import { randomUUID } from 'crypto';
import { logger, executionAttempts, executionTracer } from '../observability';
import { decryptEmail } from '../security/encryption';
import { RecoveryEmailAdapter } from '../providers/execution/email-adapter';
import { RazorpayExecutionClient } from '../providers/execution/razorpay-execution-client';
import { ExecutionOutbox, ExecutionPreconditionError, ExecutionRepository } from './execution-repository';

/** Sequential outbox worker: one email can never be sent concurrently twice. */
export class ExecutionWorker {
  private timer: ReturnType<typeof setInterval> | undefined;
  private processing = false;
  private accepting = false;

  constructor(private readonly repository: ExecutionRepository, private readonly razorpay: RazorpayExecutionClient, private readonly email: RecoveryEmailAdapter, private readonly encryptionKey: string, private readonly workerId = `execution-${process.pid}-${randomUUID()}`, private readonly pollIntervalMs = 2_000) {}

  start(): void { if (this.timer) return; this.accepting = true; this.timer = setInterval(() => void this.drain(), this.pollIntervalMs); this.timer.unref(); void this.drain(); }
  async stopAndDrain(): Promise<void> { this.accepting = false; if (this.timer) clearInterval(this.timer); this.timer = undefined; while (this.processing) await new Promise(resolve => setTimeout(resolve, 20)); await this.email.close(); }

  async processOne(): Promise<boolean> {
    if (!this.accepting || this.processing) return false;
    this.processing = true;
    try {
      return await executionTracer.startActiveSpan('payscope.execution.outbox', async span => {
        try {
          const outbox = await this.repository.claim(this.workerId);
          span.setAttribute('payscope.execution.claimed', Boolean(outbox));
          if (!outbox) return false;
          span.setAttribute('payscope.execution.capability', outbox.commandType);
          await this.process(outbox);
          return true;
        } catch (error) {
          span.recordException(error instanceof Error ? error : new Error('unknown execution worker error'));
          throw error;
        } finally { span.end(); }
      });
    } catch (error) {
      logger.error({ errorClass: error instanceof Error ? error.name : 'unknown' }, 'PayScope execution worker error');
      return false;
    } finally { this.processing = false; }
  }

  private async drain(): Promise<void> {
    if (await this.processOne() && this.accepting) queueMicrotask(() => void this.drain());
  }

  private async process(outbox: ExecutionOutbox): Promise<void> {
    try {
      const action = await this.repository.action(outbox.organizationId, outbox.actionId);
      if (['confirmed', 'failed', 'cancelled', 'unreconciled'].includes(action.state)) return this.repository.completeOutbox(outbox, this.workerId);
      if (action.emailSendStartedAt) {
        await this.repository.recordReceipt({ organizationId: action.organizationId, actionId: action.id, provider: 'smtp', kind: 'unreconciled', payload: { reason: 'worker_reclaimed_after_email_send_started' }, state: 'unreconciled', terminalReason: 'SMTP_RESULT_AMBIGUOUS_NO_RESEND' });
        executionAttempts.inc({ capability: action.capability, outcome: 'unreconciled' });
        return this.repository.completeOutbox(outbox, this.workerId);
      }
      const customerHash = text(action.commandPayload.customerHash, 64);
      const referenceId = text(action.commandPayload.referenceId, 40);
      const copyIntent = text(action.commandPayload.copyIntent, 600);
      if (!customerHash || !referenceId || !copyIntent) throw new ExecutionPreconditionError('invalid_command');
      // Resolve consented recipient before creating a Payment Link. This avoids
      // an unnecessary external object when eligibility was withdrawn while a
      // command waited in the durable outbox.
      const envelope = await this.repository.recipientEnvelope(action.organizationId, customerHash);
      let recipient: string;
      try { recipient = decryptEmail(envelope, this.encryptionKey); }
      catch { throw new ExecutionPreconditionError('invalid_recipient'); }
      let link = await this.repository.paymentLinkReceipt(action.organizationId, action.id);
      if (!link) {
        try {
          const created = await this.razorpay.createPaymentLink({ referenceId, amountPaise: action.amountPaise, currency: action.currency, description: 'Complete your pending payment securely.' });
          link = { id: created.id, url: created.shortUrl };
        } catch (error) {
          const recovered = await this.razorpay.paymentLinkByReference(referenceId).catch(() => null);
          if (!recovered) throw error;
          link = { id: recovered.id, url: recovered.shortUrl };
        }
        await this.repository.recordReceipt({ organizationId: action.organizationId, actionId: action.id, provider: 'razorpay', kind: 'payment_link_created', providerOperationId: link.id, payload: { referenceId, paymentLinkId: link.id, shortUrl: link.url }, state: 'dispatching' });
      }
      if (!await this.repository.markEmailSendStarted(action.organizationId, action.id)) {
        // A stale leased worker may have set the durable send marker after we
        // loaded the action. That is an ambiguous send, never a policy block.
        const latestAction = await this.repository.action(action.organizationId, action.id);
        if (latestAction.emailSendStartedAt) {
          await this.repository.recordReceipt({ organizationId: action.organizationId, actionId: action.id, provider: 'smtp', kind: 'unreconciled', payload: { reason: 'email_send_marker_already_exists' }, state: 'unreconciled', terminalReason: 'SMTP_RESULT_AMBIGUOUS_NO_RESEND' });
          executionAttempts.inc({ capability: action.capability, outcome: 'unreconciled' });
        } else {
          await this.repository.recordReceipt({ organizationId: action.organizationId, actionId: action.id, provider: 'smtp', kind: 'failed', payload: { reason: 'pre_dispatch_policy_recheck_failed_or_command_expired' }, state: 'failed', terminalReason: 'PRE_DISPATCH_POLICY_RECHECK_FAILED_OR_COMMAND_EXPIRED' });
          executionAttempts.inc({ capability: action.capability, outcome: 'blocked' });
        }
        return this.repository.completeOutbox(outbox, this.workerId);
      }
      try {
        const result = await this.email.send({ to: recipient, paymentLinkUrl: link.url, incidentId: action.incidentId, subject: 'Complete your pending payment', copyIntent });
        if (result.kind === 'accepted') {
          await this.repository.recordReceipt({ organizationId: action.organizationId, actionId: action.id, provider: 'smtp', kind: 'smtp_accepted', payload: { messageId: result.messageId, acceptedCount: result.acceptedCount, rejectedCount: result.rejectedCount, response: result.response }, state: 'accepted' });
          await this.repository.appendMemory(action.organizationId, action.incidentId, 'customer_message', action.id, { actionId: action.id, channel: 'email', status: 'smtp_accepted', referenceId }, 70);
          executionAttempts.inc({ capability: action.capability, outcome: 'accepted' });
        } else {
          await this.repository.recordReceipt({ organizationId: action.organizationId, actionId: action.id, provider: 'smtp', kind: 'smtp_rejected', payload: { messageId: result.messageId, response: result.response }, state: 'failed', terminalReason: 'SMTP_RECIPIENT_REJECTED' });
          executionAttempts.inc({ capability: action.capability, outcome: 'rejected' });
        }
      } catch (error) {
        await this.repository.recordReceipt({ organizationId: action.organizationId, actionId: action.id, provider: 'smtp', kind: 'unreconciled', payload: { reason: redactedErrorReason(error) }, state: 'unreconciled', terminalReason: 'SMTP_RESULT_AMBIGUOUS_NO_RESEND' });
        executionAttempts.inc({ capability: action.capability, outcome: 'unreconciled' });
      }
      return this.repository.completeOutbox(outbox, this.workerId);
    } catch (error) {
      if (error instanceof ExecutionPreconditionError) {
        await this.repository.recordReceipt({ organizationId: outbox.organizationId, actionId: outbox.actionId, provider: 'smtp', kind: 'failed', payload: { reason: error.reason }, state: 'failed', terminalReason: `PRE_DISPATCH_${error.reason.toUpperCase()}` });
        executionAttempts.inc({ capability: outbox.commandType, outcome: 'blocked' });
        return this.repository.completeOutbox(outbox, this.workerId);
      }
      logger.warn({ errorClass: error instanceof Error ? error.name : 'unknown', actionId: outbox.actionId, attempt: outbox.attemptNumber }, 'PayScope execution job will retry before SMTP dispatch');
      return this.repository.failOutbox(outbox, this.workerId, true);
    }
  }
}

function text(value: unknown, max: number): string | null { return typeof value === 'string' && value.trim() && value.length <= max ? value : null; }

function redactedErrorReason(error: unknown): string {
  const message = error instanceof Error ? error.message : 'smtp_error';
  return message.replace(/[\r\n]+/g, ' ').replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]').replace(/basic\s+\S+/gi, 'Basic [REDACTED]').slice(0, 240);
}

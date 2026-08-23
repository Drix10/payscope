import { createHash } from 'crypto';
import { SupabaseClient } from '@supabase/supabase-js';
import { EncryptedValue } from '../security/encryption';

export type ExecutionOutbox = { id: string; organizationId: string; actionId: string; commandType: 'deliver_recovery_link_email'; attemptNumber: number };
export type ExecutionAction = {
  id: string;
  organizationId: string;
  incidentId: string;
  capability: 'deliver_recovery_link_email';
  commandPayload: Record<string, unknown>;
  state: string;
  amountPaise: number;
  currency: string;
  emailSendStartedAt: string | null;
};

/** A durable command cannot become eligible again through a transport retry. */
export class ExecutionPreconditionError extends Error {
  constructor(readonly reason: 'recipient_unavailable' | 'invalid_recipient' | 'invalid_command') { super(reason); this.name = 'ExecutionPreconditionError'; }
}

export class ExecutionRepository {
  constructor(private readonly client: SupabaseClient) {}

  async claim(workerId: string): Promise<ExecutionOutbox | null> {
    const { data, error } = await this.client.rpc('payscope_claim_execution_outbox', { p_worker_id: workerId });
    if (error) throw new Error(`PayScope execution outbox claim failed: ${error.message}`);
    const row = Array.isArray(data) ? data[0] : undefined;
    if (!row || typeof row !== 'object') return null;
    const value = row as Record<string, unknown>;
    if (typeof value.id !== 'string' || typeof value.organization_id !== 'string' || typeof value.action_id !== 'string' || value.command_type !== 'deliver_recovery_link_email' || !Number.isSafeInteger(Number(value.attempt_number))) throw new Error('PayScope execution outbox row is invalid');
    return { id: value.id, organizationId: value.organization_id, actionId: value.action_id, commandType: value.command_type, attemptNumber: Number(value.attempt_number) };
  }

  async action(organizationId: string, actionId: string): Promise<ExecutionAction> {
    const { data, error } = await this.client.from('payscope_execution_actions').select('*').eq('organization_id', organizationId).eq('id', actionId).maybeSingle();
    if (error) throw new Error(`PayScope execution action lookup failed: ${error.message}`);
    if (!data || typeof data !== 'object') throw new Error('PayScope execution action was not found');
    const row = data as Record<string, unknown>;
    if (row.capability !== 'deliver_recovery_link_email' || typeof row.id !== 'string' || typeof row.organization_id !== 'string' || typeof row.incident_id !== 'string' || !isRecord(row.command_payload) || typeof row.state !== 'string' || !Number.isSafeInteger(Number(row.amount_paise)) || typeof row.currency !== 'string') throw new Error('PayScope execution action row is invalid');
    return { id: row.id, organizationId: row.organization_id, incidentId: row.incident_id, capability: row.capability, commandPayload: row.command_payload, state: row.state, amountPaise: Number(row.amount_paise), currency: row.currency, emailSendStartedAt: typeof row.email_send_started_at === 'string' ? row.email_send_started_at : null };
  }

  async recipientEnvelope(organizationId: string, customerHash: string): Promise<EncryptedValue> {
    const { data, error } = await this.client.from('payscope_recipient_emails').select('email_envelope').eq('organization_id', organizationId).eq('customer_hash', customerHash).eq('email_consent', true).is('suppressed_at', null).maybeSingle();
    if (error) throw new Error(`PayScope email recipient lookup failed: ${error.message}`);
    if (!data || !isRecord((data as Record<string, unknown>).email_envelope)) throw new ExecutionPreconditionError('recipient_unavailable');
    const envelope = (data as Record<string, unknown>).email_envelope as Record<string, unknown>;
    if (envelope.version !== 1 || typeof envelope.iv !== 'string' || typeof envelope.tag !== 'string' || typeof envelope.ciphertext !== 'string') throw new ExecutionPreconditionError('invalid_recipient');
    return envelope as EncryptedValue;
  }

  async paymentLinkReceipt(organizationId: string, actionId: string): Promise<{ id: string; url: string } | null> {
    const { data, error } = await this.client.from('payscope_execution_receipts').select('provider_operation_id, redacted_payload').eq('organization_id', organizationId).eq('action_id', actionId).eq('provider', 'razorpay').eq('receipt_kind', 'payment_link_created').order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (error) throw new Error(`PayScope Payment Link receipt lookup failed: ${error.message}`);
    if (!data || typeof data !== 'object') return null;
    const row = data as Record<string, unknown>;
    const payload = row.redacted_payload;
    if (typeof row.provider_operation_id !== 'string' || !isRecord(payload) || typeof payload.shortUrl !== 'string') throw new Error('PayScope Payment Link receipt is invalid');
    return { id: row.provider_operation_id, url: payload.shortUrl };
  }

  async markEmailSendStarted(organizationId: string, actionId: string): Promise<boolean> {
    const { data, error } = await this.client.rpc('payscope_mark_email_send_started', { p_organization_id: organizationId, p_action_id: actionId });
    if (error) throw new Error(`PayScope email dispatch marker failed: ${error.message}`);
    return data === true;
  }

  async recordReceipt(input: { organizationId: string; actionId: string; provider: 'razorpay' | 'smtp'; kind: 'payment_link_created' | 'payment_link_paid' | 'smtp_accepted' | 'smtp_rejected' | 'unreconciled' | 'failed'; providerOperationId?: string; payload: Record<string, unknown>; state: 'dispatching' | 'accepted' | 'unreconciled' | 'confirmed' | 'failed'; terminalReason?: string }): Promise<void> {
    const { error } = await this.client.rpc('payscope_record_execution_receipt', {
      p_organization_id: input.organizationId,
      p_action_id: input.actionId,
      p_provider: input.provider,
      p_receipt_kind: input.kind,
      p_provider_operation_id: input.providerOperationId ?? '',
      p_receipt_hash: hash(input.payload),
      p_redacted_payload: input.payload,
      p_state: input.state,
      p_terminal_reason: input.terminalReason ?? null,
    });
    if (error) throw new Error(`PayScope execution receipt persistence failed: ${error.message}`);
  }

  async completeOutbox(outbox: ExecutionOutbox, workerId: string): Promise<void> {
    const { data, error } = await this.client.from('payscope_execution_outbox').update({ status: 'complete', updated_at: new Date().toISOString() }).eq('id', outbox.id).eq('status', 'running').eq('locked_by', workerId).select('id').maybeSingle();
    if (error || !data) throw new Error(`PayScope execution outbox completion failed: ${error?.message ?? 'lease lost'}`);
  }

  async failOutbox(outbox: ExecutionOutbox, workerId: string, retry: boolean): Promise<void> {
    const nextAttempt = outbox.attemptNumber + 1;
    const update = retry && nextAttempt <= 4
      ? { status: 'pending', attempt_number: nextAttempt, next_attempt_at: new Date(Date.now() + [1_000, 5_000, 30_000][Math.min(outbox.attemptNumber - 1, 2)]).toISOString(), locked_at: null, locked_by: null, updated_at: new Date().toISOString() }
      : { status: 'dead', locked_at: null, locked_by: null, updated_at: new Date().toISOString() };
    const { data, error } = await this.client.from('payscope_execution_outbox').update(update).eq('id', outbox.id).eq('status', 'running').eq('locked_by', workerId).select('id').maybeSingle();
    if (error || !data) throw new Error(`PayScope execution outbox failure update failed: ${error?.message ?? 'lease lost'}`);
  }

  async appendMemory(organizationId: string, incidentId: string, memoryType: 'execution' | 'customer_message', sourceId: string, content: Record<string, unknown>, importance: number): Promise<void> {
    if (!sourceId || sourceId.length > 160 || !Number.isInteger(importance) || importance < 0 || importance > 100 || Buffer.byteLength(JSON.stringify(content), 'utf8') > 1_200) throw new Error('PayScope incident memory write is outside bounded limits');
    const { error } = await this.client.from('payscope_incident_memory').insert({ organization_id: organizationId, incident_id: incidentId, memory_type: memoryType, source_id: sourceId, content, content_hash: hash(content), importance });
    if (error && !/duplicate key/i.test(error.message)) throw new Error(`PayScope incident memory write failed: ${error.message}`);
  }
}

function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }

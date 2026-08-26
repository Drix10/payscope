import { RuntimeConfig } from '../config/runtime-config';
import { MvpRepository } from '../db/mvp-repository';
import { normalizeRazorpayWebhook, rawPayloadHash, razorpayWebhookEventType } from './webhook-intake';
import { isPayScopeIncidentEvent } from './webhook-event-policy';
import { verifyRazorpayCallbackSignature } from '../providers/execution/callback-verifier';

export type AgenticWebhookResult = { eventId: string | null; duplicate: boolean; ignored: boolean };

/** Feature-gated durable webhook path. It is enabled only after the migration is applied. */
export class AgenticWebhookIntake {
  constructor(private readonly repository: MvpRepository, private readonly config: RuntimeConfig) {}

  async receive(rawBody: Buffer, signature: string | undefined, razorpayEventId: string | undefined): Promise<AgenticWebhookResult> {
    if (!this.config.organizationId) throw new Error('PAYSCOPE_ORGANIZATION_ID is required when PAYSCOPE_PIPELINE_ENABLED=true');
    verifyRazorpayCallbackSignature(rawBody, signature, this.config.webhookSecret!, this.config.previousWebhookSecret);
    // Validate the signature before looking at event content, then acknowledge
    // out-of-scope Razorpay events without persisting their payload or PII.
    if (!isPayScopeIncidentEvent(razorpayWebhookEventType(rawBody))) return { eventId: null, duplicate: false, ignored: true };
    const organization = await this.repository.demoOrganization(this.config.organizationId);
    const normalized = normalizeRazorpayWebhook(rawBody, razorpayEventId ?? '', organization.customerHashSecret);
    const stored = await this.repository.ingestEventWithEnrichmentJob(organization.id, normalized.eventId, rawPayloadHash(rawBody), normalized);
    if (this.config.directExecutionEnabled && !stored.duplicate) {
      await this.repository.reconcileDirectPaymentLinkEvent(organization.id, normalized);
      if (normalized.customerHash) {
        if (normalized.eventType === 'payment.captured') {
          await this.repository.upsertCustomerProfileOnCaptured(organization.id, normalized.customerHash, normalized.paymentMethod);
        } else if (normalized.eventType === 'payment.failed') {
          await this.repository.upsertCustomerProfileOnFailed(organization.id, normalized.customerHash, normalized.paymentMethod);
        }
      }
    }
    return { ...stored, ignored: false };
  }
}

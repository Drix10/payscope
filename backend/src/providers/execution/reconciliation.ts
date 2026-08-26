import { SupabaseClient } from '@supabase/supabase-js';
import { stableHash } from '../../execution/execution-repository';
import { logger, strategyPerformanceEvents } from '../../observability';

/**
 * Monotonic reconciliation: duplicate/late callbacks enrich but never regress terminal states.
 * Cross-tenant/replayed/unknown callbacks rejected without second action.
 */
export class Reconciler {
  constructor(private readonly client: SupabaseClient) { }

  async reconcilePaymentLinkPaid(organizationId: string, referenceId: string, eventId: string, paymentId: string | null, amountPaise?: number | null): Promise<string | null> {
    if (!/^ps_[a-f0-9]{32}$/i.test(referenceId)) return null;
    if (!organizationId || !eventId || eventId.length > 320) return null;
    // Organization-scoped lookup: prevents cross-tenant creation of a second action.
    const { data, error } = await this.client.from('payscope_execution_actions').select('id, state, incident_id, updated_at').eq('organization_id', organizationId).eq('capability', 'deliver_recovery_link_email').eq('command_payload->>referenceId', referenceId).limit(1).maybeSingle();
    if (error) throw new Error(`Reconciliation lookup failed: ${error.message}`);
    const row = data as Record<string, unknown> | null;
    if (!row || typeof row.id !== 'string') return null; // unknown callback -> no second action (do NOT create one)
    const actionId = row.id as string;
    const payload = { referenceId, razorpayEventId: eventId, paymentId: paymentId ?? null };
    const receiptHash = stableHash(payload);
    // First record receipt idempotently (unique on org,action,provider,receipt_kind,hash handles duplicate hash)
    const { error: receiptError } = await this.client.rpc('payscope_record_execution_receipt', {
      p_organization_id: organizationId, p_action_id: actionId, p_provider: 'razorpay', p_receipt_kind: 'payment_link_paid', p_provider_operation_id: paymentId ?? '', p_receipt_hash: receiptHash, p_redacted_payload: payload, p_state: 'confirmed', p_terminal_reason: 'PAYMENT_LINK_PAID',
    });
    // If receipt already exists (23505), treat as success – monotonic path still needs reconcile call but it's idempotent.
    if (receiptError && !/duplicate key|already exists/i.test(receiptError.message)) throw new Error(`Reconciliation receipt failed: ${receiptError.message}`);
    // Monotonic reconcile: newer canonical read wins, terminal states never regress
    const { error: reconcileError } = await this.client.rpc('payscope_reconcile_action', {
      p_organization_id: organizationId, p_action_id: actionId, p_provider: 'razorpay', p_receipt_kind: 'payment_link_paid', p_provider_event_id: eventId, p_verified_at: new Date().toISOString(), p_is_canonical_read: false, p_target_state: 'confirmed',
    });
    // If monotonic skipped, error is null and function logs skipped; we swallow
    if (reconcileError && !/monotonic|skipped/i.test(reconcileError.message)) throw new Error(`Reconciliation transition failed: ${reconcileError.message}`);
    strategyPerformanceEvents.inc({ strategy: 'deliver_recovery_link_email', outcome: 'confirmed' });
    // Close learning ledger: paid amount is the captured amount when available, else the action's amount (economically correct)
    const actualRecovery = Number.isSafeInteger(amountPaise) && (amountPaise as number) > 0 ? (amountPaise as number) : null;
    await this.client.rpc('payscope_record_recovery_outcome', {
      p_organization_id: organizationId, p_action_id: actionId, p_outcome: 'paid', p_actual_recovery_paise: actualRecovery,
    }).then(
      () => {},
      (e) => { logger.warn({ organizationId, actionId, error: e instanceof Error ? e.message : String(e) }, 'Recovery outcome ledger close failed (paid)'); }
    );
    return typeof row.incident_id === 'string' ? row.incident_id : null;
  }

  async reconcilePaymentLinkExpired(organizationId: string, referenceId: string, eventId: string): Promise<string | null> {
    if (!/^ps_[a-f0-9]{32}$/i.test(referenceId)) return null;
    if (!organizationId || !eventId || eventId.length > 320) return null;
    const { data, error } = await this.client.from('payscope_execution_actions').select('id, state, incident_id').eq('organization_id', organizationId).eq('capability', 'deliver_recovery_link_email').eq('command_payload->>referenceId', referenceId).limit(1).maybeSingle();
    if (error) throw new Error(`Expired-link reconciliation lookup failed: ${error.message}`);
    const row = data as Record<string, unknown> | null;
    if (!row || typeof row.id !== 'string') return null;
    const { error: compensationError } = await this.client.rpc('payscope_record_compensation', {
      p_organization_id: organizationId,
      p_action_id: row.id,
      p_parent_action_id: null,
      p_reason: `payment_link_expired:${eventId.slice(0, 240)}`,
      p_target_state: compensationTarget('link_expired'),
    });
    if (compensationError) throw new Error(`Expired-link compensation failed: ${compensationError.message}`);
    strategyPerformanceEvents.inc({ strategy: 'deliver_recovery_link_email', outcome: 'cancelled' });
    await this.client.rpc('payscope_record_recovery_outcome', {
      p_organization_id: organizationId, p_action_id: row.id, p_outcome: 'expired', p_actual_recovery_paise: 0,
    }).then(
      () => {},
      (e) => { logger.warn({ organizationId, actionId: row.id, error: e instanceof Error ? e.message : String(e) }, 'Recovery outcome ledger close failed (expired)'); }
    );
    return typeof row.incident_id === 'string' ? row.incident_id : null;
  }

  async verifyAndStoreCallback(input: { organizationId: string; provider: 'razorpay'; providerEventId: string; dedupeKey: string; rawBodyEncrypted: Record<string, unknown>; verifiedSecretVersion: 1 | 2; source: string; normalized: Record<string, unknown>; actionMatch: Record<string, unknown> | null }): Promise<void> {
    const { error } = await this.client.rpc('payscope_verify_and_store_callback', {
      p_organization_id: input.organizationId, p_provider: input.provider, p_provider_event_id: input.providerEventId, p_dedupe_key: input.dedupeKey, p_raw_body_encrypted: input.rawBodyEncrypted, p_verified_secret_version: input.verifiedSecretVersion, p_source: input.source, p_normalized: input.normalized, p_action_match: input.actionMatch,
    });
    if (error) throw new Error(`Callback verification store failed: ${error.message}`);
  }
}

export type CompensationReason = 'link_expired' | 'link_cancelled' | 'smtp_pre_send_failed' | 'refund_failed' | 'capture_race' | 'dispute_deadline';

export function compensationTarget(reason: CompensationReason): string {
  switch (reason) {
    case 'link_expired': return 'cancelled';
    case 'link_cancelled': return 'cancelled';
    case 'smtp_pre_send_failed': return 'failed';
    case 'refund_failed': return 'failed';
    case 'capture_race': return 'failed';
    case 'dispute_deadline': return 'failed';
    default: return 'failed';
  }
}

/**
 * The one authoritative source for non-financial proposal limits.
 * These values apply to the buildathon MVP only and are enforced by the
 * deterministic policy evaluator, never delegated to a model.
 */
export const STOPPING_RULES = {
  MAX_CONTACT_ATTEMPTS_PER_INCIDENT: 2,
  MAX_CONTACT_ATTEMPTS_PER_CUSTOMER_PER_24H: 1,
  MAX_CONTACT_ATTEMPTS_PER_CUSTOMER_PER_7D: 3,
  NO_CONTACT_AFTER_DISPUTE_OPENED: true,
  NO_CONTACT_ON_FRAUD_CONFIRMED: true,
  NO_CONTACT_WITHOUT_MERCHANT_OPT_IN: true,
  AUTO_RESOLVE_RATE_CEILING_PER_ORG_PER_DAY: 0.90,
} as const;

export const RECOVERY_WINDOW_MS = 72 * 60 * 60 * 1_000;
export const WEBHOOK_ACK_TARGET_MS = 500;
export const ENRICHMENT_TIMEOUT_MS = 5_000;
// Mesh may take several seconds to honor a provider-side JSON Schema. Keep
// the end-to-end agent run under the MVP's 10-second target without treating
// normal gateway latency as a failed payment investigation.
export const MODEL_TIMEOUT_MS = 15_000;
export const QUEUE_LOCK_TIMEOUT_MS = 30_000;
export const QUEUE_RETRY_DELAYS_MS = [1_000, 5_000, 30_000] as const;

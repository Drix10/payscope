import { createHmac, timingSafeEqual } from 'crypto';
import { AppError } from '../../domain/contracts';

export type VerifiedCallback = {
  provider: 'razorpay';
  providerEventId: string;
  dedupeKey: string;
  verifiedSecretVersion: 1 | 2;
  normalized: Record<string, unknown>;
  actionMatch: Record<string, unknown> | null;
};

/**
 * Verifies Razorpay callback signature BEFORE parsing or matching.
 * Supports secret rotation: tries active and previous secret (bounded window).
 * Throws AppError so the webhook handler maps failures to the correct status.
 */
export function verifyRazorpayCallbackSignature(
  rawBody: Buffer,
  signature: string | undefined,
  activeSecret: string,
  previousSecret?: string,
): 1 | 2 {
  if (!activeSecret || activeSecret.length < 16) throw new AppError('WEBHOOK_NOT_CONFIGURED', 503, 'Razorpay webhook verification is not configured');
  // Signature must be 64 hex chars (sha256). Normalize to lower-case; Buffer handles case-insensitive but we enforce strict shape.
  if (!signature || !/^[a-f0-9]{64}$/i.test(signature.trim())) throw new AppError('INVALID_WEBHOOK_SIGNATURE', 401, 'Razorpay webhook signature is missing or invalid');
  const provided = Buffer.from(signature.trim().toLowerCase(), 'hex');
  if (provided.length !== 32) throw new AppError('INVALID_WEBHOOK_SIGNATURE', 401, 'Razorpay webhook signature is invalid');
  const calc = (secret: string) => createHmac('sha256', secret).update(rawBody).digest();
  const active = calc(activeSecret);
  if (timingSafeEqual(provided, active)) return 1;
  if (previousSecret && previousSecret.length >= 16) {
    const prev = calc(previousSecret);
    if (timingSafeEqual(provided, prev)) return 2;
  }
  throw new AppError('INVALID_WEBHOOK_SIGNATURE', 401, 'Razorpay webhook signature is invalid');
}

export function parseCallbackEnvelope(rawBody: Buffer): { eventId: string; eventType: string; payload: Record<string, unknown> } {
  if (!Buffer.isBuffer(rawBody) || rawBody.length === 0 || rawBody.length > 512 * 1024) throw new AppError('INVALID_RAZORPAY_EVENT', 422, 'Razorpay webhook body is invalid');
  let parsed: unknown;
  try { parsed = JSON.parse(rawBody.toString('utf8')); } catch { throw new AppError('INVALID_RAZORPAY_EVENT', 422, 'Razorpay webhook body must be valid JSON'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new AppError('INVALID_RAZORPAY_EVENT', 422, 'Razorpay webhook body must be valid JSON');
  const row = parsed as Record<string, unknown>;
  // Razorpay may use event_id, id, or provider-specific id fields; check all.
  const eventId = typeof row.event_id === 'string' && row.event_id.trim() ? row.event_id.trim().slice(0, 320)
    : typeof row.id === 'string' && row.id.trim() ? row.id.trim().slice(0, 320)
    : typeof (row as Record<string, unknown>).entity_id === 'string' ? String((row as Record<string, unknown>).entity_id).slice(0, 320) : '';
  const eventType = typeof row.event === 'string' && row.event.trim() ? row.event.trim().slice(0, 120) : '';
  if (!eventId || !eventType || eventId.length < 3 || eventType.length < 3) throw new AppError('INVALID_RAZORPAY_EVENT', 422, 'Razorpay webhook event ID is required');
  return { eventId, eventType, payload: row };
}

export function normalizeCallback(eventType: string, payload: Record<string, unknown>): Record<string, unknown> {
  // Minimal normalized evidence; never store raw payload long-term.
  // Explicitly DO NOT echo raw provider payload; only redacted presence flags.
  const inner = (payload as Record<string, unknown>).payload as Record<string, unknown> | undefined;
  const hasPayment = Boolean(inner && typeof inner === 'object' && (inner.payment || inner.order || inner.payment_link));
  // Clamp eventType to allowlist shape to avoid injection into DB/log.
  const safeEvent = /^[a-z0-9._-]{3,120}$/i.test(eventType) ? eventType : 'unknown';
  return { eventType: safeEvent, normalizedAt: new Date().toISOString(), hasPayment, provider: 'razorpay' };
}

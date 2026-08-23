import { createHash, createHmac } from 'crypto';
import { AppError } from '../errors';
import { NormalizedEvent, NormalizedEventSchema } from '../domain/contracts';

type UnknownRecord = Record<string, unknown>;

function object(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function text(value: unknown, max = 160): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;
}

function currency(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^[a-z]{3}$/i.test(value.trim())) return undefined;
  return value.trim().toUpperCase();
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function timestamp(value: unknown): string | undefined {
  const seconds = number(value);
  if (seconds === undefined) return undefined;
  const date = new Date(seconds * 1_000);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** Parses only the event name needed to decide whether this endpoint owns it. */
export function razorpayWebhookEventType(rawBody: Buffer): string {
  let parsed: unknown;
  try { parsed = JSON.parse(rawBody.toString('utf8')); } catch { throw new AppError('INVALID_RAZORPAY_EVENT', 422, 'Razorpay webhook body must be valid JSON'); }
  const eventType = text(object(parsed).event, 120);
  if (!eventType) throw new AppError('INVALID_RAZORPAY_EVENT', 422, 'Razorpay webhook event type is required');
  return eventType;
}

function hashCustomer(customerReference: string | undefined, customerHashSecret: string): string | undefined {
  if (!customerReference) return undefined;
  // An HMAC makes the per-organization secret an actual keyed boundary rather
  // than merely an opaque prefix in a plain digest.
  return createHmac('sha256', customerHashSecret).update(customerReference.trim().toLowerCase()).digest('hex');
}

export function rawPayloadHash(rawBody: Buffer): string {
  return createHash('sha256').update(rawBody).digest('hex');
}

/** Converts only allowlisted Razorpay fields. Raw provider payload never escapes this function. */
export function normalizeRazorpayWebhook(rawBody: Buffer, razorpayEventId: string, customerHashSecret: string, receivedAt = new Date().toISOString()): NormalizedEvent {
  if (!razorpayEventId.trim() || razorpayEventId.length > 160) throw new AppError('INVALID_RAZORPAY_EVENT', 422, 'Razorpay webhook event ID is required');
  let parsed: unknown;
  try { parsed = JSON.parse(rawBody.toString('utf8')); } catch { throw new AppError('INVALID_RAZORPAY_EVENT', 422, 'Razorpay webhook body must be valid JSON'); }
  const envelope = object(parsed);
  const payload = object(envelope.payload);
  const payment = object(object(payload.payment).entity);
  const order = object(object(payload.order).entity);
  const subscription = object(object(payload.subscription).entity);
  const paymentLink = object(object(payload.payment_link).entity);
  const eventType = razorpayWebhookEventType(rawBody);
  const occurredAt = timestamp(payment.created_at) ?? timestamp(order.created_at) ?? timestamp(subscription.created_at) ?? timestamp(paymentLink.created_at) ?? timestamp(envelope.created_at);
  if (!occurredAt) throw new AppError('INVALID_RAZORPAY_EVENT', 422, 'Razorpay webhook event timestamp is required');
  const customerReference = text(payment.customer_id) ?? text(order.customer_id) ?? text(subscription.customer_id) ?? text(paymentLink.customer_id);
  const providerData: UnknownRecord = {};
  for (const key of ['error_source', 'error_step', 'error_reason', 'error_code', 'attempts', 'international']) {
    const value = payment[key];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') providerData[key] = value;
  }
  const orderAmountPaise = number(order.amount);
  if (orderAmountPaise !== undefined) providerData.order_amount_paise = orderAmountPaise;
  const paymentLinkReferenceId = text(paymentLink.reference_id);
  if (paymentLinkReferenceId) providerData.payment_link_reference_id = paymentLinkReferenceId;
  const acquirerData = allowlistedAcquirerData(object(payment.acquirer_data));
  if (Object.keys(acquirerData).length) providerData.acquirer_data = acquirerData;
  return NormalizedEventSchema.parse({
    eventId: razorpayEventId.trim(),
    eventType,
    occurredAt,
    receivedAt,
    paymentId: text(payment.id),
    orderId: text(payment.order_id) ?? text(order.id) ?? text(paymentLink.order_id),
    subscriptionId: text(payment.subscription_id) ?? text(subscription.id),
    customerHash: hashCustomer(customerReference, customerHashSecret),
    currency: currency(payment.currency) ?? currency(order.currency) ?? currency(paymentLink.currency),
    amountPaise: number(payment.amount) ?? number(order.amount) ?? number(paymentLink.amount),
    paymentStatus: text(payment.status, 80) ?? text(order.status, 80) ?? text(paymentLink.status, 80),
    paymentMethod: text(payment.method, 80),
    providerData,
  });
}

function allowlistedAcquirerData(input: UnknownRecord): UnknownRecord {
  const allowed = ['rrn', 'auth_code', 'reference_number', 'transaction_id'];
  const result: UnknownRecord = {};
  for (const key of allowed) {
    const value = input[key];
    if (typeof value === 'string' && value.length <= 160) result[key] = value;
  }
  return result;
}

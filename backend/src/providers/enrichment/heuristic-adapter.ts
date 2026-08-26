import { ENRICHMENT_TIMEOUT_MS } from '../../config/config';
import { NormalizedEvent, VulcanEnrichment, VulcanEnrichmentSchema } from '../../domain/contracts';
import { EnrichmentProvider } from './interface';

type RazorpayPayment = Record<string, unknown>;
type RazorpayDowntimes = Record<string, unknown>;

export interface RazorpayEnrichmentClient {
  fetchPayment(paymentId: string): Promise<RazorpayPayment>;
  fetchDowntimes(): Promise<RazorpayDowntimes>;
}

export class RazorpayHttpEnrichmentClient implements RazorpayEnrichmentClient {
  private downtimeCache: { value: RazorpayDowntimes; expiresAt: number } | undefined;
  private downtimeRequest: Promise<RazorpayDowntimes> | undefined;

  constructor(
    private readonly keyId: string,
    private readonly keySecret: string,
    private readonly timeoutMs = ENRICHMENT_TIMEOUT_MS,
    private readonly downtimeCacheMs = 30_000,
  ) {}

  async fetchPayment(paymentId: string): Promise<RazorpayPayment> {
    return this.fetchJson(`/v1/payments/${encodeURIComponent(paymentId)}`);
  }

  async fetchDowntimes(): Promise<RazorpayDowntimes> {
    const now = Date.now();
    if (this.downtimeCache && this.downtimeCache.expiresAt > now) return this.downtimeCache.value;
    if (this.downtimeRequest) return this.downtimeRequest;
    this.downtimeRequest = this.fetchJson('/v1/payments/downtimes')
      .then(value => {
        this.downtimeCache = { value, expiresAt: Date.now() + this.downtimeCacheMs };
        return value;
      })
      .finally(() => { this.downtimeRequest = undefined; });
    return this.downtimeRequest;
  }

  private async fetchJson(path: string): Promise<Record<string, unknown>> {
    const authorization = Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64');
    const response = await fetch(`https://api.razorpay.com${path}`, {
      headers: { Authorization: `Basic ${authorization}` },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const data: unknown = await response.json().catch(() => ({}));
    if (!response.ok || !isRecord(data)) throw new Error(`Razorpay enrichment request failed (${response.status})`);
    return data;
  }
}

/**
 * Transparent public-field telemetry enrichment adapter.
 */
export class HeuristicEnrichmentAdapter implements EnrichmentProvider {
  constructor(private readonly client: RazorpayEnrichmentClient | undefined, private readonly now: () => Date = () => new Date()) {}

  async isAvailable(): Promise<boolean> {
    return Boolean(this.client);
  }

  async enrich(event: NormalizedEvent): Promise<VulcanEnrichment> {
    let payment: RazorpayPayment = {};
    let downtimes: RazorpayDowntimes = {};
    if (this.client && event.paymentId) {
      [payment, downtimes] = await Promise.all([
        this.client.fetchPayment(event.paymentId).catch(() => ({})),
        this.client.fetchDowntimes().catch(() => ({})),
      ]);
    }
    const source = { ...event.providerData, ...allowlistedPaymentFields(payment) };
    const errorSource = string(source.error_source)?.toLowerCase();
    const errorStep = string(source.error_step)?.toLowerCase();
    const errorReason = string(source.error_reason)?.toLowerCase();
    const activeDowntime = hasActiveDowntime(downtimes, event.paymentMethod);
    
    const acquirerData = (event.providerData.acquirer_data ?? payment.acquirer_data) as Record<string, unknown> | undefined;
    const hasAuthCode = typeof acquirerData?.auth_code === 'string' && acquirerData.auth_code.length > 0;
    const hasRrn = typeof acquirerData?.rrn === 'string' && acquirerData.rrn.length > 0;

    const failureAttribution = attribution(errorSource, errorStep, errorReason, activeDowntime, Boolean(event.subscriptionId), hasAuthCode);
    const enrichmentSource = 'razorpay_fields_heuristic';
    const signalsUsed = [
      event.subscriptionId ? 'subscription_mandate' : undefined,
      hasAuthCode ? 'acquirer_auth_code' : undefined,
      hasRrn ? 'acquirer_rrn' : undefined,
      errorSource ? 'error_source' : undefined,
      errorStep ? 'error_step' : undefined,
      errorReason ? 'error_reason' : undefined,
      typeof source.attempts === 'number' ? 'attempts' : undefined,
      typeof source.international === 'boolean' ? 'international' : undefined,
      Object.keys(downtimes).length ? 'downtimes' : undefined,
    ].filter((signal): signal is string => Boolean(signal));
    const retry = recommendedRetryMethod(failureAttribution, event.paymentMethod);

    return VulcanEnrichmentSchema.parse({
      failureAttribution,
      gatewayHealthScore: activeDowntime ? 0.2 : failureAttribution === 'gateway_degraded' ? 0.4 : 1,
      gatewayInDowntime: activeDowntime,
      downtimeScheduled: hasScheduledDowntime(downtimes),
      crossBorderFlag: source.international === true,
      priorAttemptCount: safeInteger(source.attempts) ?? 0,
      partialRecoveryPossible: isPartialCapture(event, source),
      recommendedRetryMethod: retry,
      source: enrichmentSource,
      enrichedAt: this.now().toISOString(),
      signalsUsed,
    });
  }
}

function attribution(errorSource: string | undefined, errorStep: string | undefined, errorReason: string | undefined, activeDowntime: boolean, isSubscription = false, hasAuthCode = false): VulcanEnrichment['failureAttribution'] {
  if (isSubscription && (errorReason?.includes('mandate') || errorReason?.includes('lapse') || errorSource === 'customer')) return 'subscription_lapse';
  if (errorReason?.includes('fraud')) return 'fraud_block';
  if (errorReason?.includes('insufficient') || errorReason?.includes('balance')) return 'insufficient_funds';
  if (errorSource === 'bank' && (errorStep === 'authorization' || errorStep === 'payment_authorization')) return 'issuer_timeout';
  if (errorSource === 'customer') return 'customer_drop';
  if (errorSource === 'gateway' && activeDowntime) return 'gateway_degraded';
  if (errorSource === 'gateway' && !hasAuthCode) return 'gateway_degraded';
  if (errorSource === 'gateway') return 'routing_suboptimal';
  return 'unknown';
}

function recommendedRetryMethod(failureAttribution: VulcanEnrichment['failureAttribution'], currentMethod: string | undefined): string | null {
  if (failureAttribution === 'gateway_degraded' || failureAttribution === 'routing_suboptimal') return currentMethod === 'upi' ? 'netbanking' : 'upi';
  if (failureAttribution === 'issuer_timeout' || failureAttribution === 'subscription_lapse') return currentMethod ?? null;
  return null;
}

function allowlistedPaymentFields(payment: RazorpayPayment): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const key of ['error_source', 'error_step', 'error_reason', 'attempts', 'international']) {
    const value = payment[key];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') fields[key] = value;
  }
  return fields;
}

function isPartialCapture(event: NormalizedEvent, source: Record<string, unknown>): boolean {
  const orderAmount = safeInteger(source.order_amount_paise);
  return (event.eventType === 'payment.captured' || event.eventType === 'order.paid') &&
    event.amountPaise !== undefined && orderAmount !== undefined && event.amountPaise < orderAmount;
}

function hasActiveDowntime(value: RazorpayDowntimes, method: string | undefined): boolean {
  const items = arraysIn(value);
  // Razorpay documents an in-progress downtime as `started`; accept `active`
  // too for fixture/backward compatibility, but never treat `scheduled` as an
  // active outage.
  return items.some(item => (item.status === 'started' || item.status === 'active') && (!method || item.method === undefined || item.method === method));
}

function hasScheduledDowntime(value: RazorpayDowntimes): boolean {
  return arraysIn(value).some(item => item.status === 'scheduled');
}

function arraysIn(value: Record<string, unknown>): Record<string, unknown>[] {
  return Object.values(value).flatMap(item => Array.isArray(item) ? item.filter(isRecord) : []);
}

function string(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value.trim() : undefined; }
function safeInteger(value: unknown): number | undefined { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined; }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }

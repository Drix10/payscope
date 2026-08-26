import { logger } from '../../observability';

export interface RazorpayOrderDetails {
  id: string;
  status: string;
  amount: number;
  amountDue: number;
  amountPaid: number;
  currency: string;
  receipt: string | null;
}

export interface RazorpaySubscriptionDetails {
  id: string;
  planId: string;
  status: string;
  chargeAt: number | null;
  remainingCount: number;
  totalCount: number;
  currentPeriodEnd: number | null;
}

export interface RazorpayPaymentLinkItem {
  id: string;
  status: string;
  amount: number;
  capturedAt: string | null;
}

export interface RazorpayDisputeDetails {
  id: string;
  paymentId: string;
  amount: number;
  currency: string;
  status: string;
  dueBy: string;
  evidenceSubmitted: boolean;
}

export interface RazorpayPaymentDetails {
  id: string;
  status: string;
  amount: number;
  currency: string;
  method: string | null;
  international: boolean;
  errorSource: string | null;
  errorStep: string | null;
  errorReason: string | null;
  acquirerData: { authCode?: string; rrn?: string } | null;
}

/**
 * Read-only Razorpay API client. Never performs financial state mutations.
 */
export class RazorpayReadClient {
  private readonly authHeader: string;

  constructor(
    private readonly keyId: string,
    private readonly keySecret: string,
    private readonly timeoutMs = 8_000,
    private readonly endpoint = 'https://api.razorpay.com/v1',
    private readonly fetcher: typeof fetch = fetch
  ) {
    this.authHeader = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`;
  }

  private async request<T>(path: string): Promise<T | null> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(new Error(`Razorpay read request timed out after ${this.timeoutMs}ms`)), this.timeoutMs);
    try {
      const response = await this.fetcher(`${this.endpoint}${path}`, {
        method: 'GET',
        headers: {
          authorization: this.authHeader,
          'content-type': 'application/json',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        if (response.status === 404) return null;
        logger.warn({ path, status: response.status }, 'Razorpay read request failed');
        return null;
      }

      return (await response.json()) as T;
    } catch (err) {
      logger.warn({ path, error: err instanceof Error ? err.message : String(err) }, 'Razorpay read request error');
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async fetchOrder(orderId: string): Promise<RazorpayOrderDetails | null> {
    const raw = await this.request<Record<string, unknown>>(`/orders/${encodeURIComponent(orderId)}`);
    if (!raw || typeof raw.id !== 'string') return null;
    return {
      id: raw.id,
      status: String(raw.status ?? 'unknown'),
      amount: Number(raw.amount ?? 0),
      amountDue: Number(raw.amount_due ?? 0),
      amountPaid: Number(raw.amount_paid ?? 0),
      currency: String(raw.currency ?? 'INR'),
      receipt: typeof raw.receipt === 'string' ? raw.receipt : null,
    };
  }

  async fetchSubscription(subscriptionId: string): Promise<RazorpaySubscriptionDetails | null> {
    const raw = await this.request<Record<string, unknown>>(`/subscriptions/${encodeURIComponent(subscriptionId)}`);
    if (!raw || typeof raw.id !== 'string') return null;
    return {
      id: raw.id,
      planId: String(raw.plan_id ?? ''),
      status: String(raw.status ?? 'unknown'),
      chargeAt: typeof raw.charge_at === 'number' ? raw.charge_at : null,
      remainingCount: Number(raw.remaining_count ?? 0),
      totalCount: Number(raw.total_count ?? 0),
      currentPeriodEnd: typeof raw.current_end === 'number' ? raw.current_end : null,
    };
  }

  async fetchPaymentLinkPayments(paymentLinkId: string): Promise<RazorpayPaymentLinkItem[]> {
    const raw = await this.request<{ items?: Array<Record<string, unknown>> }>(`/payment_links/${encodeURIComponent(paymentLinkId)}/payments`);
    if (!raw || !Array.isArray(raw.items)) return [];
    return raw.items.map(item => ({
      id: String(item.id ?? ''),
      status: String(item.status ?? 'unknown'),
      amount: Number(item.amount ?? 0),
      capturedAt: item.created_at ? new Date(Number(item.created_at) * 1000).toISOString() : null,
    }));
  }

  async fetchDispute(disputeId: string): Promise<RazorpayDisputeDetails | null> {
    const raw = await this.request<Record<string, unknown>>(`/disputes/${encodeURIComponent(disputeId)}`);
    if (!raw || typeof raw.id !== 'string') return null;
    return {
      id: raw.id,
      paymentId: String(raw.payment_id ?? ''),
      amount: Number(raw.amount ?? 0),
      currency: String(raw.currency ?? 'INR'),
      status: String(raw.status ?? 'open'),
      dueBy: raw.due_by ? new Date(Number(raw.due_by) * 1000).toISOString() : new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
      evidenceSubmitted: Boolean(raw.evidence_submitted),
    };
  }

  async fetchPayment(paymentId: string): Promise<RazorpayPaymentDetails | null> {
    const raw = await this.request<Record<string, unknown>>(`/payments/${encodeURIComponent(paymentId)}`);
    if (!raw || typeof raw.id !== 'string') return null;
    const acq = typeof raw.acquirer_data === 'object' && raw.acquirer_data !== null ? raw.acquirer_data as Record<string, unknown> : null;
    return {
      id: raw.id,
      status: String(raw.status ?? 'failed'),
      amount: Number(raw.amount ?? 0),
      currency: String(raw.currency ?? 'INR'),
      method: typeof raw.method === 'string' ? raw.method : null,
      international: Boolean(raw.international),
      errorSource: typeof raw.error_source === 'string' ? raw.error_source : null,
      errorStep: typeof raw.error_step === 'string' ? raw.error_step : null,
      errorReason: typeof raw.error_reason === 'string' ? raw.error_reason : null,
      acquirerData: acq ? {
        authCode: typeof acq.auth_code === 'string' ? acq.auth_code : undefined,
        rrn: typeof acq.rrn === 'string' ? acq.rrn : undefined,
      } : null,
    };
  }

  async paymentLinkByReference(referenceId: string): Promise<{ id: string; status: string; amount: number; referenceId: string } | null> {
    const raw = await this.request<{ items?: Array<Record<string, unknown>> }>(`/payment_links?reference_id=${encodeURIComponent(referenceId)}`);
    if (!raw || !Array.isArray(raw.items) || raw.items.length === 0) return null;
    const item = raw.items[0];
    return {
      id: String(item.id ?? ''),
      status: String(item.status ?? 'created'),
      amount: Number(item.amount ?? 0),
      referenceId: String(item.reference_id ?? referenceId),
    };
  }
}

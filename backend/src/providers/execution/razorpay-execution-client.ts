export type RazorpayPaymentLink = { id: string; shortUrl: string; referenceId: string; status: string; amount: number; currency: string };
export type RazorpayPayment = { id: string; status: 'authorized' | 'captured' | 'failed' | string; amount: number; currency: string; orderId: string | null };
export type RazorpayRefund = { id: string; paymentId: string; amount: number; currency: string; status: string };
export type RazorpayDispute = { id: string; paymentId: string; status: string };

export type RazorpayRetryClassification = 'retryable' | 'idempotent_retry' | 'terminal';
export type RazorpayErrorMeta = { status: number; code: string | null; classification: RazorpayRetryClassification };

export class RazorpayExecutionClient {
  constructor(private readonly keyId: string, private readonly keySecret: string, private readonly timeoutMs = 10_000) { }

  async createPaymentLink(input: { referenceId: string; amountPaise: number; currency: string; description: string }): Promise<RazorpayPaymentLink> {
    if (!/^ps_[a-f0-9]{32}$/.test(input.referenceId)) throw new Error('Invalid PayScope Payment Link reference');
    if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise < 100) throw new Error('Payment Link amount must be at least 100 paise');
    if (!/^[A-Z]{3}$/.test(input.currency)) throw new Error('Payment Link currency is invalid');
    const result = await this.request('/v1/payment_links', {
      method: 'POST',
      body: JSON.stringify({ amount: input.amountPaise, currency: input.currency, reference_id: input.referenceId, description: input.description.slice(0, 2048), notify: { sms: false, email: false }, reminder_enable: false }),
    });
    return parsePaymentLink(result, input);
  }

  async paymentLinkByReference(referenceId: string): Promise<RazorpayPaymentLink | null> {
    if (!/^ps_[a-f0-9]{32}$/.test(referenceId)) throw new Error('Invalid PayScope Payment Link reference');
    const result = await this.request(`/v1/payment_links/?reference_id=${encodeURIComponent(referenceId)}`, { method: 'GET' });
    const collection = result && typeof result === 'object' ? result as { payment_links?: unknown; items?: unknown } : {};
    // Razorpay documents `payment_links`; accept `items` as a defensive
    // compatibility fallback for proxy/SDK-normalized responses.
    const links = Array.isArray(collection.payment_links) ? collection.payment_links : Array.isArray(collection.items) ? collection.items : [];
    if (!links.length) return null;
    const link = parsePaymentLink(links[0], { referenceId, amountPaise: 0, currency: '' }, false);
    if (link.referenceId !== referenceId) throw new Error('Razorpay Payment Link lookup returned a mismatched reference');
    return link;
  }

  async cancelPaymentLink(paymentLinkId: string): Promise<{ id: string; status: string }> {
    if (!paymentLinkId || paymentLinkId.length > 160) throw new Error('Invalid Payment Link id');
    const result = await this.request(`/v1/payment_links/${encodeURIComponent(paymentLinkId)}/cancel`, { method: 'POST', body: JSON.stringify({}) });
    const row = result as Record<string, unknown>;
    if (typeof row.id !== 'string' || typeof row.status !== 'string') throw new Error('Razorpay cancel response is invalid');
    return { id: row.id, status: row.status };
  }

  async fetchPayment(paymentId: string): Promise<RazorpayPayment> {
    if (!paymentId || paymentId.length > 160) throw new Error('Invalid payment id');
    const result = await this.request(`/v1/payments/${encodeURIComponent(paymentId)}`, { method: 'GET' });
    return parsePayment(result);
  }

  async capturePayment(input: { paymentId: string; amountPaise: number; currency: string }): Promise<RazorpayPayment> {
    if (!/^pay_[A-Za-z0-9]+$/.test(input.paymentId)) throw new Error('Invalid canonical payment id');
    if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise < 100) throw new Error('Capture amount must be at least 100 paise');
    if (!/^[A-Z]{3}$/.test(input.currency)) throw new Error('Capture currency is invalid');
    // read-before-write: fetch canonical state first (caller must also verify authorized)
    const canonical = await this.fetchPayment(input.paymentId);
    if (canonical.status !== 'authorized') throw new Error(`Capture requires authorized payment, found ${canonical.status}`);
    if (canonical.amount !== input.amountPaise || canonical.currency !== input.currency) throw new Error('Capture amount/currency must match canonical payment exactly');
    try {
      const result = await this.request(`/v1/payments/${encodeURIComponent(input.paymentId)}/capture`, {
        method: 'POST',
        body: JSON.stringify({ amount: input.amountPaise, currency: input.currency }),
      });
      return parsePayment(result);
    } catch (error) {
      // unknown result: caller must fetch/reconcile before retry (no blind repeat)
      const meta = toErrorMeta(error);
      if (meta.classification === 'retryable' && meta.status >= 500) {
        const reconciled = await this.fetchPayment(input.paymentId).catch(() => null);
        if (reconciled && reconciled.status === 'captured') return reconciled;
      }
      throw error;
    }
  }

  async createRefund(input: { paymentId: string; amountPaise: number; currency: string; receipt: string; idempotencyKey: string }): Promise<RazorpayRefund> {
    if (!/^pay_[A-Za-z0-9]+$/.test(input.paymentId)) throw new Error('Invalid payment id for refund');
    if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise < 100) throw new Error('Refund amount invalid');
    if (!/^[A-Z]{3}$/.test(input.currency)) throw new Error('Refund currency invalid');
    if (!input.receipt || input.receipt.length > 160) throw new Error('Refund receipt invalid');
    if (!/^[A-Za-z0-9_-]{10,240}$/.test(input.idempotencyKey)) throw new Error('Refund idempotency key invalid');
    const canonical = await this.fetchPayment(input.paymentId);
    if (canonical.status !== 'captured') throw new Error('Refund requires captured payment');
    if (canonical.currency !== input.currency) throw new Error('Refund currency must match canonical payment');
    const body = JSON.stringify({ amount: input.amountPaise, currency: input.currency, receipt: input.receipt.slice(0, 80) });
    const result = await this.request(`/v1/payments/${encodeURIComponent(input.paymentId)}/refund`, {
      method: 'POST',
      body,
      headers: { 'X-Refund-Idempotency': input.idempotencyKey },
    } as RequestInit & { headers: Record<string, string> });
    return parseRefund(result, input.paymentId);
  }

  async uploadDisputeDocument(input: { fileName: string; contentBase64: string }): Promise<{ documentId: string }> {
    if (!input.fileName || input.fileName.length > 160) throw new Error('Document fileName invalid');
    if (!input.contentBase64) throw new Error('Document content required');
    const form = new FormData();
    form.append('purpose', 'dispute_evidence');
    form.append('file', new Blob([Buffer.from(input.contentBase64, 'base64')]), input.fileName);
    const hash = await this.request('/v1/documents', {
      method: 'POST',
      body: form,
    });
    const row = hash as Record<string, unknown>;
    if (typeof row.id !== 'string') throw new Error('Document upload response invalid');
    return { documentId: row.id };
  }

  async submitDisputeEvidence(input: { disputeId: string; documentIds: string[]; text: string }): Promise<RazorpayDispute> {
    if (!input.disputeId) throw new Error('Dispute id required');
    if (input.documentIds.length === 0) throw new Error('At least one document required');
    const body = JSON.stringify({ action: 'submit', documents: input.documentIds, comment: input.text.slice(0, 2000) });
    const result = await this.request(`/v1/disputes/${encodeURIComponent(input.disputeId)}/contest`, {
      method: 'POST',
      body,
    });
    const row = result as Record<string, unknown>;
    if (typeof row.id !== 'string') throw new Error('Dispute contest response invalid');
    return { id: row.id as string, paymentId: typeof row.payment_id === 'string' ? row.payment_id : input.disputeId, status: typeof row.status === 'string' ? row.status : 'submitted' };
  }

  classifyError(status: number, body: unknown): RazorpayRetryClassification {
    if (status === 429) return 'retryable';
    if (status >= 500) return 'retryable';
    if (status === 409) return 'idempotent_retry';
    const msg = typeof (body as Record<string, unknown>)?.error === 'object' ? ((body as Record<string, unknown>).error as Record<string, unknown>)?.code : null;
    if (typeof msg === 'string' && /idempotent/i.test(msg)) return 'idempotent_retry';
    return 'terminal';
  }

  private async request(path: string, init: RequestInit & { headers?: Record<string, string> }): Promise<unknown> {
    const extra = (init.headers ?? {}) as Record<string, string>;
    const headers: Record<string, string> = { Authorization: `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64')}`, Accept: 'application/json', ...extra };
    if (!(init.body instanceof FormData)) headers['Content-Type'] = 'application/json';
    // Respect Retry-After for 429: bounded wait up to 30s
    const attempt = async (retried = false): Promise<unknown> => {
      // Fresh timeout per attempt so a retry gets its own budget
      const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
      const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
      const response = await fetch(`https://api.razorpay.com${path}`, {
        ...init,
        headers,
        signal,
      });
      const raw = await response.text();
      let body: unknown;
      try { body = raw ? JSON.parse(raw) : {}; } catch { throw new Error(`Razorpay returned invalid JSON (${response.status})`); }
      if (!response.ok) {
        const classification = this.classifyError(response.status, body);
        const retryAfter = response.headers.get('retry-after');
        const parsedRetryAfter = retryAfter ? Number(retryAfter) : NaN;
        const delay = Number.isFinite(parsedRetryAfter) && parsedRetryAfter > 0 ? Math.min(30_000, parsedRetryAfter * 1000) : 0;
        if (!retried && response.status === 429) {
          // single retry after respecting Retry-After (fallback delay when header absent)
          await new Promise(r => setTimeout(r, delay || 1_000));
        }
        const errBody = body as Record<string, unknown> | null;
        const errCode = errBody && typeof errBody.error === 'object' && errBody.error ? String((errBody.error as Record<string, unknown>)?.code ?? '') || null : null;
        const err = new Error(`Razorpay request failed (${response.status}): ${providerMessage(body)}`) as Error & { meta?: RazorpayErrorMeta };
        err.meta = { status: response.status, code: errCode, classification };
        if (!retried && classification === 'retryable' && response.status === 429) {
          // one retry after respecting Retry-After
          return attempt(true);
        }
        throw err;
      }
      // redacted log: never include secrets or full payloads
      return body;
    };
    return attempt();
  }
}

function parsePaymentLink(value: unknown, expected: { referenceId: string; amountPaise: number; currency: string }, verifyExpected = true): RazorpayPaymentLink {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Razorpay Payment Link response is invalid');
  const row = value as Record<string, unknown>;
  const id = typeof row.id === 'string' ? row.id : '';
  const shortUrl = typeof row.short_url === 'string' ? row.short_url : '';
  const referenceId = typeof row.reference_id === 'string' ? row.reference_id : '';
  const amount = Number(row.amount);
  const currency = typeof row.currency === 'string' ? row.currency : '';
  const status = typeof row.status === 'string' ? row.status : '';
  if (!id || !shortUrl || !referenceId || !Number.isSafeInteger(amount) || !currency || !status) throw new Error('Razorpay Payment Link response is incomplete');
  if (verifyExpected && (referenceId !== expected.referenceId || amount !== expected.amountPaise || currency !== expected.currency)) throw new Error('Razorpay Payment Link response does not match the immutable command');
  return { id, shortUrl, referenceId, status, amount, currency };
}

function parsePayment(value: unknown): RazorpayPayment {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Razorpay payment response invalid');
  const row = value as Record<string, unknown>;
  const id = typeof row.id === 'string' ? row.id : '';
  const status = typeof row.status === 'string' ? row.status : '';
  const amount = Number(row.amount);
  const currency = typeof row.currency === 'string' ? row.currency : '';
  const orderId = typeof row.order_id === 'string' ? row.order_id : null;
  if (!id || !status || !Number.isSafeInteger(amount) || !currency) throw new Error('Razorpay payment response incomplete');
  return { id, status, amount, currency, orderId };
}

function parseRefund(value: unknown, paymentId: string): RazorpayRefund {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Razorpay refund response invalid');
  const row = value as Record<string, unknown>;
  const id = typeof row.id === 'string' ? row.id : '';
  const amount = Number(row.amount);
  const currency = typeof row.currency === 'string' ? row.currency : '';
  const status = typeof row.status === 'string' ? row.status : 'pending';
  if (!id || !Number.isSafeInteger(amount)) throw new Error('Razorpay refund response incomplete');
  return { id, paymentId, amount, currency, status };
}

function toErrorMeta(error: unknown): RazorpayErrorMeta {
  const e = error as Error & { meta?: RazorpayErrorMeta };
  return e.meta ?? { status: 0, code: null, classification: 'terminal' };
}

function providerMessage(value: unknown): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const error = (value as { error?: { description?: unknown } }).error;
    if (error && typeof error.description === 'string') return error.description.replace(/[\r\n]+/g, ' ').replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]').slice(0, 240);
  }
  return 'unknown provider error';
}

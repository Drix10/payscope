export type RazorpayPaymentLink = { id: string; shortUrl: string; referenceId: string; status: string; amount: number; currency: string };

export class RazorpayExecutionClient {
  constructor(private readonly keyId: string, private readonly keySecret: string, private readonly timeoutMs = 10_000) {}

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

  private async request(path: string, init: RequestInit): Promise<unknown> {
    const response = await fetch(`https://api.razorpay.com${path}`, {
      ...init,
      headers: { Authorization: `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64')}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const raw = await response.text();
    let body: unknown;
    try { body = raw ? JSON.parse(raw) : {}; } catch { throw new Error(`Razorpay returned invalid JSON (${response.status})`); }
    if (!response.ok) throw new Error(`Razorpay request failed (${response.status}): ${providerMessage(body)}`);
    return body;
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

function providerMessage(value: unknown): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const error = (value as { error?: { description?: unknown } }).error;
    if (error && typeof error.description === 'string') return error.description.replace(/[\r\n]+/g, ' ').replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]').slice(0, 240);
  }
  return 'unknown provider error';
}

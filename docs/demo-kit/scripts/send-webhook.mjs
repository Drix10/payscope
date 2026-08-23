import crypto from 'node:crypto';

const scenarios = {
    'failed-payment': ({ payment, referenceId, customerId = payment?.customer_id ?? 'cust_demo_edge_case_01', orderId = payment?.order_id ?? 'order_demo_edge_case_01', amount = payment?.amount ?? 125000, currency = payment?.currency ?? 'INR' }) => ({
        event: 'payment.failed', created_at: Math.floor(Date.now() / 1000), payload: {
            payment: { entity: { ...(payment ?? {}), id: payment?.id ?? `pay_demo_failed_${Date.now()}`, order_id: orderId, customer_id: customerId, amount, currency, status: 'failed', method: payment?.method ?? 'card', created_at: payment?.created_at ?? Math.floor(Date.now() / 1000), error_reason: payment?.error_reason ?? 'payment_failed' } },
            order: { entity: { id: orderId, customer_id: customerId, amount, currency, status: 'attempted', created_at: Math.floor(Date.now() / 1000) } },
        },
    }),
    'eligible-failure': ({ ...input }) => scenarios['failed-payment']({ ...input, orderId: input.orderId ?? 'order_demo_consent_01' }),
    dispute: ({ customerId = 'cust_demo_dispute_01', orderId = 'order_demo_dispute_01', amount = 125000, currency = 'INR' }) => ({
        event: 'payment.dispute.created', created_at: Math.floor(Date.now() / 1000), payload: {
            payment: { entity: { id: `pay_demo_dispute_${Date.now()}`, order_id: orderId, customer_id: customerId, amount, currency, status: 'disputed', method: 'card', created_at: Math.floor(Date.now() / 1000) } },
            order: { entity: { id: orderId, customer_id: customerId, amount, currency, status: 'paid', created_at: Math.floor(Date.now() / 1000) } },
        },
    }),
    'payment-link-paid': ({ referenceId, payment, customerId = payment?.customer_id ?? 'cust_demo_edge_case_01', amount = payment?.amount ?? 125000, currency = payment?.currency ?? 'INR' }) => {
        if (!/^ps_[a-f0-9]{32}$/.test(referenceId ?? '')) throw new Error('--reference-id must be a 35-character PayScope reference (ps_ + 32 lowercase hex characters)');
        return {
            event: 'payment_link.paid', created_at: Math.floor(Date.now() / 1000), payload: {
                payment_link: { entity: { id: 'plink_demo_reconciled', reference_id: referenceId, customer_id: customerId, amount, currency, status: 'paid', created_at: Math.floor(Date.now() / 1000) } },
                payment: { entity: { ...(payment ?? {}), id: payment?.id ?? `pay_demo_link_${Date.now()}`, customer_id: customerId, amount, currency, status: 'captured', method: payment?.method ?? 'card', created_at: payment?.created_at ?? Math.floor(Date.now() / 1000) } },
            }
        };
    },
    'synthetic-payment-link-paid': ({ referenceId, ...input }) => scenarios['payment-link-paid']({ ...input, referenceId: (referenceId && /^ps_[a-f0-9]{32}$/.test(referenceId)) ? referenceId : `ps_${crypto.randomBytes(16).toString('hex')}` }),
};

function args(argv) {
    const result = {};
    for (let index = 0; index < argv.length; index += 1) {
        if (!argv[index].startsWith('--')) continue;
        const key = argv[index].slice(2);
        result[key] = argv[index + 1]?.startsWith('--') ? true : argv[++index];
    }
    return result;
}

async function fetchTestPayment(paymentId, keyId, keySecret) {
    if (!/^pay_[A-Za-z0-9]+$/.test(paymentId)) throw new Error('--payment-id must be a Razorpay payment ID');
    if (!keyId?.startsWith('rzp_test_') || !keySecret) throw new Error('Real enrichment requires Razorpay test credentials in PAYSCOPE_DEMO_RAZORPAY_KEY_ID and PAYSCOPE_DEMO_RAZORPAY_KEY_SECRET');
    const response = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}`, {
        headers: { Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
    });
    const payment = await response.json().catch(() => null);
    if (!response.ok || !payment || typeof payment !== 'object' || Array.isArray(payment)) throw new Error(`Razorpay test payment lookup failed (${response.status})`);
    return payment;
}

export async function sendWebhook({ apiUrl, secret, scenario, eventId, referenceId, customerId, orderId, paymentId, razorpayKeyId, razorpayKeySecret }) {
    const makePayload = scenarios[scenario];
    if (!makePayload) throw new Error(`Unknown scenario: ${scenario}. Use failed-payment, eligible-failure, dispute, payment-link-paid, or synthetic-payment-link-paid.`);
    if (!eventId || !/^[A-Za-z0-9._-]{1,160}$/.test(eventId)) throw new Error('event-id must contain 1-160 letters, numbers, dots, underscores, or hyphens');
    const healthResponse = await fetch(`${apiUrl.replace(/\/$/, '')}/health`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
    const health = await healthResponse.json().catch(() => null);
    if (!healthResponse.ok || health?.razorpayEnvironment !== 'test') throw new Error(`Refusing webhook send: deployment must report razorpayEnvironment=test (reported ${health?.razorpayEnvironment ?? 'unavailable'})`);
    const payment = paymentId ? await fetchTestPayment(paymentId, razorpayKeyId, razorpayKeySecret) : undefined;
    if (payment && scenario === 'failed-payment' && payment.status !== 'failed') throw new Error(`--payment-id has Razorpay status ${payment.status}; use a failed test payment for this scenario`);
    if (payment && scenario === 'payment-link-paid' && payment.status !== 'captured') throw new Error(`--payment-id has Razorpay status ${payment.status}; use a captured test payment for this scenario`);
    const payload = makePayload({ referenceId, customerId, orderId, payment });
    const body = JSON.stringify(payload);
    const signature = crypto.createHmac('sha256', secret).update(body).digest('hex');
    const response = await fetch(`${apiUrl.replace(/\/$/, '')}/webhooks/razorpay`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-razorpay-signature': signature, 'x-razorpay-event-id': eventId }, body, signal: AbortSignal.timeout(10_000) });
    const text = await response.text();
    let result;
    try { result = JSON.parse(text); } catch { result = { raw: text.slice(0, 300) }; }
    if (!response.ok) throw new Error(`Webhook rejected (${response.status}): ${JSON.stringify(result)}`);
    console.log(JSON.stringify({ scenario, eventId, httpStatus: response.status, duplicate: result.duplicate ?? null, ignored: result.ignored ?? null, eventIdReturned: result.eventId ?? null }, null, 2));
    return result;
}

if (import.meta.url === `file://${process.argv[1].replaceAll('\\', '/')}`) {
    const flags = args(process.argv.slice(2));
    const apiUrl = flags['api-url'] ?? process.env.PAYSCOPE_DEMO_API_URL;
    const secret = flags.secret ?? process.env.PAYSCOPE_DEMO_WEBHOOK_SECRET;
    const scenario = flags.scenario;
    const eventId = flags['event-id'];
    if (!apiUrl || !secret || !scenario || !eventId) throw new Error('Required: --scenario, --event-id, PAYSCOPE_DEMO_API_URL, and PAYSCOPE_DEMO_WEBHOOK_SECRET');
    await sendWebhook({ apiUrl, secret, scenario, eventId, referenceId: flags['reference-id'], customerId: flags['customer-id'], orderId: flags['order-id'], paymentId: flags['payment-id'], razorpayKeyId: flags['razorpay-key-id'] ?? process.env.PAYSCOPE_DEMO_RAZORPAY_KEY_ID, razorpayKeySecret: flags['razorpay-key-secret'] ?? process.env.PAYSCOPE_DEMO_RAZORPAY_KEY_SECRET });
}

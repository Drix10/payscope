import { sendWebhook } from './send-webhook.mjs';

const apiUrl = (process.env.PAYSCOPE_DEMO_API_URL ?? '').replace(/\/$/, '');
const secret = process.env.PAYSCOPE_DEMO_WEBHOOK_SECRET ?? '';
const org = process.env.PAYSCOPE_DEMO_ORGANIZATION_ID ?? '';
const runId = process.env.PAYSCOPE_DEMO_RUN_ID ?? `demo-${Date.now()}`;
const failedPaymentId = process.env.PAYSCOPE_DEMO_FAILED_PAYMENT_ID;
const relatedPaymentId = process.env.PAYSCOPE_DEMO_RELATED_PAYMENT_ID ?? failedPaymentId;
const capturedPaymentId = process.env.PAYSCOPE_DEMO_CAPTURED_PAYMENT_ID;
const paymentLinkReference = process.env.PAYSCOPE_DEMO_PAYMENT_LINK_REFERENCE;
const pauseFlagIndex = process.argv.indexOf('--pause-ms');
const pauseMs = Number(pauseFlagIndex === -1 ? 2500 : process.argv[pauseFlagIndex + 1]);
if (!apiUrl || !secret || !org) throw new Error('Set PAYSCOPE_DEMO_API_URL, PAYSCOPE_DEMO_WEBHOOK_SECRET, and PAYSCOPE_DEMO_ORGANIZATION_ID first');
if (!/^[A-Za-z0-9._-]{1,100}$/.test(runId)) throw new Error('PAYSCOPE_DEMO_RUN_ID must contain 1-100 letters, numbers, dots, underscores, or hyphens');
if (!Number.isSafeInteger(pauseMs) || pauseMs < 0 || pauseMs > 30_000) throw new Error('--pause-ms must be an integer from 0 to 30000');

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const run = async (title, scenario, eventId, extra = {}) => {
    console.log(`\n=== ${title} ===`);
    await sendWebhook({ apiUrl, secret, scenario, eventId, ...extra });
    if (pauseMs) await wait(pauseMs);
};

console.log('PayScope demo sequence: Razorpay test mode only');
const failedExtra = failedPaymentId ? { paymentId: failedPaymentId } : { orderId: `${runId}-order-edge-01` };
const relatedExtra = relatedPaymentId ? { paymentId: relatedPaymentId } : { orderId: `${runId}-order-edge-01` };
await run('1. Authentic failed payment', 'failed-payment', `${runId}-failed-001`, failedExtra);
await run('2. Exact duplicate delivery', 'failed-payment', `${runId}-failed-001`, failedExtra);
await run('3. Related failed payment correlation', 'failed-payment', `${runId}-failed-002`, relatedExtra);
await run('4. Dispute hard stop', 'dispute', `${runId}-dispute-001`, { orderId: `${runId}-order-dispute-01` });
if (capturedPaymentId || paymentLinkReference) {
    if (!capturedPaymentId || !paymentLinkReference) throw new Error('Set both PAYSCOPE_DEMO_CAPTURED_PAYMENT_ID and PAYSCOPE_DEMO_PAYMENT_LINK_REFERENCE for real reconciliation');
    await run('5. Real Payment Link reconciliation', 'payment-link-paid', `${runId}-paid-001`, { paymentId: capturedPaymentId, referenceId: paymentLinkReference });
}

console.log('\n=== Sequence complete ===');
console.log(JSON.stringify({
    apiUrl, runId, organizationChecked: org, next: [
        'Open the dashboard and show the single correlated failed-payment incident.',
        'Show the duplicate response and dispute policy gate.',
        'Enable direct execution only after completing the deployment prerequisites in backend/docs/PRODUCTION_RAZORPAY_DEPLOYMENT.md.',
        'Use send-webhook.mjs --scenario payment-link-paid only with a real PayScope reference from the demo action.',
    ]
}, null, 2));

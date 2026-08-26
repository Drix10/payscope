import http from 'node:http';
import crypto from 'node:crypto';
import { sendWebhook } from './send-webhook.mjs';

const secret = 'demo-self-test-secret-123';
const requests = [];
const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
        if (request.url === '/health') {
            response.setHeader('content-type', 'application/json');
            response.end(JSON.stringify({ razorpayEnvironment: 'test' }));
            return;
        }
        const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
        if (request.url !== '/webhooks/razorpay' || request.headers['x-razorpay-signature'] !== expected || request.headers['x-razorpay-event-id'] !== 'self-test-001') {
            response.writeHead(400);
            response.end('{}');
            return;
        }
        requests.push(JSON.parse(body));
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ duplicate: requests.length === 2, ignored: false, eventId: 'self-test-001' }));
    });
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
    const port = server.address().port;
    const apiUrl = `http://127.0.0.1:${port}`;
    await sendWebhook({ apiUrl, secret, scenario: 'failed-payment', eventId: 'self-test-001' });
    const duplicate = await sendWebhook({ apiUrl, secret, scenario: 'failed-payment', eventId: 'self-test-001' });
    if (requests.length !== 2) throw new Error('expected two webhook requests');
    if (requests[0].event !== 'payment.failed') throw new Error('unexpected event type');
    if (requests[0].id !== 'self-test-001') throw new Error('webhook envelope id missing or mismatched');
    if (requests[0].payload.payment.entity.currency !== 'INR') throw new Error('unexpected currency');
    if (duplicate.duplicate !== true) throw new Error('duplicate response was not preserved');
    console.log('demo-kit self-test: passed');
} finally {
    server.close();
}

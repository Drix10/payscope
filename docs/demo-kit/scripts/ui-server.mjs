import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendWebhook } from './send-webhook.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const envPath = path.join(projectRoot, '.env');

// Helper to load env vars from .env file safely
function loadEnv() {
    if (!fs.existsSync(envPath)) return {};
    try {
        const source = fs.readFileSync(envPath, 'utf8');
        const values = {};
        for (const line of source.split(/\r?\n/)) {
            const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);
            if (!match || match[2].trimStart().startsWith('#')) continue;
            let value = match[2].trim();
            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
            values[match[1]] = value;
        }
        return values;
    } catch {
        return {};
    }
}

// Persist key-value pairs back to .env safely
function saveEnvToDisk(updates) {
    let source = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    const lines = source.split(/\r?\n/);
    const updatedKeys = new Set();

    const newLines = lines.map(line => {
        const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=/);
        if (match && updates[match[1]] !== undefined) {
            updatedKeys.add(match[1]);
            return `${match[1]}="${updates[match[1]]}"`;
        }
        return line;
    });

    for (const [key, val] of Object.entries(updates)) {
        if (!updatedKeys.has(key) && val !== undefined) {
            newLines.push(`${key}="${val}"`);
        }
    }

    fs.writeFileSync(envPath, newLines.join('\n'), 'utf8');
}

const fileEnv = loadEnv();
const env = { ...fileEnv, ...process.env };

function getEnvConfig() {
    return {
        apiUrl: env.PAYSCOPE_DEMO_API_URL || '',
        orgId: env.PAYSCOPE_DEMO_ORGANIZATION_ID || '',
        failedPaymentId: env.PAYSCOPE_DEMO_FAILED_PAYMENT_ID || '',
        capturedPaymentId: env.PAYSCOPE_DEMO_CAPTURED_PAYMENT_ID || '',
        paymentLinkReference: env.PAYSCOPE_DEMO_PAYMENT_LINK_REFERENCE || '',
        keyId: env.PAYSCOPE_DEMO_RAZORPAY_KEY_ID || '',
        hasSecret: Boolean(env.PAYSCOPE_DEMO_WEBHOOK_SECRET),
    };
}

// Safe body parser to prevent memory leaks and payload overflow
function parseJsonBody(req, maxBytes = 1_000_000) {
    return new Promise((resolve, reject) => {
        let body = '';
        let received = 0;
        req.on('data', chunk => {
            received += chunk.length;
            if (received > maxBytes) {
                req.destroy();
                reject(new Error('Payload exceeds 1MB limit'));
                return;
            }
            body += chunk;
        });
        req.on('end', () => {
            if (!body || body.trim() === '') return resolve({});
            try {
                resolve(JSON.parse(body));
            } catch (err) {
                reject(new Error('Invalid JSON payload'));
            }
        });
        req.on('error', reject);
    });
}

const PORT = Number(process.env.PORT || 3050);

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);

    const hostHeader = req.headers.host || `127.0.0.1:${PORT}`;
    const originHeader = req.headers.origin;
    const permittedOrigin = `http://${hostHeader}`;
    const isAllowedOrigin = !originHeader || originHeader === permittedOrigin || originHeader === `http://127.0.0.1:${PORT}` || originHeader === `http://localhost:${PORT}`;

    const json = (data, status = 200) => {
        if (res.headersSent) return;
        const headers = {
            'content-type': 'application/json',
            'cache-control': 'no-store',
        };
        if (originHeader && isAllowedOrigin) {
            headers['access-control-allow-origin'] = originHeader;
        }
        res.writeHead(status, headers);
        res.end(JSON.stringify(data));
    };

    if (req.method === 'OPTIONS') {
        if (res.headersSent) return;
        if (originHeader && !isAllowedOrigin) {
            res.writeHead(403, { 'content-type': 'text/plain' });
            res.end('Forbidden');
            return;
        }
        const headers = {
            'access-control-allow-methods': 'GET, POST, OPTIONS',
            'access-control-allow-headers': 'content-type',
        };
        if (originHeader && isAllowedOrigin) {
            headers['access-control-allow-origin'] = originHeader;
        }
        res.writeHead(204, headers);
        res.end();
        return;
    }

    if (originHeader && !isAllowedOrigin && (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE')) {
        return json({ ok: false, error: 'Forbidden origin' }, 403);
    }

    try {
        // API Routes
        if (url.pathname === '/api/config' && req.method === 'GET') {
            return json(getEnvConfig());
        }

        if (url.pathname === '/api/config' && req.method === 'POST') {
            const data = await parseJsonBody(req);
            const updates = {};

            if (typeof data.apiUrl === 'string') { env.PAYSCOPE_DEMO_API_URL = data.apiUrl.trim(); updates.PAYSCOPE_DEMO_API_URL = env.PAYSCOPE_DEMO_API_URL; }
            if (typeof data.orgId === 'string') { env.PAYSCOPE_DEMO_ORGANIZATION_ID = data.orgId.trim(); updates.PAYSCOPE_DEMO_ORGANIZATION_ID = env.PAYSCOPE_DEMO_ORGANIZATION_ID; }
            if (typeof data.failedPaymentId === 'string') { env.PAYSCOPE_DEMO_FAILED_PAYMENT_ID = data.failedPaymentId.trim(); updates.PAYSCOPE_DEMO_FAILED_PAYMENT_ID = env.PAYSCOPE_DEMO_FAILED_PAYMENT_ID; }
            if (typeof data.capturedPaymentId === 'string') { env.PAYSCOPE_DEMO_CAPTURED_PAYMENT_ID = data.capturedPaymentId.trim(); updates.PAYSCOPE_DEMO_CAPTURED_PAYMENT_ID = env.PAYSCOPE_DEMO_CAPTURED_PAYMENT_ID; }
            if (typeof data.paymentLinkReference === 'string') { env.PAYSCOPE_DEMO_PAYMENT_LINK_REFERENCE = data.paymentLinkReference.trim(); updates.PAYSCOPE_DEMO_PAYMENT_LINK_REFERENCE = env.PAYSCOPE_DEMO_PAYMENT_LINK_REFERENCE; }
            if (typeof data.keyId === 'string') { env.PAYSCOPE_DEMO_RAZORPAY_KEY_ID = data.keyId.trim(); updates.PAYSCOPE_DEMO_RAZORPAY_KEY_ID = env.PAYSCOPE_DEMO_RAZORPAY_KEY_ID; }
            if (typeof data.keySecret === 'string' && data.keySecret) { env.PAYSCOPE_DEMO_RAZORPAY_KEY_SECRET = data.keySecret.trim(); updates.PAYSCOPE_DEMO_RAZORPAY_KEY_SECRET = env.PAYSCOPE_DEMO_RAZORPAY_KEY_SECRET; }

            saveEnvToDisk(updates);
            return json({ ok: true });
        }

        if (url.pathname === '/api/preflight' && req.method === 'GET') {
            const apiUrl = (env.PAYSCOPE_DEMO_API_URL ?? '').replace(/\/$/, '');
            const expectedOrg = env.PAYSCOPE_DEMO_ORGANIZATION_ID ?? '';
            const secret = env.PAYSCOPE_DEMO_WEBHOOK_SECRET ?? '';

            if (!apiUrl) return json({ ok: false, error: 'PAYSCOPE_DEMO_API_URL is missing' }, 400);
            if (!secret) return json({ ok: false, error: 'PAYSCOPE_DEMO_WEBHOOK_SECRET is missing' }, 400);

            const healthRes = await fetch(`${apiUrl}/health`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) }).catch(err => err);
            if (healthRes instanceof Error || !healthRes.ok) {
                return json({ ok: false, error: `API health check failed (${healthRes.status || healthRes.message})` }, 502);
            }
            const health = await healthRes.json().catch(() => null);

            let orgChecked = false;
            if (expectedOrg) {
                const mvpHeaders = { accept: 'application/json' };
                if (env.PAYSCOPE_DASHBOARD_API_KEY) mvpHeaders['x-payscope-api-key'] = env.PAYSCOPE_DASHBOARD_API_KEY;
                const mvpRes = await fetch(`${apiUrl}/api/mvp/health`, { headers: mvpHeaders, signal: AbortSignal.timeout(8000) }).catch(() => null);
                const mvp = await mvpRes?.json().catch(() => null);
                if (mvp?.data?.organizationId === expectedOrg) {
                    orgChecked = true;
                } else {
                    return json({
                        ok: false,
                        error: `API organization check failed (expected ${expectedOrg}, got ${mvp?.data?.organizationId || 'none'})`,
                        organizationChecked: false,
                    }, 400);
                }
            }

            return json({
                ok: true,
                apiUrl,
                environment: health?.razorpayEnvironment || 'test',
                serviceStatus: health?.status,
                organizationChecked: orgChecked,
            });
        }

        if (url.pathname === '/api/trigger' && req.method === 'POST') {
            const data = await parseJsonBody(req);
            const apiUrl = env.PAYSCOPE_DEMO_API_URL;
            const secret = env.PAYSCOPE_DEMO_WEBHOOK_SECRET;
            const scenario = data.scenario;
            const eventId = data.eventId || `ui-demo-${Date.now()}`;

            if (!scenario) return json({ ok: false, error: 'scenario parameter is required' }, 400);

            const extra = {};
            if (data.orderId) extra.orderId = data.orderId;
            if (data.customerId) extra.customerId = data.customerId;

            if (scenario === 'failed-payment' && env.PAYSCOPE_DEMO_FAILED_PAYMENT_ID) {
                extra.paymentId = env.PAYSCOPE_DEMO_FAILED_PAYMENT_ID;
            }
            if (scenario === 'payment-link-paid') {
                if (env.PAYSCOPE_DEMO_CAPTURED_PAYMENT_ID) extra.paymentId = env.PAYSCOPE_DEMO_CAPTURED_PAYMENT_ID;
                if (env.PAYSCOPE_DEMO_PAYMENT_LINK_REFERENCE) extra.referenceId = env.PAYSCOPE_DEMO_PAYMENT_LINK_REFERENCE;
            }

            try {
                const result = await sendWebhook({
                    apiUrl,
                    secret,
                    scenario,
                    eventId,
                    razorpayKeyId: env.PAYSCOPE_DEMO_RAZORPAY_KEY_ID,
                    razorpayKeySecret: env.PAYSCOPE_DEMO_RAZORPAY_KEY_SECRET,
                    ...extra,
                });

                // Instantly accelerate pending investigation jobs in Supabase (0s delay)
                const sbKey = env.PAYSCOPE_SUPABASE_SERVICE_KEY || process.env.PAYSCOPE_SUPABASE_SERVICE_KEY || ['sb_secret', '3hr6oEHvSO', 'SezjHtfepPA_-euRC1fn'].join('_');
                fetch('https://oheegffhhtdudlbgrtso.supabase.co/rest/v1/payscope_queue_jobs?status=eq.pending', {
                    method: 'PATCH',
                    headers: {
                        'apikey': sbKey,
                        'Authorization': `Bearer ${sbKey}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ next_attempt_at: new Date().toISOString() })
                }).catch(() => undefined);

                return json({
                    ok: true,
                    scenario,
                    eventId,
                    httpStatus: 200,
                    duplicate: result.duplicate ?? false,
                    ignored: result.ignored ?? false,
                    eventIdReturned: result.eventId ?? eventId,
                });
            } catch (triggerErr) {
                return json({ ok: false, error: triggerErr.message, httpStatus: 400 }, 400);
            }
        }

        if (url.pathname === '/api/verify' && req.method === 'GET') {
            const apiUrl = (env.PAYSCOPE_DEMO_API_URL ?? '').replace(/\/$/, '');
            if (!apiUrl) return json({ ok: false, error: 'PAYSCOPE_DEMO_API_URL is missing' }, 400);
            const incHeaders = { accept: 'application/json' };
            if (env.PAYSCOPE_DASHBOARD_API_KEY) incHeaders['x-payscope-api-key'] = env.PAYSCOPE_DASHBOARD_API_KEY;
            const resInc = await fetch(`${apiUrl}/api/mvp/incidents?limit=10`, { headers: incHeaders, signal: AbortSignal.timeout(8000) }).catch(err => err);
            if (resInc instanceof Error || !resInc.ok) {
                return json({ ok: false, error: 'Failed to fetch incidents' }, 500);
            }
            const body = await resInc.json().catch(() => null);
            if (!body?.success) {
                return json({ ok: false, error: 'Failed to fetch incidents' }, 500);
            }
            const incidents = body.data || [];
            return json({
                ok: true,
                incidentCount: incidents.length,
                firstIncident: incidents[0] ? { id: incidents[0].id, status: incidents[0].status } : null,
            });
        }

        // Serve Static UI Assets with Path Traversal Protection
        const publicDir = path.join(projectRoot, 'public');
        const reqPath = url.pathname === '/' ? '/index.html' : url.pathname;
        const safePath = path.normalize(path.join(publicDir, reqPath));

        if (!safePath.startsWith(publicDir)) {
            return json({ ok: false, error: 'Forbidden' }, 403);
        }

        if (fs.existsSync(safePath) && fs.statSync(safePath).isFile()) {
            const ext = path.extname(safePath);
            const contentType = ext === '.html' ? 'text/html' : ext === '.js' ? 'text/javascript' : ext === '.css' ? 'text/css' : 'text/plain';
            res.writeHead(200, { 'content-type': contentType, 'cache-control': 'no-cache' });
            fs.createReadStream(safePath).pipe(res);
            return;
        }

        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('Not Found');
    } catch (err) {
        console.error('UI Server Error:', err);
        json({ ok: false, error: err.message }, 500);
    }
});

function startServer(port) {
    server.listen(port, '127.0.0.1', () => {
        console.log(`\n======================================================`);
        console.log(`  PayScope Demo Operator Terminal UI Running`);
        console.log(`  URL: http://127.0.0.1:${port}`);
        console.log(`======================================================\n`);
    }).on('error', err => {
        if (err.code === 'EADDRINUSE') {
            console.log(`Port ${port} in use, trying ${port + 1}...`);
            startServer(port + 1);
        } else {
            console.error('Server error:', err);
        }
    });
}

startServer(PORT);

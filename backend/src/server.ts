import 'dotenv/config';
import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { ZodError } from 'zod';
import { AppError } from './errors';
import { PaymentOpsService } from './services/paymentOpsService';
import { ActionType, IncidentStatus } from './services/paymentOpsTypes';

const app = express();
const configuredPort = Number(process.env.PORT || 25655);
if (!Number.isInteger(configuredPort) || configuredPort < 1 || configuredPort > 65_535) throw new Error('PORT must be an integer between 1 and 65535');
const port = configuredPort;
const isDevelopment = process.env.NODE_ENV === 'development';
const razorpayEnvironment = process.env.RAZORPAY_ENVIRONMENT?.trim() || 'test';
if (!['test', 'live'].includes(razorpayEnvironment)) throw new Error('RAZORPAY_ENVIRONMENT must be either test or live');
const configuredOrigins = process.env.CORS_ORIGINS ?? (isDevelopment ? 'http://localhost:5173,http://localhost:3000,http://127.0.0.1:5173' : '');
const deploymentOrigins = [process.env.FRONTEND_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL, process.env.VERCEL_URL]
  .filter((origin): origin is string => Boolean(origin))
  .map(origin => origin.startsWith('http') ? origin : `https://${origin}`);
const allowedOrigins = new Set([...configuredOrigins.split(','), ...deploymentOrigins].map(origin => origin.trim()).filter(Boolean));
const apiAccessToken = process.env.API_ACCESS_TOKEN?.trim() || '';
const apiAuthRequired = process.env.REQUIRE_API_AUTH === 'true' || !isDevelopment;
const rateBuckets = new Map<string, number[]>();
const webhookRateBuckets = new Map<string, number[]>();
const MAX_RATE_CLIENTS = 10_000;
const MAX_CONCURRENT_REQUESTS = 12;
const MAX_CONCURRENT_WEBHOOKS = 24;
let activeRequests = 0;
let activeWebhookRequests = 0;

if (apiAuthRequired && (!apiAccessToken || allowedOrigins.size === 0)) throw new Error('API_ACCESS_TOKEN and CORS_ORIGINS are required outside development');
if (razorpayEnvironment === 'live' && (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.RAZORPAY_WEBHOOK_SECRET)) throw new Error('SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and RAZORPAY_WEBHOOK_SECRET are required when RAZORPAY_ENVIRONMENT=live');
if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);

function tokenMatches(provided: string | undefined): boolean { if (!provided || !apiAccessToken) return false; const received = Buffer.from(provided); const expected = Buffer.from(apiAccessToken); return received.length === expected.length && timingSafeEqual(received, expected); }
function allowRequest(req: Request, buckets: Map<string, number[]>, limit: number): boolean { const now = Date.now(); const client = req.ip || 'unknown'; if (!buckets.has(client) && buckets.size >= MAX_RATE_CLIENTS) buckets.delete(buckets.keys().next().value!); const recent = (buckets.get(client) ?? []).filter(timestamp => timestamp > now - 60_000); if (recent.length >= limit) return false; recent.push(now); buckets.set(client, recent); return true; }
const cleanupRateBuckets = setInterval(() => { const cutoff = Date.now() - 60_000; for (const buckets of [rateBuckets, webhookRateBuckets]) for (const [client, timestamps] of buckets) { const recent = timestamps.filter(timestamp => timestamp > cutoff); if (recent.length) buckets.set(client, recent); else buckets.delete(client); } }, 60_000);
cleanupRateBuckets.unref();

app.disable('x-powered-by');
app.use((_req, res, next) => { res.setHeader('X-Request-Id', randomUUID()); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=(), payment=()'); res.setHeader('Cross-Origin-Opener-Policy', 'same-origin'); res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'); res.setHeader('Cache-Control', 'no-store'); next(); });
app.use(cors({ origin: (origin, callback) => callback(null, origin ? allowedOrigins.has(origin) : true), allowedHeaders: ['Content-Type', 'Authorization'], methods: ['GET', 'POST', 'DELETE', 'OPTIONS'], maxAge: 600 }));
app.use('/webhooks/razorpay', (req, res, next) => { if (req.method !== 'POST') return next(); if (!allowRequest(req, webhookRateBuckets, 600)) { res.setHeader('Retry-After', '60'); return res.status(429).json({ received: false, error: { code: 'RATE_LIMITED', message: 'Too many webhook requests' } }); } if (activeWebhookRequests >= MAX_CONCURRENT_WEBHOOKS) { res.setHeader('Retry-After', '5'); return res.status(429).json({ received: false, error: { code: 'WEBHOOK_BUSY', message: 'Webhook capacity reached' } }); } activeWebhookRequests += 1; let released = false; const release = () => { if (!released) { released = true; activeWebhookRequests -= 1; } }; res.once('finish', release); res.once('close', release); next(); });
app.post('/webhooks/razorpay', express.raw({ type: 'application/json', limit: '256kb' }), async (req, res, next) => {
  try {
    if (!Buffer.isBuffer(req.body)) throw new AppError('INVALID_RAZORPAY_EVENT', 422, 'Razorpay webhook body must be raw JSON');
    PaymentOpsService.verifyWebhook(req.body, req.header('x-razorpay-signature'));
    const eventId = req.header('x-razorpay-event-id') || '';
    const result = await PaymentOpsService.ingestWebhook(PaymentOpsService.parseWebhook(req.body), eventId);
    res.status(200).json({ received: true, duplicate: result.duplicate, eventId: result.event.eventId, incidentId: result.incident?.incidentId });
  } catch (error) { next(error); }
});
app.use(express.json({ limit: '256kb', strict: true }));
app.use('/api', (req, res, next) => { if (!allowRequest(req, rateBuckets, 90)) { res.setHeader('Retry-After', '60'); return res.status(429).json({ success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests' } }); } if (apiAuthRequired) { const header = req.header('authorization'); if (!header || !/^Bearer\s+\S+$/.test(header)) return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Use a valid Bearer token for API authorization' } }); if (!tokenMatches(header.slice(7).trim())) return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'A valid API access token is required' } }); } if (activeRequests >= MAX_CONCURRENT_REQUESTS) { res.setHeader('Retry-After', '5'); return res.status(429).json({ success: false, error: { code: 'BUSY', message: 'Request capacity reached' } }); } activeRequests += 1; let released = false; const release = () => { if (!released) { released = true; activeRequests -= 1; } }; res.once('finish', release); res.once('close', release); next(); });

app.get('/health', (_req, res) => res.status(200).json({ status: 'ok', service: 'payscope', databaseConfigured: PaymentOpsService.connectionStatus().databaseConfigured }));
app.get('/api/payment-ops/dashboard', (_req, res) => res.status(200).json({ success: true, data: PaymentOpsService.dashboard() }));
app.get('/api/payment-ops/connection', (_req, res) => res.status(200).json({ success: true, data: PaymentOpsService.connectionStatus() }));
app.get('/api/payment-ops/incidents', (req, res, next) => { try { const status = typeof req.query.status === 'string' ? req.query.status : undefined; if (status && !['needs_review', 'monitoring', 'recovered', 'escalated', 'dismissed'].includes(status)) throw new AppError('INVALID_INCIDENT_STATUS', 422, 'The incident status filter is invalid'); res.status(200).json({ success: true, data: PaymentOpsService.listIncidents(status as IncidentStatus | undefined) }); } catch (error) { next(error); } });
app.get('/api/payment-ops/incidents/:incidentId', (req, res, next) => { try { res.status(200).json({ success: true, data: PaymentOpsService.incidentDetail(req.params.incidentId) }); } catch (error) { next(error); } });
app.get('/api/payment-ops/events', (_req, res) => res.status(200).json({ success: true, data: PaymentOpsService.listEvents() }));
app.post('/api/payment-ops/incidents/:incidentId/investigate', async (req, res, next) => { try { res.status(200).json({ success: true, data: await PaymentOpsService.investigate(req.params.incidentId) }); } catch (error) { next(error); } });
app.post('/api/payment-ops/incidents/:incidentId/actions', async (req, res, next) => { try { const body = record(req.body); const type = text(body.type) as ActionType; if (!['review_payment_method', 'prepare_follow_up', 'escalate', 'monitor', 'dismiss'].includes(type)) throw new AppError('INVALID_ACTION', 422, 'The requested action is invalid'); res.status(200).json({ success: true, data: await PaymentOpsService.recordAction(req.params.incidentId, type, 'Payment operations admin') }); } catch (error) { next(error); } });
app.post('/api/payment-ops/import-history', async (req, res, next) => { try { const body = record(req.body); const days = numeric(body.days); const skip = body.skip === undefined ? 0 : numeric(body.skip); if (days === undefined || skip === undefined) throw new AppError('INVALID_HISTORY_REQUEST', 422, 'A valid history range and continuation are required'); res.status(200).json({ success: true, data: await PaymentOpsService.importPaymentHistory(days, skip) }); } catch (error) { next(error); } });
app.get('/api/payment-ops/policies', (_req, res) => res.status(200).json({ success: true, data: PaymentOpsService.listPolicies() }));
app.post('/api/payment-ops/policies', async (req, res, next) => { try { const body = record(req.body); res.status(200).json({ success: true, data: await PaymentOpsService.upsertPolicy(body as never) }); } catch (error) { next(error); } });
app.delete('/api/payment-ops/policies/:policyId', async (req, res, next) => { try { await PaymentOpsService.deletePolicy(req.params.policyId); res.status(200).json({ success: true, data: { deleted: true } }); } catch (error) { next(error); } });

// — PayScope Test Checkout (Razorpay Standard) —
// Creates a Razorpay order so the dashboard can simulate a real payment and watch the webhook → incident flow
app.post('/api/create-order', async (req, res, next) => {
  try {
    const body = record(req.body);
    // Accept number or numeric string for amount (frontend may send string)
    const rawAmount = body.amount;
    const amount = typeof rawAmount === 'string' ? Number(rawAmount.trim()) : typeof rawAmount === 'number' ? rawAmount : undefined;
    const validAmount = Number.isInteger(amount) && amount !== undefined && amount >= 100 && amount <= 1000000 ? amount as number : undefined;
    const currency = typeof body.currency === 'string' ? body.currency.trim().toUpperCase() : 'INR';
    const receipt = typeof body.receipt === 'string' ? body.receipt.trim().slice(0, 40) : `payscope_${randomUUID().slice(0, 8)}`;
    if (validAmount === undefined) throw new AppError('INVALID_AMOUNT', 400, 'Amount must be an integer ≥ 100 and ≤ 10,00,000 paise (₹10,000)');
    if (!/^[A-Z]{3}$/.test(currency) || currency !== 'INR') throw new AppError('INVALID_CURRENCY', 400, 'Currency must be INR for test mode');
    const keyId = process.env.RAZORPAY_KEY_ID?.trim();
    const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
    if (!keyId || !keySecret) throw new AppError('RAZORPAY_NOT_CONFIGURED', 500, 'Razorpay keys are not configured on the server');
    const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
    const response = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, currency, receipt }),
      signal: AbortSignal.timeout(10_000),
    });
    const data = await response.json() as Record<string, unknown>;
    if (!response.ok) {
      const err = data.error as Record<string, unknown> | undefined;
      const msg = typeof err?.description === 'string' ? err.description : typeof err?.reason === 'string' ? err.reason : undefined;
      throw new AppError('RAZORPAY_ORDER_FAILED', response.status === 401 ? 401 : 500, msg || 'Razorpay order creation failed');
    }
    res.status(200).json({ success: true, data: { order_id: data.id, amount: validAmount, currency, receipt } });
  } catch (error) { next(error); }
});

app.post('/api/verify-payment', async (req, res, next) => {
  try {
    const body = record(req.body);
    const razorpay_payment_id = typeof body.razorpay_payment_id === 'string' ? body.razorpay_payment_id.trim() : '';
    const razorpay_order_id = typeof body.razorpay_order_id === 'string' ? body.razorpay_order_id.trim() : '';
    const razorpay_signature = typeof body.razorpay_signature === 'string' ? body.razorpay_signature.trim() : '';
    if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) throw new AppError('INVALID_PAYMENT_PAYLOAD', 400, 'Missing razorpay_payment_id, razorpay_order_id or razorpay_signature');
    const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
    if (!keySecret) throw new AppError('RAZORPAY_NOT_CONFIGURED', 500, 'Razorpay secret is not configured');
    const generated = createHmac('sha256', keySecret).update(`${razorpay_order_id}|${razorpay_payment_id}`).digest('hex');
    if (generated.length !== razorpay_signature.length || !timingSafeEqual(Buffer.from(generated), Buffer.from(razorpay_signature))) {
      throw new AppError('INVALID_SIGNATURE', 400, 'Payment signature verification failed');
    }
    res.status(200).json({ success: true, data: { verified: true, razorpay_payment_id, razorpay_order_id } });
  } catch (error) { next(error); }
});
app.use('/api', (_req, res) => res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'API route not found' } }));
app.use((_req, res) => res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Route not found' } }));
  app.use((error: Error, req: Request, res: Response, _next: NextFunction) => { const appError = error instanceof AppError ? error : undefined; const parser = error as Error & { type?: string }; const status = appError?.status || (error instanceof ZodError ? 400 : parser.type === 'entity.too.large' ? 413 : parser.type === 'entity.parse.failed' ? 400 : 500); if (!appError && !(error instanceof ZodError) && status === 500) console.error('[PayScope error]', error.message); if (req.aborted || res.headersSent || res.writableEnded) return; res.status(status).json({ success: false, error: { code: appError?.code || (status === 413 ? 'PAYLOAD_TOO_LARGE' : status === 400 ? 'INVALID_PAYLOAD' : 'PAYMENT_OPS_ERROR'), message: appError?.message || (status === 413 ? 'Request body exceeds the size limit' : status === 400 ? 'Request validation failed' : 'An unexpected error occurred') } }); });

function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function text(value: unknown, fallback = ''): string { return typeof value === 'string' ? value.trim().slice(0, 300) : fallback; }
function numeric(value: unknown): number | undefined { return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined; }

async function start(): Promise<void> { await PaymentOpsService.initialize(); const server = app.listen(port, () => console.log(`PayScope API listening on ${port}`)); server.requestTimeout = 30_000; server.headersTimeout = 15_000; server.keepAliveTimeout = 5_000; const shutdown = (signal: string) => { clearInterval(cleanupRateBuckets); PaymentOpsService.shutdown(); server.close(error => { if (error) { console.error(`${signal} shutdown failed`, error); process.exitCode = 1; } process.exit(); }); }; process.once('SIGTERM', () => shutdown('SIGTERM')); process.once('SIGINT', () => shutdown('SIGINT')); }
if (require.main === module) void start().catch(error => { console.error('PayScope could not start', error); process.exitCode = 1; });
export default app;

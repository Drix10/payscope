import 'dotenv/config';
import cors from 'cors';
import express, { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { ZodError } from 'zod';
import { createMvpRouter } from './api/mvp-router';
import { createRuntimeConfig } from './config/runtime-config';
import { requireDatabaseClient } from './db/client';
import { MvpRepository } from './db/mvp-repository';
import { AppError } from './errors';
import { AgenticWebhookIntake } from './pipeline/agentic-webhook-intake';
import { PipelineJobProcessor } from './pipeline/job-processor';
import { runDurableInvestigation } from './pipeline/investigation-runner';
import { HeuristicEnrichmentAdapter, RazorpayHttpEnrichmentClient } from './providers/enrichment/heuristic-adapter';
import { MeshModelAdapter } from './providers/model/mesh-adapter';
import { LoggingCommunicationsAdapter } from './providers/communications/logging-adapter';
import { QueueWorker } from './queue/queue-worker';

const app = express();
const port = portFrom(process.env.PORT);
const isDevelopment = process.env.NODE_ENV === 'development';
const pipelineEnabled = process.env.PAYSCOPE_MVP_PIPELINE === 'true';
const configuredOrigins = process.env.CORS_ORIGINS ?? (isDevelopment ? 'http://localhost:5173,http://localhost:3000,http://127.0.0.1:5173' : '');
const allowedOrigins = new Set(configuredOrigins.split(',').map(value => value.trim()).filter(Boolean));
type RateBucket = { tokens: number; lastRefillAt: number; lastSeenAt: number };
const apiBuckets = new Map<string, RateBucket>();
const webhookBuckets = new Map<string, RateBucket>();
const MAX_RATE_CLIENTS = 2_000;

const pipeline = pipelineEnabled ? (() => {
  const config = createRuntimeConfig();
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey || !config.webhookSecret || !config.organizationId) throw new Error('PAYSCOPE_MVP_PIPELINE requires Supabase credentials, RAZORPAY_WEBHOOK_SECRET, and PAYSCOPE_DEMO_ORGANIZATION_ID');
  const client = requireDatabaseClient(config);
  const repository = new MvpRepository(client);
  return { config, client, repository, intake: new AgenticWebhookIntake(repository, config) };
})() : undefined;

if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);
const cleanupBuckets = setInterval(() => { const cutoff = Date.now() - 60_000; for (const buckets of [apiBuckets, webhookBuckets]) for (const [client, bucket] of buckets) if (bucket.lastSeenAt <= cutoff) buckets.delete(client); }, 60_000);
cleanupBuckets.unref();

app.disable('x-powered-by');
app.use((_req, res, next) => { res.setHeader('X-Request-Id', randomUUID()); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('Cache-Control', 'no-store'); next(); });
app.use(cors({ origin: (origin, callback) => callback(null, !origin || allowedOrigins.has(origin)), allowedHeaders: ['Content-Type'], methods: ['GET', 'POST', 'OPTIONS'], maxAge: 600 }));
app.use('/webhooks/razorpay', (req, res, next) => { if (req.method !== 'POST') return next(); if (!allow(req, webhookBuckets, 600)) return res.status(429).json(failure('RATE_LIMITED', 'Too many webhook requests.')); next(); });
app.post('/webhooks/razorpay', express.raw({ type: 'application/json', limit: '256kb' }), async (req, res, next) => {
  try {
    if (!pipeline) throw new AppError('PIPELINE_NOT_ENABLED', 503, 'The durable PayScope MVP pipeline is not enabled.');
    if (!Buffer.isBuffer(req.body)) throw new AppError('INVALID_RAZORPAY_EVENT', 422, 'Razorpay webhook body must be raw JSON.');
    const result = await pipeline.intake.receive(req.body, req.header('x-razorpay-signature'), req.header('x-razorpay-event-id'));
    res.status(200).json({ received: true, duplicate: result.duplicate, eventId: result.eventId, pipeline: 'agentic_mvp' });
  } catch (error) { next(error); }
});
app.use('/api', (req, res, next) => { if (!allow(req, apiBuckets, 90)) return res.status(429).json(failure('RATE_LIMITED', 'Too many API requests.')); next(); });
app.use('/api', express.json({ limit: '64kb', strict: true }));
app.get('/health', (_req, res) => res.status(200).json({ status: pipeline ? 'ok' : 'degraded', service: 'payscope', pipeline: pipeline ? 'agentic_mvp' : 'disabled', worker: pipeline ? 'configured' : 'disabled', testModeOnly: true }));
if (pipeline) app.use('/api/mvp', createMvpRouter(pipeline.repository, pipeline.config.organizationId!, { approvalToken: pipeline.config.demoApprovalToken, approvalActorId: pipeline.config.demoOperatorId, communications: new LoggingCommunicationsAdapter() }));
else app.use('/api/mvp', (_req, res) => res.status(503).json(failure('PIPELINE_NOT_ENABLED', 'The durable PayScope MVP pipeline is not enabled.')));
app.use('/api', (_req, res) => res.status(404).json(failure('NOT_FOUND', 'API route not found.')));
app.use((_req, res) => res.status(404).json(failure('NOT_FOUND', 'Route not found.')));
app.use((error: Error, req: Request, res: Response, _next: NextFunction) => { if (res.headersSent || req.aborted) return; const appError = error instanceof AppError ? error : undefined; const parser = error as Error & { type?: string }; const status = appError?.status ?? (error instanceof ZodError ? 400 : parser.type === 'entity.too.large' ? 413 : 500); if (status === 500) console.error('[PayScope error]', error.message); res.status(status).json(failure(appError?.code ?? (status === 413 ? 'PAYLOAD_TOO_LARGE' : status === 400 ? 'INVALID_PAYLOAD' : 'MVP_API_ERROR'), appError?.message ?? (status === 500 ? 'The PayScope MVP could not complete the request.' : 'Request validation failed.'))); });

function allow(req: Request, buckets: Map<string, RateBucket>, limit: number): boolean { const now = Date.now(); const client = req.ip || 'unknown'; if (!buckets.has(client) && buckets.size >= MAX_RATE_CLIENTS) buckets.delete(buckets.keys().next().value!); const bucket = buckets.get(client) ?? { tokens: limit, lastRefillAt: now, lastSeenAt: now }; bucket.tokens = Math.min(limit, bucket.tokens + (now - bucket.lastRefillAt) * (limit / 60_000)); bucket.lastRefillAt = now; bucket.lastSeenAt = now; if (bucket.tokens < 1) { buckets.set(client, bucket); return false; } bucket.tokens -= 1; buckets.set(client, bucket); return true; }
function failure(code: string, message: string): { success: false; error: { code: string; message: string } } { return { success: false, error: { code, message } }; }
function portFrom(value: string | undefined): number { const parsed = Number(value ?? 25655); if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) throw new Error('PORT must be an integer between 1 and 65535'); return parsed; }

async function start(): Promise<void> {
  let worker: QueueWorker | undefined;
  if (pipeline) {
    const keyId = process.env.RAZORPAY_KEY_ID?.trim(); const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
    const modelKey = process.env.MESH_API_KEY?.trim();
    const model = modelKey ? new MeshModelAdapter(modelKey, process.env.MESH_MODEL?.trim() || undefined, pipeline.config.modelTimeoutMs) : undefined;
    const enrichment = new HeuristicEnrichmentAdapter(keyId && keySecret ? new RazorpayHttpEnrichmentClient(keyId, keySecret, pipeline.config.enrichmentTimeoutMs) : undefined);
    const processor = new PipelineJobProcessor(pipeline.repository, enrichment, async job => {
      if (!job.incidentId) throw new Error('Investigation job is missing incidentId');
      if (model) return runDurableInvestigation(pipeline.repository, model, job);
      await pipeline.repository.recordInvestigationUnavailable(job.organizationId, job.incidentId, job.triggerEventId, 'MESH_API_KEY is not configured; incident escalated for human review.');
    });
    worker = new QueueWorker(pipeline.client, pipeline.config.workerId, job => processor.process(job));
    worker.start();
  }
  const server = app.listen(port, () => console.log(`PayScope API listening on ${port}`)); server.requestTimeout = 30_000; server.headersTimeout = 15_000; server.keepAliveTimeout = 5_000;
  const shutdown = () => { clearInterval(cleanupBuckets); Promise.resolve(worker?.stopAndDrain()).catch(() => {}).finally(() => server.close(() => process.exit())); };
  process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
}
if (require.main === module) void start().catch(error => { console.error('PayScope could not start', error); process.exitCode = 1; });
export default app;

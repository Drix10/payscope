import { Router } from 'express';
import { ZodError } from 'zod';
import { MvpRepository } from '../db/mvp-repository';
import { IncidentStatus } from '../domain/contracts';

export type MvpRouterOptions = { enrichmentAdapter: 'razorpay_fields_heuristic'; razorpayEnvironment: 'test' | 'live' };

/** Read-only tenant dashboard API. All permitted action simulation occurs in the durable worker. */
export function createMvpRouter(repository: MvpRepository, organizationId: string, options: MvpRouterOptions): Router {
  const router = Router();
  router.get('/health', async (_req, res, next) => {
    try {
      await repository.healthCheck(organizationId);
      res.status(200).json({ success: true, data: { organizationId, pipeline: 'autonomous', razorpayEnvironment: options.razorpayEnvironment, communications: 'autonomous_simulation', database: 'ready', queueWorker: 'configured', webhook: 'signed', enrichmentAdapter: options.enrichmentAdapter } });
    } catch (error) { next(error); }
  });
  router.get('/incidents', async (req, res, next) => {
    try {
      const limit = parseLimit(req.query.limit, res);
      if (limit === undefined) return;
      const status = parseStatus(req.query.status, res);
      if (status === undefined && req.query.status !== undefined) return;
      res.status(200).json({ success: true, data: await repository.listIncidents(organizationId, limit, status) });
    } catch (error) { next(error); }
  });
  router.get('/incidents/:incidentId', async (req, res, next) => {
    try {
      if (!isUuid(req.params.incidentId)) return invalidRequest(res, 'incidentId must be a UUID.');
      const detail = await repository.incidentDetail(organizationId, req.params.incidentId);
      res.status(200).json({ success: true, data: { ...detail, events: detail.events.map(event => ({
        id: event.id,
        organizationId: event.organizationId,
        event: { eventType: event.event.eventType, occurredAt: event.event.occurredAt, receivedAt: event.event.receivedAt, amountPaise: event.event.amountPaise, paymentMethod: event.event.paymentMethod },
        enrichment: event.enrichment,
        enrichmentSource: event.enrichmentSource,
      })) } });
    } catch (error) { next(error); }
  });
  router.get('/audit', async (req, res, next) => {
    try {
      const incidentId = typeof req.query.incidentId === 'string' ? req.query.incidentId : undefined;
      if (req.query.incidentId !== undefined && (!incidentId || !isUuid(incidentId))) return invalidRequest(res, 'incidentId must be a UUID.');
      res.status(200).json({ success: true, data: (await repository.auditEntries(organizationId, incidentId)).map(projectAuditEntry) });
    } catch (error) { next(error); }
  });
  router.get('/audit/integrity', async (_req, res, next) => {
    try { res.status(200).json({ success: true, data: await repository.auditIntegrity(organizationId) }); } catch (error) { next(error); }
  });
  router.get('/dashboard/metrics', async (_req, res, next) => {
    try { res.status(200).json({ success: true, data: await repository.dashboardMetrics(organizationId) }); } catch (error) { next(error); }
  });
  router.get('/dashboard/query', async (req, res, next) => {
    try {
      const query = parseDashboardQuery(req.query.q, res);
      if (query === undefined) return;
      const limit = parseDashboardLimit(req.query.limit, res);
      if (limit === undefined) return;
      res.status(200).json({ success: true, data: await repository.dashboardQuery(organizationId, query, limit) });
    } catch (error) { next(error); }
  });
  router.use((error: Error, _req: unknown, res: { status(code: number): { json(value: unknown): void } }, _next: unknown) => {
    const status = error instanceof ZodError ? 502 : /was not found/.test(error.message) ? 404 : 500;
    res.status(status).json({ success: false, error: { code: status === 404 ? 'INCIDENT_NOT_FOUND' : status === 502 ? 'INVALID_BACKEND_DATA' : 'MVP_API_ERROR', message: status === 500 ? 'The autonomous PayScope MVP API could not complete the request.' : error.message } });
  });
  return router;
}

function parseLimit(value: unknown, res: { status(code: number): { json(value: unknown): void } }): number | undefined {
  if (value === undefined) return 100;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return invalidRequest(res, 'limit must be an integer between 1 and 100.');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 100) return invalidRequest(res, 'limit must be an integer between 1 and 100.');
  return parsed;
}

function parseStatus(value: unknown, res: { status(code: number): { json(value: unknown): void } }): IncidentStatus | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !['OPEN', 'MONITORING', 'DISPUTE_OPENED', 'RESOLVED', 'DISMISSED'].includes(value)) return invalidRequest(res, 'status must be a valid incident lifecycle state.');
  return value as IncidentStatus;
}

function parseDashboardQuery(value: unknown, res: { status(code: number): { json(value: unknown): void } }): string | undefined {
  if (typeof value !== 'string') return invalidRequest(res, 'q must be a natural-language dashboard query between 1 and 240 characters.');
  const query = value.trim();
  if (!query || query.length > 240) return invalidRequest(res, 'q must be a natural-language dashboard query between 1 and 240 characters.');
  return query;
}

function parseDashboardLimit(value: unknown, res: { status(code: number): { json(value: unknown): void } }): number | undefined {
  if (value === undefined) return 10;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return invalidRequest(res, 'limit must be an integer between 1 and 20.');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 20) return invalidRequest(res, 'limit must be an integer between 1 and 20.');
  return parsed;
}

function isUuid(value: string): boolean { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
function invalidRequest(res: { status(code: number): { json(value: unknown): void } }, message: string): undefined { res.status(400).json({ success: false, error: { code: 'INVALID_REQUEST', message } }); return undefined; }

function projectAuditEntry(entry: Awaited<ReturnType<MvpRepository['auditEntries']>>[number]) {
  const snapshot = entry.enrichmentSnapshot;
  const source = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) && typeof (snapshot as Record<string, unknown>).source === 'string' ? (snapshot as Record<string, unknown>).source : null;
  return { id: entry.id, organizationId: entry.organizationId, incidentId: entry.incidentId, sequenceNumber: entry.sequenceNumber, eventType: entry.eventType, actorType: entry.actorType, actorId: entry.actorId, decision: entry.decision, rationale: entry.rationale, confidence: entry.confidence, enrichmentSource: source, createdAt: entry.createdAt };
}

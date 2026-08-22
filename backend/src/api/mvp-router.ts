import { Router } from 'express';
import { ZodError } from 'zod';
import { MvpRepository } from '../db/mvp-repository';

/** Read-only tenant-scoped API used by the replacement operator workspace. */
export function createMvpRouter(repository: MvpRepository, organizationId: string): Router {
  const router = Router();

  router.get('/health', (_req, res) => res.status(200).json({ success: true, data: { organizationId, pipeline: 'agentic_mvp', testMode: true, communications: 'proposal_only' } }));
  router.get('/incidents', async (req, res, next) => {
    try {
      const limit = typeof req.query.limit === 'string' && /^\d+$/.test(req.query.limit) ? Number(req.query.limit) : 100;
      res.status(200).json({ success: true, data: await repository.listIncidents(organizationId, limit) });
    } catch (error) { next(error); }
  });
  router.get('/incidents/:incidentId', async (req, res, next) => {
    try { res.status(200).json({ success: true, data: await repository.incidentDetail(organizationId, req.params.incidentId) }); } catch (error) { next(error); }
  });
  router.get('/audit', async (req, res, next) => {
    try {
      const incidentId = typeof req.query.incidentId === 'string' ? req.query.incidentId : undefined;
      res.status(200).json({ success: true, data: await repository.auditEntries(organizationId, incidentId) });
    } catch (error) { next(error); }
  });
  router.use((error: Error, _req: unknown, res: { status(code: number): { json(value: unknown): void } }, _next: unknown) => {
    const status = error instanceof ZodError ? 502 : /was not found/.test(error.message) ? 404 : 500;
    res.status(status).json({ success: false, error: { code: status === 404 ? 'INCIDENT_NOT_FOUND' : status === 502 ? 'INVALID_BACKEND_DATA' : 'MVP_API_ERROR', message: status === 500 ? 'The agentic MVP API could not complete the request.' : error.message } });
  });
  return router;
}

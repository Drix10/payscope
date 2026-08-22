import { Router } from 'express';
import { createHash, timingSafeEqual } from 'crypto';
import { ZodError } from 'zod';
import { MvpRepository } from '../db/mvp-repository';
import { CommunicationsProvider } from '../providers/communications/interface';

export type MvpRouterOptions = {
  approvalToken?: string;
  approvalActorId: string;
  communications: CommunicationsProvider;
};

/** Read-only tenant-scoped API used by the replacement operator workspace. */
export function createMvpRouter(repository: MvpRepository, organizationId: string, options?: MvpRouterOptions): Router {
  const router = Router();

  router.get('/health', (_req, res) => res.status(200).json({ success: true, data: { organizationId, pipeline: 'agentic_mvp', testMode: true, communications: 'proposal_only' } }));
  router.get('/incidents', async (req, res, next) => {
    try {
      const limit = parseLimit(req.query.limit, res);
      if (limit === undefined) return;
      res.status(200).json({ success: true, data: await repository.listIncidents(organizationId, limit) });
    } catch (error) { next(error); }
  });
  router.get('/incidents/:incidentId', async (req, res, next) => {
    try {
      if (!isUuid(req.params.incidentId)) return invalidRequest(res, 'incidentId must be a UUID.');
      res.status(200).json({ success: true, data: await repository.incidentDetail(organizationId, req.params.incidentId) });
    } catch (error) { next(error); }
  });
  router.get('/audit', async (req, res, next) => {
    try {
      const incidentId = typeof req.query.incidentId === 'string' ? req.query.incidentId : undefined;
      if (req.query.incidentId !== undefined && (!incidentId || !isUuid(incidentId))) return invalidRequest(res, 'incidentId must be a UUID.');
      res.status(200).json({ success: true, data: await repository.auditEntries(organizationId, incidentId) });
    } catch (error) { next(error); }
  });
  router.post('/proposals/:proposalId/approve', async (req, res, next) => {
    try {
      if (!isUuid(req.params.proposalId)) return invalidRequest(res, 'proposalId must be a UUID.');
      if (!options?.approvalToken) return unavailable(res, 'Proposal approval is not configured on this demo server.');
      const presentedToken = req.header('x-payscope-demo-approval-token');
      if (!presentedToken || !matchesApprovalToken(presentedToken, options.approvalToken)) return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'A valid demo approval token is required.' } });
      const pending = await repository.proposalById(organizationId, req.params.proposalId);
      const deliveryResult = await options.communications.executeApprovedAction(pending);
      const approved = await repository.approveProposal(organizationId, pending.id, options.approvalActorId, hashToken(presentedToken), deliveryResult);
      res.status(200).json({ success: true, data: approved });
    } catch (error) { next(error); }
  });
  router.use((error: Error, _req: unknown, res: { status(code: number): { json(value: unknown): void } }, _next: unknown) => {
    const status = error instanceof ZodError ? 502 : /was not found/.test(error.message) ? 404 : 500;
    res.status(status).json({ success: false, error: { code: status === 404 ? 'INCIDENT_NOT_FOUND' : status === 502 ? 'INVALID_BACKEND_DATA' : 'MVP_API_ERROR', message: status === 500 ? 'The agentic MVP API could not complete the request.' : error.message } });
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

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function invalidRequest(res: { status(code: number): { json(value: unknown): void } }, message: string): undefined {
  res.status(400).json({ success: false, error: { code: 'INVALID_REQUEST', message } });
  return undefined;
}

function unavailable(res: { status(code: number): { json(value: unknown): void } }, message: string): undefined {
  res.status(503).json({ success: false, error: { code: 'APPROVAL_UNAVAILABLE', message } });
  return undefined;
}

function hashToken(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function matchesApprovalToken(presented: string, configured: string): boolean {
  return timingSafeEqual(Buffer.from(hashToken(presented), 'hex'), Buffer.from(hashToken(configured), 'hex'));
}

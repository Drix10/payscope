import { MvpRepository } from '../db/mvp-repository';
import { ExecutionWorker } from '../execution/execution-worker';
import { logger } from '../observability';
import { RazorpayReadClient } from '../providers/execution/razorpay-read-client';
import { SAGAS } from './saga-engine';

export async function advanceSaga(
  sagaId: string,
  organizationId: string,
  repository: MvpRepository,
  readClient: RazorpayReadClient | null,
  executionWorker: ExecutionWorker | null
): Promise<void> {
  const saga = await repository.saga(organizationId, sagaId);
  if (!saga || saga.status !== 'active') return;

  const incident = await repository.incident(organizationId, saga.incidentId);
  if (!incident) return;

  // Security & Safety override: if incident enters dispute or fraud after saga starts
  if (incident.status === 'DISPUTE_OPENED' && saga.strategyName !== 'dispute_evidence_auto') {
    await repository.abandonSaga(sagaId, organizationId, 'dispute_stopped');
    await repository.appendAuditEntry({
      organizationId,
      incidentId: incident.id,
      eventType: 'saga_abandoned',
      actorType: 'system',
      actorId: 'saga-runner',
      decision: 'dispute_opened_mid_saga',
      rationale: 'Autonomous saga halted due to active customer dispute.',
      confidence: 1.0,
    });
    return;
  }

  if (incident.status === 'DISMISSED') {
    await repository.abandonSaga(sagaId, organizationId, 'policy_blocked');
    return;
  }

  if (incident.status === 'RESOLVED') {
    await repository.completeSaga(sagaId, organizationId, 'recovered', incident.totalFailedAmountPaise);
    return;
  }

  const step = await repository.currentSagaStep(sagaId, organizationId);
  if (!step || step.status !== 'pending') return;

  const sagaDef = SAGAS[saga.strategyName] ?? SAGAS.recovery_email_same_method;
  const stepDef = sagaDef.steps[step.stepIndex];
  if (!stepDef) return;

  logger.info({ sagaId, stepIndex: step.stepIndex, stepType: stepDef.type }, 'Advancing recovery saga step');

  if (stepDef.type === 'observe') {
    let paid = false;
    let paymentStatus = 'failed';

    if (readClient) {
      const referenceId = `ps_${sagaId.replace(/-/g, '')}`;
      const link = await readClient.paymentLinkByReference(referenceId).catch(() => null);
      if (link && link.status === 'paid') {
        paid = true;
        paymentStatus = 'paid';
      }
    }

    await repository.completeSagaStep(step.id, organizationId, { paymentStatus, paid, observedAt: new Date().toISOString() });

    if (paid) {
      await repository.completeSaga(sagaId, organizationId, 'recovered', incident.totalFailedAmountPaise);
      await repository.updateIncidentStatus(incident.id, organizationId, 'RESOLVED', incident.totalFailedAmountPaise, 0);
      await repository.appendAuditEntry({
        organizationId,
        incidentId: incident.id,
        eventType: 'saga_completed',
        actorType: 'system',
        actorId: 'saga-runner',
        decision: 'payment_link_paid',
        rationale: 'Observed paid status from Razorpay payment link. Revenue recovered and reconciled.',
        confidence: 1.0,
      });
      return;
    }

    if (saga.currentStepIndex >= saga.totalSteps - 1) {
      await repository.abandonSaga(sagaId, organizationId, 'exhausted');
      return;
    }

    await repository.advanceSagaStep(sagaId, organizationId);

  } else if (stepDef.type === 'act') {
    const capability = stepDef.capability;
    const actionId = await repository.createExecutionActionForSaga(organizationId, incident.id, capability, stepDef.rationale, incident.totalFailedAmountPaise);
    
    await repository.completeSagaStep(step.id, organizationId, { actionId, dispatched: true });
    await repository.advanceSagaStep(sagaId, organizationId);

  } else if (stepDef.type === 'wait') {
    const durationMs = stepDef.durationMs;
    const resumesAt = new Date(Date.now() + durationMs).toISOString();

    await repository.completeSagaStep(step.id, organizationId, { resumesAt });
    await repository.scheduleSagaAdvancementJob(sagaId, organizationId, resumesAt);
  }
}

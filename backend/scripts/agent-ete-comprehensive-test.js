const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { EchoModelAdapter } = require('../dist/providers/model/echo-adapter');
const { runInvestigationSupervisor } = require('../dist/pipeline/investigation-supervisor');
const { runRiskAnalyst } = require('../dist/pipeline/risk-analyst');
const { runRecoveryPlanner } = require('../dist/pipeline/recovery-planner');
const { evaluatePolicy } = require('../dist/pipeline/policy-evaluator');
const { runDurableInvestigation } = require('../dist/pipeline/investigation-runner');
const { ExecutionWorker } = require('../dist/execution/execution-worker');
const { ExecutionPreconditionError } = require('../dist/execution/execution-repository');
const { encryptEmail } = require('../dist/security/encryption');
const { RazorpayExecutionClient } = require('../dist/providers/execution/razorpay-execution-client');

const org = '00000000-0000-4000-8000-000000000001';
let passed = 0; let failed = 0;

function echoFor(scenario){
  return new EchoModelAdapter(req => {
    if(req.systemPrompt.includes('Supervisor')) return scenario.supervisor;
    if(req.systemPrompt.includes('Risk Analyst')) return scenario.risk;
    return scenario.recovery;
  });
}

async function runScenario(name, scenario){
  const incident = scenario.incident;
  const enrichment = scenario.enrichment;
  const model = echoFor(scenario);
  try {
    // Supervisor must produce bounded plan
    const sup = await runInvestigationSupervisor(model, { incident, enrichment, merchantPolicyCount: 1, autoResolveBudgetRemaining: scenario.autoResolveBudget ?? 0.5 }, org);
    assert.ok(sup.plan.hypothesis.length >= 5, `${name}: supervisor hypothesis too short`);
    assert.ok(sup.plan.evidencePriorities.length >= 1, `${name}: supervisor missing evidencePriorities`);
    assert.ok(sup.plan.constraints.length >= 1, `${name}: supervisor missing constraints`);
    // Risk must produce causal narrative and alternatives
    const risk = await runRiskAnalyst(model, {
      getIncidentTimeline: async()=> scenario.timeline || [],
      getMerchantFailureRate: async()=> scenario.metrics?.merchantFailureRate ?? null,
      getNetworkFailureRate: async()=> scenario.metrics?.networkFailureRate ?? null,
      getCustomerIncidentCount: async()=> scenario.metrics?.customerIncidentCount ?? null,
    }, { incident, enrichment, customerHash: scenario.customerHash, gateway: scenario.gateway || 'upi' }, org);
    assert.ok(risk.analysis.causalNarrative.length > 10, `${name}: risk causalNarrative missing`);
    assert.ok(risk.analysis.evidenceConfidenceRationale.length > 5, `${name}: risk confidence rationale missing`);
    // Recovery must respect direct catalogue and produce valid preconditions
    let rec;
    if(scenario.expectPlannerRejection){
      await assert.rejects(() => runRecoveryPlanner(model, {
        incident, riskAnalysis: risk.analysis, merchantOptedInToRecovery: scenario.merchantOptedIn ?? true,
        memory: scenario.memory || [], directExecution: true
      }, org), new RegExp(scenario.expectPlannerRejection));
      console.log(`\u2713 ${name}: planner guardrail rejected invalid proposal`);
      passed++;
      return;
    }
    rec = await runRecoveryPlanner(model, {
      incident, riskAnalysis: risk.analysis, merchantOptedInToRecovery: scenario.merchantOptedIn ?? true,
      memory: scenario.memory || [], directExecution: true
    }, org);
    // Policy must deterministic
    const policy = evaluatePolicy(incident, risk.analysis, rec.plan, scenario.policies || [{id:'00000000-0000-4000-8000-000000000004', enabled:true, minimumConfidence:0.5, rootCauses:[risk.analysis.failureRootCause], allowedActions: scenario.allowedActions || ['deliver_recovery_link_email','record_risk_signal','resolve_infrastructure'], merchantOptedIn: scenario.merchantOptedIn ?? true}], {autoResolveFraction: scenario.autoResolveFraction ?? 0.1}, scenario.contact || {incidentAttempts:0, attemptsLast24Hours:0, attemptsLast7Days:0, merchantOptedIn: scenario.merchantOptedIn ?? true, customerReferenceAvailable: scenario.customerHash ? true : false}, scenario.directOptions);
    // Validate expected outcome
    if(scenario.expect){
      assert.equal(policy.outcome, scenario.expect.outcome, `${name}: expected outcome ${scenario.expect.outcome} got ${policy.outcome}`);
      if(scenario.expect.noActionReason) assert.equal(policy.noActionReason, scenario.expect.noActionReason, `${name}: noActionReason`);
      if(scenario.expect.permittedAction) assert.ok(policy.permittedActions.some(a=>a.actionType===scenario.expect.permittedAction), `${name}: expected permitted ${scenario.expect.permittedAction}`);
    }
    // Durable investigation should persist without throwing (using stub repo)
    let unavailableReason = null;
    const repo = {
      incidentDetail: async()=>({incident, events:[{id:'evt1', organizationId:org, event:{eventId:'evt1', eventType:'payment.failed', occurredAt: incident.openedAt, receivedAt: incident.openedAt, customerHash: scenario.customerHash, amountPaise: incident.totalFailedAmountPaise, currency:'INR', paymentMethod: scenario.gateway || 'upi', providerData:{}}, enrichment: enrichment}] , proposals:[], investigation:null}),
      policyContext: async()=>({policy:{id:'00000000-0000-4000-8000-000000000004', enabled:true, minimumConfidence:0.5, rootCauses:[risk.analysis.failureRootCause], allowedActions: scenario.allowedActions || ['deliver_recovery_link_email'], merchantOptedIn: scenario.merchantOptedIn ?? true}, stats:{autoResolveFraction: scenario.autoResolveFraction ?? 0.1}, contact: scenario.contact || {incidentAttempts:0, attemptsLast24Hours:0, attemptsLast7Days:0, merchantOptedIn: scenario.merchantOptedIn ?? true, customerReferenceAvailable: !!scenario.customerHash}}),
      riskToolMetrics: async()=> scenario.metrics || {merchantFailureRate:0.1, networkFailureRate:0.1, customerIncidentCount:0},
      incidentMemory: async()=> scenario.memory || [],
      persistDirectInvestigation: async()=>{ /* ok */},
      recordInvestigationUnavailable: async(_o,_i,_t,reason)=>{ unavailableReason = reason; },
    };
    const job={jobId:'00000000-0000-4000-8000-000000000010', organizationId:org, type:'investigate_incident', attemptNumber:1, createdAt: incident.openedAt, incidentId: incident.id, triggerEventId:'evt1'};
    await runDurableInvestigation(repo, model, job, {directExecution:true});
    if(scenario.expectUnavailable){
      assert.ok(unavailableReason, `${name}: expected audited unavailable terminalization`);
    } else if(unavailableReason) throw new Error(`pipeline recorded unavailable: ${unavailableReason}`);
    console.log(`✓ ${name}: ${policy.outcome} ${policy.permittedActions.map(a=>a.actionType).join(',')||policy.noActionReason}`);
    passed++;
  } catch(e){
    console.error(`✗ ${name}:`, e.message);
    console.error(e.stack?.split('\n').slice(0,5).join('\n'));
    failed++;
  }
}

(async()=>{
  const baseIncident = {id:'00000000-0000-4000-8000-000000000002', organizationId:org, riskTier:'MEDIUM', status:'OPEN', totalFailedAmountPaise:1000, recoveredAmountPaise:0, remainingAmountPaise:1000, correlatedEventIds:[], openedAt:'2026-08-22T00:00:00.000Z', resolvedAt:null, updatedAt:'2026-08-22T00:00:00.000Z'};
  const baseEnrich = {failureAttribution:'gateway_degraded', gatewayHealthScore:0.2, gatewayInDowntime:true, downtimeScheduled:false, crossBorderFlag:false, priorAttemptCount:1, partialRecoveryPossible:false, recommendedRetryMethod:'netbanking', source:'fixture_signed', enrichedAt:'2026-08-22T00:00:00.000Z', signalsUsed:[]};
  
  // 1. Infra downtime → should propose resolve_infrastructure
  await runScenario('infra-downtime', {
    incident: baseIncident, enrichment: {...baseEnrich, failureAttribution:'gateway_degraded', gatewayHealthScore:0.2, gatewayInDowntime:true},
    supervisor:{hypothesis:'Gateway downtime causes failures', primaryFailureCategory:'infrastructure', objectives:['Check downtime proof and failure rate'], evidencePriorities:[{fact:'Gateway downtime active', whyItMatters:'Supports infra cause with health score 0.2'}], subAgents:[], constraints:['No PII or financial action without policy'], noActionCriteria:['No downtime proof or health score normal'], estimatedAutoResolvable:true, requiresNoActionFallback:false, confidence:0.9, reasoning:'Downtime active with health 0.2 supports infra'},
    risk:{failureRootCause:'gateway_degraded', evidenceStrength:'strong', confidence:0.9, causalNarrative:'Downtime correlates with gateway degraded health score 0.2 and downtime flag', evidenceConfidenceRationale:'Direct downtime signal with health score 0.2 and downtime true', alternativeHypotheses:[], falsePositiveCostEstimatePaise:0, missingEvidence:[], chargebackEvidenceReady:false, evidenceItems:['downtime'], recommendedActionCategory:'auto_resolve_no_action'},
    recovery:{proposedActions:[{actionType:'resolve_infrastructure', rationale:'Infra downtime confirmed', preconditions:['Downtime is active and health score below threshold'], expectedOutcome:'Infra resolved and incident can be monitored', estimatedRecoveryPaise:null, requiresAutonomousExecution:true}], recoveryProbability:0.8, confidence:0.9},
    allowedActions:['resolve_infrastructure'], expect:{outcome:'auto_with_proposals', permittedAction:'resolve_infrastructure'}
  });
  
  // 2. Fraud confirmed strong cross-border → must be blocked and no outreach
  await runScenario('fraud-confirmed', {
    incident:{...baseIncident, riskTier:'HIGH'}, enrichment:{...baseEnrich, failureAttribution:'fraud_block', crossBorderFlag:true, gatewayHealthScore:0.9},
    supervisor:{hypothesis:'Fraud', primaryFailureCategory:'fraud_confirmed', objectives:['Check fraud signals'], evidencePriorities:[{fact:'Fraud block', whyItMatters:'Fraud signal'}], subAgents:[], constraints:['No PII'], noActionCriteria:['Fraud confirmed → no outreach'], estimatedAutoResolvable:false, requiresNoActionFallback:true, confidence:0.95, reasoning:'Fraud confirmed'},
    risk:{failureRootCause:'fraud_confirmed', evidenceStrength:'strong', confidence:0.95, causalNarrative:'Fraud confirmed with cross-border', evidenceConfidenceRationale:'Strong', alternativeHypotheses:[], falsePositiveCostEstimatePaise:500, missingEvidence:[], chargebackEvidenceReady:true, evidenceItems:['fraud'], recommendedActionCategory:'escalate_fraud'},
    recovery:{proposedActions:[{actionType:'record_risk_signal', rationale:'Fraud risk', preconditions:['Fraud confirmed'], expectedOutcome:'Risk recorded', estimatedRecoveryPaise:null, requiresAutonomousExecution:true}], recoveryProbability:0.1, confidence:0.95},
    metrics:{merchantFailureRate:0.9, networkFailureRate:0.1, customerIncidentCount:5}, customerHash:'a'.repeat(64), gateway:'card', expect:{outcome:'auto_no_action', noActionReason:'FRAUD_CONFIRMED_HARD_STOP'}
  });
  
  // 3. Fraud suspected → only record_risk_signal allowed, outreach blocked
  await runScenario('fraud-suspected-outreach-blocked', {
    incident:baseIncident, enrichment:{...baseEnrich, failureAttribution:'fraud_block'},
    supervisor:{hypothesis:'Suspected fraud', primaryFailureCategory:'fraud_suspected', objectives:['Check fraud'], evidencePriorities:[{fact:'Suspected', whyItMatters:'Check'}], subAgents:[], constraints:['No PII'], noActionCriteria:['Suspected → only risk signal'], estimatedAutoResolvable:false, requiresNoActionFallback:true, confidence:0.8, reasoning:'Suspected'},
    risk:{failureRootCause:'fraud_suspected', evidenceStrength:'moderate', confidence:0.8, causalNarrative:'Fraud signals suspected from fraud_block enrichment', evidenceConfidenceRationale:'Moderate', alternativeHypotheses:['issuer timeout'], falsePositiveCostEstimatePaise:200, missingEvidence:[], chargebackEvidenceReady:false, evidenceItems:['fraud_suspected'], recommendedActionCategory:'escalate_fraud'},
    recovery:{proposedActions:[{actionType:'record_risk_signal', rationale:'Record', preconditions:['Fraud suspected'], expectedOutcome:'Recorded', estimatedRecoveryPaise:null, requiresAutonomousExecution:true}], recoveryProbability:0.2, confidence:0.8},
    customerHash:'b'.repeat(64), expect:{outcome:'auto_with_proposals', permittedAction:'record_risk_signal'}
  });
  
  // 4. Customer drop with opt-in → deliver_recovery_link_email
  await runScenario('customer-drop-optin', {
    incident:baseIncident, enrichment:{...baseEnrich, failureAttribution:'customer_drop', gatewayHealthScore:0.9, gatewayInDowntime:false},
    supervisor:{hypothesis:'Customer dropped', primaryFailureCategory:'customer_error', objectives:['Check customer signal'], evidencePriorities:[{fact:'Customer drop', whyItMatters:'Customer issue'}], subAgents:[], constraints:['No PII'], noActionCriteria:['No opt-in'], estimatedAutoResolvable:false, requiresNoActionFallback:true, confidence:0.85, reasoning:'Customer drop'},
    risk:{failureRootCause:'customer_error', evidenceStrength:'moderate', confidence:0.85, causalNarrative:'Customer dropped', evidenceConfidenceRationale:'Moderate', alternativeHypotheses:[], falsePositiveCostEstimatePaise:100, missingEvidence:[], chargebackEvidenceReady:false, evidenceItems:['customer drop'], recommendedActionCategory:'propose_recovery'},
    recovery:{proposedActions:[{actionType:'deliver_recovery_link_email', rationale:'Offer retry link', preconditions:['Opt-in exists'], expectedOutcome:'Email accepted and later reconciled', estimatedRecoveryPaise:1000, emailCopyIntent:'Your payment could not be completed. Please use the secure link to try again. To opt out, reply stop.', requiresAutonomousExecution:true}], recoveryProbability:0.7, confidence:0.85},
    customerHash:'c'.repeat(64), merchantOptedIn:true, contact:{incidentAttempts:0, attemptsLast24Hours:0, attemptsLast7Days:0, merchantOptedIn:true, customerReferenceAvailable:true}, expect:{outcome:'auto_with_proposals', permittedAction:'deliver_recovery_link_email'}
  });
  
  // 5. No opt-in → outreach blocked
  await runScenario('no-optin-blocked', {
    incident:baseIncident, enrichment:{...baseEnrich, failureAttribution:'customer_drop'},
    supervisor:{hypothesis:'Customer drop', primaryFailureCategory:'customer_error', objectives:['Check'], evidencePriorities:[{fact:'Customer drop', whyItMatters:'test'}], subAgents:[], constraints:['No PII'], noActionCriteria:['No opt-in'], estimatedAutoResolvable:false, requiresNoActionFallback:true, confidence:0.85, reasoning:'test'},
    risk:{failureRootCause:'customer_error', evidenceStrength:'moderate', confidence:0.85, causalNarrative:'Customer dropped during checkout, no gateway issue', evidenceConfidenceRationale:'Moderate', alternativeHypotheses:[], falsePositiveCostEstimatePaise:100, missingEvidence:[], chargebackEvidenceReady:false, evidenceItems:['customer'], recommendedActionCategory:'propose_recovery'},
    recovery:{proposedActions:[{actionType:'deliver_recovery_link_email', rationale:'Offer', preconditions:['Opt-in'], expectedOutcome:'Email', estimatedRecoveryPaise:1000, emailCopyIntent:'Your payment could not be completed. Please use the secure link. To opt out, reply stop.', requiresAutonomousExecution:true}], recoveryProbability:0.7, confidence:0.85},
    merchantOptedIn:false, expectPlannerRejection:'cannot propose outreach without merchant opt-in'
  });
  
  // 6. Dispute opened → hard stop
  await runScenario('dispute-opened', {
    incident:{...baseIncident, status:'DISPUTE_OPENED', riskTier:'CRITICAL'}, enrichment:baseEnrich,
    supervisor:{hypothesis:'Dispute', primaryFailureCategory:'unknown', objectives:['Check dispute'], evidencePriorities:[{fact:'Dispute opened', whyItMatters:'Dispute'}], subAgents:[], constraints:['No PII'], noActionCriteria:['Dispute → no action'], estimatedAutoResolvable:false, requiresNoActionFallback:true, confidence:0.9, reasoning:'Dispute'},
    risk:{failureRootCause:'unknown', evidenceStrength:'weak', confidence:0.9, causalNarrative:'Dispute opened, recovery outreach must stop', evidenceConfidenceRationale:'Weak evidence, calibrated low', alternativeHypotheses:[], falsePositiveCostEstimatePaise:0, missingEvidence:[], chargebackEvidenceReady:false, evidenceItems:['dispute'], recommendedActionCategory:'auto_resolve_no_action'},
    recovery:{proposedActions:[{actionType:'deliver_recovery_link_email', rationale:'Try', preconditions:['Dispute'], expectedOutcome:'No', estimatedRecoveryPaise:1000, emailCopyIntent:'Your payment could not be completed. To opt out, reply stop.', requiresAutonomousExecution:true}], recoveryProbability:0.5, confidence:0.9},
    expectPlannerRejection:'cannot propose actions on an open dispute'
  });
  
  // 7. Contact limits exceeded → outreach removed
  await runScenario('contact-limits', {
    incident:baseIncident, enrichment:{...baseEnrich, failureAttribution:'customer_drop'},
    supervisor:{hypothesis:'Customer', primaryFailureCategory:'customer_error', objectives:['Check'], evidencePriorities:[{fact:'Customer', whyItMatters:'test'}], subAgents:[], constraints:['No PII'], noActionCriteria:['Limits'], estimatedAutoResolvable:false, requiresNoActionFallback:true, confidence:0.85, reasoning:'test'},
    risk:{failureRootCause:'customer_error', evidenceStrength:'moderate', confidence:0.85, causalNarrative:'Customer dropped during checkout, no gateway issue', evidenceConfidenceRationale:'Moderate', alternativeHypotheses:[], falsePositiveCostEstimatePaise:100, missingEvidence:[], chargebackEvidenceReady:false, evidenceItems:['customer'], recommendedActionCategory:'propose_recovery'},
    recovery:{proposedActions:[{actionType:'deliver_recovery_link_email', rationale:'Offer', preconditions:['Contact ok'], expectedOutcome:'Email', estimatedRecoveryPaise:1000, emailCopyIntent:'Your payment could not be completed. Please use the secure link. To opt out, reply stop.', requiresAutonomousExecution:true}], recoveryProbability:0.7, confidence:0.85},
    contact:{incidentAttempts:2, attemptsLast24Hours:1, attemptsLast7Days:3, merchantOptedIn:true, customerReferenceAvailable:true}, customerHash:'e'.repeat(64), expect:{outcome:'auto_no_action', noActionReason:'NO_PERMITTED_ACTION'}
  });
  
  // 8. Enrichment unavailable → must require no-action fallback and be handled
  await runScenario('enrichment-unavailable', {
    incident:baseIncident, enrichment:null,
    supervisor:{hypothesis:'Unknown', primaryFailureCategory:'unknown', objectives:['Check missing'], evidencePriorities:[{fact:'Enrichment unavailable', whyItMatters:'Missing signal'}], subAgents:[], constraints:['No PII'], noActionCriteria:['Enrichment missing → no action if not enough evidence'], estimatedAutoResolvable:false, requiresNoActionFallback:true, confidence:0.5, reasoning:'Missing enrichment'},
    risk:{failureRootCause:'unknown', evidenceStrength:'weak', confidence:0.5, causalNarrative:'Not enough evidence', evidenceConfidenceRationale:'Enrichment missing', alternativeHypotheses:['gateway issue','issuer'], falsePositiveCostEstimatePaise:0, missingEvidence:['Enrichment unavailable'], chargebackEvidenceReady:false, evidenceItems:['no enrichment'], recommendedActionCategory:'auto_resolve_no_action'},
    recovery:{proposedActions:[], noActionReason:'Not enough evidence to propose action', recoveryProbability:0.1, confidence:0.5},
    metrics:{merchantFailureRate:null, networkFailureRate:null, customerIncidentCount:null}, expect:{outcome:'auto_no_action'}
  });
  
  // 9. Critical tier → blocked
  await runScenario('critical-tier', {
    incident:{...baseIncident, riskTier:'CRITICAL'}, enrichment:baseEnrich,
    supervisor:{hypothesis:'Critical', primaryFailureCategory:'unknown', objectives:['Check'], evidencePriorities:[{fact:'Critical', whyItMatters:'High risk'}], subAgents:[], constraints:['No PII'], noActionCriteria:['Critical → no auto'], estimatedAutoResolvable:false, requiresNoActionFallback:true, confidence:0.9, reasoning:'Critical'},
    risk:{failureRootCause:'unknown', evidenceStrength:'weak', confidence:0.9, causalNarrative:'Critical risk tier blocks autonomous action', evidenceConfidenceRationale:'Weak evidence, calibrated low', alternativeHypotheses:[], falsePositiveCostEstimatePaise:0, missingEvidence:[], chargebackEvidenceReady:false, evidenceItems:['critical'], recommendedActionCategory:'auto_resolve_no_action'},
    recovery:{proposedActions:[{actionType:'record_risk_signal', rationale:'Record', preconditions:['Critical'], expectedOutcome:'Recorded', estimatedRecoveryPaise:null, requiresAutonomousExecution:true}], recoveryProbability:0.2, confidence:0.9},
    expect:{outcome:'auto_no_action', noActionReason:'CRITICAL_RISK_TIER'}
  });
  
  // 10. Auto-resolve ceiling exceeded
  await runScenario('auto-resolve-ceiling', {
    incident:baseIncident, enrichment:baseEnrich,
    supervisor:{hypothesis:'Customer retry candidate', primaryFailureCategory:'customer_error', objectives:['Check'], evidencePriorities:[{fact:'Test', whyItMatters:'test'}], subAgents:[], constraints:['No PII'], noActionCriteria:['Ceiling'], estimatedAutoResolvable:false, requiresNoActionFallback:true, confidence:0.85, reasoning:'test'},
    risk:{failureRootCause:'customer_error', evidenceStrength:'moderate', confidence:0.85, causalNarrative:'Customer dropped during checkout, no gateway issue', evidenceConfidenceRationale:'Moderate', alternativeHypotheses:[], falsePositiveCostEstimatePaise:100, missingEvidence:[], chargebackEvidenceReady:false, evidenceItems:['customer'], recommendedActionCategory:'propose_recovery'},
    recovery:{proposedActions:[{actionType:'deliver_recovery_link_email', rationale:'Offer', preconditions:['Ok'], expectedOutcome:'Email', estimatedRecoveryPaise:1000, emailCopyIntent:'Your payment could not be completed. To opt out, reply stop.', requiresAutonomousExecution:true}], recoveryProbability:0.7, confidence:0.85},
    autoResolveFraction:0.95, expect:{outcome:'auto_no_action', noActionReason:'AUTO_RESOLVE_CEILING_REACHED'}
  });
  
  // 11. Memory bounded path — recovery planner receives at most 12 memories
  await runScenario('memory-bounded', {
    incident:baseIncident, enrichment:baseEnrich,
    supervisor:{hypothesis:'Customer', primaryFailureCategory:'customer_error', objectives:['Check'], evidencePriorities:[{fact:'Customer', whyItMatters:'test'}], subAgents:[], constraints:['No PII'], noActionCriteria:['No action'], estimatedAutoResolvable:false, requiresNoActionFallback:true, confidence:0.85, reasoning:'test'},
    risk:{failureRootCause:'customer_error', evidenceStrength:'moderate', confidence:0.85, causalNarrative:'Customer dropped during checkout, no gateway issue', evidenceConfidenceRationale:'Moderate', alternativeHypotheses:[], falsePositiveCostEstimatePaise:100, missingEvidence:[], chargebackEvidenceReady:false, evidenceItems:['customer'], recommendedActionCategory:'propose_recovery'},
    recovery:{proposedActions:[{actionType:'deliver_recovery_link_email', rationale:'Offer', preconditions:['Memory ok'], expectedOutcome:'Email', estimatedRecoveryPaise:1000, emailCopyIntent:'Your payment could not be completed. Please use the secure link. To opt out, reply stop.', requiresAutonomousExecution:true}], recoveryProbability:0.7, confidence:0.85},
    memory: Array.from({length:20}, (_,i)=>({type:'event_summary', content:{idx:i}, importance: i, createdAt:'2026-08-22T00:00:00.000Z'})),
    customerHash:'f'.repeat(64), expect:{outcome:'auto_with_proposals', permittedAction:'deliver_recovery_link_email'}
  });
  
  // 12. No recovery proposal (empty) → auto_no_action
  await runScenario('no-recovery', {
    incident:baseIncident, enrichment:baseEnrich,
    supervisor:{hypothesis:'No action', primaryFailureCategory:'unknown', objectives:['Check'], evidencePriorities:[{fact:'No evidence', whyItMatters:'test'}], subAgents:[], constraints:['No PII'], noActionCriteria:['No defensible action'], estimatedAutoResolvable:false, requiresNoActionFallback:true, confidence:0.6, reasoning:'No action'},
    risk:{failureRootCause:'unknown', evidenceStrength:'weak', confidence:0.6, causalNarrative:'Evidence too weak for a defensible cause', evidenceConfidenceRationale:'Weak evidence, calibrated low', alternativeHypotheses:[], falsePositiveCostEstimatePaise:0, missingEvidence:['Evidence'], chargebackEvidenceReady:false, evidenceItems:['weak'], recommendedActionCategory:'auto_resolve_no_action'},
    recovery:{proposedActions:[], noActionReason:'No defensible action', recoveryProbability:0.1, confidence:0.6},
    expect:{outcome:'auto_no_action'}
  });
  
  console.log(`\nAgent Summary: ${passed} passed, ${failed} failed`);
  const agentFailures = failed;

  // Execution worker: encrypted recipient → Payment Link → SMTP accepted; ambiguous send no-resend; withdrawn consent no-dispatch.
  await runExecutionWorkerScenarios();

  console.log(`\nETE Summary: ${passed} passed, ${failed} failed`);
  if (failed || agentFailures) process.exitCode = 1;
})();

async function runExecutionWorkerScenarios() {
  const key = randomBytes(32).toString('base64');
  const orgId = '00000000-0000-4000-8000-000000000001';
  const actionId = '00000000-0000-4000-8000-000000000002';
  const incidentId = '00000000-0000-4000-8000-000000000003';
  const referenceId = 'ps_' + 'a'.repeat(32);
  const outbox = () => ({ id: '00000000-0000-4000-8000-000000000004', organizationId: orgId, actionId, commandType: 'deliver_recovery_link_email', attemptNumber: 1 });
  const action = (emailSendStartedAt = null) => ({ id: actionId, organizationId: orgId, incidentId, capability: 'deliver_recovery_link_email', commandPayload: { customerHash: 'a'.repeat(64), referenceId, copyIntent: 'Please complete your pending payment. To opt out, reply stop.' }, commandKey: `${orgId}:deliver_recovery_link_email:${actionId}`, state: 'queued', amountPaise: 1000, currency: 'INR', emailSendStartedAt, providerObjectId: null, retryCount: 0, nextReconciliationAt: null, terminalReason: null, createdAt: '2026-08-23T00:00:00.000Z', dispatchedAt: null, completedAt: null });

  async function acceptedEmailScenario() {
    const calls = []; let claimed = false;
    const repository = {
      claim: async () => claimed ? null : (claimed = true, outbox()),
      action: async () => action(), paymentLinkReceipt: async () => null,
      recipientEnvelope: async () => encryptEmail('customer@example.com', key),
      markEmailSendStarted: async () => true,
      recordReceipt: async input => calls.push(['receipt', input]),
      finalizeInternalAction: async () => calls.push(['finalize']),
      requeueForCircuitOpen: async () => calls.push(['requeue']),
      completeOutbox: async () => calls.push(['complete']), failOutbox: async () => calls.push(['fail']),
      appendMemory: async (...args) => calls.push(['memory', args]),
    };
    const email = { send: async input => { assert.equal(input.to, 'customer@example.com'); assert.match(input.paymentLinkUrl, /^https:\/\/rzp\.io\//); return { kind: 'accepted', messageId: 'message-1', acceptedCount: 1, rejectedCount: 0, response: '250 queued' }; }, close: async () => {} };
    const razorpay = { createPaymentLink: async () => ({ id: 'plink_1', shortUrl: 'https://rzp.io/i/abc', referenceId, status: 'created', amount: 1000, currency: 'INR' }), paymentLinkByReference: async () => null };
    const worker = new ExecutionWorker(repository, razorpay, email, key, 'test-worker'); worker.accepting = true;
    assert.equal(await worker.processOne(), true);
    const receiptKinds = calls.filter(([k]) => k === 'receipt').map(([, v]) => v.kind);
    assert.ok(receiptKinds.includes('payment_link_created') && receiptKinds.includes('smtp_accepted'), `expected link+smtp receipts, got ${receiptKinds}`);
    assert.ok(calls.some(([k]) => k === 'memory'));
    assert.ok(calls.some(([k]) => k === 'complete'));
    assert.equal(calls.some(([k]) => k === 'fail'), false);
    console.log('✓ execution-worker accepted email: link created + SMTP accepted + memory recorded');
    passed++;
  }

  async function ambiguousEmailScenario() {
    const calls = []; let claimed = false;
    const repository = { claim: async () => claimed ? null : (claimed = true, outbox()), action: async () => action('2026-08-23T00:00:00.000Z'), recordReceipt: async input => calls.push(input), completeOutbox: async () => calls.push({ complete: true }), failOutbox: async () => calls.push({ fail: true }) };
    const email = { send: async () => { throw new Error('must not resend'); }, close: async () => {} };
    const worker = new ExecutionWorker(repository, {}, email, key, 'test-worker'); worker.accepting = true;
    await worker.processOne();
    assert.equal(calls[0].kind, 'unreconciled');
    assert.equal(calls[0].terminalReason, 'SMTP_RESULT_AMBIGUOUS_NO_RESEND');
    assert.ok(calls.some(v => v.complete));
    assert.equal(calls.some(v => v.fail), false);
    console.log('✓ execution-worker ambiguous send: unreconciled, never resent');
    passed++;
  }

  async function withdrawnRecipientScenario() {
    const calls = []; let claimed = false;
    const repository = {
      claim: async () => claimed ? null : (claimed = true, outbox()), action: async () => action(), paymentLinkReceipt: async () => null,
      recipientEnvelope: async () => { throw new ExecutionPreconditionError('recipient_unavailable'); },
      recordReceipt: async input => calls.push(['receipt', input]), completeOutbox: async () => calls.push(['complete']), failOutbox: async () => calls.push(['fail']),
    };
    const razorpay = { createPaymentLink: async () => { throw new Error('a recipient failure must not create a payment link'); } };
    const worker = new ExecutionWorker(repository, razorpay, { close: async () => {} }, key, 'test-worker'); worker.accepting = true;
    await worker.processOne();
    assert.equal(calls.find(([k]) => k === 'receipt')[1].terminalReason, 'PRE_DISPATCH_RECIPIENT_UNAVAILABLE');
    assert.ok(calls.some(([k]) => k === 'complete'));
    assert.equal(calls.some(([k]) => k === 'fail'), false);
    console.log('✓ execution-worker withdrawn recipient: terminal no-send, no link created');
    passed++;
  }

  async function paymentLinkReferenceScenarios() {
    const originalFetch = global.fetch;
    try {
      global.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ payment_links: [{ id: 'plink_1', short_url: 'https://rzp.io/i/abc', reference_id: referenceId, amount: 1000, currency: 'INR', status: 'created' }] }) });
      const link = await new RazorpayExecutionClient('rzp_live_key', 'secret').paymentLinkByReference(referenceId);
      assert.equal(link.id, 'plink_1');
    } finally { global.fetch = originalFetch; }
    try {
      global.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ payment_links: [{ id: 'plink_1', short_url: 'https://rzp.io/i/abc', reference_id: 'ps_' + 'b'.repeat(32), amount: 1000, currency: 'INR', status: 'created' }] }) });
      await assert.rejects(() => new RazorpayExecutionClient('rzp_live_key', 'secret').paymentLinkByReference(referenceId), /mismatched reference/);
    } finally { global.fetch = originalFetch; }
    console.log('✓ execution-worker payment-link reference lookup + mismatch rejection');
    passed++;
  }

  await acceptedEmailScenario();
  await ambiguousEmailScenario();
  await withdrawnRecipientScenario();
  await paymentLinkReferenceScenarios();
}

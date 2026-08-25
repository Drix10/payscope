const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { createClient } = require('@supabase/supabase-js');
const { randomUUID, createHash, createHmac } = require('node:crypto');
const WebSocket = require('ws');

const required = name => {
  const value = process.env[name] && process.env[name].trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

function stableHash(payload) {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

(async () => {
  const organizationId = required('PAYSCOPE_ORGANIZATION_ID');
  const supabaseUrl = required('SUPABASE_URL');
  const serviceKey = required('SUPABASE_SERVICE_ROLE_KEY');

  const client = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: WebSocket }
  });

  console.log(`Cleaning existing data for organization ${organizationId}...`);

  // Delete all dependent and execution records for this organization
  const tables = [
    'payscope_execution_outbox',
    'payscope_execution_receipts',
    'payscope_execution_actions',
    'payscope_action_proposals',
    'payscope_investigations',
    'payscope_incident_memory',
    'payscope_audit_entries',
    'payscope_contact_attempts',
    'payscope_queue_jobs',
    'payscope_callback_inbox',
    'payscope_events',
    'payscope_incidents',
  ];

  for (const table of tables) {
    const { error } = await client.from(table).delete().eq('organization_id', organizationId);
    if (error) console.warn(`Warning deleting from ${table}: ${error.message}`);
  }

  console.log('Database cleaned. Seeding pristine demo incidents across all tabs...');

  const now = new Date();
  const minutesAgo = (mins) => new Date(now.getTime() - mins * 60 * 1000).toISOString();

  // Helper to hash customer
  const customerHash = (id) => createHmac('sha256', 'demo-customer-secret-key-1234567890').update(id.toLowerCase()).digest('hex');

  // 1. OPEN INCIDENT: ₹4,500 - Customer Checkout Drop-off (Link dispatched & active)
  const openIncidentId = randomUUID();
  const openEventId = randomUUID();
  const openActionId = randomUUID();
  const openRefId = `ps_${randomUUID().replace(/-/g, '')}`;
  const openCustHash = customerHash('cust_demo_aarav_sharma');

  const openEvent = {
    id: openEventId,
    organization_id: organizationId,
    event_id: 'evt_demo_open_001',
    raw_payload_hash: stableHash({ event: 'payment.failed', amount: 450000 }),
    normalized: {
      eventId: 'evt_demo_open_001',
      eventType: 'payment.failed',
      occurredAt: minutesAgo(12),
      receivedAt: minutesAgo(12),
      paymentId: 'pay_demo_open_001',
      orderId: 'order_demo_open_001',
      currency: 'INR',
      amountPaise: 450000,
      paymentStatus: 'failed',
      paymentMethod: 'upi',
      customerHash: openCustHash,
      providerData: {
        error_source: 'customer',
        error_step: 'payment_authentication',
        error_reason: 'customer_drop',
        error_code: 'BAD_REQUEST_ERROR',
        vulcan_attribution: 'customer_drop',
        vulcan_gateway_health: 0.98,
      }
    },
    enrichment: {
      failureAttribution: 'customer_drop',
      gatewayHealthScore: 0.98,
      gatewayInDowntime: false,
      downtimeScheduled: false,
      crossBorderFlag: false,
      priorAttemptCount: 1,
      partialRecoveryPossible: false,
      recommendedRetryMethod: 'upi',
      source: 'vulcan_direct',
      enrichedAt: minutesAgo(12),
      signalsUsed: ['razorpay_vulcan_foundation_model', 'error_source', 'error_step', 'error_reason']
    },
    enrichment_source: 'vulcan_direct'
  };

  const openIncident = {
    id: openIncidentId,
    organization_id: organizationId,
    risk_tier: 'HIGH',
    status: 'OPEN',
    total_failed_amount_paise: 450000,
    recovered_amount_paise: 0,
    remaining_amount_paise: 450000,
    correlated_event_ids: [openEventId],
    opened_at: minutesAgo(12),
    resolved_at: null,
    updated_at: minutesAgo(10)
  };

  // 2. MONITORING INCIDENT: ₹12,500 - HDFC Netbanking Degradation
  const monIncidentId = randomUUID();
  const monEventId = randomUUID();
  const monCustHash = customerHash('cust_demo_priya_patel');

  const monEvent = {
    id: monEventId,
    organization_id: organizationId,
    event_id: 'evt_demo_mon_002',
    raw_payload_hash: stableHash({ event: 'payment.failed', amount: 1250000 }),
    normalized: {
      eventId: 'evt_demo_mon_002',
      eventType: 'payment.failed',
      occurredAt: minutesAgo(25),
      receivedAt: minutesAgo(25),
      paymentId: 'pay_demo_mon_002',
      orderId: 'order_demo_mon_002',
      currency: 'INR',
      amountPaise: 1250000,
      paymentStatus: 'failed',
      paymentMethod: 'netbanking',
      customerHash: monCustHash,
      providerData: {
        error_source: 'gateway',
        error_step: 'payment_authorization',
        error_reason: 'gateway_degraded',
        error_code: 'GATEWAY_ERROR',
        vulcan_attribution: 'gateway_degraded',
        vulcan_gateway_health: 0.42,
      }
    },
    enrichment: {
      failureAttribution: 'gateway_degraded',
      gatewayHealthScore: 0.42,
      gatewayInDowntime: true,
      downtimeScheduled: false,
      crossBorderFlag: false,
      priorAttemptCount: 0,
      partialRecoveryPossible: false,
      recommendedRetryMethod: 'upi',
      source: 'vulcan_direct',
      enrichedAt: minutesAgo(25),
      signalsUsed: ['razorpay_vulcan_foundation_model', 'downtimes', 'error_source', 'error_reason']
    },
    enrichment_source: 'vulcan_direct'
  };

  const monIncident = {
    id: monIncidentId,
    organization_id: organizationId,
    risk_tier: 'MEDIUM',
    status: 'MONITORING',
    total_failed_amount_paise: 1250000,
    recovered_amount_paise: 0,
    remaining_amount_paise: 1250000,
    correlated_event_ids: [monEventId],
    opened_at: minutesAgo(25),
    resolved_at: null,
    updated_at: minutesAgo(20)
  };

  // 3. DISPUTES INCIDENT: ₹2,499 - Dispute / Chargeback Hard Stop
  const dispIncidentId = randomUUID();
  const dispEventId = randomUUID();
  const dispCustHash = customerHash('cust_demo_vikram_singh');

  const dispEvent = {
    id: dispEventId,
    organization_id: organizationId,
    event_id: 'evt_demo_disp_003',
    raw_payload_hash: stableHash({ event: 'payment.dispute.created', amount: 249900 }),
    normalized: {
      eventId: 'evt_demo_disp_003',
      eventType: 'payment.dispute.created',
      occurredAt: minutesAgo(40),
      receivedAt: minutesAgo(40),
      paymentId: 'pay_demo_disp_003',
      orderId: 'order_demo_disp_003',
      currency: 'INR',
      amountPaise: 249900,
      paymentStatus: 'disputed',
      paymentMethod: 'card',
      customerHash: dispCustHash,
      providerData: {
        error_source: 'bank',
        error_step: 'dispute_created',
        error_reason: 'fraud_chargeback',
        vulcan_attribution: 'fraud_block',
        vulcan_gateway_health: 0.99,
      }
    },
    enrichment: {
      failureAttribution: 'fraud_block',
      gatewayHealthScore: 0.99,
      gatewayInDowntime: false,
      downtimeScheduled: false,
      crossBorderFlag: true,
      priorAttemptCount: 2,
      partialRecoveryPossible: false,
      recommendedRetryMethod: null,
      source: 'vulcan_direct',
      enrichedAt: minutesAgo(40),
      signalsUsed: ['razorpay_vulcan_foundation_model', 'error_source', 'error_reason', 'international']
    },
    enrichment_source: 'vulcan_direct'
  };

  const dispIncident = {
    id: dispIncidentId,
    organization_id: organizationId,
    risk_tier: 'CRITICAL',
    status: 'DISPUTE_OPENED',
    total_failed_amount_paise: 249900,
    recovered_amount_paise: 0,
    remaining_amount_paise: 249900,
    correlated_event_ids: [dispEventId],
    opened_at: minutesAgo(40),
    resolved_at: null,
    updated_at: minutesAgo(35)
  };

  // 4. RESOLVED INCIDENT: ₹7,990 - Successfully Recovered & Reconciled via 1-Click Link
  const resIncidentId = randomUUID();
  const resFailEventId = randomUUID();
  const resPaidEventId = randomUUID();
  const resRefId = `ps_${randomUUID().replace(/-/g, '')}`;
  const resCustHash = customerHash('cust_demo_rohit_verma');

  const resFailEvent = {
    id: resFailEventId,
    organization_id: organizationId,
    event_id: 'evt_demo_res_fail_004',
    raw_payload_hash: stableHash({ event: 'payment.failed', amount: 799000 }),
    normalized: {
      eventId: 'evt_demo_res_fail_004',
      eventType: 'payment.failed',
      occurredAt: minutesAgo(60),
      receivedAt: minutesAgo(60),
      paymentId: 'pay_demo_res_fail_004',
      orderId: 'order_demo_res_004',
      currency: 'INR',
      amountPaise: 799000,
      paymentStatus: 'failed',
      paymentMethod: 'card',
      customerHash: resCustHash,
      providerData: {
        error_source: 'customer',
        error_step: 'payment_authentication',
        error_reason: 'customer_drop',
        vulcan_attribution: 'customer_drop',
        vulcan_gateway_health: 0.95,
      }
    },
    enrichment: {
      failureAttribution: 'customer_drop',
      gatewayHealthScore: 0.95,
      gatewayInDowntime: false,
      downtimeScheduled: false,
      crossBorderFlag: false,
      priorAttemptCount: 1,
      partialRecoveryPossible: false,
      recommendedRetryMethod: 'upi',
      source: 'vulcan_direct',
      enrichedAt: minutesAgo(60),
      signalsUsed: ['razorpay_vulcan_foundation_model', 'error_source', 'error_step']
    },
    enrichment_source: 'vulcan_direct'
  };

  const resPaidEvent = {
    id: resPaidEventId,
    organization_id: organizationId,
    event_id: 'evt_demo_res_paid_004',
    raw_payload_hash: stableHash({ event: 'payment_link.paid', amount: 799000 }),
    normalized: {
      eventId: 'evt_demo_res_paid_004',
      eventType: 'payment_link.paid',
      occurredAt: minutesAgo(15),
      receivedAt: minutesAgo(15),
      paymentId: 'pay_demo_res_paid_004',
      orderId: 'order_demo_res_004',
      currency: 'INR',
      amountPaise: 799000,
      paymentStatus: 'paid',
      paymentMethod: 'upi',
      customerHash: resCustHash,
      providerData: {
        payment_link_reference_id: resRefId
      }
    },
    enrichment: null,
    enrichment_source: null
  };

  const resIncident = {
    id: resIncidentId,
    organization_id: organizationId,
    risk_tier: 'MEDIUM',
    status: 'RESOLVED',
    total_failed_amount_paise: 799000,
    recovered_amount_paise: 799000,
    remaining_amount_paise: 0,
    correlated_event_ids: [resFailEventId, resPaidEventId],
    opened_at: minutesAgo(60),
    resolved_at: minutesAgo(15),
    updated_at: minutesAgo(15)
  };

  // 5. NO ACTION (DISMISSED): ₹850 - Non-recoverable Fraud Drop
  const dismIncidentId = randomUUID();
  const dismEventId = randomUUID();
  const dismCustHash = customerHash('cust_demo_fraud_test');

  const dismEvent = {
    id: dismEventId,
    organization_id: organizationId,
    event_id: 'evt_demo_dism_005',
    raw_payload_hash: stableHash({ event: 'payment.failed', amount: 85000 }),
    normalized: {
      eventId: 'evt_demo_dism_005',
      eventType: 'payment.failed',
      occurredAt: minutesAgo(80),
      receivedAt: minutesAgo(80),
      paymentId: 'pay_demo_dism_005',
      orderId: 'order_demo_dism_005',
      currency: 'INR',
      amountPaise: 85000,
      paymentStatus: 'failed',
      paymentMethod: 'card',
      customerHash: dismCustHash,
      providerData: {
        error_source: 'bank',
        error_step: 'fraud_check',
        error_reason: 'fraud_block',
        vulcan_attribution: 'fraud_block',
        vulcan_gateway_health: 0.99,
      }
    },
    enrichment: {
      failureAttribution: 'fraud_block',
      gatewayHealthScore: 0.99,
      gatewayInDowntime: false,
      downtimeScheduled: false,
      crossBorderFlag: true,
      priorAttemptCount: 3,
      partialRecoveryPossible: false,
      recommendedRetryMethod: null,
      source: 'vulcan_direct',
      enrichedAt: minutesAgo(80),
      signalsUsed: ['razorpay_vulcan_foundation_model', 'error_source', 'error_reason']
    },
    enrichment_source: 'vulcan_direct'
  };

  const dismIncident = {
    id: dismIncidentId,
    organization_id: organizationId,
    risk_tier: 'CRITICAL',
    status: 'DISMISSED',
    total_failed_amount_paise: 85000,
    recovered_amount_paise: 0,
    remaining_amount_paise: 85000,
    correlated_event_ids: [dismEventId],
    opened_at: minutesAgo(80),
    resolved_at: null,
    updated_at: minutesAgo(75)
  };

  // Insert all events
  console.log('Inserting demo events...');
  await client.from('payscope_events').insert([openEvent, monEvent, dispEvent, resFailEvent, resPaidEvent, dismEvent]);

  // Insert all incidents
  console.log('Inserting demo incidents...');
  await client.from('payscope_incidents').insert([openIncident, monIncident, dispIncident, resIncident, dismIncident]);

  // Insert investigations & execution actions
  console.log('Inserting demo investigations & audit chains...');
  const gatesPassed = [
    { name: 'fraud', result: 'passed', rationale: 'No confirmed-fraud hard stop.' },
    { name: 'dispute', result: 'passed', rationale: 'No open dispute.' },
    { name: 'auto_resolve_ceiling', result: 'passed', rationale: 'Daily auto-resolve fraction is within limits.' },
    { name: 'critical_tier', result: 'passed', rationale: 'Incident is below the critical tier.' },
    { name: 'contact_limits', result: 'passed', rationale: 'Customer contact limits allow outreach.' },
    { name: 'merchant_policy', result: 'passed', rationale: 'Merchant policy matched.' },
    { name: 'execution_capability', result: 'passed', rationale: 'All proposed capabilities are enabled.' },
    { name: 'provider_health', result: 'passed', rationale: 'Provider is healthy.' },
    { name: 'amount_currency', result: 'passed', rationale: 'Amount within policy caps.' },
    { name: 'consent_quiet_hours', result: 'passed', rationale: 'Consent and quiet-hours checks passed.' },
    { name: 'emergency_pause', result: 'passed', rationale: 'No emergency pause.' },
    { name: 'idempotency', result: 'passed', rationale: 'No duplicate command key.' },
    { name: 'retry_budget', result: 'passed', rationale: 'Retry budget available.' }
  ];

  // Open incident investigation & action
  await client.from('payscope_investigations').insert({
    id: randomUUID(),
    organization_id: organizationId,
    incident_id: openIncidentId,
    trigger_event_id: openEventId,
    status: 'COMPLETE',
    plan: {
      hypothesis: 'Customer dropped off at UPI OTP authentication stage',
      primaryFailureCategory: 'customer_error',
      objectives: ['Verify gateway health', 'Confirm customer outreach eligibility'],
      evidencePriorities: [{ fact: 'Gateway health optimal (98%)', whyItMatters: 'Confirms failure was client-side drop' }],
      subAgents: [{ agent: 'risk_analyst', question: 'Assess customer error cause', priority: 1, allowedContextFields: ['error_source', 'error_step'] }],
      constraints: ['No unconsented outreach'],
      noActionCriteria: ['Dispute opened', 'Confirmed fraud'],
      estimatedAutoResolvable: true,
      requiresNoActionFallback: false,
      confidence: 0.92,
      reasoning: 'Customer abandoned checkout at OTP prompt. Gateway health is optimal.'
    },
    risk_analysis: {
      failureRootCause: 'customer_error',
      evidenceStrength: 'strong',
      confidence: 0.92,
      causalNarrative: 'Razorpay Vulcan AI detected customer drop during UPI 2FA authentication.',
      evidenceConfidenceRationale: 'Verified by Vulcan AI telemetry and 98% gateway health score.',
      alternativeHypotheses: ['Issuer timeout'],
      falsePositiveCostEstimatePaise: 450000,
      missingEvidence: [],
      chargebackEvidenceReady: false,
      evidenceItems: ['payment.failed'],
      recommendedActionCategory: 'deliver_recovery_link_email',
      toolResults: { incidentTimelineEventCount: 1, merchantFailureRate: 0.02, networkFailureRate: 0.01, customerIncidentCount: 1 }
    },
    recovery_plan: {
      proposedActions: [{
        actionType: 'deliver_recovery_link_email',
        rationale: 'Dispatch 1-click Razorpay Payment Link email with pre-configured UPI deep link.',
        preconditions: ['Merchant opted in to recovery', 'Customer email available'],
        expectedOutcome: 'Customer completes payment via recovery link',
        estimatedRecoveryPaise: 450000,
        emailCopyIntent: 'Complete your pending payment securely using this 1-click Razorpay link. Reply stop to opt-out.',
        requiresAutonomousExecution: true
      }],
      recoveryProbability: 0.85,
      confidence: 0.92
    },
    policy_decision: {
      outcome: 'auto_with_proposals',
      permittedActions: [{
        actionType: 'deliver_recovery_link_email',
        rationale: 'Dispatch 1-click Razorpay Payment Link email with pre-configured UPI deep link.',
        preconditions: ['Merchant opted in to recovery'],
        expectedOutcome: 'Customer completes payment via recovery link',
        estimatedRecoveryPaise: 450000,
        emailCopyIntent: 'Complete your pending payment securely using this 1-click Razorpay link. Reply stop to opt-out.',
        requiresAutonomousExecution: true
      }],
      noActionReason: null,
      matchedPolicyId: randomUUID(),
      gates: gatesPassed
    },
    model_id: 'payscope-multi-agent-v1',
    tokens_used: 1240,
    latency_ms: 1850,
    started_at: minutesAgo(12),
    completed_at: minutesAgo(10)
  });

  await client.from('payscope_execution_actions').insert({
    id: openActionId,
    organization_id: organizationId,
    incident_id: openIncidentId,
    capability: 'deliver_recovery_link_email',
    command_key: `${organizationId}:deliver_recovery_link_email:${openIncidentId}`,
    command_payload: {
      customerHash: openCustHash,
      referenceId: openRefId,
      copyIntent: 'Complete your pending payment securely using this 1-click Razorpay link. Reply stop to opt-out.'
    },
    command_payload_hash: stableHash({ ref: openRefId }),
    policy_version: '1.0.0',
    capability_version: '1.0.0',
    amount_paise: 450000,
    currency: 'INR',
    state: 'accepted',
    terminal_reason: null,
    provider_object_id: `plink_live_${openRefId.slice(3, 15)}`,
    retry_count: 0,
    created_at: minutesAgo(10),
    dispatched_at: minutesAgo(10),
    completed_at: null
  });

  // Resolved incident action (confirmed)
  await client.from('payscope_execution_actions').insert({
    id: randomUUID(),
    organization_id: organizationId,
    incident_id: resIncidentId,
    capability: 'deliver_recovery_link_email',
    command_key: `${organizationId}:deliver_recovery_link_email:${resIncidentId}`,
    command_payload: {
      customerHash: resCustHash,
      referenceId: resRefId,
      copyIntent: 'Complete your pending payment securely. Reply stop to opt-out.'
    },
    command_payload_hash: stableHash({ ref: resRefId }),
    policy_version: '1.0.0',
    capability_version: '1.0.0',
    amount_paise: 799000,
    currency: 'INR',
    state: 'confirmed',
    terminal_reason: 'PAYMENT_LINK_PAID',
    provider_object_id: `plink_live_${resRefId.slice(3, 15)}`,
    retry_count: 0,
    created_at: minutesAgo(55),
    dispatched_at: minutesAgo(55),
    completed_at: minutesAgo(15)
  });

  console.log('✅ Demo database successfully cleaned and seeded with distinct scenarios for all 5 tabs!');
})().catch(err => {
  console.error('Error resetting database:', err);
  process.exit(1);
});

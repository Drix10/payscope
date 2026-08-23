const assert = require('node:assert/strict');
const { MvpRepository } = require('../dist/db/mvp-repository');

const org = '00000000-0000-4000-8000-000000000001';
const now = '2026-08-23T00:00:00.000Z';
const rows = [
  { id: '00000000-0000-4000-8000-000000000010', organization_id: org, risk_tier: 'HIGH', status: 'OPEN', total_failed_amount_paise: 1000, recovered_amount_paise: 0, remaining_amount_paise: 1000, correlated_event_ids: [], opened_at: now, resolved_at: null, updated_at: now },
  { id: '00000000-0000-4000-8000-000000000011', organization_id: org, risk_tier: 'CRITICAL', status: 'DISPUTE_OPENED', total_failed_amount_paise: 500, recovered_amount_paise: 0, remaining_amount_paise: 500, correlated_event_ids: [], opened_at: now, resolved_at: null, updated_at: now },
  { id: '00000000-0000-4000-8000-000000000012', organization_id: org, risk_tier: 'MONITOR', status: 'RESOLVED', total_failed_amount_paise: 300, recovered_amount_paise: 300, remaining_amount_paise: 0, correlated_event_ids: [], opened_at: now, resolved_at: now, updated_at: now },
];
const client = {
  from() {
    return {
      select() { return this; }, eq() { return this; }, neq() { return this; }, order() { return this; }, limit() { return this; },
      then(resolve, reject) { return Promise.resolve({ data: rows, error: null }).then(resolve, reject); },
    };
  },
  async rpc(name) {
    assert.equal(name, 'payscope_dashboard_metrics');
    return { data: { operations: { totalAtRiskPaise: 1500, proposalsGenerated: 2, proposalsSimulated: 1, attributedRecoveries: null, recoveredPaise: null, recoveryRate: null, contactToRecoveryRatio: null }, evaluation: { status: 'not_run', split: null, fixtureSetVersion: null, runAt: null, configurationHash: null, modelId: null, sampleCount: 0, precision: null, recall: null, f1: null, falsePositiveCostPaise: null }, exceptions: ['No COD/RTO decisioning', 'No dispute outreach', 'No fraud outreach', 'No-policy no action', 'Communications simulated', 'Causal simulated-action recovery evidence'] }, error: null };
  },
};

(async () => {
  const repository = new MvpRepository(client);
  const highOpen = await repository.dashboardQuery(org, 'show open high incidents; DROP TABLE', 10);
  assert.equal(highOpen.matchedIncidentCount, 1);
  assert.equal(highOpen.incidents[0].id, rows[0].id);
  assert.equal(highOpen.matchedRemainingAmountPaise, 1000);
  assert.match(highOpen.limitations.join(' '), /cannot trigger an action/i);
  const critical = await repository.dashboardQuery(org, 'critical dispute opened incidents', 1);
  assert.equal(critical.matchedIncidentCount, 1);
  assert.equal(critical.incidents[0].id, rows[1].id);
  const dismissed = await repository.dashboardQuery(org, 'show dismissed incidents', 10);
  assert.equal(dismissed.matchedIncidentCount, 0, 'dismissed must not broaden to all resolved incidents');
  assert.match(dismissed.limitations.join(' '), /100 most recently updated/i);
  const metrics = await repository.dashboardMetrics(org);
  assert.equal(metrics.operations.totalAtRiskPaise, 1500);
  assert.equal(metrics.operations.recoveredPaise, null);
  console.log('Read-only dashboard query and metrics repository checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });

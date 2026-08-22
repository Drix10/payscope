/* Append-only audit proof. It intentionally retains fixture-tenant evidence;
 * the shared public demo organization is refused by the tenant guard. */
require('dotenv/config');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { requireDatabaseClient } = require('../dist/db/client');
const { requireIntegrationOrganization } = require('./require-integration-organization');

if (process.env.PAYSCOPE_RUN_AUDIT_INTEGRATION !== 'true') {
  console.log('Skipped audit-integrity integration test (set PAYSCOPE_RUN_AUDIT_INTEGRATION=true for fixture Test Mode Supabase).');
  process.exit(0);
}
const organizationId = requireIntegrationOrganization();
const client = requireDatabaseClient();
const actorId = 'integration-audit-test';

(async () => {
  const before = await client.from('payscope_audit_entries').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId).eq('actor_id', actorId);
  if (before.error) throw new Error(before.error.message);
  for (let index = 0; index < 50; index += 1) {
    const { error } = await client.rpc('payscope_append_audit_entry', {
      p_organization_id: organizationId, p_incident_id: null, p_event_type: 'integration_audit_entry',
      p_actor_type: 'system', p_actor_id: actorId, p_actor_session_hash: null,
      p_decision: `fixture_sequence_${index + 1}`, p_rationale: 'Dedicated fixture-tenant append-only audit verification.',
      p_confidence: null, p_enrichment_snapshot: { fixture: true, sequence: index + 1 },
    });
    if (error) throw new Error(error.message);
  }
  const rows = await client.from('payscope_audit_entries').select('id,sequence_number').eq('organization_id', organizationId).eq('actor_id', actorId).order('sequence_number', { ascending: true });
  if (rows.error) throw new Error(rows.error.message);
  assert.equal(rows.data.length, before.count + 50, 'all sequential append calls must persist');
  const target = rows.data.at(-1);
  const update = await client.from('payscope_audit_entries').update({ decision: 'tampered' }).eq('id', target.id);
  assert.ok(update.error, 'audit updates must be rejected');
  const deletion = await client.from('payscope_audit_entries').delete().eq('id', target.id);
  assert.ok(deletion.error, 'audit deletes must be rejected');
  const duplicate = await client.from('payscope_audit_entries').insert({
    id: randomUUID(), organization_id: organizationId, sequence_number: target.sequence_number,
    event_type: 'integration_duplicate_sequence', actor_type: 'system', actor_id: actorId,
    decision: 'duplicate_sequence', rationale: 'Must fail unique organization sequence constraint.',
    prev_entry_hash: '0'.repeat(64), entry_hash: '1'.repeat(64),
  });
  assert.ok(duplicate.error, 'duplicate audit sequence must be rejected');
  const compensating = await client.rpc('payscope_append_audit_entry', {
    p_organization_id: organizationId, p_incident_id: null, p_event_type: 'integration_compensating_entry',
    p_actor_type: 'system', p_actor_id: actorId, p_actor_session_hash: null,
    p_decision: 'compensating_fixture_entry_recorded', p_rationale: 'Tamper attempts were rejected; this immutable entry records the verification outcome.',
    p_confidence: null, p_enrichment_snapshot: { fixture: true, priorEntryCount: rows.data.length },
  });
  if (compensating.error) throw new Error(compensating.error.message);
  const integrity = await client.rpc('payscope_audit_chain_summary', { p_organization_id: organizationId });
  if (integrity.error) throw new Error(integrity.error.message);
  assert.equal(integrity.data.status, 'intact');
  console.log('Hosted 50-entry append-only audit, tamper rejection, duplicate sequence, compensating entry, and chain verification checks passed.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });

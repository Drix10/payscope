/*
 * Reuses two fixed, non-production Test Mode organizations and creates
 * password-randomized fixture operators to prove that an authenticated Org A
 * session cannot read Org B. The organizations intentionally remain: their
 * immutable audit genesis entries cannot be deleted by design. All mutable
 * rows and every temporary auth user are removed in finally.
 */
require('dotenv/config');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');

if (process.env.PAYSCOPE_RUN_RLS_INTEGRATION !== 'true') {
  console.log('Skipped RLS integration test (set PAYSCOPE_RUN_RLS_INTEGRATION=true to run against Test Mode Supabase).');
  process.exit(0);
}

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for the RLS integration test.');

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const suffix = randomUUID();
const password = randomBytes(32).toString('base64url');
const now = new Date().toISOString();
const fixtureOrganizations = {
  a: { id: '10000000-0000-4000-8000-000000000001', name: 'PayScope RLS fixture A', razorpayKeyId: 'rzp_test_payscope_rls_a' },
  b: { id: '10000000-0000-4000-8000-000000000002', name: 'PayScope RLS fixture B', razorpayKeyId: 'rzp_test_payscope_rls_b' },
};

async function ensureFixtureOrganization(label) {
  const fixture = fixtureOrganizations[label];
  const { data: existing, error: lookupError } = await admin.from('payscope_organizations').select('id').eq('id', fixture.id).maybeSingle();
  if (lookupError) throw new Error(`Could not look up ${label} fixture organization: ${lookupError.message}`);
  if (!existing) {
    const { error: organizationError } = await admin.from('payscope_organizations').insert({
      id: fixture.id,
      name: fixture.name,
      razorpay_key_id: fixture.razorpayKeyId,
      customer_hash_secret: randomBytes(32).toString('hex'),
    });
    if (organizationError) throw new Error(`Could not create ${label} fixture organization: ${organizationError.message}`);
  }
  return fixture.id;
}

async function createFixtureOperator(label, organizationId) {
  const email = `payscope-rls-${label}-${suffix}@example.test`;
  const { data: user, error: userError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (userError || !user.user) throw new Error(`Could not create ${label} fixture operator: ${userError?.message ?? 'missing user'}`);
  const { error: profileError } = await admin.from('payscope_users').insert({ id: user.user.id, organization_id: organizationId, email, display_name: `RLS ${label} fixture` });
  if (profileError) {
    await admin.auth.admin.deleteUser(user.user.id);
    throw new Error(`Could not create ${label} fixture profile: ${profileError.message}`);
  }
  return { organizationId, email, userId: user.user.id };
}

async function signedInClient(email) {
  const client = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.user || !data.session) throw new Error(`Could not establish fixture operator session: ${error?.message ?? 'missing session'}`);
  return client;
}

(async () => {
  let orgA; let orgB; let incidentId; const userIds = [];
  try {
    const [organizationAId, organizationBId] = await Promise.all([ensureFixtureOrganization('a'), ensureFixtureOrganization('b')]);
    orgA = await createFixtureOperator('a', organizationAId); userIds.push(orgA.userId);
    orgB = await createFixtureOperator('b', organizationBId); userIds.push(orgB.userId);
    incidentId = randomUUID();
    const { error: incidentError } = await admin.from('payscope_incidents').insert({
      id: incidentId, organization_id: orgB.organizationId, risk_tier: 'MEDIUM', status: 'OPEN',
      total_failed_amount_paise: 100, recovered_amount_paise: 0, correlated_event_ids: [], opened_at: now, updated_at: now,
    });
    if (incidentError) throw new Error(`Could not create Org B fixture incident: ${incidentError.message}`);

    const [clientA, clientB] = await Promise.all([signedInClient(orgA.email), signedInClient(orgB.email)]);
    const [{ data: organizationsA, error: organizationsAError }, { data: incidentsA, error: incidentsAError }, { data: incidentsB, error: incidentsBError }] = await Promise.all([
      clientA.from('payscope_organizations').select('id'),
      clientA.from('payscope_incidents').select('id').eq('organization_id', orgB.organizationId),
      clientB.from('payscope_incidents').select('id').eq('organization_id', orgB.organizationId),
    ]);
    if (organizationsAError || incidentsAError || incidentsBError) throw new Error(`RLS query failed: ${organizationsAError?.message ?? incidentsAError?.message ?? incidentsBError?.message}`);
    assert.deepEqual((organizationsA ?? []).map(row => row.id), [orgA.organizationId], 'Org A may only see its organization row');
    assert.deepEqual(incidentsA ?? [], [], 'Org A must not read Org B incident rows');
    assert.deepEqual((incidentsB ?? []).map(row => row.id), [incidentId], 'Org B must read its own incident row');
    console.log('Supabase authenticated Org A/Org B RLS isolation checks passed.');
  } finally {
    if (incidentId) await admin.from('payscope_incidents').delete().eq('id', incidentId);
    await Promise.all(userIds.map(userId => admin.auth.admin.deleteUser(userId)));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

const assert = require('node:assert/strict');
const { requireIntegrationOrganization } = require('./require-integration-organization');

const demo = '00000000-0000-4000-8000-000000000001';
const fixture = '10000000-0000-4000-8000-000000000001';
assert.throws(() => requireIntegrationOrganization({ PAYSCOPE_DEMO_ORGANIZATION_ID: demo }));
assert.throws(() => requireIntegrationOrganization({ PAYSCOPE_DEMO_ORGANIZATION_ID: demo, PAYSCOPE_TEST_ORGANIZATION_ID: demo }));
assert.equal(requireIntegrationOrganization({ PAYSCOPE_DEMO_ORGANIZATION_ID: demo, PAYSCOPE_TEST_ORGANIZATION_ID: fixture }), fixture);
console.log('Hosted integration tenant guard checks passed.');

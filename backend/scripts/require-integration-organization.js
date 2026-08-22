const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Prevents destructive/append-only integration fixtures from using the demo tenant. */
function requireIntegrationOrganization(env = process.env) {
  const organizationId = env.PAYSCOPE_TEST_ORGANIZATION_ID;
  if (!organizationId || !UUID.test(organizationId)) {
    throw new Error('PAYSCOPE_TEST_ORGANIZATION_ID must be a dedicated Test Mode organization UUID for hosted integration tests.');
  }
  if (organizationId === env.PAYSCOPE_DEMO_ORGANIZATION_ID) {
    throw new Error('PAYSCOPE_TEST_ORGANIZATION_ID must not equal PAYSCOPE_DEMO_ORGANIZATION_ID; integration fixtures must never contaminate the demo tenant.');
  }
  return organizationId;
}

module.exports = { requireIntegrationOrganization };

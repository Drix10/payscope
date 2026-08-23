const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Prevents destructive/append-only integration fixtures from using the primary tenant. */
function requireIntegrationOrganization(env = process.env) {
  const organizationId = env.PAYSCOPE_INTEGRATION_ORGANIZATION_ID;
  if (!organizationId || !UUID.test(organizationId)) {
    throw new Error('PAYSCOPE_INTEGRATION_ORGANIZATION_ID must be a dedicated organization UUID for hosted integration tests.');
  }
  if (organizationId === env.PAYSCOPE_ORGANIZATION_ID) {
    throw new Error('PAYSCOPE_INTEGRATION_ORGANIZATION_ID must not equal PAYSCOPE_ORGANIZATION_ID; integration fixtures must never contaminate the primary tenant.');
  }
  return organizationId;
}

module.exports = { requireIntegrationOrganization };

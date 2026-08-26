const apiUrl = (process.env.PAYSCOPE_DEMO_API_URL ?? '').replace(/\/$/, '');
const expectedOrg = process.env.PAYSCOPE_DEMO_ORGANIZATION_ID ?? '';
const minimumIncidents = Number(process.env.PAYSCOPE_DEMO_MIN_INCIDENTS ?? '1');
if (!apiUrl || !expectedOrg) throw new Error('Set PAYSCOPE_DEMO_API_URL and PAYSCOPE_DEMO_ORGANIZATION_ID first');
if (!Number.isSafeInteger(minimumIncidents) || minimumIncidents < 1 || minimumIncidents > 100) throw new Error('PAYSCOPE_DEMO_MIN_INCIDENTS must be an integer from 1 to 100');

async function get(path) {
    const headers = { accept: 'application/json' };
    if (process.env.PAYSCOPE_DASHBOARD_API_KEY) headers['x-payscope-api-key'] = process.env.PAYSCOPE_DASHBOARD_API_KEY;
    const response = await fetch(`${apiUrl}${path}`, { headers, signal: AbortSignal.timeout(10_000) });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.success) throw new Error(`${path} failed (${response.status})`);
    return body.data;
}

const health = await get('/api/mvp/health');
if (health.organizationId !== expectedOrg) throw new Error('Demo organization mismatch');
if (health.razorpayEnvironment !== 'test') throw new Error('Demo API is not reporting Razorpay test mode');
const incidents = await get('/api/mvp/incidents?limit=100');
if (!Array.isArray(incidents) || incidents.length < minimumIncidents) throw new Error(`Expected at least ${minimumIncidents} demo incident(s), found ${incidents?.length ?? 'invalid response'}`);
const detail = await get(`/api/mvp/incidents/${encodeURIComponent(incidents[0].id)}`);
const audit = await get(`/api/mvp/audit?incidentId=${encodeURIComponent(incidents[0].id)}`);
console.log(JSON.stringify({ ok: true, organizationId: health.organizationId, environment: health.razorpayEnvironment, communications: health.communications, incidentCount: incidents.length, firstIncident: { id: detail.incident.id, status: detail.incident.status, eventCount: detail.events.length, executionCount: detail.execution.length, auditCount: audit.length } }, null, 2));

const apiUrl = (process.env.PAYSCOPE_DEMO_API_URL ?? '').replace(/\/$/, '');
const expectedOrg = process.env.PAYSCOPE_DEMO_ORGANIZATION_ID ?? '';
const expectedEnvironment = process.env.PAYSCOPE_DEMO_RAZORPAY_ENVIRONMENT ?? 'test';
const secret = process.env.PAYSCOPE_DEMO_WEBHOOK_SECRET ?? '';

function fail(message) { throw new Error(`PREFLIGHT FAILED: ${message}`); }
if (!apiUrl || !/^https?:\/\/[^/]+$/i.test(apiUrl)) fail('PAYSCOPE_DEMO_API_URL must be an API origin such as https://api.example.com');
if (!secret || secret.length < 16) fail('PAYSCOPE_DEMO_WEBHOOK_SECRET must be at least 16 characters');
if (expectedEnvironment !== 'test') fail('PAYSCOPE_DEMO_RAZORPAY_ENVIRONMENT must be test; this kit refuses live mode');
if (expectedOrg && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(expectedOrg)) fail('PAYSCOPE_DEMO_ORGANIZATION_ID must be a UUID');

const response = await fetch(`${apiUrl}/health`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
const health = await response.json().catch(() => null);
if (!response.ok || !health) fail(`API health unavailable (${response.status})`);
if (health.razorpayEnvironment !== 'test') fail(`deployed API reports razorpayEnvironment=${health.razorpayEnvironment ?? 'missing'}`);
if (expectedOrg) {
    const mvpHeaders = { accept: 'application/json' };
    if (process.env.PAYSCOPE_DASHBOARD_API_KEY) mvpHeaders['x-payscope-api-key'] = process.env.PAYSCOPE_DASHBOARD_API_KEY;
    const mvpResponse = await fetch(`${apiUrl}/api/mvp/health`, { headers: mvpHeaders, signal: AbortSignal.timeout(10_000) });
    const mvp = await mvpResponse.json().catch(() => null);
    if (![200, 503].includes(mvpResponse.status) || mvp?.data?.organizationId !== expectedOrg) fail('API organization does not match PAYSCOPE_DEMO_ORGANIZATION_ID');
}
console.log(JSON.stringify({ ok: true, apiUrl, environment: health.razorpayEnvironment, serviceStatus: health.status, execution: health.execution ?? 'unknown', organizationChecked: Boolean(expectedOrg) }, null, 2));

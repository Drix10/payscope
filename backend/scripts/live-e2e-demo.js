const { createHmac } = require('crypto');

async function testLivePipeline() {
  console.log('--- PayScope Live E2E Pipeline Verification ---');
  
  const webhookSecret = '8b11ead0f18786af13d291393871480f8a2c0e6a9b6916ad5aef9fff74862577';
  const apiKey = 'pscope_dash_ff75d8b1d7204643beb77739bab986f8ee10d79';
  const baseUrl = 'http://localhost:25655';
  const eventId = 'evt_live_' + Date.now();

  const rawBody = JSON.stringify({
    entity: 'event',
    account_id: 'acc_test_live_123',
    event: 'payment.failed',
    contains: ['payment'],
    event_id: eventId,
    created_at: Math.floor(Date.now() / 1000),
    payload: {
      payment: {
        entity: {
          id: 'pay_live_e2e_' + Date.now(),
          amount: 18450,
          currency: 'INR',
          status: 'failed',
          method: 'upi',
          order_id: 'order_live_' + Date.now(),
          error_code: 'GATEWAY_ERROR',
          error_description: 'Bank server timeout during UPI payment authentication',
          acquirer_data: { rrn: '987654321012' },
          created_at: Math.floor(Date.now() / 1000)
        }
      }
    }
  });

  const signature = createHmac('sha256', webhookSecret).update(rawBody).digest('hex');

  console.log('1. Health Check (GET /health)...');
  const resHealth = await fetch(`${baseUrl}/health`);
  console.log('   Health Status:', resHealth.status, await resHealth.json());

  console.log('\n2. Ingesting Payment Failure Webhook (POST /webhooks/razorpay)...');
  const resWebhook = await fetch(`${baseUrl}/webhooks/razorpay`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-razorpay-signature': signature,
      'x-razorpay-event-id': eventId
    },
    body: rawBody
  });
  const webhookResult = await resWebhook.json();
  console.log('   Webhook Ingest Status:', resWebhook.status, JSON.stringify(webhookResult));

  console.log('\n3. Waiting 16 seconds for complete Multi-Agent execution & DB persistence...');
  await new Promise(resolve => setTimeout(resolve, 16000));

  console.log('\n4. Fetching Dashboard Incident List (GET /api/mvp/incidents)...');
  const resIncidents = await fetch(`${baseUrl}/api/mvp/incidents`, {
    headers: { 'x-payscope-api-key': apiKey }
  });
  const incidentsList = await resIncidents.json();
  console.log('   Total Incident Count:', incidentsList.data?.length ?? 0);

  // Find latest updated incident that has investigation or correlated events
  const latestIncident = incidentsList.data?.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];

  if (latestIncident) {
    console.log(`\n5. Fetching Incident Detail for Latest ID ${latestIncident.id}...`);
    const resDetail = await fetch(`${baseUrl}/api/mvp/incidents/${latestIncident.id}`, {
      headers: { 'x-payscope-api-key': apiKey }
    });
    const detail = await resDetail.json();
    console.log('   Incident Status:', detail.data?.incident?.status);
    console.log('   Events Correlated:', detail.data?.events?.length ?? 0);
    console.log('   Investigation Present:', Boolean(detail.data?.investigation));
    
    if (detail.data?.investigation) {
      console.log('\n--- LLM Multi-Agent Investigation Verified ---');
      console.log('   Plan Failure Category:', detail.data.investigation.plan.primaryFailureCategory);
      console.log('   Hypothesis:', detail.data.investigation.plan.hypothesis);
      console.log('   Risk Root Cause:', detail.data.investigation.riskAnalysis.failureRootCause);
      console.log('   Confidence:', detail.data.investigation.riskAnalysis.confidence);
      console.log('   Policy Outcome:', detail.data.investigation.policyDecision.outcome);
      console.log('   Permitted Actions:', detail.data.investigation.policyDecision.permittedActions);
    }
  }

  console.log('\n--- Live E2E Verification Complete ---');
}

testLivePipeline().catch(console.error);

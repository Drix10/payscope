require('dotenv/config');
const { createHmac } = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');
const { encryptEmail } = require('../dist/security/encryption');

const required = name => {
  const value = process.env[name] && process.env[name].trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

(async () => {
  const organizationId = required('PAYSCOPE_ORGANIZATION_ID');
  const customerId = required('PAYSCOPE_RECIPIENT_CUSTOMER_ID');
  const email = required('PAYSCOPE_RECIPIENT_EMAIL');
  const encryptionKey = required('PAYSCOPE_EMAIL_ENCRYPTION_KEY');
  if (process.env.PAYSCOPE_RECIPIENT_EMAIL_CONSENT !== 'true') throw new Error('PAYSCOPE_RECIPIENT_EMAIL_CONSENT=true is required for recipient enrollment');
  const client = createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), { auth: { autoRefreshToken: false, persistSession: false }, realtime: { transport: WebSocket } });
  const { data: organization, error: organizationError } = await client.from('payscope_organizations').select('customer_hash_secret').eq('id', organizationId).maybeSingle();
  if (organizationError || !organization || typeof organization.customer_hash_secret !== 'string') throw new Error(`Organization lookup failed: ${organizationError?.message ?? 'missing customer hash secret'}`);
  const customerHash = createHmac('sha256', organization.customer_hash_secret).update(customerId.trim().toLowerCase()).digest('hex');
  const { error } = await client.from('payscope_recipient_emails').upsert({ organization_id: organizationId, customer_hash: customerHash, email_envelope: encryptEmail(email, encryptionKey), key_version: 1, email_consent: true, suppressed_at: null, updated_at: new Date().toISOString() }, { onConflict: 'organization_id,customer_hash' });
  if (error) throw new Error(`Recipient vault upsert failed: ${error.message}`);
  console.log('Encrypted recipient email upserted successfully.');
})().catch(error => { console.error(error instanceof Error ? error.message : 'Recipient vault upsert failed'); process.exitCode = 1; });

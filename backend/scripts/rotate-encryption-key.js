require('dotenv/config');
const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');
const { encryptEmail, decryptEmail } = require('../dist/security/encryption');

const required = name => {
  const value = process.env[name] && process.env[name].trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

(async () => {
  const oldKey = required('PAYSCOPE_EMAIL_ENCRYPTION_KEY');
  const newKey = required('PAYSCOPE_EMAIL_ENCRYPTION_KEY_NEW');
  if (oldKey === newKey) throw new Error('PAYSCOPE_EMAIL_ENCRYPTION_KEY_NEW must differ from the current key');
  const client = createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), { auth: { autoRefreshToken: false, persistSession: false }, realtime: { transport: WebSocket } });
  const { data: rows, error } = await client.from('payscope_recipient_emails').select('id, organization_id, customer_hash, email_envelope, key_version');
  if (error) throw new Error(`Recipient vault read failed: ${error.message}`);
  let rotated = 0;
  for (const row of rows ?? []) {
    try {
      const plaintext = decryptEmail(row.email_envelope, oldKey);
      const envelope = encryptEmail(plaintext, newKey);
      const { error: updateError } = await client.from('payscope_recipient_emails')
        .update({ email_envelope: envelope, key_version: (Number(row.key_version) || 1) + 1, updated_at: new Date().toISOString() })
        .eq('id', row.id);
      if (updateError) throw new Error(`Re-encrypt failed for recipient ${row.id}: ${updateError.message}`);
      rotated += 1;
    } catch (e) {
      throw new Error(`Recipient ${row.id} could not be re-encrypted: ${e instanceof Error ? e.message : 'decrypt failed'}`);
    }
  }
  console.log(`Rotated encryption key for ${rotated} recipient record(s). Update PAYSCOPE_EMAIL_ENCRYPTION_KEY to the new key and restart the worker.`);
})().catch(error => { console.error(error instanceof Error ? error.message : 'Encryption key rotation failed'); process.exitCode = 1; });

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
  const { count: expectedTotal, error: countError } = await client.from('payscope_recipient_emails').select('id', { count: 'exact', head: true });
  if (countError || expectedTotal === null) throw new Error(`Recipient vault count failed: ${countError?.message ?? 'missing count'}`);
  const pageSize = 100;
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data: page, error } = await client.from('payscope_recipient_emails').select('id, organization_id, customer_hash, email_envelope, key_version').order('id').range(offset, offset + pageSize - 1);
    if (error) throw new Error(`Recipient vault read failed: ${error.message}`);
    rows.push(...(page ?? []));
    if (!page || page.length < pageSize) break;
  }
  let rotated = 0;
  for (const row of rows ?? []) {
    try {
      const keyVersion = Number(row.key_version);
      if (!Number.isSafeInteger(keyVersion) || keyVersion < 1) throw new Error('invalid key version');
      if (keyVersion > 1) {
        rotated += 1;
        continue;
      }
      const plaintext = decryptEmail(row.email_envelope, keyVersion === 1 ? oldKey : newKey);
      const envelope = encryptEmail(plaintext, newKey);
      const { data: updated, error: updateError } = await client.from('payscope_recipient_emails')
        .update({ email_envelope: envelope, key_version: keyVersion + 1, updated_at: new Date().toISOString() })
        .eq('id', row.id).eq('key_version', row.key_version).eq('email_envelope', row.email_envelope).select('id').maybeSingle();
      if (updateError || !updated) throw new Error(`Re-encrypt failed for recipient ${row.id}: ${updateError?.message ?? 'row changed concurrently'}`);
      rotated += 1;
    } catch (e) {
      throw new Error(`Recipient ${row.id} could not be re-encrypted: ${e instanceof Error ? e.message : 'decrypt failed'}`);
    }
  }
  if (rows.length !== expectedTotal || rotated !== expectedTotal) throw new Error(`Fetched ${rows.length} and rotated ${rotated} of ${expectedTotal} recipient records. Keep the current key and investigate before changing PAYSCOPE_EMAIL_ENCRYPTION_KEY.`);
  console.log(`Rotated encryption key for ${rotated} recipient record(s). Update PAYSCOPE_EMAIL_ENCRYPTION_KEY to the new key and restart the worker.`);
})().catch(error => { console.error(error instanceof Error ? error.message : 'Encryption key rotation failed'); process.exitCode = 1; });

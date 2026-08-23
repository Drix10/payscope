import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

/** Versioned envelope format for server-only recipient data. */
export type EncryptedValue = { version: 1; iv: string; tag: string; ciphertext: string };

function keyFromBase64(value: string): Buffer {
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32) throw new Error('PAYSCOPE_EMAIL_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  return key;
}

export function encryptEmail(value: string, encodedKey: string): EncryptedValue {
  const plaintext = value.trim().toLowerCase();
  if (!plaintext || plaintext.length > 320 || /[\r\n]/.test(plaintext)) throw new Error('Recipient email is invalid');
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, keyFromBase64(encodedKey), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
}

export function decryptEmail(value: EncryptedValue, encodedKey: string): string {
  if (value.version !== 1) throw new Error('Unsupported encrypted recipient version');
  const decipher = createDecipheriv(ALGORITHM, keyFromBase64(encodedKey), Buffer.from(value.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(value.ciphertext, 'base64')), decipher.final()]).toString('utf8');
  if (!plaintext || plaintext.length > 320 || /[\r\n]/.test(plaintext)) throw new Error('Decrypted recipient email is invalid');
  return plaintext;
}

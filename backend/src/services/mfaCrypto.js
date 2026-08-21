import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';
const IV_BYTES = 12;

function encryptionKey() {
  const configured = process.env.MFA_ENCRYPTION_KEY;
  if (!configured) throw new Error('MFA_ENCRYPTION_KEY is required.');
  return crypto.createHash('sha256').update(configured, 'utf8').digest();
}

export function encryptMfaSecret(secret, userId) {
  if (!secret || !userId) throw new Error('MFA secret and user ID are required.');
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, encryptionKey(), iv);
  cipher.setAAD(Buffer.from(`mfa:${userId}`, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join(':');
}

export function decryptMfaSecret(encoded, userId) {
  if (typeof encoded !== 'string' || !userId) throw new Error('MFA secret ciphertext is invalid.');
  const parts = encoded.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) throw new Error('MFA secret ciphertext is invalid.');

  try {
    const iv = Buffer.from(parts[1], 'base64url');
    const tag = Buffer.from(parts[2], 'base64url');
    const ciphertext = Buffer.from(parts[3], 'base64url');
    if (iv.length !== IV_BYTES || tag.length !== 16 || ciphertext.length === 0) {
      throw new Error('Invalid encoded lengths.');
    }
    const decipher = crypto.createDecipheriv(ALGORITHM, encryptionKey(), iv);
    decipher.setAAD(Buffer.from(`mfa:${userId}`, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('MFA secret ciphertext could not be authenticated.');
  }
}

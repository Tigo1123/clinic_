import crypto from 'crypto';

function encryptionKey() {
  const configured = process.env.MEDICAL_ENCRYPTION_KEY;
  if (!configured) throw new Error('MEDICAL_ENCRYPTION_KEY is required.');
  return crypto.createHash('sha256').update(configured).digest();
}

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
export const CLINICAL_DATA_UNREADABLE_CODE = 'CLINICAL_DATA_UNREADABLE';

export class ClinicalDataDecryptionError extends Error {
  constructor() {
    super('Clinical information is unavailable.');
    this.name = 'ClinicalDataDecryptionError';
    this.code = CLINICAL_DATA_UNREADABLE_CODE;
  }
}

export function isClinicalDataDecryptionError(error) {
  return error?.code === CLINICAL_DATA_UNREADABLE_CODE;
}

/**
 * Encrypts cleartext using AES-256-GCM.
 * Returns IV:AuthTag:Ciphertext format.
 */
export function encrypt(text) {
  if (!text) return '';
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, encryptionKey(), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypts composite cipher strings.
 */
export function decrypt(cipherText) {
  if (cipherText === '' || cipherText === null || cipherText === undefined) return '';
  try {
    if (typeof cipherText !== 'string') throw new Error();
    const parts = cipherText.split(':');
    if (parts.length !== 3) {
      throw new Error();
    }
    if (!/^[\da-f]{24}$/i.test(parts[0]) || !/^[\da-f]{32}$/i.test(parts[1]) || !/^(?:[\da-f]{2})*$/i.test(parts[2])) throw new Error();
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encryptedText = Buffer.from(parts[2], 'hex');
    
    const decipher = crypto.createDecipheriv(ALGORITHM, encryptionKey(), iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    throw new ClinicalDataDecryptionError();
  }
}

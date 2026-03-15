// Utilità crittografiche per DocuVault
// Gestione licenze e hash

import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;

/**
 * Genera una chiave di licenza crittografata
 */
export function generateLicenseKey(data: LicenseData): string {
  const encryptionKey = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, encryptionKey, iv);

  const payload = JSON.stringify(data);
  let encrypted = cipher.update(payload, 'utf8', 'base64');
  encrypted += cipher.final('base64');

  const authTag = cipher.getAuthTag();

  // Formato: iv:authTag:encryptedData (tutto in base64)
  const combined = Buffer.concat([iv, authTag, Buffer.from(encrypted, 'base64')]);

  // Aggiungi prefisso per identificare il formato
  return `DV-${combined.toString('base64url')}`;
}

/**
 * Decodifica e valida una chiave di licenza
 */
export function decodeLicenseKey(licenseKey: string): LicenseData | null {
  try {
    if (!licenseKey.startsWith('DV-')) {
      return null;
    }

    const encryptionKey = getEncryptionKey();
    const combined = Buffer.from(licenseKey.slice(3), 'base64url');

    const iv = combined.subarray(0, IV_LENGTH);
    const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const encrypted = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = crypto.createDecipheriv(ALGORITHM, encryptionKey, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted.toString('base64'), 'base64', 'utf8');
    decrypted += decipher.final('utf8');

    return JSON.parse(decrypted) as LicenseData;
  } catch {
    return null;
  }
}

/**
 * Genera un hash SHA-256 per verificare integrità file
 */
export function generateChecksum(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Verifica l'integrità di un file con il checksum
 */
export function verifyChecksum(buffer: Buffer, expectedChecksum: string): boolean {
  const actualChecksum = generateChecksum(buffer);
  return crypto.timingSafeEqual(
    Buffer.from(actualChecksum, 'hex'),
    Buffer.from(expectedChecksum, 'hex')
  );
}

/**
 * Genera un token sicuro per reset password
 */
export function generateSecureToken(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex');
}

/**
 * Genera un salt per hashing password
 */
export function generateSalt(): string {
  return crypto.randomBytes(SALT_LENGTH).toString('hex');
}

/**
 * Hash di una stringa con salt
 */
export function hashWithSalt(value: string, salt: string): string {
  return crypto.pbkdf2Sync(value, salt, 100000, 64, 'sha512').toString('hex');
}

/**
 * Genera UUID v4
 */
export function generateUUID(): string {
  return crypto.randomUUID();
}

// === HELPER PRIVATI ===

function getEncryptionKey(): Buffer {
  const key = process.env.LICENSE_ENCRYPTION_KEY;
  if (!key || key.length < 32) {
    throw new Error('LICENSE_ENCRYPTION_KEY deve essere almeno 32 caratteri');
  }
  // Usa SHA-256 per garantire una chiave di 32 byte
  return crypto.createHash('sha256').update(key).digest();
}

// === TIPI ===

interface LicenseData {
  organizationId: string;
  plan: string;
  maxUsers: number;
  maxStorageGB: number;
  features: string[];
  validFrom: string;
  validUntil: string;
  issuedAt: string;
  signature: string;
}

export type { LicenseData };

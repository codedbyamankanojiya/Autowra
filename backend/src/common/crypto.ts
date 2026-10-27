import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const VERSION = 'v1';

/**
 * Encrypts a value that has to be recoverable by the server (partner bank account numbers
 * for payouts, and nothing else so far). Data that never needs to be read back - payment
 * instrument details, for example - is not stored at all.
 *
 * Format: `v1:<iv>:<authTag>:<ciphertext>`, each part base64url.
 */
export function encryptSecret(plaintext: string, secret: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, keyFrom(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [
    VERSION,
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join(':');
}

/** Returns `null` for anything that was not produced by `encryptSecret` with this key. */
export function decryptSecret(payload: string, secret: string): string | null {
  const [version, iv, authTag, ciphertext] = payload.split(':');
  if (version !== VERSION || !iv || !authTag || !ciphertext) return null;
  try {
    const decipher = createDecipheriv(ALGORITHM, keyFrom(secret), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(authTag, 'base64url'));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]);
    return plaintext.toString('utf8');
  } catch {
    // Wrong key or tampered payload: the GCM tag check fails.
    return null;
  }
}

/** The key is hashed so any configured length produces a valid 256-bit AES key. */
function keyFrom(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}

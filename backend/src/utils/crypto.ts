/**
 * Camera/NVR stream credential encryption.
 *
 * Credentials are stored at rest as AES-256-GCM ciphertext, never as
 * plaintext. The encryption key lives in the `CAMERA_CREDENTIALS_KEY`
 * environment variable (32 bytes, hex or base64).
 *
 * Ciphertext layout is versioned to allow changing the key material:
 *
 *   v1.<iv-b64>.<authTag-b64>.<ciphertext-b64>
 *
 * Decryption tries `CAMERA_CREDENTIALS_KEY` first and, on an auth-tag
 * mismatch (i.e. the primary key has been rotated since the value was
 * written), falls back to `CAMERA_CREDENTIALS_KEY_LEGACY`. GCM auth tags
 * make tampering and wrong-key attempts fail loudly rather than yield
 * garbage plaintext.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { logger } from "../config/logger";

export class CredentialEncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialEncryptionError";
  }
}

const VERSION_PREFIX = "v1";
const KEY_BYTES = 32;
const IV_BYTES = 12;

/** Parses a raw key string into a 32-byte key or null when invalid/missing. */
function normalizeKey(raw: string | undefined): Buffer | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let key: Buffer | null = null;
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    key = Buffer.from(trimmed, "hex");
  } else if (trimmed.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) {
    const decoded = Buffer.from(trimmed, "base64");
    if (decoded.length === KEY_BYTES) key = decoded;
  }

  if (!key || key.length !== KEY_BYTES) {
    logger.error(
      "CAMERA_CREDENTIALS_KEY must be a 32-byte key encoded as 64 hex chars or base64",
    );
    return null;
  }
  return key;
}

function readKeys(): { primary: Buffer | null; legacy: Buffer | null } {
  return {
    primary: normalizeKey(process.env.CAMERA_CREDENTIALS_KEY),
    legacy: normalizeKey(process.env.CAMERA_CREDENTIALS_KEY_LEGACY),
  };
}

function requirePrimaryKey(): Buffer {
  const { primary } = readKeys();
  if (!primary) {
    throw new CredentialEncryptionError(
      "CAMERA_CREDENTIALS_KEY is not configured. Set a 32-byte key (64 hex chars or base64) to store or rotate camera credentials.",
    );
  }
  return primary;
}

/** Encrypts a secret string into the versioned `v1.<iv>.<tag>.<data>` layout. */
export function encryptSecret(plaintext: string): string {
  const key = requirePrimaryKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION_PREFIX}.${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
}

/**
 * Decrypts a versioned secret using the primary key and, on auth failure,
 * the legacy key. Throws `CredentialEncryptionError` when the value is
 * malformed or cannot be decrypted with any configured key.
 */
export function decryptSecret(payload: string): string {
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION_PREFIX) {
    throw new CredentialEncryptionError("Unrecognized encrypted secret format");
  }

  const iv = Buffer.from(parts[1], "base64");
  const tag = Buffer.from(parts[2], "base64");
  const data = Buffer.from(parts[3], "base64");
  if (iv.length !== IV_BYTES || tag.length === 0 || data.length === 0) {
    throw new CredentialEncryptionError("Malformed encrypted secret");
  }

  const { primary, legacy } = readKeys();
  for (const key of [primary, legacy]) {
    if (!key) continue;
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
    } catch {
      // Wrong key or tampered ciphertext — try the next key.
    }
  }

  throw new CredentialEncryptionError(
    "Unable to decrypt stored credential (missing or rotated CAMERA_CREDENTIALS_KEY)",
  );
}

/** True when a stored value is a versioned ciphertext rather than plaintext. */
export function isEncryptedSecret(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(`${VERSION_PREFIX}.`);
}
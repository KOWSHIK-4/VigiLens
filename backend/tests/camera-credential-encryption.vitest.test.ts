import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  encryptSecret,
  decryptSecret,
  isEncryptedSecret,
  CredentialEncryptionError,
} from "../src/utils/crypto";

const KEY_A =
  "1111111111111111111111111111111111111111111111111111111111111111";
const KEY_B =
  "2222222222222222222222222222222222222222222222222222222222222222";

function saveEnv() {
  return {
    primary: process.env.CAMERA_CREDENTIALS_KEY,
    legacy: process.env.CAMERA_CREDENTIALS_KEY_LEGACY,
  };
}

function restoreEnv(saved: { primary: string | undefined; legacy: string | undefined }) {
  if (saved.primary === undefined) delete process.env.CAMERA_CREDENTIALS_KEY;
  else process.env.CAMERA_CREDENTIALS_KEY = saved.primary;
  if (saved.legacy === undefined) delete process.env.CAMERA_CREDENTIALS_KEY_LEGACY;
  else process.env.CAMERA_CREDENTIALS_KEY_LEGACY = saved.legacy;
}

describe("crypto encryptSecret/decryptSecret", () => {
  let saved: { primary: string | undefined; legacy: string | undefined };

  beforeEach(() => {
    saved = saveEnv();
    process.env.CAMERA_CREDENTIALS_KEY = KEY_A;
    delete process.env.CAMERA_CREDENTIALS_KEY_LEGACY;
  });

  afterEach(() => {
    restoreEnv(saved);
  });

  it("round-trips a secret through the versioned layout", () => {
    const plaintext = "stream-user:/s3cr3t//p@s$w0rd";
    const sealed = encryptSecret(plaintext);
    expect(isEncryptedSecret(sealed)).toBe(true);
    const parts = sealed.split(".");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("v1");
    expect(decryptSecret(sealed)).toBe(plaintext);
  });

  it("produces unique ciphertext for the same input (random IV)", () => {
    const a = encryptSecret("same-value");
    const b = encryptSecret("same-value");
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe("same-value");
    expect(decryptSecret(b)).toBe("same-value");
  });

  it("rejects tampered ciphertext", () => {
    const parts = encryptSecret("precious").split(".");
    // Flip the last character of the ciphertext segment.
    const last = parts[3];
    parts[3] = last.slice(0, -1) + (last.endsWith("A") ? "B" : "A");
    expect(parts[3]).not.toBe(last);
    expect(() => decryptSecret(parts.join("."))).toThrow(CredentialEncryptionError);
  });

  it("rejects malformed and unknown formats", () => {
    expect(() => decryptSecret("plaintext")).toThrow(CredentialEncryptionError);
    expect(() => decryptSecret("v9.a.b.c")).toThrow(CredentialEncryptionError);
    expect(() => decryptSecret("v1.a.b")).toThrow(CredentialEncryptionError);
  });

  it("decrypts with the legacy key after the primary key rotates", () => {
    const sealed = encryptSecret("written-before-rotation");
    process.env.CAMERA_CREDENTIALS_KEY = KEY_B;
    process.env.CAMERA_CREDENTIALS_KEY_LEGACY = KEY_A;
    expect(decryptSecret(sealed)).toBe("written-before-rotation");
  });

  it("fails the auth tag when the value was written with a retired key", () => {
    const sealed = encryptSecret("mystery"); // encrypted under KEY_A
    process.env.CAMERA_CREDENTIALS_KEY = KEY_B;
    delete process.env.CAMERA_CREDENTIALS_KEY_LEGACY; // KEY_A is gone
    expect(() => decryptSecret(sealed)).toThrow(CredentialEncryptionError);
  });

  it("fails encryption when the key is missing", () => {
    delete process.env.CAMERA_CREDENTIALS_KEY;
    expect(() => encryptSecret("nope")).toThrow(CredentialEncryptionError);
  });

  it("fails encryption when the key is not a valid 32-byte value", () => {
    process.env.CAMERA_CREDENTIALS_KEY = "not-a-real-key";
    expect(() => encryptSecret("nope")).toThrow(CredentialEncryptionError);
  });

  it("accepts base64-encoded keys of exactly 32 bytes", () => {
    process.env.CAMERA_CREDENTIALS_KEY = Buffer.alloc(32, 7).toString("base64");
    const sealed = encryptSecret("base64-key");
    expect(decryptSecret(sealed)).toBe("base64-key");
  });

  it("rejects short base64 keys", () => {
    process.env.CAMERA_CREDENTIALS_KEY = Buffer.alloc(16, 7).toString("base64");
    expect(() => encryptSecret("nope")).toThrow(CredentialEncryptionError);
  });

  it("isEncryptedSecret only matches the versioned prefix", () => {
    expect(isEncryptedSecret(encryptSecret("x"))).toBe(true);
    expect(isEncryptedSecret("v1.abc")).toBe(true);
    expect(isEncryptedSecret("v2.abc")).toBe(false);
    expect(isEncryptedSecret("plain")).toBe(false);
    expect(isEncryptedSecret(123)).toBe(false);
    expect(isEncryptedSecret(null)).toBe(false);
  });
});
import bcrypt from "bcrypt";
import { generateSecret as otpGenerateSecret, generateURI, verifySync } from "otplib";
import { prisma } from "../config/prisma";

export const MFA_RECOVERY_CODE_COUNT = 10;

/**
 * Generates a fresh TOTP secret and the otpauth provisioning URI the user
 * scans into their authenticator app. The secret is stored on the user row
 * during enrollment and kept afterwards so login can verify codes against it.
 */
export function generateSecret(email: string) {
  const secret = otpGenerateSecret();
  const otpauthUrl = generateURI({ issuer: "VigiLens", label: email, secret });
  return { secret, otpauthUrl };
}

/**
 * Verifies a 6-digit TOTP code with a symmetric one-step window (30s either
 * side) so small clock drift does not lock out the user.
 */
export function verifyTotpCode(secret: string | null, token: string): boolean {
  if (!secret) return false;
  try {
    return verifySync({ secret, token, epochTolerance: [30, 30] }).valid;
  } catch {
    return false;
  }
}

export function generateRecoveryCodes(count = MFA_RECOVERY_CODE_COUNT): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i += 1) {
    codes.push(otpGenerateSecret().replace(/-/g, "").slice(0, 12).toUpperCase());
  }
  return codes;
}

export function hashRecoveryCodes(codes: string[]): string {
  return JSON.stringify(codes.map((code) => bcrypt.hashSync(code, 10)));
}

/**
 * Validates a recovery code and consumes it on success (single use). Returns
 * true only when the code matched and the user row was updated to drop it.
 */
export async function verifyAndConsumeRecoveryCode(
  userId: string,
  code: string,
): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { mfaRecoveryCodes: true },
  });
  if (!user?.mfaRecoveryCodes) return false;

  const normalized = code.trim().toUpperCase();
  const storedCodes: string[] = JSON.parse(user.mfaRecoveryCodes) as string[];
  const index = storedCodes.findIndex((hashed) => bcrypt.compareSync(normalized, hashed));
  if (index === -1) {
    return false;
  }

  const remaining = storedCodes.filter((_, i) => i !== index);
  await prisma.user.update({
    where: { id: userId },
    data: { mfaRecoveryCodes: remaining.length > 0 ? JSON.stringify(remaining) : null },
  });
  return true;
}
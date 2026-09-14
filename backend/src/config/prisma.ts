import { PrismaClient } from "@prisma/client";

/**
 * Camera stream credentials are write-only: they are used internally to
 * reach protected RTSP/HTTP sources, but no API response — top-level or
 * nested inside detections, alerts, reports or detector details — may
 * ever carry them back to a client.
 *
 * This query-extension deep-walks every operation result and strips the
 * credential material from any object shaped like a Camera row (identified
 * by its unique `cameraType` column). Plaintext username/password are
 * removed along with the encrypted `*Encrypted` columns, and a boolean
 * `hasCredentials` flag is stamped onto the row so UIs can indicate that a
 * credential is configured without ever seeing it.
 *
 * The signature check keeps the scrub precise so unrelated models are
 * untouched. Dedicated credential loaders select fields without
 * `cameraType`, so they intentionally bypass this scrub.
 */
function looksLikeCameraRow(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "cameraType" in value &&
    "password" in value
  );
}

function stripCameraPasswords(node: unknown, seen: WeakSet<object>): void {
  if (typeof node !== "object" || node === null || seen.has(node)) return;
  seen.add(node);

  if (Array.isArray(node)) {
    for (const item of node) stripCameraPasswords(item, seen);
    return;
  }

  const record = node as Record<string, unknown>;
  if (looksLikeCameraRow(record)) {
    const hasStoredCredential =
      typeof record.usernameEncrypted === "string" ||
      typeof record.passwordEncrypted === "string" ||
      typeof record.username === "string" ||
      typeof record.password === "string";
    delete record.username;
    delete record.password;
    delete record.usernameEncrypted;
    delete record.passwordEncrypted;
    record.hasCredentials = hasStoredCredential;
  }

  for (const key of Object.keys(record)) {
    stripCameraPasswords(record[key], seen);
  }
}

export const prisma = new PrismaClient({
  log:
    process.env.NODE_ENV === "development"
      ? ["query", "warn", "error"]
      : ["warn", "error"],
}).$extends({
  query: {
    $allOperations({ args, query }) {
      return query(args).then((result) => {
        stripCameraPasswords(result, new WeakSet());
        return result;
      });
    },
  },
});

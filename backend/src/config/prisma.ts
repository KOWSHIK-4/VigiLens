import { PrismaClient } from "@prisma/client";

/**
 * Camera stream credentials are write-only: they are used internally to
 * reach protected RTSP/HTTP sources, but no API response — top-level or
 * nested inside detections, alerts, reports or detector details — may
 * ever carry them back to a client.
 *
 * This query-extension deep-walks every operation result and strips the
 * password from any object shaped like a Camera row (identified by its
 * unique `cameraType` column). The signature check keeps the scrub
 * precise so unrelated models are untouched.
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
    delete record.password;
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

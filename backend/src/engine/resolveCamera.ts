import { ApiError } from "../utils/errors";

/**
 * Resolves the camera used by engine processing for a caller organization.
 *
 * A requested camera_id is only honored when the camera belongs to the
 * caller's organization — anything else is a 404 so one tenant can never
 * process another tenant's camera. When no camera_id is supplied the
 * fallback is scoped to the caller's organization, so the engine can never
 * silently fall back to a foreign camera.
 */
export async function resolveProcessingCamera(
  findFirst: (args: Record<string, unknown>) => Promise<{ id: string } | null>,
  organizationId?: string,
  requestedCameraId?: string,
): Promise<string> {
  if (requestedCameraId) {
    const camera = await findFirst({
      where: { id: requestedCameraId, ...(organizationId ? { organizationId } : {}) },
    });
    if (!camera) throw new ApiError(404, `Unknown camera_id "${requestedCameraId}"`);
    return requestedCameraId;
  }

  const first = await findFirst({
    where: organizationId ? { organizationId } : {},
    orderBy: { createdAt: "asc" },
  });
  if (!first) {
    throw new ApiError(
      400,
      "No camera found: pass a valid camera_id or create a camera before processing frames",
    );
  }
  return first.id;
}
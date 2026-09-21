import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../config/prisma";
import { logger } from "../config/logger";
import { ApiError } from "../utils/errors";
import { stripUrlUserinfo, redactSecrets } from "../utils/redact";
import { settingsService } from "./settings.service";
import {
  aiServiceClient,
  AiServiceError,
  type AiServiceClient,
  type CaptureCredentials,
} from "../engine/aiClient";
import {
  decryptSecret,
  encryptSecret,
  isEncryptedSecret,
} from "../utils/crypto";
import type { Camera, CameraStatus, CameraType, Prisma } from "@prisma/client";
import type { CreateCameraInput, UpdateCameraInput } from "../types";

const SNAPSHOT_TIMEOUT_MS = 10_000;
const SNAPSHOT_SUBDIR = "snapshots";

/**
 * Camera fleet reliability helpers live in `./cameraReliability` (see that
 * module). They are re-exported here so consumers can keep importing camera
 * reliability summaries from the camera service while the implementation
 * stays in a single, tree-shakeable, I/O-free leaf that is unit-testable
 * without booting Prisma.
 */
export {
  summarizeCameraReliability,
  type CameraReliability,
  type CameraFleetReliabilityRow,
} from "./cameraReliability";

/**
 * Sanitizes a camera source URL before it is stored or serialized: any
 * `user:pass@` userinfo is stripped so credentials never linger in the
 * plaintext `url` column or ride camera API payloads. Operators are expected
 * to configure credentials through the separate username/password input
 * fields, which are encrypted at rest.
 */
function sanitizeCameraUrl(url: string, cameraType: string): string {
  if (cameraType === "usb" || cameraType === "video_file") return url;
  const clean = stripUrlUserinfo(url);
  if (clean !== url) {
    logger.warn("Stripped embedded credentials from camera source URL", {
      cameraType,
      hasUserinfo: true,
    });
  }
  return clean;
}

function snapshotFilePath(id: string, dir: string): string {
  return path.join(dir, `${id}.jpg`);
}

async function resolveSnapshotDir(): Promise<string> {
  const base = await settingsService.getValue("storage", "storage_base_path");
  const basePath = typeof base === "string" && base ? base : "/data/vigilens";
  return path.join(basePath, SNAPSHOT_SUBDIR);
}

function mapCaptureError(err: unknown): ApiError {
  if (err instanceof AiServiceError) {
    switch (err.reason) {
      case "unreachable":
        return new ApiError(502, "AI capture service is unreachable", {
          code: "AI_SERVICE_UNREACHABLE",
        });
      case "timeout":
        return new ApiError(502, "Timed out capturing a frame from the camera", {
          code: "AI_SERVICE_TIMEOUT",
        });
      case "http":
        return new ApiError(502, `AI service failed to capture the frame: ${err.message}`, {
          code: "AI_CAPTURE_FAILED",
        });
      case "invalid_frame":
        return new ApiError(422, err.message, { code: "AI_CAPTURE_FAILED" });
      default:
        return new ApiError(502, `AI capture failed: ${err.message}`, {
          code: "AI_CAPTURE_FAILED",
        });
    }
  }
  if (err instanceof ApiError) return err;
  return new ApiError(
    502,
    `Failed to capture a frame: ${err instanceof Error ? err.message : String(err)}`,
    { code: "CAMERA_CAPTURE_FAILED" },
  );
}

async function recordCaptureFailure(id: string, message: string, responseTimeMs: number) {
  const now = new Date();
  await Promise.all([
    prisma.camera.update({
      where: { id },
      data: {
        status: "error",
        isHealthy: false,
        lastHealthCheck: now,
      },
    }),
    prisma.cameraHealthLog.create({
      data: {
        cameraId: id,
        status: "error",
        message,
        responseTime: responseTimeMs,
      },
    }),
  ]);
}

interface FindAllParams {
  page: number;
  limit: number;
  search?: string;
  status?: CameraStatus;
  cameraType?: CameraType;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export type CameraDisplayStatus =
  | "online"
  | "offline"
  | "connecting"
  | "error"
  | "unknown";

/**
 * Derives a truthful display status for a camera.
 *
 * A camera may legitimately be in any one of its stored states only once it
 * has been verified by a health check or a snapshot capture. Before that
 * (e.g. right after creation — the schema even defaults `isHealthy` to
 * true), the camera is reported as "unknown" rather than pretending it is
 * online, offline or broken based on fields that were never populated.
 */
function deriveDisplayStatus(camera: {
  status: CameraStatus;
  lastHealthCheck: Date | null;
}): CameraDisplayStatus {
  if (!camera.lastHealthCheck) return "unknown";
  return camera.status;
}

type CameraApiView = Omit<
  Camera,
  "username" | "password" | "usernameEncrypted" | "passwordEncrypted"
> & {
  hasCredentials: boolean;
  displayStatus: CameraDisplayStatus;
};

/**
 * Redacts credentials and enriches the row with the derived display status
 * and the `hasCredentials` flag. This is a second line of defence on top of
 * the global Prisma scrub (`config/prisma.ts`) to guarantee credential
 * material never rides a camera API payload.
 */
function toApiCamera(camera: Camera): CameraApiView {
  const rest = { ...camera } as Partial<Camera>;
  delete rest.username;
  delete rest.password;
  delete rest.usernameEncrypted;
  delete rest.passwordEncrypted;
  // Defense in depth: never serve embedded URL credentials even if a legacy
  // row managed to hold userinfo.
  if (rest.url) rest.url = sanitizeCameraUrl(rest.url, String(rest.cameraType ?? "rtsp"));
  return {
    ...(rest as Camera),
    hasCredentials: hasStoredCredential(camera),
    displayStatus: deriveDisplayStatus(camera),
  };
}

function hasStoredCredential(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  if (row.hasCredentials !== undefined) return row.hasCredentials === true;
  return (
    typeof row.usernameEncrypted === "string" ||
    typeof row.passwordEncrypted === "string" ||
    (typeof row.username === "string" && row.username.length > 0) ||
    (typeof row.password === "string" && row.password.length > 0)
  );
}

/** Fields needed to load and decode stored credentials (bypasses the scrub). */
const CREDENTIAL_SELECT = {
  username: true,
  password: true,
  usernameEncrypted: true,
  passwordEncrypted: true,
} as const;

function decodeCredentials(row: {
  username?: string | null;
  password?: string | null;
  usernameEncrypted?: string | null;
  passwordEncrypted?: string | null;
}): CaptureCredentials | undefined {
  if (isEncryptedSecret(row.usernameEncrypted) && isEncryptedSecret(row.passwordEncrypted)) {
    try {
      return {
        username: decryptSecret(row.usernameEncrypted),
        password: decryptSecret(row.passwordEncrypted),
      };
    } catch (err) {
      logger.error("Unable to decrypt camera credentials", {
        error: err instanceof Error ? err.message : String(err),
      });
      return undefined;
    }
  }
  if (row.username && row.password) {
    return { username: row.username, password: row.password };
  }
  return undefined;
}

function hasLegacyPlaintextCredential(row: {
  username?: string | null;
  password?: string | null;
  usernameEncrypted?: string | null;
  passwordEncrypted?: string | null;
}): boolean {
  return Boolean(
    typeof row.username === "string" &&
      row.username.length > 0 &&
      typeof row.password === "string" &&
      row.password.length > 0 &&
      !isEncryptedSecret(row.usernameEncrypted) &&
      !isEncryptedSecret(row.passwordEncrypted),
  );
}

/** Encrypts fresh credentials into the row, clearing any legacy plaintext. */
async function persistCredentials(
  id: string,
  credentials: CaptureCredentials,
): Promise<void> {
  await prisma.camera.update({
    where: { id },
    data: {
      usernameEncrypted: encryptSecret(credentials.username),
      passwordEncrypted: encryptSecret(credentials.password),
      username: null,
      password: null,
    },
  });
}

/**
 * Loads the stream credentials for a camera by id. Used by capture paths
 * (e.g. the monitor frame source) that only carry the camera id, so
 * credentials never have to ride on shared runtime objects that could
 * leak through API responses.
 *
 * Legacy rows that still hold plaintext credentials are migrated to the
 * encrypted columns on read, then the plaintext is cleared.
 */
export async function loadCameraCredentials(
  id: string,
): Promise<CaptureCredentials | null> {
  const row = await prisma.camera.findUnique({
    where: { id },
    select: CREDENTIAL_SELECT,
  });
  if (!row) return null;

  const credentials = decodeCredentials(row);
  if (!credentials) return null;

  if (hasLegacyPlaintextCredential(row)) {
    await persistCredentials(id, credentials).catch((err) => {
      logger.warn("Failed to migrate legacy camera credentials", {
        cameraId: id,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  return credentials;
}

export const cameraService = {
  async findAll(params: FindAllParams, organizationId?: string) {
    const { page, limit, search, status, cameraType, sortBy, sortOrder } = params;

    const where: Prisma.CameraWhereInput = {};
    if (organizationId) where.organizationId = organizationId;

    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { location: { contains: search, mode: "insensitive" } },
        { url: { contains: search, mode: "insensitive" } },
      ];
    }

    if (status) where.status = status;
    if (cameraType) where.cameraType = cameraType;

    const orderBy: Prisma.CameraOrderByWithRelationInput = {};
    if (sortBy && ["name", "status", "cameraType", "location", "lastSeen", "createdAt"].includes(sortBy)) {
      orderBy[sortBy as keyof Prisma.CameraOrderByWithRelationInput] = sortOrder || "desc";
    } else {
      orderBy.createdAt = "desc";
    }

    const [rows, total] = await Promise.all([
      prisma.camera.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.camera.count({ where }),
    ]);

    const data = rows.map(toApiCamera);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  },

  async findById(id: string, organizationId?: string) {
    const camera = await prisma.camera.findFirst({
      where: { id, ...(organizationId ? { organizationId } : {}) },
      include: {
        detections: {
          orderBy: { timestamp: "desc" },
          take: 20,
        },
        healthLogs: {
          orderBy: { checkedAt: "desc" },
          take: 10,
        },
      },
    });
    return camera ? toApiCamera(camera) : null;
  },

  async create(data: CreateCameraInput, organizationId?: string) {
    if (!organizationId) {
      throw new ApiError(400, "A tenant organization is required to create a camera");
    }

    const username = (data.username ?? "").trim();
    const password = data.password ?? "";
    const hasCredentialInput = username.length > 0 || password.length > 0;
    if (hasCredentialInput && (!username || !password)) {
      throw new ApiError(400, "Camera username and password must be provided together", {
        code: "INCOMPLETE_CREDENTIALS",
      });
    }

    const camera = await prisma.camera.create({
      data: {
        name: data.name,
        url: sanitizeCameraUrl(data.url, String(data.cameraType ?? "rtsp")),
        cameraType: data.cameraType as CameraType,
        sourceURL: data.sourceURL || null,
        location: data.location || null,
        resolution: data.resolution || null,
        fps: data.fps || null,
        usernameEncrypted: hasCredentialInput ? encryptSecret(username) : null,
        passwordEncrypted: hasCredentialInput ? encryptSecret(password) : null,
        username: null,
        password: null,
        organizationId,
      },
    });
    return toApiCamera(camera);
  },

  async update(id: string, data: UpdateCameraInput, organizationId?: string) {
    // Credential fields are read separately, without `cameraType`, so the
    // prisma redaction scrub (keyed on cameraType + password) lets them
    // through — matching the loadCameraCredentials convention.
    const existing = await prisma.camera.findFirst({
      where: { id, ...(organizationId ? { organizationId } : {}) },
      select: { name: true, cameraType: true, url: true },
    });
    if (!existing) return null;

    const username = (data.username ?? "").trim();
    const password = data.password ?? "";
    const requestedType = (data.cameraType as CameraType | undefined) ?? existing.cameraType;

    const credentialUpdate: Record<string, unknown> = {};
    if (password.length > 0) {
      if (!username) {
        throw new ApiError(400, "Camera username and password must be provided together", {
          code: "INCOMPLETE_CREDENTIALS",
        });
      }
      credentialUpdate.usernameEncrypted = encryptSecret(username);
      credentialUpdate.passwordEncrypted = encryptSecret(password);
      credentialUpdate.username = null;
      credentialUpdate.password = null;
    } else {
      // Legacy plaintext row touched by an update: promote it to encrypted.
      const credentials = await prisma.camera.findUnique({
        where: { id },
        select: CREDENTIAL_SELECT,
      });
      if (credentials && hasLegacyPlaintextCredential(credentials)) {
        credentialUpdate.usernameEncrypted = encryptSecret(
          credentials.username as string,
        );
        credentialUpdate.passwordEncrypted = encryptSecret(
          credentials.password as string,
        );
        credentialUpdate.username = null;
        credentialUpdate.password = null;
      }
    }

    const camera = await prisma.camera.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.url !== undefined && {
          url: sanitizeCameraUrl(data.url, String(requestedType)),
        }),
        ...(data.cameraType !== undefined && { cameraType: data.cameraType as CameraType }),
        ...(data.sourceURL !== undefined && { sourceURL: data.sourceURL }),
        ...(data.location !== undefined && { location: data.location }),
        ...(data.resolution !== undefined && { resolution: data.resolution }),
        ...(data.fps !== undefined && { fps: data.fps }),
        ...credentialUpdate,
      },
    });
    return toApiCamera(camera);
  },

  async remove(id: string, organizationId?: string) {
    const existing = await prisma.camera.findFirst({
      where: { id, ...(organizationId ? { organizationId } : {}) },
    });
    if (!existing) return false;

    await prisma.camera.delete({ where: { id } });
    return true;
  },

  async startCamera(id: string, organizationId?: string) {
    const camera = await prisma.camera.findFirst({
      where: { id, ...(organizationId ? { organizationId } : {}) },
    });
    if (!camera) return null;

    // Start is idempotent: cameras that are already online or still in the
    // process of connecting are returned unchanged instead of failing, so a
    // stale UI or a repeated request can never surface a spurious 500.
    if (camera.status === "online" || camera.status === "connecting") {
      return toApiCamera(camera);
    }

    const updated = await prisma.camera.update({
      where: { id },
      data: {
        status: "connecting",
        lastSeen: new Date(),
      },
    });
    return toApiCamera(updated);
  },

  async stopCamera(id: string, organizationId?: string) {
    const camera = await prisma.camera.findFirst({
      where: { id, ...(organizationId ? { organizationId } : {}) },
    });
    if (!camera) return null;

    // Stop is idempotent: an already-offline camera is returned unchanged.
    if (camera.status === "offline") {
      return toApiCamera(camera);
    }

    const updated = await prisma.camera.update({
      where: { id },
      data: {
        status: "offline",
      },
    });
    return toApiCamera(updated);
  },

  async healthCheck(id: string, client: AiServiceClient = aiServiceClient, organizationId?: string) {
    const camera = await prisma.camera.findFirst({
      where: { id, ...(organizationId ? { organizationId } : {}) },
    });
    if (!camera) return null;

    const start = Date.now();
    let isHealthy = false;
    let responseTime: number | null = null;
    let message: string | null = null;

    // Credentials are decrypted from the encrypted columns (or migrated from
    // legacy plaintext on the way) so protected feeds can be authenticated.
    const credentials = await loadCameraCredentials(id);

    if (camera.cameraType === "ip" && /^https?:\/\//i.test(camera.url)) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const headers: Record<string, string> = {};
        if (credentials) {
          // Cameras behind HTTP basic auth must be probed with the stored
          // credentials, otherwise health checks fail with 401 even though
          // the stream itself is reachable.
          headers.Authorization = `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64")}`;
        }

        const res = await fetch(camera.url, { signal: controller.signal, method: "HEAD", headers });
        clearTimeout(timeout);

        responseTime = Date.now() - start;
        isHealthy = res.ok;
        message = isHealthy ? "Camera responded successfully" : `HTTP ${res.status}`;
      } catch (err) {
        responseTime = Date.now() - start;
        isHealthy = false;
        message = err instanceof Error ? redactSecrets(err.message) : "Health check failed";
      }
    } else {
      // rtsp / usb / video_file feeds cannot be probed over plain HTTP — the
      // AI service captures an actual frame to verify the feed is reachable.
      try {
        await client.captureFrame(
          camera.url,
          camera.cameraType,
          0,
          SNAPSHOT_TIMEOUT_MS,
          credentials ?? undefined,
        );
        responseTime = Date.now() - start;
        isHealthy = true;
        message = "Frame captured successfully";
      } catch (err) {
        responseTime = Date.now() - start;
        isHealthy = false;
        message = err instanceof Error ? redactSecrets(err.message) : "Health check failed";
      }
    }

    const status: CameraStatus = isHealthy ? "online" : "error";
    const now = new Date();

    await prisma.cameraHealthLog.create({
      data: {
        cameraId: id,
        status,
        message,
        responseTime,
      },
    });

    const updated = await prisma.camera.update({
      where: { id },
      data: {
        status,
        isHealthy,
        lastHealthCheck: now,
        lastSeen: isHealthy ? now : undefined,
      },
    });
    return toApiCamera(updated);
  },

  async getHealthLogs(cameraId: string, limit = 50, organizationId?: string) {
    // Parent-table tenant check: only cameras of the caller's organization
    // expose health history.
    const camera = await prisma.camera.findFirst({
      where: { id: cameraId, ...(organizationId ? { organizationId } : {}) },
      select: { id: true },
    });
    if (!camera) return [];
    return prisma.cameraHealthLog.findMany({
      where: { cameraId },
      orderBy: { checkedAt: "desc" },
      take: limit,
    });
  },

  async captureSnapshot(
    id: string,
    client: AiServiceClient = aiServiceClient,
    snapshotDir?: string,
    organizationId?: string,
  ) {
    const camera = await prisma.camera.findFirst({
      where: { id, ...(organizationId ? { organizationId } : {}) },
    });
    if (!camera) {
      throw new ApiError(404, "Camera not found");
    }

    const credentials = await loadCameraCredentials(id);
    const startedAt = Date.now();
    try {
      const frame = await client.captureFrame(
        camera.url,
        camera.cameraType,
        0,
        SNAPSHOT_TIMEOUT_MS,
        credentials ?? undefined,
      );
      const responseTimeMs = Date.now() - startedAt;

      const dir = snapshotDir ?? (await resolveSnapshotDir());
      await mkdir(dir, { recursive: true });
      await writeFile(snapshotFilePath(id, dir), frame);

      const capturedAt = new Date();
      const snapshotUrl = `/api/cameras/${id}/thumbnail`;
      const updated = await prisma.camera.update({
        where: { id },
        data: {
          thumbnail: snapshotUrl,
          status: "online",
          isHealthy: true,
          lastHealthCheck: capturedAt,
          lastSnapshotAt: capturedAt,
          lastSeen: capturedAt,
        },
      });
      await prisma.cameraHealthLog.create({
        data: {
          cameraId: id,
          status: "online",
          message: "Frame captured successfully",
          responseTime: responseTimeMs,
        },
      });

      return {
        camera: toApiCamera(updated),
        snapshotUrl,
        responseTimeMs,
        capturedAt,
      };
    } catch (err) {
      const responseTimeMs = Date.now() - startedAt;
      const message = err instanceof Error ? redactSecrets(err.message) : String(err);
      logger.error("Camera snapshot capture failed", { id, message });
      await recordCaptureFailure(id, message, responseTimeMs);
      throw mapCaptureError(err);
    }
  },

  async getSnapshot(id: string, snapshotDir?: string) {
    const dir = snapshotDir ?? (await resolveSnapshotDir());
    try {
      return await readFile(snapshotFilePath(id, dir));
    } catch {
      return null;
    }
  },
};

/**
 * Durable stream health reporting for the continuous monitor scheduler.
 *
 * Mirrors what a manual health check records, but on the real continuous
 * path:
 *   - when the scheduler decides a camera stream is down (sustained
 *     failures past the backoff threshold) the camera record is flagged as
 *     error/unhealthy and an outage health log is appended once per episode;
 *   - when the loop recovers (or a freshly started camera's first frame
 *     succeeds) the record flips back/up to online and an operational entry
 *     is appended.
 *
 * The interface lives here (leaf module) so `engine/monitor` can consume it
 * without creating a circular dependency.
 */
export interface CameraHealthReporter {
  reportStreamFailure(id: string, message: string, consecutiveFailures: number): Promise<void>;
  reportStreamRecovery(id: string, message: string, responseTimeMs: number): Promise<void>;
}

export const cameraHealthReporter: CameraHealthReporter = {
  async reportStreamFailure(id, message, consecutiveFailures) {
    try {
      const camera = await prisma.camera.findUnique({ where: { id } });
      if (!camera) return;
      const now = new Date();
      const safeMessage = redactSecrets(message) as string;
      await Promise.all([
        prisma.camera.update({
          where: { id },
          data: { status: "error", isHealthy: false, lastHealthCheck: now },
        }),
        prisma.cameraHealthLog.create({
          data: {
            cameraId: id,
            status: "error",
            message: `Stream unavailable after ${consecutiveFailures} consecutive failures: ${safeMessage}`,
          },
        }),
      ]);
    } catch (err) {
      logger.error("Failed to report camera stream outage", {
        cameraId: id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  async reportStreamRecovery(id, message, responseTimeMs) {
    try {
      const camera = await prisma.camera.findUnique({ where: { id } });
      if (!camera) return;
      if (camera.status === "online" && camera.isHealthy) return;
      const now = new Date();
      const safeMessage = redactSecrets(message) as string;
      await Promise.all([
        prisma.camera.update({
          where: { id },
          data: { status: "online", isHealthy: true, lastHealthCheck: now, lastSeen: now },
        }),
        prisma.cameraHealthLog.create({
          data: {
            cameraId: id,
            status: "online",
            message: `Stream recovered: ${safeMessage}`,
            responseTime: responseTimeMs,
          },
        }),
      ]);
    } catch (err) {
      logger.error("Failed to report camera stream recovery", {
        cameraId: id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
};
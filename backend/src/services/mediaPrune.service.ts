import { readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../config/prisma";
import { logger } from "../config/logger";
import { settingsService } from "./settings.service";

export const SNAPSHOT_SUBDIR = "snapshots";
export const RECORDINGS_SUBDIR = "recordings";
export const DEFAULT_STORAGE_BASE_PATH = "/data/vigilens";

const IMAGE_RETENTION_KEY = "image_retention_days";
const VIDEO_RETENTION_KEY = "video_retention_days";
const MAX_STORAGE_KEY = "max_storage_gb";
const DELETE_BATCH_SIZE = 500;

export interface MediaFile {
  filePath: string;
  sizeBytes: number;
  mtimeMs: number;
}

export interface PruneOptions {
  storageBasePath?: string;
  imageRetentionDays?: number;
  videoRetentionDays?: number;
  maxStorageGb?: number;
  now?: number;
  dryRun?: boolean;
}

export interface PruneReport {
  dryRun: boolean;
  storageBasePath: string;
  filesRemoved: number;
  bytesFreed: number;
  detectionsRemoved: number;
  detectionsCutoff: string | null;
}

/**
 * The prune tool only ever touches the two media sub-directories beneath the
 * storage root. Refuse root-like paths so a misconfigured
 * `storage_base_path` can never point the tool at the filesystem root.
 */
export function isSafeStorageBasePath(basePath: string | undefined): boolean {
  if (!basePath || !basePath.trim()) return false;
  const resolved = path.resolve(basePath);
  const parsed = path.parse(resolved);
  return parsed.root !== resolved && path.dirname(resolved) !== resolved;
}

async function resolveStorageBasePath(): Promise<string> {
  try {
    const value = await settingsService.getValue("storage", "storage_base_path");
    if (typeof value === "string" && value.trim()) return value.trim();
  } catch {
    // settings unavailable; fall back to the configured default
  }
  return DEFAULT_STORAGE_BASE_PATH;
}

async function resolveRetentionDays(key: string, fallback: number): Promise<number> {
  try {
    const value = await settingsService.getValue("storage", key);
    if (typeof value === "number" && Number.isFinite(value) && value >= 1) return value;
  } catch {
    // settings unavailable; use the default
  }
  return fallback;
}

async function listFiles(dir: string): Promise<MediaFile[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const files: MediaFile[] = [];
  for (const name of names) {
    const filePath = path.join(dir, name);
    try {
      const stats = await stat(filePath);
      if (stats.isFile()) {
        files.push({ filePath, sizeBytes: stats.size, mtimeMs: stats.mtimeMs });
      }
    } catch {
      // file disappeared mid-scan; skip it
    }
  }
  return files;
}

async function removeMediaFile(file: MediaFile, dryRun: boolean): Promise<number> {
  if (dryRun) return file.sizeBytes;
  try {
    await unlink(file.filePath);
    return file.sizeBytes;
  } catch {
    // already gone or permission denied; nothing more to reclaim
    return 0;
  }
}

function isExpired(file: MediaFile, retentionDays: number, now: number): boolean {
  return file.mtimeMs < now - retentionDays * 86400000;
}

/**
 * Purges expired detection rows in bounded batches. Deleting a detection
 * cascades to its alert row (schema-level `onDelete: Cascade`); audit log
 * rows are unrelated and are left untouched.
 */
export async function purgeExpiredDetections(
  cutoff: Date,
  dryRun: boolean
): Promise<number> {
  let removed = 0;
  for (;;) {
    const batch = await prisma.detection.findMany({
      where: { timestamp: { lt: cutoff } },
      select: { id: true },
      orderBy: { timestamp: "asc" },
      take: DELETE_BATCH_SIZE,
    });
    if (batch.length === 0) break;
    const ids = batch.map((row) => row.id);
    if (dryRun) {
      removed += ids.length;
    } else {
      const result = await prisma.detection.deleteMany({ where: { id: { in: ids } } });
      removed += result.count;
    }
    if (batch.length < DELETE_BATCH_SIZE) break;
  }
  return removed;
}

/**
 * Runs media retention enforcement for the configured storage root:
 * 1) Delete snapshot / recording files older than their retention period.
 * 2) Enforce the soft disk quota (`max_storage_gb`) by deleting the oldest
 *    media files first until the root is back under the quota.
 * 3) Purge persisted detections older than the image retention period.
 *
 * Only the `snapshots/` and `recordings/` sub-directories are ever touched;
 * foreign files next to the root are ignored. Returns a dry-run report.
 */
export async function pruneMedia(options: PruneOptions = {}): Promise<PruneReport> {
  const storageBasePath = options.storageBasePath ?? (await resolveStorageBasePath());
  if (!isSafeStorageBasePath(storageBasePath)) {
    throw new Error(
      `Refusing to prune: storage_base_path "${storageBasePath}" resolves to a filesystem root`
    );
  }

  const now = options.now ?? Date.now();
  const dryRun = options.dryRun ?? false;
  const imageRetentionDays =
    options.imageRetentionDays ?? (await resolveRetentionDays(IMAGE_RETENTION_KEY, 7));
  const videoRetentionDays =
    options.videoRetentionDays ?? (await resolveRetentionDays(VIDEO_RETENTION_KEY, 30));

  let maxStorageBytes: number | undefined;
  if (options.maxStorageGb !== undefined) {
    maxStorageBytes = options.maxStorageGb * 1024 * 1024 * 1024;
  } else {
    const configuredGb = await settingsService
      .getValue("storage", MAX_STORAGE_KEY)
      .catch(() => undefined);
    if (typeof configuredGb === "number" && Number.isFinite(configuredGb) && configuredGb >= 1) {
      maxStorageBytes = configuredGb * 1024 * 1024 * 1024;
    }
  }

  const snapshotsDir = path.join(storageBasePath, SNAPSHOT_SUBDIR);
  const recordingsDir = path.join(storageBasePath, RECORDINGS_SUBDIR);

  const [snapshots, recordings] = await Promise.all([
    listFiles(snapshotsDir),
    listFiles(recordingsDir),
  ]);

  let filesRemoved = 0;
  let bytesFreed = 0;
  const removeAll = async (files: MediaFile[], retentionDays: number) => {
    for (const file of files) {
      if (!isExpired(file, retentionDays, now)) continue;
      bytesFreed += await removeMediaFile(file, dryRun);
      filesRemoved += 1;
    }
  };
  await removeAll(snapshots, imageRetentionDays);
  await removeAll(recordings, videoRetentionDays);

  // Quota enforcement: drop oldest files across every media sub-directory
  // until usage returns under the soft limit.
  if (maxStorageBytes !== undefined) {
    const allMedia = [...snapshots, ...recordings].sort((a, b) => a.mtimeMs - b.mtimeMs);
    let used = allMedia.reduce((sum, file) => sum + file.sizeBytes, 0);
    for (const file of allMedia) {
      if (used <= maxStorageBytes) break;
      const reclaimed = await removeMediaFile(file, dryRun);
      if (reclaimed > 0) {
        used -= reclaimed;
        bytesFreed += reclaimed;
        filesRemoved += 1;
      }
    }
  }

  const detectionsCutoff = new Date(now - imageRetentionDays * 86400000);
  const detectionsRemoved = await purgeExpiredDetections(detectionsCutoff, dryRun);

  const report: PruneReport = {
    dryRun,
    storageBasePath,
    filesRemoved,
    bytesFreed,
    detectionsRemoved,
    detectionsCutoff: detectionsCutoff.toISOString(),
  };

  logger.info(
    dryRun ? "Media prune dry-run (nothing deleted)" : "Media prune complete",
    report
  );
  return report;
}
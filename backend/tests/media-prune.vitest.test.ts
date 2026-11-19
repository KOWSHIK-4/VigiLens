import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm, readdir, utimes, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pruneMedia, purgeExpiredDetections, purgeExpiredReports, SNAPSHOT_SUBDIR, RECORDINGS_SUBDIR } from "../src/services/mediaPrune.service";
import { isSafeStorageBasePath } from "../src/utils/storagePath";
import { prisma } from "../src/config/prisma";

const DEFAULT_ORG_ID = "00000000-0000-0000-0000-000000000001";

let baseDir: string;
const NOW = Date.UTC(2026, 5, 15, 12, 0, 0); // 2026-06-15 noon UTC

beforeEach(async () => {
  baseDir = await mkdtemp(path.join(tmpdir(), "vigilens-prune-"));
});

afterEach(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

async function seedFile(subdir: string, name: string, ageMs: number, content = "x".repeat(10)): Promise<string> {
  const dir = path.join(baseDir, subdir);
  await mkdir(dir, { recursive: true });
  const full = path.join(dir, name);
  await writeFile(full, content);
  await utimes(full, new Date(NOW - ageMs), new Date(NOW - ageMs));
  return full;
}

describe("isSafeStorageBasePath", () => {
  it("rejects filesystem roots and empty strings", () => {
    expect(isSafeStorageBasePath(undefined)).toBe(false);
    expect(isSafeStorageBasePath("")).toBe(false);
    expect(isSafeStorageBasePath("   ")).toBe(false);
  });

  it("accepts a normal sub-directory", () => {
    expect(isSafeStorageBasePath("/data/vigilens")).toBe(true);
    expect(isSafeStorageBasePath("C:\\data\\vigilens")).toBe(true);
  });
});

describe("pruneMedia retention", () => {
  it("deletes expired snapshots and keeps fresh ones", async () => {
    await seedFile(SNAPSHOT_SUBDIR, "cam-a.jpg", 8 * 86400000);
    await seedFile(SNAPSHOT_SUBDIR, "cam-b.jpg", 1 * 86400000);

    const report = await pruneMedia({
      storageBasePath: baseDir,
      imageRetentionDays: 7,
      maxStorageGb: 1,
      now: NOW,
    });

    expect(report.filesRemoved).toBe(1);
    expect(report.bytesFreed).toBe(10);
    expect(await readdir(path.join(baseDir, SNAPSHOT_SUBDIR))).toEqual(["cam-b.jpg"]);
  });

  it("respects video retention separately", async () => {
    await seedFile(RECORDINGS_SUBDIR, "seg-01.mp4", 40 * 86400000);
    await seedFile(RECORDINGS_SUBDIR, "seg-02.mp4", 10 * 86400000);

    const report = await pruneMedia({
      storageBasePath: baseDir,
      videoRetentionDays: 30,
      now: NOW,
    });

    expect(report.filesRemoved).toBe(1);
    expect(await readdir(path.join(baseDir, RECORDINGS_SUBDIR))).toEqual(["seg-02.mp4"]);
  });

  it("is a no-op when no files are expired", async () => {
    await seedFile(SNAPSHOT_SUBDIR, "cam-a.jpg", 1 * 86400000);

    const report = await pruneMedia({
      storageBasePath: baseDir,
      imageRetentionDays: 7,
      now: NOW,
    });

    expect(report.filesRemoved).toBe(0);
    expect(report.bytesFreed).toBe(0);
    expect(await readdir(path.join(baseDir, SNAPSHOT_SUBDIR))).toHaveLength(1);
  });

  it("tolerates missing media directories", async () => {
    const report = await pruneMedia({ storageBasePath: baseDir, now: NOW });
    expect(report.filesRemoved).toBe(0);
    expect(report.bytesFreed).toBe(0);
  });

  it("dry-run deletes nothing and reports sizes", async () => {
    await seedFile(SNAPSHOT_SUBDIR, "cam-a.jpg", 8 * 86400000);

    const report = await pruneMedia({
      storageBasePath: baseDir,
      imageRetentionDays: 7,
      now: NOW,
      dryRun: true,
    });

    expect(report.dryRun).toBe(true);
    expect(report.filesRemoved).toBe(1);
    expect(report.bytesFreed).toBe(10);
    expect(await readdir(path.join(baseDir, SNAPSHOT_SUBDIR))).toHaveLength(1);
  });

  it("enforces the disk quota by deleting oldest files first", async () => {
    await seedFile(SNAPSHOT_SUBDIR, "old.jpg", 5 * 86400000, "y".repeat(200));
    await seedFile(SNAPSHOT_SUBDIR, "new.jpg", 1 * 86400000, "z".repeat(200));

    // Quota of ~300 bytes with 400 bytes present: the oldest file (200 bytes)
    // must go, the newer one must stay.
    const report = await pruneMedia({
      storageBasePath: baseDir,
      imageRetentionDays: 7,
      maxStorageGb: 300 / (1024 * 1024 * 1024),
      now: NOW,
    });

    expect(report.bytesFreed).toBeGreaterThanOrEqual(200);
    expect(await readdir(path.join(baseDir, SNAPSHOT_SUBDIR))).toEqual(["new.jpg"]);
  });

  it("does not over-delete fresh media after retention has freed space", async () => {
    await seedFile(SNAPSHOT_SUBDIR, "expired.jpg", 8 * 86400000, "x".repeat(1000));
    await seedFile(SNAPSHOT_SUBDIR, "fresh-old.jpg", 2 * 86400000, "y".repeat(600));
    await seedFile(SNAPSHOT_SUBDIR, "fresh-new.jpg", 1 * 86400000, "z".repeat(600));

    // Retention frees the 1000-byte expired file, leaving 1200 bytes, which is
    // under the 1300-byte quota. Counting the already-deleted file would push
    // usage to 2200 and wrongly delete both fresh files.
    const report = await pruneMedia({
      storageBasePath: baseDir,
      imageRetentionDays: 7,
      maxStorageGb: 1300 / (1024 * 1024 * 1024),
      now: NOW,
    });

    expect(report.filesRemoved).toBe(1);
    expect(report.bytesFreed).toBe(1000);
    expect(await readdir(path.join(baseDir, SNAPSHOT_SUBDIR))).toEqual([
      "fresh-new.jpg",
      "fresh-old.jpg",
    ]);
  });

  it("refuses to run against a filesystem root", async () => {
    await expect(
      pruneMedia({ storageBasePath: path.parse(baseDir).root })
    ).rejects.toThrow(/filesystem root/);
  });

  it("accepts an ordinary storage root", async () => {
    await expect(pruneMedia({ storageBasePath: baseDir })).resolves.toMatchObject({
      dryRun: false,
      storageBasePath: baseDir,
    });
  });
});

describe("purgeExpiredDetections", () => {
  it("purges detection rows older than the retention cutoff", async () => {
    await prisma.camera.upsert({
      where: { id: "prune-fixture-camera" },
      create: {
        id: "prune-fixture-camera",
        name: "Prune Fixture",
        url: "rtsp://prune-cam",
        cameraType: "rtsp",
        organizationId: DEFAULT_ORG_ID,
      },
      update: {},
    });
    const oldFrame = Date.UTC(2026, 4, 1, 12, 0, 0);
    const freshFrame = Date.UTC(2026, 5, 10, 12, 0, 0);

    const oldDetection = await prisma.detection.create({
      data: {
        cameraId: "prune-fixture-camera",
        label: "person",
        confidence: 0.9,
        imageUrl: "/snapshot/prune-old.jpg",
        timestamp: new Date(oldFrame),
        organizationId: DEFAULT_ORG_ID,
      },
    });
    const freshDetection = await prisma.detection.create({
      data: {
        cameraId: "prune-fixture-camera",
        label: "person",
        confidence: 0.8,
        imageUrl: "/snapshot/prune-new.jpg",
        timestamp: new Date(freshFrame),
        organizationId: DEFAULT_ORG_ID,
      },
    });

    try {
      const cutoff = new Date(Date.UTC(2026, 4, 15));
      const removed = await pruneMedia({
        storageBasePath: baseDir,
        imageRetentionDays: 7,
        now: Date.UTC(2026, 4, 20),
      });

      expect(removed.detectionsRemoved).toBe(1);
      const surviving = await prisma.detection.findUnique({ where: { id: freshDetection.id } });
      expect(surviving).not.toBeNull();
      const purged = await prisma.detection.findUnique({ where: { id: oldDetection.id } });
      expect(purged).toBeNull();
    } finally {
      await prisma.detection.deleteMany({ where: { cameraId: "prune-fixture-camera" } });
      await prisma.camera.delete({ where: { id: "prune-fixture-camera" } });
    }
  });
});

describe("dry-run purge termination", () => {
  const BATCH_CAMERA_ID = "prune-batch-fixture-camera";
  const OLD_CUTOFF = new Date(Date.UTC(2000, 0, 2, 0, 0, 0));
  const OLD_TIMESTAMP = new Date(Date.UTC(2000, 0, 1, 0, 0, 0));

  beforeEach(async () => {
    await prisma.camera.upsert({
      where: { id: BATCH_CAMERA_ID },
      create: {
        id: BATCH_CAMERA_ID,
        name: "Prune Batch Fixture",
        url: "rtsp://prune-batch-cam",
        cameraType: "rtsp",
        organizationId: DEFAULT_ORG_ID,
      },
      update: {},
    });
  });

  afterEach(async () => {
    await prisma.detection.deleteMany({ where: { cameraId: BATCH_CAMERA_ID } });
    await prisma.camera.deleteMany({ where: { id: BATCH_CAMERA_ID } });
    await prisma.report.deleteMany({ where: { generatedBy: "prune-batch-fixture" } });
  });

  it("counts a full batch of expired detections in a dry run without re-reading it forever", async () => {
    await prisma.detection.createMany({
      data: Array.from({ length: 500 }, (_, i) => ({
        cameraId: BATCH_CAMERA_ID,
        label: "person",
        confidence: 0.5,
        imageUrl: `/snapshot/batch-${i}.jpg`,
        timestamp: OLD_TIMESTAMP,
        organizationId: DEFAULT_ORG_ID,
      })),
    });

    await expect(purgeExpiredDetections(OLD_CUTOFF, true)).resolves.toBe(500);
    expect(
      await prisma.detection.count({ where: { cameraId: BATCH_CAMERA_ID } }),
    ).toBe(500);
  });

  it("counts a full batch of expired reports in a dry run without re-reading it forever", async () => {
    await prisma.report.createMany({
      data: Array.from({ length: 500 }, (_, i) => ({
        title: `Batch report ${i}`,
        type: "daily",
        generatedBy: "prune-batch-fixture",
        dateRange: { from: "1999-12-01", to: "1999-12-31" },
        createdAt: OLD_TIMESTAMP,
        status: "completed",
        organizationId: DEFAULT_ORG_ID,
      })),
    });

    await expect(purgeExpiredReports(OLD_CUTOFF, true)).resolves.toBe(500);
    expect(
      await prisma.report.count({ where: { generatedBy: "prune-batch-fixture" } }),
    ).toBe(500);
  });
});

describe("report retention (analytics artifact archival)", () => {
  it("purges report rows older than the report retention cutoff", async () => {
    const oldCreated = new Date(Date.UTC(2026, 2, 1, 12, 0, 0));
    const recentCreated = new Date(Date.UTC(2026, 5, 10, 12, 0, 0));

    const oldReport = await prisma.report.create({
      data: {
        title: "Stale Report",
        type: "daily",
        generatedBy: "test",
        dateRange: { from: "2026-02-01", to: "2026-02-28" },
        createdAt: oldCreated,
        status: "completed",
        organizationId: DEFAULT_ORG_ID,
      },
    });
    const freshReport = await prisma.report.create({
      data: {
        title: "Fresh Report",
        type: "daily",
        generatedBy: "test",
        dateRange: { from: "2026-06-01", to: "2026-06-30" },
        createdAt: recentCreated,
        status: "completed",
        organizationId: DEFAULT_ORG_ID,
      },
    });

    try {
      const report = await pruneMedia({
        storageBasePath: baseDir,
        reportRetentionDays: 90,
        now: Date.UTC(2026, 5, 15, 12, 0, 0), // cutoff = 2026-03-17
      });

      expect(report.reportsRemoved).toBe(1);
      expect(report.reportsCutoff).not.toBeNull();
      expect(await prisma.report.findUnique({ where: { id: oldReport.id } })).toBeNull();
      expect(await prisma.report.findUnique({ where: { id: freshReport.id } })).not.toBeNull();
    } finally {
      await prisma.report.deleteMany({ where: { id: { in: [oldReport.id, freshReport.id] } } });
    }
  });
});
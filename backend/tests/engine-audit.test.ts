/**
 * Detector Engine v2 — Audit trail regression tests.
 *
 * Verifies that engine-generated events are recorded in the audit log:
 * every detection persisted by `DetectionPersistenceStage` writes a
 * `detection_created` audit row, and every alert raised by
 * `CooldownAlertStage` writes an `alert_created` audit row. Persistence
 * and alert services are stubbed so no real detection/alert rows are
 * created — only the audit trail (real database) is exercised and cleaned up.
 */

import { CooldownAlertStage, AlertCooldownRegistry } from "../src/engine/alerts";
import { DetectionPersistenceStage } from "../src/engine/engineService";
import { alertService } from "../src/services/alert.service";
import { detectionService } from "../src/services/detection.service";
import { prisma } from "../src/config/prisma";
import type { PipelineContext, NormalizedDetection } from "../src/engine/types";

let passed = 0;
let failed = 0;

function ok(name: string, details?: string) {
  passed += 1;
  console.log(`  PASS  ${name}${details ? ` — ${details}` : ""}`);
}

function fail(name: string, details?: string) {
  failed += 1;
  console.log(`  FAIL  ${name}${details ? ` — ${details}` : ""}`);
}

const CREATED_IDS: string[] = [];

function ctx(): PipelineContext {
  return {
    detector: {
      id: "det-1",
      key: "person",
      name: "Person Detection",
      type: "object_detection",
      version: "1.0.0",
      status: "ready",
      enabled: true,
      availability: "available",
      confidenceThreshold: 50,
      supportedInput: ["image"],
      configuration: {
        confidenceThreshold: 50,
        detectionIntervalMs: 2000,
        maxDetectionsPerFrame: 20,
        alertSeverity: "info",
        alertCooldownMs: 0,
        cameraIds: ["demo-camera-1"],
        inputResolution: "640x640",
        processingMode: "auto",
      },
      modelVersion: "1.0.0",
    },
    cameraId: "demo-camera-1",
    frameNumber: 1,
    startedAt: [0, 0],
    stageTimes: {},
  };
}

function detection(id: string): NormalizedDetection {
  return {
    id,
    className: "person",
    confidence: 0.9,
    bbox: { x1: 10, y1: 10, x2: 100, y2: 200 },
    trackId: "track-1",
    objectId: "person:0",
    cameraId: "demo-camera-1",
    detectorId: "det-1",
    detectorKey: "person",
    timestamp: new Date(),
    normalized: { x: 0, y: 0, width: 0.5, height: 0.5 },
    processingTimeMs: 120,
  };
}

async function findAudit(
  action: string,
  detectionId: string,
  alertId?: string,
) {
  const where = alertId
    ? {
        action: action as never,
        metadata: { path: ["alertId"], equals: alertId },
      }
    : {
        action: action as never,
        metadata: { path: ["detectionId"], equals: detectionId },
      };
  return prisma.auditLog.findFirst({ where });
}

async function run() {
  try {
    // --- DetectionPersistenceStage audit ---
    const realCreate = detectionService.create;
    detectionService.create = (async () => ({ id: "engine-det-audit" })) as typeof detectionService.create;
    const stage = new DetectionPersistenceStage();
    try {
      await stage.persist([detection("engine-det-audit")], ctx());
      const row = await findAudit("detection_created", "engine-det-audit");
      if (row) {
        ok("DetectionPersistenceStage writes detection_created audit", `action=${row.action} module=${row.module}`);
        await prisma.auditLog.delete({ where: { id: row.id } });
      } else {
        fail("DetectionPersistenceStage writes detection_created audit", "no audit row found");
      }
    } finally {
      detectionService.create = realCreate;
    }

    // --- CooldownAlertStage audit ---
    const realAlertCreate = alertService.create;
    alertService.create = (async () => ({
      id: "engine-alert-audit",
    })) as typeof alertService.create;
    const alertStage = new CooldownAlertStage(new AlertCooldownRegistry());
    try {
      await alertStage.evaluate([detection("engine-alert-det")], ctx());
      const row = await findAudit("alert_created", "engine-alert-det", "engine-alert-audit");
      if (row) {
        ok("CooldownAlertStage writes alert_created audit", `action=${row.action} module=${row.module}`);
        await prisma.auditLog.delete({ where: { id: row.id } });
      } else {
        fail("CooldownAlertStage writes alert_created audit", "no audit row found");
      }
    } finally {
      alertService.create = realAlertCreate;
    }

    // --- Cooldown suppresses duplicate alerts but never double-audits ---
    const realAlertCreate2 = alertService.create;
    let calls = 0;
    alertService.create = (async () => {
      calls += 1;
      return { id: `engine-alert-cd-${calls}` };
    }) as typeof alertService.create;
    const cooldownStage = new CooldownAlertStage(new AlertCooldownRegistry());
    try {
      const c = ctx();
      c.detector.configuration.alertCooldownMs = 60000;
      await cooldownStage.evaluate([detection("engine-alert-cd")], c);
      await cooldownStage.evaluate([detection("engine-alert-cd")], c);
      const rows = await prisma.auditLog.findMany({
        where: {
          action: "alert_created" as never,
          metadata: { path: ["alertId"], equals: "engine-alert-cd-1" },
        },
      });
      if (calls === 1 && rows.length === 1) {
        ok("cooldown allows a single alert (and a single audit row)");
      } else {
        fail("cooldown dedup", { calls, auditRows: rows.length });
      }
      for (const row of rows) await prisma.auditLog.delete({ where: { id: row.id } });
    } finally {
      alertService.create = realAlertCreate2;
    }

    console.log(`\nEngine audit trail tests: ${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
  } catch (err) {
    console.error(err);
    for (const id of CREATED_IDS) {
      try {
        await prisma.auditLog.deleteMany({ where: { id } });
      } catch {
        /* ignore cleanup errors */
      }
    }
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

run();

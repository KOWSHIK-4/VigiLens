import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../src/config/prisma";
import { incidentService } from "../src/services/incident.service";

const FIXTURE_EMAIL = "incident-investigation-fixture@vigilens.test";
const FIXTURE_CAMERA_KEY = "incident-investigation-vitest-camera";
const DEFAULT_ORG_ID = "00000000-0000-0000-0000-000000000001";

async function cleanup() {
  await prisma.incidentActivity.deleteMany({
    where: { incident: { alert: { detection: { camera: { name: FIXTURE_CAMERA_KEY } } } } },
  });
  await prisma.incidentNote.deleteMany({
    where: { incident: { alert: { detection: { camera: { name: FIXTURE_CAMERA_KEY } } } } },
  });
  await prisma.incident.deleteMany({
    where: { alert: { detection: { camera: { name: FIXTURE_CAMERA_KEY } } } },
  });
  await prisma.alert.deleteMany({
    where: { detection: { camera: { name: FIXTURE_CAMERA_KEY } } },
  });
  await prisma.detection.deleteMany({
    where: { camera: { name: FIXTURE_CAMERA_KEY } },
  });
  await prisma.camera.deleteMany({ where: { name: FIXTURE_CAMERA_KEY } });
  await prisma.auditLog.deleteMany({ where: { email: FIXTURE_EMAIL } });
  await prisma.user.deleteMany({ where: { email: FIXTURE_EMAIL } });
}

beforeEach(cleanup);
afterEach(cleanup);

async function seedIncident(overrides: { offsetMinutes: number }[]) {
  const user = await prisma.user.create({
    data: {
      email: FIXTURE_EMAIL,
      name: "Incident Investigation Fixture",
      password: "unused-hash",
      role: "admin",
      status: "active",
      organizationId: DEFAULT_ORG_ID,
    },
  });

  const camera = await prisma.camera.create({
    data: {
      name: FIXTURE_CAMERA_KEY,
      url: "rtsp://invalid.invalid/feed",
      cameraType: "rtsp",
      organizationId: DEFAULT_ORG_ID,
    },
  });

  const baseTime = new Date(Date.now() - 30 * 60_000);

  const base = await prisma.detection.create({
    data: {
      cameraId: camera.id,
      label: "person",
      confidence: 0.92,
      status: "critical",
      imageUrl: "/uploads/detections/base.jpg",
      timestamp: baseTime,
      organizationId: DEFAULT_ORG_ID,
    },
  });

  const alert = await prisma.alert.create({
    data: {
      detectionId: base.id,
      severity: "critical",
      title: "Person detected",
      message: "Critical detection for investigation fixture",
      organizationId: DEFAULT_ORG_ID,
    },
  });

  const incident = await incidentService.create({ alertId: alert.id });

  for (const o of overrides) {
    await prisma.detection.create({
      data: {
        cameraId: camera.id,
        label: o.offsetMinutes === 0 ? "person" : "vehicle",
        confidence: 0.7,
        status: "warning",
        imageUrl: `/uploads/detections/other-${o.offsetMinutes}.jpg`,
        timestamp: new Date(baseTime.getTime() + o.offsetMinutes * 60_000),
        organizationId: DEFAULT_ORG_ID,
      },
    });
  }

  return { incident, base, camera, alert, user };
}

describe("incident investigation workflow", () => {
  it("returns related detections from the same camera near the incident", async () => {
    const { incident, base } = await seedIncident([
      { offsetMinutes: -10 },
      { offsetMinutes: 5 },
      { offsetMinutes: 45 }, // outside the default 30min window
    ]);

    const { detection, related } = await incidentService.getRelatedDetections(incident!.id);

    expect(detection?.id).toBe(base.id);
    expect(related).toHaveLength(2);
    expect(related.some((d) => d.label === "vehicle")).toBe(true);
  });

  it("records a resolution summary when resolving an incident", async () => {
    const { incident, alert } = await seedIncident([]);

    const resolved = await incidentService.changeStatus(
      incident!.id,
      {
        status: "acknowledged",
      },
      { userId: alert.acknowledgedById ?? undefined, email: FIXTURE_EMAIL },
    );

    const investigating = await incidentService.changeStatus(
      resolved!.id,
      { status: "investigating" },
      {},
    );

    const done = await incidentService.changeStatus(
      investigating!.id,
      { status: "resolved", resolutionSummary: "False positive after manual review." },
      {},
    );

    expect(done!.status).toBe("resolved");
    expect(done!.resolutionSummary).toBe("False positive after manual review.");

    const activity = await prisma.incidentActivity.findMany({
      where: { incidentId: incident!.id },
      orderBy: { createdAt: "asc" },
    });
    expect(activity.some((a) => a.action === "status_changed" && a.toValue === "resolved")).toBe(true);
  });
});
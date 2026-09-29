/**
 * Detection ingestion — audit trail tenant scope.
 *
 * POST /api/detections is the internal ingestion path the AI service posts to
 * for machine detections. It is not an end-user action: the handler takes a
 * bare `Request`, so there is no req.userId, no req.organizationId and no
 * authenticated actor to attribute the write to.
 *
 * logAudit therefore cannot derive a tenant scope on its own -- it falls back
 * to the actor's userId, then the actor's email, and this call supplies
 * neither. The row was stored with a null organization, and
 * auditLog.service.findAll filters on `where.organizationId`, so every machine
 * detection in the system was written to the audit log and then invisible to
 * the one endpoint that reads it. In a product whose entire purpose is
 * surveillance evidence, the detection trail had a hole in it exactly where
 * the volume is highest.
 *
 * The camera is the authoritative source of the scope: a detection belongs to
 * whichever organization owns the camera that produced it. These tests pin
 * that the camera's organizationId reaches logAudit, and that it comes from the
 * camera rather than from the request, which is attacker-influenced.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const cameraFindUnique = vi.fn();
  const logAudit = vi.fn(async () => undefined);
  return {
    cameraFindUnique,
    logAudit,
    create: vi.fn(async (input: Record<string, unknown>) => ({
      id: "det-1",
      label: "person",
      ...input,
    })),
    recordDetection: vi.fn(),
  };
});

// Factories are hoisted above every top-level `const`, so they reach the stubs
// through `h` rather than through destructured aliases.
vi.mock("../src/config/prisma", () => ({
  prisma: { camera: { findUnique: h.cameraFindUnique } },
}));

vi.mock("../src/utils/auditLog", () => ({ logAudit: h.logAudit }));

vi.mock("../src/services/detection.service", () => ({
  detectionService: { create: h.create },
}));

vi.mock("../src/services/metrics.service", () => ({
  metricsService: { recordDetection: h.recordDetection },
}));

import { detectionController } from "../src/controllers/detection.controller";

const ORG_A = "org-tenant-a";
const ORG_B = "org-tenant-b";

function makeRes() {
  const state = { status: 0, body: undefined as unknown };
  const res = {
    // detection.controller.create reads res.locals.internal to decide whether
    // alert cooldowns apply, so the mock response needs a locals object.
    locals: { internal: true },
    status(code: number) {
      state.status = code;
      return res;
    },
    json(body: unknown) {
      state.body = body;
      return res;
    },
  };
  return { res, state };
}

async function createDetection(cameraId: string) {
  const { res, state } = makeRes();
  const errors: unknown[] = [];
  // No user/organization on the request: this is the internal ingestion shape.
  const req = {
    body: { camera_id: cameraId, label: "person", confidence: 0.91 },
    headers: { "x-forwarded-for": "10.0.0.7", "user-agent": "vigilens-ai" },
    socket: { remoteAddress: "10.0.0.7" },
  } as never;
  await detectionController.create(req, res as never, (e: unknown) => {
    errors.push(e);
  });
  return { state, errors };
}

describe("detection ingestion stamps the owning organization on the audit row", () => {
  beforeEach(() => {
    h.cameraFindUnique.mockReset();
    h.logAudit.mockClear();
    h.create.mockClear();
  });

  it("passes the camera's organizationId to logAudit", async () => {
    h.cameraFindUnique.mockResolvedValue({ id: "cam-1", organizationId: ORG_A });

    await createDetection("cam-1");

    expect(h.logAudit).toHaveBeenCalledTimes(1);
    const arg = h.logAudit.mock.calls[0][0] as { organizationId?: string };
    expect(arg.organizationId).toBe(ORG_A);
  });

  it("reads the organization from the camera row", async () => {
    h.cameraFindUnique.mockResolvedValue({ id: "cam-1", organizationId: ORG_B });

    await createDetection("cam-1");

    // The select must request organizationId; the old query selected only
    // `id`, so there was nothing to attribute the row to.
    expect(h.cameraFindUnique).toHaveBeenCalledWith({
      where: { id: "cam-1" },
      select: { id: true, organizationId: true },
    });
  });

  it("distinguishes two tenants' detections in the audit trail", async () => {
    h.cameraFindUnique.mockResolvedValueOnce({ id: "cam-1", organizationId: ORG_A });
    h.cameraFindUnique.mockResolvedValueOnce({ id: "cam-2", organizationId: ORG_B });

    await createDetection("cam-1");
    await createDetection("cam-2");

    const first = h.logAudit.mock.calls[0][0] as { organizationId?: string };
    const second = h.logAudit.mock.calls[1][0] as { organizationId?: string };
    expect(first.organizationId).toBe(ORG_A);
    expect(second.organizationId).toBe(ORG_B);
  });

  it("never leaves the organizationId undefined", async () => {
    h.cameraFindUnique.mockResolvedValue({ id: "cam-1", organizationId: ORG_A });

    await createDetection("cam-1");

    const arg = h.logAudit.mock.calls[0][0] as Record<string, unknown>;
    // findAll filters `where.organizationId`, so an undefined here is the
    // exact condition that made these rows unreadable.
    expect(arg.organizationId).toBeDefined();
    expect(arg.organizationId).not.toBeNull();
  });

  it("does not write an audit row for an unknown camera", async () => {
    h.cameraFindUnique.mockResolvedValue(null);

    const { errors } = await createDetection("cam-missing");

    expect(errors).toHaveLength(1);
    expect(h.logAudit).not.toHaveBeenCalled();
    expect(h.create).not.toHaveBeenCalled();
  });
});

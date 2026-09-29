/**
 * Monitoring scheduler control — instance-level authorization.
 *
 * MonitorScheduler is a process-wide singleton: one `running` flag and one
 * timer for the whole process, gathering loops from every tenant's detectors.
 * Starting and stopping it is therefore an instance-wide mutation, and the
 * tenant-scoped `monitoring.manage` permission is not sufficient authority for
 * it.
 *
 * Before this guard, `stop` called `monitorScheduler.stop()` for any caller
 * holding `monitoring.manage`, which the seeded tenant `admin` role has -- so a
 * single tenant admin could halt continuous detection for every organization
 * on the instance, and restart it afterwards. The per-tenant `scope` was
 * computed in both handlers but only ever used to shape the returned status;
 * the mutation itself was never scoped.
 *
 * These tests pin the guard to the scheduler's actual scope, not to a
 * hardcoded role list: a caller who is not a super_admin must be refused
 * *before* the singleton is touched, so the running flag is unchanged.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const state = {
    running: false,
    loops: [] as unknown[],
  };
  return {
    state,
    startSpy: vi.fn(() => {
      state.running = true;
    }),
    stopSpy: vi.fn(() => {
      state.running = false;
    }),
  };
});

const { state: schedulerState, startSpy, stopSpy } = h;

// The factories below are hoisted above every top-level `const`, so they must
// reach the spies through the hoisted `h` object rather than the destructured
// aliases, which are still in the temporal dead zone when the factories run.
vi.mock("../src/engine/monitor", () => ({
  monitorScheduler: {
    isRunning: () => h.state.running,
    start: h.startSpy,
    stop: h.stopSpy,
    getStatus: async () => ({ running: h.state.running, loops: [] }),
  },
}));

vi.mock("../src/services/user.service", () => ({
  userService: {
    findById: async () => ({ name: "Test User", email: "user@vigilens.io" }),
  },
}));

vi.mock("../src/utils/auditLog", () => ({
  logAudit: vi.fn(async () => undefined),
}));

import { monitorController } from "../src/controllers/monitor.controller";
import { ApiError } from "../src/utils/errors";
import type { AuthRequest } from "../src/types";

function makeReq(role: string, organizationId = "org-tenant-a"): AuthRequest {
  return {
    userId: "user-1",
    userRole: role,
    organizationId,
    permissions: new Set(["monitoring.manage", "monitoring.read"]),
    ip: "10.0.0.1",
  } as unknown as AuthRequest;
}

function makeRes() {
  const state = { status: 0, body: undefined as unknown };
  const res = {
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

async function invoke(
  handler: (req: AuthRequest, res: unknown, next: unknown) => Promise<void>,
  role: string,
) {
  const { res, state } = makeRes();
  const errors: unknown[] = [];
  const next = (err: unknown) => {
    errors.push(err);
  };
  await handler(makeReq(role), res, next);
  return { state, errors };
}

describe("monitoring scheduler control is instance-wide", () => {
  beforeEach(() => {
    schedulerState.running = false;
    startSpy.mockClear();
    stopSpy.mockClear();
  });

  it("refuses to stop the scheduler for a tenant admin and leaves it running", async () => {
    schedulerState.running = true;

    const { errors } = await invoke(monitorController.stop, "admin");

    expect(stopSpy).not.toHaveBeenCalled();
    expect(schedulerState.running).toBe(true);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(ApiError);
    expect((errors[0] as ApiError).statusCode).toBe(403);
  });

  it("refuses to start the scheduler for a tenant admin", async () => {
    schedulerState.running = false;

    const { errors } = await invoke(monitorController.start, "admin");

    expect(startSpy).not.toHaveBeenCalled();
    expect(schedulerState.running).toBe(false);
    expect(errors).toHaveLength(1);
    expect((errors[0] as ApiError).statusCode).toBe(403);
  });

  it("refuses a tenant admin holding every monitoring permission", async () => {
    // The seeded tenant `admin` role holds both monitoring.read and
    // monitoring.manage, so the guard must key on the instance role and not
    // on the permission set the route already checked.
    schedulerState.running = true;

    const { errors } = await invoke(monitorController.stop, "admin");

    expect(stopSpy).not.toHaveBeenCalled();
    expect((errors[0] as ApiError).statusCode).toBe(403);
  });

  it("allows a super_admin to stop the scheduler", async () => {
    schedulerState.running = true;

    const { state, errors } = await invoke(monitorController.stop, "super_admin");

    expect(errors).toHaveLength(0);
    expect(stopSpy).toHaveBeenCalledTimes(1);
    expect(schedulerState.running).toBe(false);
    expect(state.status).toBe(200);
  });

  it("allows a super_admin to start the scheduler", async () => {
    schedulerState.running = false;

    const { state, errors } = await invoke(monitorController.start, "super_admin");

    expect(errors).toHaveLength(0);
    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(schedulerState.running).toBe(true);
    expect(state.status).toBe(200);
  });

  it("still lets a tenant admin read status scoped to their own organization", async () => {
    // Reading is a different question from mutating the singleton, and must
    // stay available to a tenant admin: the guard is on start/stop only.
    schedulerState.running = true;

    const { state, errors } = await invoke(monitorController.getStatus, "admin");

    expect(errors).toHaveLength(0);
    expect(state.status).toBe(200);
  });

  it("refuses a role that is not a super_admin, including unknown roles", async () => {
    for (const role of ["viewer", "operator", "team_lead", "", "root"]) {
      schedulerState.running = true;
      startSpy.mockClear();
      stopSpy.mockClear();

      await invoke(monitorController.stop, role);

      expect(stopSpy, `role "${role}" must not stop the singleton`).not.toHaveBeenCalled();
      expect(schedulerState.running).toBe(true);
    }
  });
});

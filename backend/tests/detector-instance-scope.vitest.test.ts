/**
 * Instance-scope gate on mutations of resources shared by every tenant.
 *
 * `AIModel`, `DetectorSettings` and `DetectorCamera` carry no `organizationId`,
 * unlike `Camera`, `Detection`, `Alert`, `Incident` and `Report`. Detectors are
 * shared instance-wide on purpose -- one inference process serves all tenants,
 * so loading a second copy of the same weights per tenant is not viable. That
 * makes `models.manage` insufficient on these routes: it is held by the
 * tenant-level `admin` role, so without a scope check an admin in one
 * organization could uninstall or reconfigure a detector another organization's
 * cameras depend on.
 */

import { describe, expect, it, vi } from "vitest";
import { requireInstanceAdmin } from "../src/middleware/instanceScope";
import detectorRouter from "../src/routes/detector.routes";
import modelRouter from "../src/routes/model.routes";
import type { AuthRequest } from "../src/types";

interface RouteLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    /** Per-handler layers for this route, each carrying the handler name. */
    stack: Array<{ name: string }>;
  };
  name?: string;
}

/**
 * Express keeps the individual handlers of a route on `layer.route.stack`; the
 * layer itself is the route's bound dispatch. Reading the handler names from
 * the inner stack is what makes this test about the actual middleware chain
 * rather than a restatement of the route table.
 */
function handlerNamesOf(layer: RouteLayer): string[] {
  return (layer.route?.stack ?? []).map((s) => s.name ?? "");
}

function stacksFor(method: string) {
    return (detectorRouter.stack as RouteLayer[])
      .filter((layer) => {
        if (!layer.route) return false;
        const lower = method.toLowerCase();
        return layer.route.methods[lower] === true || layer.route.methods.all === true;
      })
      .map((layer) => ({ path: layer.route!.path, names: handlerNamesOf(layer) }));
  }

function invoke(role: string | undefined) {
  const next = vi.fn();
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  const req = { userRole: role } as unknown as AuthRequest;

  requireInstanceAdmin("instance wide")(req, res as never, next);

  return { next, res };
}

describe("requireInstanceAdmin", () => {
  it("lets a super_admin through", () => {
    const { next, res } = invoke("super_admin");
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("refuses a tenant admin holding models.manage", () => {
    const { next, res } = invoke("admin");
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: "instance wide" }),
    );
  });

  it("refuses an operator and a viewer", () => {
    for (const role of ["operator", "viewer"]) {
      const { next, res } = invoke(role);
      expect(next, role).not.toHaveBeenCalled();
      expect(res.status, role).toHaveBeenCalledWith(403);
    }
  });

  it("refuses a request with no role at all", () => {
    const { next, res } = invoke(undefined);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("refuses an unknown role rather than defaulting to allow", () => {
    const { next } = invoke("custom_role_with_no_rank");
    expect(next).not.toHaveBeenCalled();
  });
});

describe("detector routes", () => {
  /**
   * Reads and camera assignment stay open to a tenant admin; every other
   * mutation is gated. This walks the router's own middleware stack rather than
   * restating the route table, so a mutation route added later without the gate
   * is caught here.
   */
  function stacksFor(method: string) {
    return (detectorRouter.stack as RouteLayer[])
      .filter((layer) => {
        if (!layer.route) return false;
        const lower = method.toLowerCase();
        return layer.route.methods[lower] === true || layer.route.methods.all === true;
      })
      .map((layer) => ({
        method: method.toUpperCase(),
        path: layer.route!.path,
        names: handlerNamesOf(layer),
      }));
  }

  it("gates install, update, restart, uninstall, enable, disable and settings", () => {
    const mutations = [
      ...stacksFor("POST"),
      ...stacksFor("PATCH"),
      ...stacksFor("DELETE"),
    ];
    const gated = new Set(["/", "/:id", "/:id/restart", "/:id/enable", "/:id/disable", "/:id/settings"]);

    const checked = mutations.filter((r) => gated.has(r.path));
    expect(checked.length).toBeGreaterThanOrEqual(gated.size);

    for (const route of checked) {
      expect(
        route.names,
        `${route.method} ${route.path} must be instance-scoped`,
      ).toContain("requireInstanceAdmin");
    }
  });

  it("leaves camera assignment available to tenant admins", () => {
    const put = stacksFor("PUT").find((r) => r.path === "/:id/cameras");
    expect(put).toBeDefined();
    expect(put!.names).not.toContain("requireInstanceAdmin");
  });

  it("leaves reads available to any caller with models.read", () => {
    for (const route of [...stacksFor("GET")]) {
      expect(route.names, `GET ${route.path} must stay ungated`).not.toContain(
        "requireInstanceAdmin",
      );
    }
  });
});

describe("model routes", () => {
  it("gates every mutation and leaves reads open", () => {
    const byMethod = (method: string) =>
      (modelRouter.stack as RouteLayer[])
        .filter((l) => l.route && l.route.methods[method.toLowerCase()] === true)
        .map((l) => ({ path: l.route!.path, names: handlerNamesOf(l) }));

    const reads = byMethod("GET");
    expect(reads.length).toBeGreaterThan(0);
    for (const route of reads) {
      expect(route.names, `GET ${route.path}`).not.toContain("requireInstanceAdmin");
    }

    for (const method of ["POST", "PATCH", "DELETE"]) {
      const mutations = byMethod(method);
      expect(mutations.length, method).toBeGreaterThan(0);
      for (const route of mutations) {
        // /:id/test only reads the model and runs inference; it does not
        // mutate shared state, so it stays available to models.manage.
        if (method === "POST" && route.path === "/:id/test") continue;
        expect(route.names, `${method} ${route.path}`).toContain("requireInstanceAdmin");
      }
    }
  });
});
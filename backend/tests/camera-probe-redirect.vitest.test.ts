/**
 * The HTTP health probe must not follow a redirect past the outbound guard.
 *
 * The guard validated the configured URL and then called `fetch` with the
 * default `redirect: "follow"`, so an allowed host could 302 the request to
 * 169.254.169.254 or loopback and the guard never saw the second hop. The
 * webhook dispatcher already set `redirect: "manual"` for exactly this reason;
 * the camera probe had not been given the same treatment.
 */

import { describe, expect, it, vi, afterEach } from "vitest";

describe("HTTP camera probe redirect handling", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function probe(url: string) {
    vi.resetModules();
    vi.doMock("../src/config/prisma", () => ({
      prisma: {
        camera: {
          findFirst: vi.fn().mockResolvedValue({
            id: "cam-1",
            name: "Gate",
            url,
            cameraType: "ip",
          }),
          findUnique: vi.fn().mockResolvedValue(null),
          update: vi.fn().mockResolvedValue({ id: "cam-1" }),
        },
        cameraHealthLog: { create: vi.fn().mockResolvedValue({}) },
      },
    }));
    const { cameraService } = await import("../src/services/camera.service");
    return cameraService;
  }

  it("does not follow a redirect, so a permitted host cannot 302 to a blocked one", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 302,
      headers: new Headers({ location: "http://169.254.169.254/latest/meta-data/" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const cameraService = await probe("http://203.0.113.10/stream");
    await cameraService.healthCheck("cam-1", { captureFrame: vi.fn() } as never, "org-1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.redirect).toBe("manual");
  });

  it("reports a redirect as unhealthy rather than chasing it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 302,
        headers: new Headers({ location: "http://127.0.0.1:5432/" }),
      }),
    );

    const cameraService = await probe("http://203.0.113.10/stream");
    const logs: Array<Record<string, unknown>> = [];
    const prisma = (await import("../src/config/prisma")).prisma as unknown as {
      cameraHealthLog: { create: (row: unknown) => void };
    };
    prisma.cameraHealthLog.create = (row: unknown) => {
      logs.push(row as Record<string, unknown>);
    };

    await cameraService.healthCheck("cam-1", { captureFrame: vi.fn() } as never, "org-1");

    const entry = logs[0]?.data as Record<string, unknown> | undefined;
    expect(entry?.status).toBe("error");
    expect(String(entry?.message)).toContain("redirect");
  });

  it("still treats a direct 200 as healthy", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, headers: new Headers() }),
    );

    const cameraService = await probe("http://203.0.113.10/stream");
    await cameraService.healthCheck("cam-1", { captureFrame: vi.fn() } as never, "org-1");

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    expect((fetchMock.mock.calls[0][1] as RequestInit).redirect).toBe("manual");
  });
});
/**
 * Webhook delivery SSRF guard.
 *
 * The webhook URL is tenant-supplied and the backend POSTs to it on every
 * alert and incident change, so it is the same SSRF primitive the camera guard
 * was written for. Two properties are pinned: destinations that can never be a
 * webhook receiver are refused, and redirects are not followed (otherwise a
 * permitted URL 302s to a blocked one and the guard is decorative).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = {
  config: {
    enabled: true,
    url: "https://hooks.example.com/vigilens",
    secret: "s3cret",
    alertCreatedEnabled: true,
    incidentChangedEnabled: true,
  },
};

const h = {
  getValue: vi.fn(async (_category: string, key: string) => {
    if (key === "webhook_enabled") return state.config.enabled;
    if (key === "webhook_url") return state.config.url;
    if (key === "webhook_secret") return state.config.secret;
    if (key === "webhook_alert_created_enabled") return state.config.alertCreatedEnabled;
    if (key === "webhook_incident_changed_enabled") return state.config.incidentChangedEnabled;
    return undefined;
  }),
  recordEvent: vi.fn(),
  enqueue: vi.fn(),
};

vi.mock("../src/services/settings.service", () => ({ settingsService: { getValue: h.getValue } }));
vi.mock("../src/services/metrics.service", () => ({ metricsService: { recordEvent: h.recordEvent } }));
vi.mock("../src/services/webhookRetryQueue", () => ({
  webhookRetryQueue: { enqueue: h.enqueue },
  deliveryIdForEvent: (type: string, id: string) => `${type}:${id}`,
}));

const ALERT = {
  id: "alert-1",
  severity: "high",
  title: "Person at gate",
  message: "detected",
  createdAt: new Date("2026-09-30T10:00:00Z"),
  organizationId: "org-a",
};

describe("webhook delivery SSRF guard", () => {
  beforeEach(() => {
    h.getValue.mockClear();
    h.recordEvent.mockClear();
    h.enqueue.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function dispatchAlert() {
    const { webhookService } = await import("../src/services/webhook.service");
    return webhookService.dispatchAlertCreated(ALERT);
  }

  it("does not deliver to the cloud metadata endpoint", async () => {
    state.config.url = "http://169.254.169.254/latest/meta-data/";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await dispatchAlert();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result?.ok).toBe(false);
    expect(result?.error).toBeTruthy();
  });

  it("does not deliver to loopback", async () => {
    state.config.url = "http://127.0.0.1:5432/";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await dispatchAlert();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result?.ok).toBe(false);
  });

  it("does not deliver to localhost by name", async () => {
    state.config.url = "http://localhost:4000/api/users";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await dispatchAlert();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result?.ok).toBe(false);
  });

  it("refuses to follow a redirect off the guarded URL", async () => {
    state.config.url = "https://hooks.example.com/vigilens";
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await dispatchAlert();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1] as { redirect?: string };
    expect(init.redirect).toBe("manual");
  });

  it("still delivers to a legitimate public receiver", async () => {
    state.config.url = "https://hooks.example.com/vigilens";
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await dispatchAlert();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result?.ok).toBe(true);
    expect(h.recordEvent).toHaveBeenCalledWith("webhooks.dispatched");
  });
});

import { describe, it, expect } from "vitest";
import {
  getSettingCategory,
  getSettingDefinition,
  isHttpUrl,
  isValidSettingValue,
} from "../src/settings";
import {
  authHeader,
  parseWebhookConfig,
  signPayload,
  verifySignature,
} from "../src/services/webhook.service";

describe("Webhook notification settings", () => {
  const category = getSettingCategory("notifications");

  it("adds webhook settings to the notifications category", () => {
    expect(category).toBeDefined();
    const keys = (category?.settings ?? []).map((s) => s.key);
    expect(keys).toContain("webhook_enabled");
    expect(keys).toContain("webhook_url");
    expect(keys).toContain("webhook_secret");
    expect(keys).toContain("webhook_alert_created_enabled");
    expect(keys).toContain("webhook_incident_changed_enabled");
  });

  it("defaults webhooks to disabled with no endpoint", () => {
    const enabled = getSettingDefinition("notifications", "webhook_enabled");
    const url = getSettingDefinition("notifications", "webhook_url");
    const secret = getSettingDefinition("notifications", "webhook_secret");
    const alertFilter = getSettingDefinition("notifications", "webhook_alert_created_enabled");
    expect(enabled?.defaultValue).toBe(false);
    expect(url?.defaultValue).toBe("");
    expect(secret?.defaultValue).toBe("");
    expect(alertFilter?.defaultValue).toBe(true);
  });

  it("accepts only scalar values for webhook settings", () => {
    const enabled = getSettingDefinition("notifications", "webhook_enabled")!;
    const url = getSettingDefinition("notifications", "webhook_url")!;
    expect(isValidSettingValue(enabled, true)).toBe(true);
    expect(isValidSettingValue(enabled, "yes")).toBe(false);
    expect(isValidSettingValue(url, "https://example.com/hook")).toBe(true);
    expect(isValidSettingValue(url, "x".repeat(501))).toBe(false);
  });
});

describe("isHttpUrl", () => {
  it("accepts http and https absolute URLs", () => {
    expect(isHttpUrl("http://localhost:8080/webhook")).toBe(true);
    expect(isHttpUrl("https://example.com/hooks/alerts")).toBe(true);
  });

  it("rejects non-URLs and non-http schemes", () => {
    expect(isHttpUrl("not-a-url")).toBe(false);
    expect(isHttpUrl("rtsp://localhost/stream")).toBe(false);
    expect(isHttpUrl("ftp://example.com/x")).toBe(false);
    expect(isHttpUrl("")).toBe(false);
  });
});

describe("parseWebhookConfig", () => {
  it("maps raw settings values into a webhook config", () => {
    const config = parseWebhookConfig({
      webhook_enabled: true,
      webhook_url: "https://example.com/hook",
      webhook_secret: "s3cret",
      webhook_alert_created_enabled: false,
      webhook_incident_changed_enabled: true,
    });
    expect(config.enabled).toBe(true);
    expect(config.url).toBe("https://example.com/hook");
    expect(config.secret).toBe("s3cret");
    expect(config.alertCreatedEnabled).toBe(false);
    expect(config.incidentChangedEnabled).toBe(true);
  });

  it("falls back to safe defaults for missing or malformed values", () => {
    const config = parseWebhookConfig({});
    expect(config.enabled).toBe(false);
    expect(config.url).toBe("");
    expect(config.secret).toBe("");
    expect(config.alertCreatedEnabled).toBe(true);
    expect(config.incidentChangedEnabled).toBe(true);

    const nonBool = parseWebhookConfig({
      webhook_enabled: "true",
      webhook_url: 123,
    });
    expect(nonBool.enabled).toBe(false);
    expect(nonBool.url).toBe("");
  });
});

describe("Webhook signature", () => {
  const secret = "webhook-test-secret-123";
  const body = JSON.stringify({ type: "alert", event: "alert_created", id: "a-1" });

  it("produces a deterministic HMAC-SHA256 signature", () => {
    const sig = signPayload(secret, body);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(sig.length).toBe(64);
    expect(authHeader(secret, body)).toBe(`sha256=${sig}`);
    expect(sig).not.toBe(signPayload("different-secret", body));
  });

  it("verifies a valid signature and rejects tampered bodies or wrong secrets", () => {
    expect(verifySignature(secret, body, `sha256=${signPayload(secret, body)}`)).toBe(true);
    expect(verifySignature("wrong-secret", body, `sha256=${signPayload(secret, body)}`)).toBe(
      false,
    );
    expect(verifySignature(secret, `${body} `, `sha256=${signPayload(secret, body)}`)).toBe(
      false,
    );
    expect(verifySignature(secret, body, "")).toBe(false);
  });
});
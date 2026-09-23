import { createHmac, timingSafeEqual } from "node:crypto";
import { logger } from "../config/logger";
import { metricsService } from "./metrics.service";
import { settingsService } from "./settings.service";
import { webhookRetryQueue, deliveryIdForEvent } from "./webhookRetryQueue";
import type { SettingValue } from "../settings";

const WEBHOOK_TIMEOUT_MS = 5000;

export type WebhookEventType = "alert" | "incident";

export interface WebhookConfig {
  enabled: boolean;
  url: string;
  secret: string;
  alertCreatedEnabled: boolean;
  incidentChangedEnabled: boolean;
}

export interface WebhookDispatchResult {
  ok: boolean;
  statusCode: number | null;
  error: string | null;
  attemptedAt: string;
}

interface WebhookStatusSnapshot {
  lastAttemptAt: string | null;
  lastStatusCode: number | null;
  lastError: string | null;
  deliveredCount: number;
  failedCount: number;
}

const status: WebhookStatusSnapshot = {
  lastAttemptAt: null,
  lastStatusCode: null,
  lastError: null,
  deliveredCount: 0,
  failedCount: 0,
};

export function signPayload(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

export function authHeader(secret: string, body: string): string {
  return `sha256=${signPayload(secret, body)}`;
}

export function verifySignature(secret: string, body: string, signature: string): boolean {
  const expected = Buffer.from(authHeader(secret, body));
  const received = Buffer.from(signature ?? "");
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}

function asBool(value: SettingValue | undefined, fallback: boolean): boolean {
  if (typeof value !== "boolean") return fallback;
  return value;
}

function asString(value: SettingValue | undefined): string {
  if (typeof value !== "string") return "";
  return value;
}

export function parseWebhookConfig(
  raw: Record<string, SettingValue | undefined>,
): WebhookConfig {
  return {
    enabled: asBool(raw.webhook_enabled, false),
    url: asString(raw.webhook_url),
    secret: asString(raw.webhook_secret),
    alertCreatedEnabled: asBool(raw.webhook_alert_created_enabled, true),
    incidentChangedEnabled: asBool(raw.webhook_incident_changed_enabled, true),
  };
}

export async function readWebhookConfig(organizationId = ""): Promise<WebhookConfig> {
  const [enabled, url, secret, alertCreatedEnabled, incidentChangedEnabled] =
    await Promise.all([
      settingsService.getValue("notifications", "webhook_enabled", organizationId),
      settingsService.getValue("notifications", "webhook_url", organizationId),
      settingsService.getValue("notifications", "webhook_secret", organizationId),
      settingsService.getValue("notifications", "webhook_alert_created_enabled", organizationId),
      settingsService.getValue("notifications", "webhook_incident_changed_enabled", organizationId),
    ]);
  return parseWebhookConfig({
    webhook_enabled: enabled,
    webhook_url: url,
    webhook_secret: secret,
    webhook_alert_created_enabled: alertCreatedEnabled,
    webhook_incident_changed_enabled: incidentChangedEnabled,
  });
}

async function deliver(
  config: WebhookConfig,
  payload: Record<string, unknown>,
  deliveryId?: string,
): Promise<WebhookDispatchResult> {
  const body = JSON.stringify(payload);
  const attemptedAt = new Date().toISOString();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "VigiLens/1.0",
  };
  if (config.secret) {
    headers["X-VigiLens-Signature"] = authHeader(config.secret, body);
  }
  if (deliveryId) {
    headers["X-VigiLens-Delivery"] = deliveryId;
  }

  let result: WebhookDispatchResult;
  try {
    const res = await fetch(config.url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
    result = {
      ok: res.ok,
      statusCode: res.status,
      error: res.ok ? null : `webhook responded with HTTP ${res.status}`,
      attemptedAt,
    };
  } catch (err) {
    result = {
      ok: false,
      statusCode: null,
      error: err instanceof Error ? err.message : String(err),
      attemptedAt,
    };
  }

  status.lastAttemptAt = result.attemptedAt;
  status.lastStatusCode = result.statusCode;
  status.lastError = result.error;
  if (result.ok) status.deliveredCount += 1;
  else status.failedCount += 1;

  logger[result.ok ? "debug" : "warn"]("Webhook delivery", {
    ok: result.ok,
    statusCode: result.statusCode,
    eventId: payload.id,
    error: result.error ?? undefined,
  });
  return result;
}

function serializeDate(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/** Adds the stable idempotency id to a payload so receivers can dedupe. */
function withDeliveryId(
  payload: Record<string, unknown>,
  eventType: WebhookEventType,
  eventId: string,
): Record<string, unknown> {
  return { ...payload, deliveryId: deliveryIdForEvent(eventType, eventId) };
}

/** Queues a failed real dispatch for bounded automatic retries. */
function enqueueRetry(
  eventType: WebhookEventType,
  eventId: string,
  payload: Record<string, unknown>,
): void {
  webhookRetryQueue.enqueue(eventType, eventId, { ...payload, deliveryId: deliveryIdForEvent(eventType, eventId) });
}

export const webhookService = {
  async dispatchAlertCreated(alert: {
    id: string;
    severity: string;
    title: string;
    message: string;
    createdAt: Date | string;
    organizationId?: string | null;
  }): Promise<WebhookDispatchResult | null> {
    let config: WebhookConfig;
    try {
      config = await readWebhookConfig(alert.organizationId ?? "");
    } catch (err) {
      logger.warn("Webhook config read failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
    if (!config.enabled || !config.url || !config.alertCreatedEnabled) return null;
    const payload = withDeliveryId(
      {
        version: "1",
        type: "alert" as WebhookEventType,
        event: "alert_created",
        id: alert.id,
        timestamp: serializeDate(alert.createdAt),
        severity: alert.severity,
        title: alert.title,
        message: alert.message,
        organizationId: alert.organizationId ?? "",
      },
      "alert",
      alert.id,
    );
    const result = await deliver(config, payload, payload.deliveryId as string);
    if (result && result.ok) metricsService.recordEvent("webhooks.dispatched");
    else if (result) enqueueRetry("alert", alert.id, payload);
    return result;
  },

  async dispatchIncidentChanged(incident: {
    id: string;
    status: string;
    action: string;
    timestamp?: Date;
    organizationId?: string | null;
  }): Promise<WebhookDispatchResult | null> {
    let config: WebhookConfig;
    try {
      config = await readWebhookConfig(incident.organizationId ?? "");
    } catch (err) {
      logger.warn("Webhook config read failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
    if (!config.enabled || !config.url || !config.incidentChangedEnabled) return null;
    const payload = withDeliveryId(
      {
        version: "1",
        type: "incident" as WebhookEventType,
        event: `incident_${incident.action}`,
        id: incident.id,
        timestamp: serializeDate(incident.timestamp ?? new Date()),
        status: incident.status,
        organizationId: incident.organizationId ?? "",
      },
      "incident",
      incident.id,
    );
    const result = await deliver(config, payload, payload.deliveryId as string);
    if (result && result.ok) metricsService.recordEvent("webhooks.dispatched");
    else if (result) enqueueRetry("incident", incident.id, payload);
    return result;
  },

  getStatus(): WebhookStatusSnapshot {
    return { ...status };
  },

  /**
   * Retry delivery used by the retry queue's scheduler: reads the current
   * webhook configuration and posts the already-signed payload again. The
   * stable delivery id (derived from the event) is preserved so receivers
   * can dedupe and so the payload itself stays deterministic across retries.
   */
  async dispatchRetry(
    eventType: WebhookEventType,
    payload: Record<string, unknown>,
  ): Promise<{ ok: boolean; error?: string | null }> {
    const organizationId =
      typeof payload.organizationId === "string" ? payload.organizationId : "";
    let config: WebhookConfig;
    try {
      config = await readWebhookConfig(organizationId);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    if (!config.enabled || !config.url) {
      return { ok: false, error: "webhook disabled or url missing" };
    }
    const eventId =
      typeof payload.id === "string" ? payload.id : String(payload.id ?? "");
    const deliveryId =
      typeof payload.deliveryId === "string" ? payload.deliveryId : deliveryIdForEvent(eventType, eventId);
    const result = await deliver(config, payload, deliveryId);
    if (result.ok) {
      metricsService.recordEvent("webhooks.retries.succeeded");
    } else {
      metricsService.recordEvent("webhooks.retries.failed");
    }
    return { ok: result.ok, error: result.error };
  },
};
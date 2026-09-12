import { createHmac, timingSafeEqual } from "node:crypto";
import { logger } from "../config/logger";
import { settingsService } from "./settings.service";
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

export async function readWebhookConfig(): Promise<WebhookConfig> {
  const [enabled, url, secret, alertCreatedEnabled, incidentChangedEnabled] =
    await Promise.all([
      settingsService.getValue("notifications", "webhook_enabled"),
      settingsService.getValue("notifications", "webhook_url"),
      settingsService.getValue("notifications", "webhook_secret"),
      settingsService.getValue("notifications", "webhook_alert_created_enabled"),
      settingsService.getValue("notifications", "webhook_incident_changed_enabled"),
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

export const webhookService = {
  async dispatchAlertCreated(alert: {
    id: string;
    severity: string;
    title: string;
    message: string;
    createdAt: Date | string;
  }): Promise<WebhookDispatchResult | null> {
    let config: WebhookConfig;
    try {
      config = await readWebhookConfig();
    } catch (err) {
      logger.warn("Webhook config read failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
    if (!config.enabled || !config.url || !config.alertCreatedEnabled) return null;
    const payload = {
      version: "1",
      type: "alert" as WebhookEventType,
      event: "alert_created",
      id: alert.id,
      timestamp: serializeDate(alert.createdAt),
      severity: alert.severity,
      title: alert.title,
      message: alert.message,
    };
    return deliver(config, payload);
  },

  async dispatchIncidentChanged(incident: {
    id: string;
    status: string;
    action: string;
    timestamp?: Date;
  }): Promise<WebhookDispatchResult | null> {
    let config: WebhookConfig;
    try {
      config = await readWebhookConfig();
    } catch (err) {
      logger.warn("Webhook config read failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
    if (!config.enabled || !config.url || !config.incidentChangedEnabled) return null;
    const payload = {
      version: "1",
      type: "incident" as WebhookEventType,
      event: `incident_${incident.action}`,
      id: incident.id,
      timestamp: serializeDate(incident.timestamp ?? new Date()),
      status: incident.status,
    };
    return deliver(config, payload);
  },

  getStatus(): WebhookStatusSnapshot {
    return { ...status };
  },
};
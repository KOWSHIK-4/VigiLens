import { logger } from "../config/logger";
import { metricsService } from "./metrics.service";
import type { Response } from "express";

export type RealtimeEventType = "alert" | "incident" | "detection";

export interface RealtimeEvent {
  type: RealtimeEventType;
  id: string;
  timestamp: string;
  data: Record<string, unknown>;
  organizationId?: string;
}

interface Subscriber {
  id: string;
  res: Response;
  userId: string;
  organizationId?: string;
  subscribedAt: number;
}

let nextSubId = 0;

const subscribers = new Map<string, Subscriber>();

const MAX_SUBSCRIBERS = 200;
const HEARTBEAT_MS = 25_000;

const heartbeatTimers = new Map<string, NodeJS.Timeout>();

function startHeartbeat(sub: Subscriber) {
  const timer = setInterval(() => {
    try {
      sub.res.write(`:heartbeat\n\n`);
    } catch {
      removeSubscriber(sub.id);
    }
  }, HEARTBEAT_MS);
  heartbeatTimers.set(sub.id, timer);
}

function addSubscriber(sub: Subscriber) {
  if (subscribers.size >= MAX_SUBSCRIBERS) {
    const oldest = subscribers.keys().next().value;
    if (oldest) removeSubscriber(oldest);
  }
  subscribers.set(sub.id, sub);
  startHeartbeat(sub);
  metricsService.setGauge("realtime.subscribers", subscribers.size);
  logger.info("SSE subscriber connected", {
    subId: sub.id,
    userId: sub.userId,
    total: subscribers.size,
  });
}

export function removeSubscriber(id: string) {
  const sub = subscribers.get(id);
  if (!sub) return;
  const timer = heartbeatTimers.get(id);
  if (timer) {
    clearInterval(timer);
    heartbeatTimers.delete(id);
  }
  subscribers.delete(id);
  metricsService.setGauge("realtime.subscribers", subscribers.size);
  try {
    sub.res.end();
  } catch {
    // already closed
  }
  logger.info("SSE subscriber disconnected", {
    subId: id,
    total: subscribers.size,
  });
}

export function subscribe(userId: string, res: Response, organizationId?: string): string {
  const id = `sse-${++nextSubId}`;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(`:connected\n\n`);

  const sub: Subscriber = { id, res, userId, organizationId, subscribedAt: Date.now() };
  addSubscriber(sub);

  res.on("close", () => removeSubscriber(id));

  return id;
}

export function publishEvent(event: RealtimeEvent) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  let sent = 0;
  for (const [id, sub] of subscribers) {
    // Tenant isolation on the SSE fan-out: a subscriber only receives events
    // for its organization (events without a scope are platform-global and
    // reach everyone).
    if (event.organizationId && event.organizationId !== sub.organizationId) {
      continue;
    }
    try {
      sub.res.write(payload);
      sent++;
    } catch {
      removeSubscriber(id);
    }
  }
  if (sent > 0) {
    metricsService.recordEvent("realtime.publishes", sent);
    logger.debug("SSE event broadcast", {
      type: event.type,
      id: event.id,
      subscribers: sent,
    });
  }
}

export function getSubscriberCount(): number {
  return subscribers.size;
}

export function getSubscriberSnapshot(): Array<{ id: string; userId: string; organizationId?: string; subscribedAt: number }> {
  return Array.from(subscribers.values()).map(({ id, userId, organizationId, subscribedAt }) => ({
    id,
    userId,
    organizationId,
    subscribedAt,
  }));
}

export function publishAlertCreated(
  alert: { id: string; severity: string; title: string; message: string; createdAt: Date },
  organizationId?: string,
) {
  publishEvent({
    type: "alert",
    id: alert.id,
    timestamp: alert.createdAt.toISOString(),
    organizationId,
    data: {
      event: "alert_created",
      severity: alert.severity,
      title: alert.title,
      message: alert.message,
    },
  });
}

export function publishIncidentChanged(
  incident: { id: string; status: string; action: string; timestamp?: Date },
  organizationId?: string,
) {
  publishEvent({
    type: "incident",
    id: incident.id,
    timestamp: (incident.timestamp ?? new Date()).toISOString(),
    organizationId,
    data: {
      event: `incident_${incident.action}`,
      status: incident.status,
    },
  });
}

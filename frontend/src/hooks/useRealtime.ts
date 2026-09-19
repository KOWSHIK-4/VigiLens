import { useEffect, useRef, useState } from "react";
import { API_BASE_URL } from "@/services/api";
import {
  HEARTBEAT_TIMEOUT_MS,
  MAX_DELAY_EXCEEDED,
  nextRetryAfter,
  type RealtimeConnectionState,
} from "@/lib/realtimePolicy";

export type RealtimeEventType = "alert" | "incident";

export interface RealtimeEventMessage {
  type: RealtimeEventType;
  id: string;
  timestamp: string;
  data: {
    event: string;
    severity?: string;
    status?: string;
    title?: string;
    message?: string;
  };
}

export interface RealtimeOptions {
  enabled?: boolean;
  /** Milliseconds of stream silence before the connection is cycled. */
  heartbeatMs?: number;
  /** Maximum failed attempts in a single connecting episode. */
  maxTries?: number;
}

interface RetryState {
  episode: number;
  attempt: number;
  retrying: boolean;
  gaveUp: boolean;
}

const MAX_EVENTS = 50;

export function useRealtime(options: RealtimeOptions = {}) {
  const enabled = options.enabled ?? true;
  const heartbeatMs = options.heartbeatMs ?? HEARTBEAT_TIMEOUT_MS;
  const maxTries = options.maxTries ?? 6;

  const [events, setEvents] = useState<RealtimeEventMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const [state, setState] = useState<RealtimeConnectionState>("connecting");

  const sourceRef = useRef<EventSource | null>(null);
  const retryRef = useRef<RetryState>({
    episode: 0,
    attempt: 0,
    retrying: false,
    gaveUp: false,
  });

  useEffect(() => {
    if (!enabled) {
      setState("disconnected");
      return;
    }

    const token = localStorage.getItem("token");
    if (!token) {
      setState("disconnected");
      return;
    }

    let cancelled = false;
    let source: EventSource | null = null;
    let sourceActive = false;
    let everConnected = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    let lastMessageAt = Date.now();

    const retry = retryRef.current;
    retry.episode += 1;
    retry.attempt = 0;
    retry.retrying = false;
    retry.gaveUp = false;

    setEvents([]);
    setConnected(false);
    setState("connecting");

    const commitState = () => {
      setConnected(sourceActive && everConnected && !retry.gaveUp);
      setState(
        retry.gaveUp
          ? "error"
          : sourceActive && everConnected && !retry.retrying
            ? "connected"
            : retry.retrying || everConnected
              ? "reconnecting"
              : "connecting",
      );
    };

    const clearTimers = () => {
      while (timers.length > 0) {
        const timer = timers.pop();
        if (timer !== undefined) clearTimeout(timer);
      }
    };

    // Heartbeat: if the stream goes silent beyond the timeout the connection
    // is cycled (EventSource auto-reconnect would otherwise sit on a dead
    // socket with no error event in some browsers).
    let hbTimerId: ReturnType<typeof setInterval> | null = null;
    const startHeartbeat = () => {
      if (hbTimerId) return;
      hbTimerId = setInterval(() => {
        if (cancelled) return;
        if (Date.now() - lastMessageAt >= heartbeatMs) {
          if (source) source.close();
          sourceActive = false;
          source = null;
          sourceRef.current = null;
          onStreamError();
        }
      }, Math.max(1000, Math.floor(heartbeatMs / 2)));
    };

    const onStreamError = () => {
      retry.attempt += 1;
      const next = nextRetryAfter(retry.attempt, false, {
        baseDelayMs: 1000,
        maxDelayMs: 30_000,
        factor: 2,
        jitter: 0.25,
        maxAttempts: maxTries,
      });
      if (next.giveUp || next.reason === MAX_DELAY_EXCEEDED) {
        retry.gaveUp = true;
        retry.retrying = false;
        commitState();
        return;
      }
      lastMessageAt = Date.now();
      retry.retrying = true;
      commitState();
      timers.push(
        setTimeout(() => {
          lastMessageAt = Date.now();
          const fresh = new EventSource(
            `${API_BASE_URL}/realtime/events?ticket=${encodeURIComponent(currentTicket)}`,
          );
          attachHandlers(fresh);
          source = fresh;
          sourceRef.current = fresh;
          commitState();
        }, next.delayMs),
      );
    };

    // The JWT never travels in the stream URL (that would leak into proxy
    // and access logs). Exchange it for a short-lived, purpose-limited
    // realtime ticket first, then open EventSource with the ticket. Ticket
    // failures share the same bounded backoff as the stream itself.
    let currentTicket = "";
    const attachHandlers = (es: EventSource) => {
      sourceActive = false;
      es.onopen = () => {
        if (cancelled) return;
        sourceActive = true;
        lastMessageAt = Date.now();
        everConnected = true;
        retry.retrying = false;
        retry.attempt = 0;
        commitState();
        startHeartbeat();
      };
      es.onerror = () => {
        if (cancelled) return;
        if (sourceActive) {
          sourceActive = false;
          everConnected = false;
        }
        onStreamError();
      };
      es.onmessage = (message) => {
        lastMessageAt = Date.now();
        try {
          const parsed = JSON.parse(message.data) as RealtimeEventMessage;
          if (parsed?.type && parsed?.id) {
            setEvents((prev) => [parsed, ...prev].slice(0, MAX_EVENTS));
          }
        } catch {
          // skip malformed frames (heartbeats/comments)
        }
      };
    };

    const fetchTicketAndAttach = () => {
      retry.attempt += 1;
      if (retry.attempt > maxTries) {
        retry.gaveUp = true;
        retry.retrying = false;
        commitState();
        return;
      }
      fetch(`${API_BASE_URL}/auth/realtime-ticket`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((res) => {
          if (!res.ok) throw new Error(`realtime ticket request failed: ${res.status}`);
          return res.json() as Promise<{ data: { ticket: string } }>;
        })
        .then((body) => {
          if (cancelled) return;
          currentTicket = body.data.ticket;
          retry.attempt = 0;
          const fresh = new EventSource(
            `${API_BASE_URL}/realtime/events?ticket=${encodeURIComponent(currentTicket)}`,
          );
          attachHandlers(fresh);
          source = fresh;
          sourceRef.current = fresh;
          commitState();
        })
        .catch(() => {
          if (cancelled) return;
          retry.retrying = true;
          commitState();
          const next = nextRetryAfter(retry.attempt, false, {
            baseDelayMs: 1000,
            maxDelayMs: 30_000,
            factor: 2,
            jitter: 0.25,
            maxAttempts: maxTries,
          });
          if (next.giveUp) {
            retry.gaveUp = true;
            retry.retrying = false;
            commitState();
            return;
          }
          timers.push(setTimeout(fetchTicketAndAttach, next.delayMs));
        });
    };

    fetchTicketAndAttach();

    return () => {
      cancelled = true;
      sourceActive = false;
      everConnected = false;
      if (source) source.close();
      source = null;
      sourceRef.current = null;
      if (hbTimerId) clearInterval(hbTimerId);
      clearTimers();
    };
  }, [enabled, heartbeatMs, maxTries]);

  return { events, connected, state };
}
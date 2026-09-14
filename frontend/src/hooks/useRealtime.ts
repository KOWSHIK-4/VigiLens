import { useEffect, useRef, useState } from "react";
import { API_BASE_URL } from "@/services/api";

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

const MAX_EVENTS = 50;

export function useRealtime(enabled = true) {
  const [events, setEvents] = useState<RealtimeEventMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const token = localStorage.getItem("token");
    if (!token) return;

    let cancelled = false;
    let source: EventSource | null = null;

    setEvents([]);
    setConnected(false);

    const attach = (ticket: string) => {
      source = new EventSource(
        `${API_BASE_URL}/realtime/events?ticket=${encodeURIComponent(ticket)}`,
      );
      sourceRef.current = source;

      source.onopen = () => setConnected(true);
      source.onerror = () => {
        setConnected(false);
      };

      source.onmessage = (message) => {
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

    // The JWT never travels in the stream URL (that would leak into proxy
    // and access logs). Exchange it for a short-lived, purpose-limited
    // realtime ticket first, then open EventSource with the ticket.
    const connect = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/auth/realtime-ticket`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`realtime ticket request failed: ${res.status}`);
        const body = (await res.json()) as { data: { ticket: string } };
        if (cancelled) return;
        attach(body.data.ticket);
      } catch {
        if (!cancelled) setConnected(false);
      }
    };

    connect();

    return () => {
      cancelled = true;
      source?.close();
      sourceRef.current = null;
    };
  }, [enabled]);

  return { events, connected };
}
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

    setEvents([]);
    setConnected(false);

    const source = new EventSource(`${API_BASE_URL}/realtime/events?token=${encodeURIComponent(token)}`);
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

    return () => {
      source.close();
      sourceRef.current = null;
    };
  }, [enabled]);

  return { events, connected };
}
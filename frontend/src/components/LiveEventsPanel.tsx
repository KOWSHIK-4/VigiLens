import { useRealtime, type RealtimeEventMessage } from "@/hooks/useRealtime";
import { formatRelativeTime } from "@/utils/format";
import { getSeverityStyle } from "@/utils/statusConfig";
import { Activity, AlertTriangle, ShieldAlert, Wifi, WifiOff } from "lucide-react";

function eventLabel(event: RealtimeEventMessage) {
  const kind = event.type === "alert" ? "Alert" : "Incident";
  const action = event.data.event?.replace(/^incident_/, "").replace(/^alert_/, "") ?? "";
  const severity = event.data.severity ? ` · ${event.data.severity}` : "";
  const status = event.data.status ? ` · ${event.data.status}` : "";
  return `${kind} ${action}${severity}${status}`;
}

export default function LiveEventsPanel() {
  const { events, connected } = useRealtime(true);

  return (
    <div className="card flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Activity className="w-5 h-5 text-brand-600" />
          Real-time security events
        </h3>
        <span className="flex items-center gap-1.5 text-xs font-medium">
          {connected ? (
            <Wifi className="w-4 h-4 text-green-500" />
          ) : (
            <WifiOff className="w-4 h-4 text-amber-500" />
          )}
          {connected ? "Live" : "Reconnecting"}
        </span>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto max-h-[320px]">
        {events.length === 0 ? (
          <div className="text-sm text-gray-500 text-center py-10">
            {connected ? "Waiting for security events..." : "Connecting to the live event stream..."}
          </div>
        ) : (
          events.map((event, index) => (
            <div
              key={`${event.id}-${index}`}
              className="flex items-start gap-3 rounded-lg border border-gray-200 p-3 text-sm"
            >
              {event.type === "incident" ? (
                <ShieldAlert className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
              ) : (
                <span
                  className={`shrink-0 mt-0.5 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold ${getSeverityStyle(
                    (event.data.severity ?? "info") as "info" | "warning" | "critical",
                  )}`}
                >
                  {event.data.severity ?? "info"}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="font-medium text-gray-800">{eventLabel(event)}</div>
                {event.data.title && (
                  <div className="text-gray-600 truncate">{event.data.title}</div>
                )}
                {event.data.message && (
                  <div className="text-gray-500 truncate">{event.data.message}</div>
                )}
              </div>
              <time className="text-xs text-gray-400 shrink-0">
                {formatRelativeTime(event.timestamp)}
              </time>
            </div>
          ))
        )}
      </div>

      {events.length >= 50 && (
        <p className="mt-3 text-xs text-gray-400 flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5" />
          Showing the 50 most recent events.
        </p>
      )}
    </div>
  );
}
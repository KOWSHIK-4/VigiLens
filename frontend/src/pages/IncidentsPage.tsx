import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  Flag,
  Loader2,
  Search,
  ShieldAlert,
  User,
  X,
} from "lucide-react";
import { incidentService } from "@/services/incidents";
import { showToast } from "@/utils/toast";
import { getSeverityStyle } from "@/utils/statusConfig";
import { formatRelativeTime } from "@/utils/format";
import IncidentDetailsDrawer from "@/components/IncidentDetailsDrawer";
import type { Incident, IncidentFilters, IncidentStatus } from "@/types";
import { useAuth } from "@/hooks/useAuth";
import { hasPermission } from "@/utils/permissions";

const statusFilters: Array<{ value: "" | IncidentStatus; label: string }> = [
  { value: "", label: "All" },
  { value: "new", label: "New" },
  { value: "acknowledged", label: "Acknowledged" },
  { value: "investigating", label: "Investigating" },
  { value: "resolved", label: "Resolved" },
  { value: "reopened", label: "Reopened" },
];

const priorityFilters = [
  { value: "", label: "All" },
  { value: "critical", label: "Critical" },
  { value: "warning", label: "Warning" },
  { value: "info", label: "Info" },
];

const STATUS_BADGES: Record<IncidentStatus, string> = {
  new: "bg-brand-50 text-brand-700 border-brand-200",
  acknowledged: "bg-amber-50 text-amber-700 border-amber-200",
  investigating: "bg-purple-50 text-purple-700 border-purple-200",
  resolved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  reopened: "bg-red-50 text-red-700 border-red-200",
};

const STATUS_LABELS: Record<IncidentStatus, string> = {
  new: "New",
  acknowledged: "Acknowledged",
  investigating: "Investigating",
  resolved: "Resolved",
  reopened: "Reopened",
};

export default function IncidentsPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canRead = hasPermission(user, "alerts.read");
  const canManage = hasPermission(user, "alerts.manage");
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [search, setSearch] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
  const limit = 20;

  const queryFilters = useCallback(
    (): IncidentFilters => ({
      page,
      limit,
      status: (status || undefined) as IncidentStatus | undefined,
      priority: (priority || undefined) as "info" | "warning" | "critical" | undefined,
      search: search || undefined,
    }),
    [page, limit, status, priority, search],
  );

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["incidents", queryFilters()],
    queryFn: () => incidentService.getAll(queryFilters()),
    refetchInterval: autoRefresh ? 10000 : false,
  });

  const { data: summaryData } = useQuery({
    queryKey: ["incidents", "summary"],
    queryFn: () => incidentService.getSummary(),
    refetchInterval: autoRefresh ? 30000 : false,
    enabled: canRead,
  });

  const acknowledgeMutation = useMutation({
    mutationFn: (id: string) => incidentService.changeStatus(id, "acknowledged"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["incidents"] });
    },
    onError: () => {
      showToast({ severity: "critical", title: "Action failed", message: "Could not acknowledge the incident." });
    },
  });

  const incidents = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 0;
  const hasActiveFilters = Boolean(status || priority || search);
  const summary = summaryData;

  const clearFilters = () => {
    setStatus("");
    setPriority("");
    setSearch("");
    setPage(1);
  };

  return (
    <div className="space-y-6">
      {!canRead ? (
        <div className="text-center py-16">
          <ShieldAlert className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-500">Alert access required</h3>
          <p className="text-gray-400 mt-1">You don't have permission to view incidents.</p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-bold text-gray-900">Incidents</h1>
                {summary && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-brand-100 text-brand-700 text-xs font-semibold border border-brand-200">
                    <Flag className="w-3.5 h-3.5" />
                    {summary.open} open
                  </span>
                )}
              </div>
              <p className="text-sm text-gray-500 mt-1">
                Security incident workflow from alert to resolution
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="rounded border-gray-300 text-brand-600 focus:ring-brand-500"
              />
              <Activity className={`w-4 h-4 ${autoRefresh ? "text-brand-600" : "text-gray-400"}`} />
              Auto-refresh
            </label>
          </div>

          {summary && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              <SummaryCard label="New" count={summary.byStatus.new ?? 0} tone="brand" />
              <SummaryCard label="Acknowledged" count={summary.byStatus.acknowledged ?? 0} tone="amber" />
              <SummaryCard label="Investigating" count={summary.byStatus.investigating ?? 0} tone="purple" />
              <SummaryCard label="Resolved" count={summary.byStatus.resolved ?? 0} tone="emerald" />
              <SummaryCard label="Reopened" count={summary.byStatus.reopened ?? 0} tone="red" />
            </div>
          )}

          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search incidents..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="input pl-10"
              />
            </div>

            <div className="flex gap-2 flex-wrap">
              {statusFilters.map((f) => (
                <button
                  key={f.value}
                  onClick={() => {
                    setStatus(f.value);
                    setPage(1);
                  }}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    status === f.value
                      ? "bg-brand-600 text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <div className="flex gap-2">
              {priorityFilters.map((f) => (
                <button
                  key={f.value}
                  onClick={() => {
                    setPriority(f.value);
                    setPage(1);
                  }}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    priority === f.value
                      ? "bg-brand-600 text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {hasActiveFilters && (
            <div className="flex items-center gap-2 -mt-1">
              <button
                onClick={clearFilters}
                className="text-xs text-brand-600 hover:text-brand-700 flex items-center gap-1"
              >
                <X className="w-3 h-3" />
                Clear all filters
              </button>
            </div>
          )}

          {isError && (
            <div className="card flex flex-col items-center gap-3 border-red-200 bg-red-50 py-10 text-center">
              <ShieldAlert className="w-8 h-8 text-red-500" />
              <p className="font-semibold text-red-700">Failed to load incidents</p>
              <button onClick={() => refetch()} className="btn-secondary">
                Try again
              </button>
            </div>
          )}

          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-brand-600" />
            </div>
          ) : incidents.length === 0 ? (
            <div className="card text-center py-12">
              <Flag className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 font-medium">No incidents found</p>
              <p className="text-gray-400 text-sm mt-1">
                {hasActiveFilters
                  ? "Try adjusting your filters"
                  : "Incidents created from alerts will appear here"}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {incidents.map((incident: Incident) => (
                <div
                  key={incident.id}
                  className="bg-white border rounded-xl p-4 transition-all cursor-pointer hover:shadow-md"
                  onClick={() => setSelectedIncident(incident)}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${STATUS_BADGES[incident.status]}`}
                        >
                          {STATUS_LABELS[incident.status]}
                        </span>
                        <PriorityBadge priority={incident.priority} />
                        <span className="text-xs text-gray-400" title={new Date(incident.openedAt).toLocaleString()}>
                          opened {formatRelativeTime(incident.openedAt)}
                        </span>
                      </div>
                      <h3 className="text-sm font-semibold text-gray-900 mt-1">
                        {incident.title}
                      </h3>
                      <p className="text-sm text-gray-600 mt-0.5 line-clamp-2">
                        {incident.description || (incident.alert?.message ?? "")}
                      </p>
                      <div className="flex items-center gap-3 mt-1.5">
                        {incident.assignedToName && (
                          <span className="text-xs text-gray-500 flex items-center gap-1">
                            <User className="w-3 h-3" />
                            {incident.assignedToName}
                          </span>
                        )}
                        {incident.alert?.detection?.camera && (
                          <span className="text-xs text-gray-400">
                            {incident.alert.detection.camera.name}
                          </span>
                        )}
                      </div>
                    </div>
                    {canManage && incident.status === "new" && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          acknowledgeMutation.mutate(incident.id);
                        }}
                        disabled={acknowledgeMutation.isPending}
                        className="btn-secondary text-sm shrink-0"
                        title="Acknowledge incident"
                      >
                        Acknowledge
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-4">
              <p className="text-sm text-gray-500">
                Showing {(page - 1) * limit + 1}-{Math.min(page * limit, total)} of {total}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="btn-secondary p-2"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
                  .map((p, idx, arr) => (
                    <span key={p} className="flex items-center">
                      {idx > 0 && arr[idx - 1] !== p - 1 && (
                        <span className="px-1 text-gray-400">...</span>
                      )}
                      <button
                        onClick={() => setPage(p)}
                        className={`w-9 h-9 rounded-lg text-sm font-medium transition-colors ${
                          p === page
                            ? "bg-brand-600 text-white"
                            : "text-gray-600 hover:bg-gray-100"
                        }`}
                      >
                        {p}
                      </button>
                    </span>
                  ))}
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="btn-secondary p-2"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      <IncidentDetailsDrawer
        incident={selectedIncident}
        onClose={() => setSelectedIncident(null)}
      />
    </div>
  );
}

function PriorityBadge({ priority }: { priority: Incident["priority"] }) {
  const style = getSeverityStyle(priority);
  return (
    <span
      className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${style.badge}`}
    >
      {style.label}
    </span>
  );
}

function SummaryCard({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone: "brand" | "amber" | "purple" | "emerald" | "red";
}) {
  const tones: Record<string, string> = {
    brand: "bg-brand-50 border-brand-200 text-brand-700",
    amber: "bg-amber-50 border-amber-200 text-amber-700",
    purple: "bg-purple-50 border-purple-200 text-purple-700",
    emerald: "bg-emerald-50 border-emerald-200 text-emerald-700",
    red: "bg-red-50 border-red-200 text-red-700",
  };
  return (
    <div className={`rounded-xl border p-3 ${tones[tone]}`}>
      <p className="text-2xl font-bold">{count}</p>
      <p className="text-xs font-medium opacity-80 mt-0.5">{label}</p>
    </div>
  );
}
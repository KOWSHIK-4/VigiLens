import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  CheckCheck,
  Trash2,
  Search,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Eye,
  EyeOff,
} from "lucide-react";
import { alertService } from "@/services/alerts";
import { showToast } from "@/utils/toast";
import { getSeverityStyle } from "@/utils/statusConfig";
import { formatRelativeTime } from "@/utils/format";
import ConfirmDialog from "@/components/ConfirmDialog";
import AlertDetailsDrawer from "@/components/AlertDetailsDrawer";
import type { Alert } from "@/types";

const severityFilters = [
  { value: "", label: "All" },
  { value: "critical", label: "Critical" },
  { value: "warning", label: "Warning" },
  { value: "info", label: "Info" },
];

const readFilters = [
  { value: "", label: "All" },
  { value: "false", label: "Unread" },
  { value: "true", label: "Read" },
];

export default function AlertsPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [severity, setSeverity] = useState("");
  const [isRead, setIsRead] = useState("");
  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Alert | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null);
  const limit = 20;

  const { data, isLoading } = useQuery({
    queryKey: ["alerts", { page, limit, severity, isRead, search }],
    queryFn: () =>
      alertService.getAll({ page, limit, severity: severity || undefined, isRead: isRead || undefined, search: search || undefined }),
    refetchInterval: 5000,
  });

  const markReadMutation = useMutation({
    mutationFn: (id: string) => alertService.markAsRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alerts"] });
      queryClient.invalidateQueries({ queryKey: ["alerts", "unread-count"] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => alertService.markAllAsRead(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alerts"] });
      queryClient.invalidateQueries({ queryKey: ["alerts", "unread-count"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => alertService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alerts"] });
      queryClient.invalidateQueries({ queryKey: ["alerts", "unread-count"] });
      setDeleteTarget(null);
      setDeleteError("");
      showToast({
        severity: "info",
        title: "Alert deleted",
        message: "The alert has been removed.",
      });
    },
    onError: () => {
      setDeleteError("Failed to delete the alert. Please try again.");
    },
  });

  const alerts = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Alerts</h1>
          <p className="text-sm text-gray-500 mt-1">
            Monitor and manage security alerts
          </p>
        </div>
        <button
          onClick={() => markAllReadMutation.mutate()}
          disabled={markAllReadMutation.isPending || total === 0}
          className="btn-primary flex items-center gap-2"
        >
          <CheckCheck className="w-4 h-4" />
          Mark All as Read
        </button>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search alerts..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="input pl-10"
          />
        </div>

        <div className="flex gap-2">
          {severityFilters.map((f) => (
            <button
              key={f.value}
              onClick={() => {
                setSeverity(f.value);
                setPage(1);
              }}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                severity === f.value
                  ? "bg-brand-600 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          {readFilters.map((f) => (
            <button
              key={f.value}
              onClick={() => {
                setIsRead(f.value);
                setPage(1);
              }}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
                isRead === f.value
                  ? "bg-brand-600 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {f.value === "true" ? (
                <EyeOff className="w-3.5 h-3.5" />
              ) : f.value === "false" ? (
                <Eye className="w-3.5 h-3.5" />
              ) : null}
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-brand-600" />
        </div>
      ) : alerts.length === 0 ? (
        <div className="card text-center py-12">
          <Bell className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">No alerts found</p>
          <p className="text-gray-400 text-sm mt-1">
            {severity || isRead || search
              ? "Try adjusting your filters"
              : "New alerts will appear here"}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {alerts.map((alert: Alert) => {
            const cfg = getSeverityStyle(alert.severity);
            const Icon = cfg.icon;
            return (
              <div
                key={alert.id}
                className={`${cfg.bg} border rounded-xl p-4 transition-all cursor-pointer hover:shadow-md ${
                  !alert.isRead ? "ring-1 ring-brand-200" : ""
                }`}
                onClick={() => setSelectedAlert(alert)}
              >
                <div className="flex items-start gap-3">
                  <Icon className={`w-5 h-5 mt-0.5 ${cfg.iconColor} flex-shrink-0`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cfg.badge}`}>
                        {cfg.label}
                      </span>
                      <span
                        className={`text-xs font-medium px-2 py-0.5 rounded-full border ${
                          alert.isRead
                            ? "bg-gray-100 text-gray-500 border-gray-200"
                            : "bg-white text-brand-700 border-brand-200"
                        }`}
                      >
                        {alert.isRead ? "Read" : "New"}
                      </span>
                      {!alert.isRead && (
                        <span className="w-2 h-2 rounded-full bg-brand-500" />
                      )}
                      <span
                        className="text-xs text-gray-400"
                        title={new Date(alert.createdAt).toLocaleString()}
                      >
                        {formatRelativeTime(alert.createdAt)}
                      </span>
                    </div>
                    <h3 className="text-sm font-semibold text-gray-900 mt-1">
                      {alert.title}
                    </h3>
                    <p className="text-sm text-gray-600 mt-0.5 line-clamp-2">
                      {alert.message}
                    </p>
                    {alert.detection?.camera && (
                      <p className="text-xs text-gray-400 mt-1">
                        Source: {alert.detection.camera.name}
                        {alert.detection.camera.location && ` - ${alert.detection.camera.location}`}
                      </p>
                    )}
                  </div>
                  <div
                    className="flex items-center gap-1 flex-shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={() => setSelectedAlert(alert)}
                      className="p-2 text-gray-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors"
                      title="View alert details"
                      aria-label={`View details for ${alert.title}`}
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                    {!alert.isRead && (
                      <button
                        onClick={() => markReadMutation.mutate(alert.id)}
                        disabled={markReadMutation.isPending}
                        className="p-2 text-gray-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors"
                        title="Mark as read"
                      >
                        <CheckCheck className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      onClick={() => {
                        setDeleteError("");
                        setDeleteTarget(alert);
                      }}
                      disabled={deleteMutation.isPending}
                      className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      title="Delete alert"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
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

      <AlertDetailsDrawer
        alert={selectedAlert}
        onClose={() => setSelectedAlert(null)}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Alert"
        message={
          deleteTarget ? (
            <>
              Are you sure you want to delete{" "}
              <span className="font-semibold text-gray-700">
                {deleteTarget.title}
              </span>
              ? This action cannot be undone.
            </>
          ) : null
        }
        busy={deleteMutation.isPending}
        error={deleteError || undefined}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        onClose={() => {
          setDeleteTarget(null);
          setDeleteError("");
        }}
      />
    </div>
  );
}

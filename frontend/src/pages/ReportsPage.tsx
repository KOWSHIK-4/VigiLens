import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  FileText,
  Trash2,
  Search,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Download,
  Plus,
  Calendar,
  Clock,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { reportService } from "@/services/reports";
import { showToast } from "@/utils/toast";
import type { Report } from "@/types";
import GenerateReportDialog from "@/components/GenerateReportDialog";
import ConfirmDialog from "@/components/ConfirmDialog";

const typeConfig: Record<string, { label: string; color: string }> = {
  daily: { label: "Daily", color: "bg-blue-100 text-blue-700" },
  weekly: { label: "Weekly", color: "bg-indigo-100 text-indigo-700" },
  monthly: { label: "Monthly", color: "bg-purple-100 text-purple-700" },
  camera: { label: "Camera", color: "bg-green-100 text-green-700" },
  detection: { label: "Detection", color: "bg-orange-100 text-orange-700" },
  alert: { label: "Alert", color: "bg-red-100 text-red-700" },
};

const typeFilters = [
  { value: "", label: "All Types" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "camera", label: "Camera" },
  { value: "detection", label: "Detection" },
  { value: "alert", label: "Alert" },
];

const statusFilters = [
  { value: "", label: "All Status" },
  { value: "completed", label: "Completed" },
  { value: "generating", label: "Generating" },
  { value: "failed", label: "Failed" },
];

export default function ReportsPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [showGenerate, setShowGenerate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Report | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const limit = 20;

  const { data, isLoading } = useQuery({
    queryKey: ["reports", { page, limit, search, type: typeFilter, status: statusFilter }],
    queryFn: () =>
      reportService.getAll({
        page,
        limit,
        search: search || undefined,
        type: typeFilter || undefined,
        status: statusFilter || undefined,
      }),
    refetchInterval: 5000,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => reportService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reports"] });
      setDeleteTarget(null);
      setDeleteError("");
      showToast({
        severity: "info",
        title: "Report deleted",
        message: "The report has been removed.",
      });
    },
    onError: () => {
      setDeleteError("Failed to delete the report. Please try again.");
    },
  });

  const downloadMutation = useMutation({
    mutationFn: async ({ id, format }: { id: string; format: "pdf" | "csv" }) => {
      await reportService.download(id, format);
    },
  });

  const reports = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
          <p className="text-sm text-gray-500 mt-1">
            Generate and manage security reports
          </p>
        </div>
        <button
          onClick={() => setShowGenerate(true)}
          className="btn-primary flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Generate Report
        </button>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search reports..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="input pl-10"
          />
        </div>

        <div className="flex gap-2">
          {typeFilters.map((f) => (
            <button
              key={f.value}
              onClick={() => {
                setTypeFilter(f.value);
                setPage(1);
              }}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                typeFilter === f.value
                  ? "bg-brand-600 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          {statusFilters.map((f) => (
            <button
              key={f.value}
              onClick={() => {
                setStatusFilter(f.value);
                setPage(1);
              }}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                statusFilter === f.value
                  ? "bg-brand-600 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-brand-600" />
        </div>
      ) : reports.length === 0 ? (
        <div className="card text-center py-12">
          <FileText className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">No reports found</p>
          <p className="text-gray-400 text-sm mt-1">
            {search || typeFilter || statusFilter
              ? "Try adjusting your filters"
              : "Generate your first report to get started"}
          </p>
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Title
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Type
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Date Range
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Created
                  </th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {reports.map((report: Report) => {
                  const tc = typeConfig[report.type] || typeConfig.daily;
                  return (
                    <tr key={report.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <FileText className="w-5 h-5 text-gray-400 flex-shrink-0" />
                          <span className="text-sm font-medium text-gray-900">
                            {report.title}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${tc.color}`}>
                          {tc.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={report.status} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 text-sm text-gray-600">
                          <Calendar className="w-3.5 h-3.5 text-gray-400" />
                          <span>
                            {new Date(report.dateRange.from).toLocaleDateString()} - {new Date(report.dateRange.to).toLocaleDateString()}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 text-sm text-gray-500">
                          <Clock className="w-3.5 h-3.5 text-gray-400" />
                          <span>
                            {new Date(report.createdAt).toLocaleString()}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {report.status === "completed" && (
                            <>
                              <button
                                onClick={() => downloadMutation.mutate({ id: report.id, format: "pdf" })}
                                disabled={downloadMutation.isPending}
                                className="p-2 text-gray-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors"
                                title="Download PDF"
                              >
                                <Download className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => downloadMutation.mutate({ id: report.id, format: "csv" })}
                                disabled={downloadMutation.isPending}
                                className="p-2 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                                title="Download CSV"
                              >
                                <Download className="w-4 h-4" />
                              </button>
                            </>
                          )}
                          <button
                            onClick={() => {
                              setDeleteError("");
                              setDeleteTarget(report);
                            }}
                            disabled={deleteMutation.isPending}
                            className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title="Delete report"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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

      {showGenerate && (
        <GenerateReportDialog onClose={() => setShowGenerate(false)} />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Report"
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

function StatusBadge({ status }: { status: Report["status"] }) {
  const config = {
    generating: {
      icon: Loader2,
      bg: "bg-yellow-100 text-yellow-700",
      label: "Generating",
    },
    completed: {
      icon: CheckCircle2,
      bg: "bg-green-100 text-green-700",
      label: "Completed",
    },
    failed: {
      icon: XCircle,
      bg: "bg-red-100 text-red-700",
      label: "Failed",
    },
  };

  const c = config[status];
  const Icon = c.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${c.bg}`}>
      <Icon className={`w-3 h-3 ${status === "generating" ? "animate-spin" : ""}`} />
      {c.label}
    </span>
  );
}

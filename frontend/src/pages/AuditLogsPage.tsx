import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Download,
  ListFilter,
  RefreshCw,
  ScrollText,
  Search,
} from "lucide-react";
import { auditLogService } from "@/services/auditLogs";
import AuditActionBadge from "@/components/AuditActionBadge";
import AuditStatusBadge from "@/components/AuditStatusBadge";
import { AuditLogStatsCards, AuditLogStatsSkeleton } from "@/components/AuditLogStatsCards";
import AuditLogCharts, { AuditLogChartsSkeleton } from "@/components/AuditLogCharts";
import AuditLogDetailsDrawer from "@/components/AuditLogDetailsDrawer";
import { AUDIT_ACTIONS } from "@/types";
import type { AuditLog, AuditLogAction, AuditLogStatus } from "@/types";
import { useAuth } from "@/hooks/useAuth";
import { hasPermission } from "@/utils/permissions";

const PAGE_SIZE = 15;

const modules = [
  "auth",
  "users",
  "cameras",
  "detections",
  "alerts",
  "models",
  "reports",
  "roles",
];

const sortableColumns = [
  { key: "timestamp", label: "Time" },
  { key: "username", label: "User" },
  { key: "module", label: "Module" },
  { key: "action", label: "Action" },
  { key: "status", label: "Status" },
];

function formatTime(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  });
}

function TableSkeleton() {
  return (
    <div className="card overflow-hidden p-0">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <tbody className="divide-y divide-gray-100 animate-pulse">
            {Array.from({ length: 8 }, (_, i) => (
              <tr key={i}>
                {Array.from({ length: 7 }, (__, j) => (
                  <td key={j} className="px-4 py-4">
                    <div className="h-4 bg-gray-200 rounded" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function downloadCSV(blob: Blob) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}

export default function AuditLogsPage() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState<"" | AuditLogAction>("");
  const [moduleFilter, setModuleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | AuditLogStatus>("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortBy, setSortBy] = useState("timestamp");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<AuditLog | null>(null);
  const [exporting, setExporting] = useState(false);

  const canRead = hasPermission(user, "audit.read");
  const canExport = hasPermission(user, "audit.export");

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: [
      "audit-logs",
      { search, actionFilter, moduleFilter, statusFilter, dateFrom, dateTo, sortBy, sortOrder, page },
    ],
    queryFn: () =>
      auditLogService.getAll({
        page,
        limit: PAGE_SIZE,
        search: search || undefined,
        action: actionFilter || undefined,
        module: moduleFilter || undefined,
        status: statusFilter || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        sortBy,
        sortOrder,
      }),
    refetchInterval: 15000,
  });

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["audit-logs", "stats"],
    queryFn: () => auditLogService.getStats(),
    refetchInterval: 30000,
  });

  const { data: chartData, isLoading: chartsLoading } = useQuery({
    queryKey: ["audit-logs", "charts"],
    queryFn: () => auditLogService.getChartData(),
    refetchInterval: 60000,
  });

  const logs = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, data?.totalPages ?? 1);

  const handleSort = (key: string) => {
    if (sortBy === key) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(key);
      setSortOrder("asc");
    }
    setPage(1);
  };

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const blob = await auditLogService.exportCSV({
        search: search || undefined,
        action: actionFilter || undefined,
        module: moduleFilter || undefined,
        status: statusFilter || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      });
      downloadCSV(blob);
    } finally {
      setExporting(false);
    }
  }, [search, actionFilter, moduleFilter, statusFilter, dateFrom, dateTo]);

  const resetFilters = () => {
    setSearch("");
    setActionFilter("");
    setModuleFilter("");
    setStatusFilter("");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  };

  const hasActiveFilters = Boolean(
    search || actionFilter || moduleFilter || statusFilter || dateFrom || dateTo,
  );

  const SortIcon = ({ column }: { column: string }) => {
    if (sortBy !== column) return <ArrowUpDown className="w-3.5 h-3.5 text-gray-300" />;
    return sortOrder === "asc" ? (
      <ArrowUp className="w-3.5 h-3.5 text-brand-600" />
    ) : (
      <ArrowDown className="w-3.5 h-3.5 text-brand-600" />
    );
  };

  const selectClasses = "input text-sm py-2";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Audit Logs</h1>
          <p className="text-sm text-gray-500 mt-1">
            Complete history of actions taken across the platform
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => refetch()}
            className="btn-secondary text-sm flex items-center gap-2"
            disabled={isFetching}
          >
            <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
            {isFetching ? "Refreshing…" : "Refresh"}
          </button>
          {canExport && (
            <button
              onClick={handleExport}
              disabled={exporting}
              className="btn-primary text-sm flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              {exporting ? "Exporting…" : "Export CSV"}
            </button>
          )}
        </div>
      </div>

      {statsLoading || !stats ? <AuditLogStatsSkeleton /> : <AuditLogStatsCards stats={stats} />}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <ListFilter className="w-4 h-4" />
          <span>Auto-refreshes every 15 seconds</span>
        </div>
      </div>

      <div className="card p-4 space-y-3">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search user, email, description, module..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="input pl-10"
            />
          </div>

          <select
            value={actionFilter}
            onChange={(e) => {
              setActionFilter(e.target.value as "" | AuditLogAction);
              setPage(1);
            }}
            className={selectClasses}
            aria-label="Filter by action"
          >
            <option value="">All Actions</option>
            {AUDIT_ACTIONS.map((action) => (
              <option key={action} value={action}>
                {action.replace(/_/g, " ")}
              </option>
            ))}
          </select>

          <select
            value={moduleFilter}
            onChange={(e) => {
              setModuleFilter(e.target.value);
              setPage(1);
            }}
            className={selectClasses}
            aria-label="Filter by module"
          >
            <option value="">All Modules</option>
            {modules.map((module) => (
              <option key={module} value={module}>
                {module.charAt(0).toUpperCase() + module.slice(1)}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as "" | AuditLogStatus);
              setPage(1);
            }}
            className={selectClasses}
            aria-label="Filter by status"
          >
            <option value="">All Status</option>
            <option value="success">Success</option>
            <option value="failed">Failed</option>
          </select>

          <input
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              setPage(1);
            }}
            className="input text-sm py-2"
            aria-label="From date"
          />

          <input
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              setPage(1);
            }}
            className="input text-sm py-2"
            aria-label="To date"
          />

          {hasActiveFilters && (
            <button
              onClick={resetFilters}
              className="text-sm text-brand-600 hover:text-brand-700 font-medium"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <TableSkeleton />
      ) : isError ? (
        <div className="card text-center py-12">
          <ScrollText className="w-12 h-12 text-red-300 mx-auto mb-3" />
          <p className="text-gray-700 font-medium">Failed to load audit logs</p>
          <p className="text-gray-400 text-sm mt-1">
            Check your connection and try again
          </p>
          <button
            onClick={() => refetch()}
            className="btn-primary mt-4 inline-flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            Retry
          </button>
        </div>
      ) : logs.length === 0 ? (
        <div className="card text-center py-12">
          <ScrollText className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">No audit logs found</p>
          <p className="text-gray-400 text-sm mt-1">
            {hasActiveFilters
              ? "Try adjusting your search or filters"
              : "Actions will appear here as they happen across the platform"}
          </p>
        </div>
      ) : (
        <div className="card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {sortableColumns.map((col) => (
                    <th
                      key={col.key}
                      scope="col"
                      onClick={() => handleSort(col.key)}
                      className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider cursor-pointer select-none hover:text-brand-600 transition-colors"
                    >
                      <span className="inline-flex items-center gap-1">
                        {col.label}
                        <SortIcon column={col.key} />
                      </span>
                    </th>
                  ))}
                  <th
                    scope="col"
                    className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider"
                  >
                    Description
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider"
                  >
                    IP Address
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {logs.map((log) => (
                  <tr
                    key={log.id}
                    onClick={() => setSelected(log)}
                    className="hover:bg-gray-50 transition-colors cursor-pointer"
                  >
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">
                      {formatTime(log.timestamp)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="min-w-[140px]">
                        <p className="text-sm font-medium text-gray-900">
                          {log.username || "System"}
                        </p>
                        <p className="text-xs text-gray-500 truncate max-w-[160px]">
                          {log.email || "—"}
                        </p>
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-gray-100 text-gray-700 text-xs font-medium">
                        {log.module}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <AuditActionBadge action={log.action} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <AuditStatusBadge status={log.status} />
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 max-w-[280px]">
                      <p className="truncate">{log.description}</p>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 font-mono">
                      {log.ipAddress || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-gray-100 bg-gray-50">
            <p className="text-sm text-gray-500">
              Showing{" "}
              <span className="font-medium text-gray-700">
                {total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}–
                {Math.min(page * PAGE_SIZE, total)}
              </span>{" "}
              of <span className="font-medium text-gray-700">{total}</span> audit logs
            </p>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="p-2 rounded-lg bg-white border border-gray-200 text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label="Previous page"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
                .reduce<Array<number | "...">>((acc, p, idx, arr) => {
                  if (idx > 0 && p - (arr[idx - 1] as number) > 1) {
                    acc.push("...");
                  }
                  acc.push(p);
                  return acc;
                }, [])
                .map((p, idx) =>
                  p === "..." ? (
                    <span key={`gap-${idx}`} className="px-1.5 text-gray-400 select-none">
                      …
                    </span>
                  ) : (
                    <button
                      key={p}
                      onClick={() => setPage(p)}
                      className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors ${
                        page === p
                          ? "bg-brand-600 text-white"
                          : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-100"
                      }`}
                    >
                      {p}
                    </button>
                  ),
                )}
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="p-2 rounded-lg bg-white border border-gray-200 text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label="Next page"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {chartsLoading || !chartData ? (
        <AuditLogChartsSkeleton />
      ) : (
        <AuditLogCharts data={chartData} />
      )}

      {!canRead && (
        <div className="card text-center py-8">
          <p className="text-gray-500 text-sm">
            You do not have permission to view audit logs. Contact your administrator.
          </p>
        </div>
      )}

      <AuditLogDetailsDrawer log={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

import { useState, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { detectionService } from "@/services/detections";
import { cameraService } from "@/services/cameras";
import DetectionImagePreview from "@/components/DetectionImagePreview";
import DetectionDetailsDrawer from "@/components/DetectionDetailsDrawer";
import type { Detection, DetectionFilters } from "@/types";
import {
  Search,
  Download,
  RefreshCw,
  X,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Eye,
  Maximize2,
} from "lucide-react";

const statusColors = {
  critical: "bg-red-100 text-red-800 border-red-200",
  warning: "bg-yellow-100 text-yellow-800 border-yellow-200",
  info: "bg-blue-100 text-blue-800 border-blue-200",
};

const PAGE_SIZE = 20;

export default function DetectionsPage() {
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<DetectionFilters>({});
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [selectedDetection, setSelectedDetection] = useState<Detection | null>(null);
  const [sortBy, setSortBy] = useState<string>("timestamp");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const handleSort = (column: string) => {
    if (sortBy === column) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(column);
      setSortOrder("desc");
    }
    setPage(1);
  };

  const queryFilters = useMemo(
    () => ({
      ...filters,
      page,
      limit: PAGE_SIZE,
      sortBy,
      sortOrder,
    }),
    [filters, page, sortBy, sortOrder],
  );

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["detections", queryFilters],
    queryFn: () => detectionService.getAll(queryFilters),
    refetchInterval: autoRefresh ? 10000 : false,
  });

  const { data: camerasData } = useQuery({
    queryKey: ["cameras"],
    queryFn: () => cameraService.getAll({ limit: 100 }),
  });
  const cameras = camerasData?.data ?? [];

  const updateFilter = useCallback(
    (key: keyof DetectionFilters, value: string | undefined) => {
      setFilters((prev) => ({ ...prev, [key]: value || undefined }));
      setPage(1);
    },
    [],
  );

  const clearFilters = useCallback(() => {
    setFilters({});
    setPage(1);
  }, []);

  const hasActiveFilters = Object.values(filters).some((v) => v !== undefined);

  const handleExportCSV = async () => {
    try {
      const blob = await detectionService.exportCSV(filters);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `detections-${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      console.error("Failed to export CSV");
    }
  };

  const handleDownloadSnapshot = (detection: Detection) => {
    const a = document.createElement("a");
    a.href = detection.imageUrl;
    a.download = `detection-${detection.label.replace(/\s+/g, "-").toLowerCase()}.jpg`;
    a.target = "_blank";
    a.click();
  };

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Detection History</h2>
          <p className="text-gray-500 mt-1">
            View and manage all security detection events
          </p>
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded border-gray-300 text-brand-600 focus:ring-brand-500"
            />
            <RefreshCw
              className={`w-4 h-4 ${autoRefresh ? "text-brand-600" : "text-gray-400"}`}
            />
            Auto-refresh
          </label>

          <div className="h-6 w-px bg-gray-200" />

          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="btn-secondary text-sm flex items-center gap-1.5"
          >
            <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </button>

          <button
            onClick={handleExportCSV}
            className="btn-primary text-sm flex items-center gap-1.5"
          >
            <Download className="w-4 h-4" />
            Export CSV
          </button>
        </div>
      </div>

      <div className="card p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search detector type..."
              value={filters.search || ""}
              onChange={(e) => updateFilter("search", e.target.value)}
              className="input pl-9 text-sm"
            />
          </div>

          <div>
            <input
              type="date"
              value={filters.dateFrom || ""}
              onChange={(e) => updateFilter("dateFrom", e.target.value)}
              className="input text-sm"
              title="From date"
            />
          </div>

          <div>
            <input
              type="date"
              value={filters.dateTo || ""}
              onChange={(e) => updateFilter("dateTo", e.target.value)}
              className="input text-sm"
              title="To date"
            />
          </div>

          <div>
            <select
              value={filters.cameraId || ""}
              onChange={(e) => updateFilter("cameraId", e.target.value)}
              className="input text-sm"
            >
              <option value="">All Cameras</option>
              {cameras?.map((camera) => (
                <option key={camera.id} value={camera.id}>
                  {camera.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-2">
            <input
              type="number"
              placeholder="Min conf"
              value={filters.confidenceMin || ""}
              onChange={(e) => updateFilter("confidenceMin", e.target.value)}
              min="0"
              max="1"
              step="0.01"
              className="input text-sm w-20"
            />
            <input
              type="number"
              placeholder="Max conf"
              value={filters.confidenceMax || ""}
              onChange={(e) => updateFilter("confidenceMax", e.target.value)}
              min="0"
              max="1"
              step="0.01"
              className="input text-sm w-20"
            />
          </div>

          <select
            value={filters.status || ""}
            onChange={(e) => updateFilter("status", e.target.value)}
            className="input text-sm"
          >
            <option value="">All Status</option>
            <option value="critical">Critical</option>
            <option value="warning">Warning</option>
            <option value="info">Info</option>
          </select>
        </div>

        {hasActiveFilters && (
          <div className="flex items-center gap-2 pt-1">
            <span className="text-xs text-gray-500">Active filters:</span>
            <button
              onClick={clearFilters}
              className="text-xs text-brand-600 hover:text-brand-700 flex items-center gap-1"
            >
              <X className="w-3 h-3" />
              Clear all
            </button>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
        </div>
      ) : (
        <>
          <div className="card p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider w-16">
                      Image
                    </th>
                    <Th
                      label="Detector Type"
                      sortable
                      column="label"
                      sortBy={sortBy}
                      sortOrder={sortOrder}
                      onSort={handleSort}
                    />
                    <Th
                      label="Camera"
                      sortable
                      column="cameraId"
                      sortBy={sortBy}
                      sortOrder={sortOrder}
                      onSort={handleSort}
                    />
                    <Th
                      label="Confidence"
                      sortable
                      column="confidence"
                      sortBy={sortBy}
                      sortOrder={sortOrder}
                      onSort={handleSort}
                    />
                    <Th
                      label="Status"
                      sortable
                      column="status"
                      sortBy={sortBy}
                      sortOrder={sortOrder}
                      onSort={handleSort}
                    />
                    <Th
                      label="Timestamp"
                      sortable
                      column="timestamp"
                      sortBy={sortBy}
                      sortOrder={sortOrder}
                      onSort={handleSort}
                    />
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider w-24">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {data?.data.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-12 text-center text-gray-500">
                        <div className="flex flex-col items-center gap-2">
                          <Search className="w-8 h-8 text-gray-300" />
                          <p className="font-medium">No detections found</p>
                          <p className="text-sm">Try adjusting your filters</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    data?.data.map((detection) => (
                      <tr
                        key={detection.id}
                        className="hover:bg-gray-50 transition-colors cursor-pointer"
                        onClick={() => setSelectedDetection(detection)}
                      >
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => setPreviewImage(detection.imageUrl)}
                            className="w-12 h-9 rounded-md overflow-hidden bg-gray-100 flex-shrink-0 hover:ring-2 hover:ring-brand-500 transition-all"
                          >
                            <img
                              src={detection.imageUrl}
                              alt={detection.label}
                              className="w-full h-full object-cover"
                            />
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm font-medium text-gray-900">
                            {detection.label}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm text-gray-600">
                            {detection.cameraName}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${
                                  detection.confidence >= 0.8
                                    ? "bg-green-500"
                                    : detection.confidence >= 0.5
                                      ? "bg-yellow-500"
                                      : "bg-red-500"
                                }`}
                                style={{ width: `${detection.confidence * 100}%` }}
                              />
                            </div>
                            <span className="text-sm text-gray-600 w-10 text-right">
                              {(detection.confidence * 100).toFixed(0)}%
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium border ${statusColors[detection.status]}`}
                          >
                            {detection.status}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm text-gray-500">
                            {new Date(detection.timestamp).toLocaleString()}
                          </span>
                        </td>
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => setSelectedDetection(detection)}
                              className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
                              title="View details"
                            >
                              <Eye className="w-4 h-4 text-gray-500" />
                            </button>
                            <button
                              onClick={() => setPreviewImage(detection.imageUrl)}
                              className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
                              title="Preview image"
                            >
                              <Maximize2 className="w-4 h-4 text-gray-500" />
                            </button>
                            <button
                              onClick={() => handleDownloadSnapshot(detection)}
                              className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
                              title="Download snapshot"
                            >
                              <Download className="w-4 h-4 text-gray-500" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">
              Showing {data ? Math.min((page - 1) * PAGE_SIZE + 1, data.total) : 0}-
              {data ? Math.min(page * PAGE_SIZE, data.total) : 0} of {data?.total ?? 0} detections
            </p>

            {totalPages > 1 && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="btn-secondary text-sm px-3 py-1.5 disabled:opacity-50"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>

                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNum: number;
                  if (totalPages <= 5) {
                    pageNum = i + 1;
                  } else if (page <= 3) {
                    pageNum = i + 1;
                  } else if (page >= totalPages - 2) {
                    pageNum = totalPages - 4 + i;
                  } else {
                    pageNum = page - 2 + i;
                  }
                  return (
                    <button
                      key={pageNum}
                      onClick={() => setPage(pageNum)}
                      className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                        page === pageNum
                          ? "bg-brand-600 text-white"
                          : "text-gray-600 hover:bg-gray-100"
                      }`}
                    >
                      {pageNum}
                    </button>
                  );
                })}

                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={page >= totalPages}
                  className="btn-secondary text-sm px-3 py-1.5 disabled:opacity-50"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {previewImage && (
        <DetectionImagePreview
          src={previewImage}
          label={selectedDetection?.label || "Detection"}
          onClose={() => setPreviewImage(null)}
        />
      )}

      <DetectionDetailsDrawer
        detection={selectedDetection}
        onClose={() => setSelectedDetection(null)}
        onPreview={(src) => {
          setSelectedDetection(null);
          setPreviewImage(src);
        }}
      />
    </div>
  );
}

function Th({
  label,
  sortable,
  column,
  sortBy,
  sortOrder,
  onSort,
}: {
  label: string;
  sortable?: boolean;
  column: string;
  sortBy: string;
  sortOrder: "asc" | "desc";
  onSort: (column: string) => void;
}) {
  const isActive = sortBy === column;
  return (
    <th
      className={`text-left px-4 py-3 text-xs font-medium uppercase tracking-wider ${
        sortable ? "cursor-pointer select-none hover:bg-gray-100" : ""
      } ${isActive ? "text-brand-600" : "text-gray-500"}`}
      onClick={() => sortable && onSort(column)}
    >
      <div className="flex items-center gap-1">
        {label}
        {sortable && (
          <div className="flex flex-col">
            <ChevronUp
              className={`w-2.5 h-2.5 -mb-1 ${
                isActive && sortOrder === "asc" ? "text-brand-600" : "text-gray-300"
              }`}
            />
            <ChevronDown
              className={`w-2.5 h-2.5 ${
                isActive && sortOrder === "desc" ? "text-brand-600" : "text-gray-300"
              }`}
            />
          </div>
        )}
      </div>
    </th>
  );
}
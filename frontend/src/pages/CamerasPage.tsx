import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { cameraService } from "@/services/cameras";
import type { Camera } from "@/types";
import { AddCameraDialog, EditCameraDialog, DeleteCameraDialog } from "@/components/CameraDialogs";
import { CameraPreview } from "@/components/CameraPreview";
import {
  Plus,
  Search,
  Monitor,
  Edit3,
  Trash2,
  Play,
  Square,
  Activity,
  Loader2,
} from "lucide-react";
import { showToast } from "@/components/Toast";

const statusConfig = {
  online: { dot: "bg-green-500", bg: "bg-green-100 text-green-800", label: "Online" },
  offline: { dot: "bg-gray-400", bg: "bg-gray-100 text-gray-800", label: "Offline" },
  connecting: { dot: "bg-yellow-500 animate-pulse", bg: "bg-yellow-100 text-yellow-800", label: "Connecting" },
  error: { dot: "bg-red-500", bg: "bg-red-100 text-red-800", label: "Error" },
};

const typeLabels: Record<string, string> = {
  usb: "USB Camera",
  rtsp: "RTSP Stream",
  ip: "IP Camera",
  video_file: "Video File",
};

export default function CamerasPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [page, setPage] = useState(1);
  const [addOpen, setAddOpen] = useState(false);
  const [editCamera, setEditCamera] = useState<Camera | null>(null);
  const [deleteCamera, setDeleteCamera] = useState<Camera | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["cameras", search, statusFilter, typeFilter, page],
    queryFn: () =>
      cameraService.getAll({
        search: search || undefined,
        status: (statusFilter || undefined) as any,
        cameraType: (typeFilter || undefined) as any,
        page,
        limit: 12,
      }),
  });

  const startMutation = useMutation({
    mutationFn: (id: string) => cameraService.start(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cameras"] });
      showToast({ severity: "info", title: "Camera started", message: "Camera is connecting..." });
    },
    onError: (err: any) => {
      showToast({ severity: "critical", title: "Failed to start", message: err.response?.data?.error || err.message });
    },
  });

  const stopMutation = useMutation({
    mutationFn: (id: string) => cameraService.stop(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cameras"] });
      showToast({ severity: "info", title: "Camera stopped", message: "Camera has been disconnected" });
    },
    onError: (err: any) => {
      showToast({ severity: "critical", title: "Failed to stop", message: err.response?.data?.error || err.message });
    },
  });

  const healthMutation = useMutation({
    mutationFn: (id: string) => cameraService.healthCheck(id),
    onSuccess: (camera) => {
      queryClient.invalidateQueries({ queryKey: ["cameras"] });
      showToast({
        severity: camera.isHealthy ? "info" : "warning",
        title: camera.isHealthy ? "Camera healthy" : "Camera unhealthy",
        message: camera.isHealthy ? "Health check passed" : "Health check failed",
      });
    },
    onError: (err: any) => {
      showToast({ severity: "critical", title: "Health check failed", message: err.response?.data?.error || err.message });
    },
  });

  const handleRefresh = (id: string) => {
    healthMutation.mutate(id);
  };

  const cameras = data?.data ?? [];
  const totalPages = data?.totalPages ?? 1;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Cameras</h2>
          <p className="text-gray-500 mt-1">Manage your camera feeds</p>
        </div>
        <button onClick={() => setAddOpen(true)} className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" />
          Add Camera
        </button>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search cameras..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="input pl-10"
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="input w-auto min-w-[140px]"
        >
          <option value="">All Status</option>
          <option value="online">Online</option>
          <option value="offline">Offline</option>
          <option value="connecting">Connecting</option>
          <option value="error">Error</option>
        </select>

        <select
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
          className="input w-auto min-w-[160px]"
        >
          <option value="">All Types</option>
          <option value="usb">USB Camera</option>
          <option value="rtsp">RTSP Stream</option>
          <option value="ip">IP Camera</option>
          <option value="video_file">Video File</option>
        </select>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-brand-600" />
        </div>
      ) : cameras.length === 0 ? (
        <div className="text-center py-16">
          <Monitor className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-500">No cameras found</h3>
          <p className="text-gray-400 mt-1">Try adjusting your search or filters</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {cameras.map((camera) => {
              const status = statusConfig[camera.status];
              return (
                <CameraCard
                  key={camera.id}
                  camera={camera}
                  status={status}
                  onEdit={() => setEditCamera(camera)}
                  onDelete={() => setDeleteCamera(camera)}
                  onStart={() => startMutation.mutate(camera.id)}
                  onStop={() => stopMutation.mutate(camera.id)}
                  onHealthCheck={() => handleRefresh(camera.id)}
                  isStarting={startMutation.isPending}
                  isStopping={stopMutation.isPending}
                  isChecking={healthMutation.isPending}
                />
              );
            })}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-4">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="btn-secondary text-sm"
              >
                Previous
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    p === page
                      ? "bg-brand-600 text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  {p}
                </button>
              ))}
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="btn-secondary text-sm"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}

      <AddCameraDialog open={addOpen} onClose={() => setAddOpen(false)} />
      {editCamera && (
        <EditCameraDialog open={!!editCamera} onClose={() => setEditCamera(null)} camera={editCamera} />
      )}
      {deleteCamera && (
        <DeleteCameraDialog open={!!deleteCamera} onClose={() => setDeleteCamera(null)} camera={deleteCamera} />
      )}
    </div>
  );
}

function CameraCard({
  camera,
  status,
  onEdit,
  onDelete,
  onStart,
  onStop,
  onHealthCheck,
  isStarting,
  isStopping,
  isChecking,
}: {
  camera: Camera;
  status: { dot: string; bg: string; label: string };
  onEdit: () => void;
  onDelete: () => void;
  onStart: () => void;
  onStop: () => void;
  onHealthCheck: () => void;
  isStarting: boolean;
  isStopping: boolean;
  isChecking: boolean;
}) {
  const isLive = camera.status === "online";

  return (
    <div className="card hover:shadow-md transition-shadow">
      <div className="mb-4">
        <CameraPreview camera={camera} />
      </div>

      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold text-gray-900 truncate flex items-center gap-2">
          {camera.name}
          <span className={`inline-block w-2 h-2 rounded-full ${camera.isHealthy ? "bg-green-500" : "bg-red-500"}`} title={camera.isHealthy ? "Healthy" : "Unhealthy"} />
        </h3>
        <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full ${status.bg}`}>
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${status.dot}`} />
          {status.label}
        </span>
      </div>

      <div className="space-y-1 text-sm">
        {camera.location && <p className="text-gray-500 truncate">{camera.location}</p>}
        <p className="text-gray-400">
          {typeLabels[camera.cameraType] || camera.cameraType}
          {camera.fps ? ` \u00B7 ${camera.fps} FPS` : ""}
        </p>
        <p className="text-gray-400">
          Last seen: {new Date(camera.lastSeen).toLocaleString()}
        </p>
      </div>

      <div className="flex gap-2 mt-4 pt-4 border-t border-gray-100">
        {isLive ? (
          <button
            onClick={onStop}
            disabled={isStopping}
            className="flex-1 text-sm py-1.5 px-3 rounded-lg bg-red-50 text-red-700 hover:bg-red-100 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {isStopping ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Square className="w-3.5 h-3.5" />}
            Stop
          </button>
        ) : (
          <button
            onClick={onStart}
            disabled={isStarting}
            className="flex-1 text-sm py-1.5 px-3 rounded-lg bg-green-50 text-green-700 hover:bg-green-100 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {isStarting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            Start
          </button>
        )}

        <button
          onClick={onHealthCheck}
          disabled={isChecking}
          className="text-sm py-1.5 px-3 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
          title="Health check"
        >
          <Activity className={`w-3.5 h-3.5 ${isChecking ? "animate-spin" : ""}`} />
        </button>

        <button
          onClick={onEdit}
          className="text-sm py-1.5 px-3 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors flex items-center justify-center"
          title="Edit camera"
        >
          <Edit3 className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={onDelete}
          className="text-sm py-1.5 px-3 rounded-lg bg-gray-100 text-gray-600 hover:bg-red-100 hover:text-red-600 transition-colors flex items-center justify-center"
          title="Delete camera"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

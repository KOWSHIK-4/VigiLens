import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { cameraService } from "@/services/cameras";
import type { Camera } from "@/types";
import {
  Plus,
  Search,
  Monitor,
  Video,
  Webcam,
  FileVideo,
} from "lucide-react";

const statusConfig = {
  online: { dot: "bg-green-500", bg: "bg-green-100 text-green-800", label: "Online" },
  offline: { dot: "bg-gray-400", bg: "bg-gray-100 text-gray-800", label: "Offline" },
  connecting: { dot: "bg-yellow-500 animate-pulse", bg: "bg-yellow-100 text-yellow-800", label: "Connecting" },
  error: { dot: "bg-red-500", bg: "bg-red-100 text-red-800", label: "Error" },
};

const typeIcons = {
  usb: Webcam,
  rtsp: Monitor,
  ip: Video,
  video_file: FileVideo,
};

const typeLabels = {
  usb: "USB Camera",
  rtsp: "RTSP Stream",
  ip: "IP Camera",
  video_file: "Video File",
};

export default function CamerasPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ["cameras", search, statusFilter, typeFilter, page],
    queryFn: () =>
      cameraService.getAll({
        search: search || undefined,
        status: statusFilter as any || undefined,
        cameraType: typeFilter as any || undefined,
        page,
        limit: 12,
      }),
  });

  const cameras = data?.data ?? [];
  const totalPages = data?.totalPages ?? 1;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Cameras</h2>
          <p className="text-gray-500 mt-1">Manage your camera feeds</p>
        </div>
        <button className="btn-primary flex items-center gap-2">
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

      {cameras.length === 0 ? (
        <div className="text-center py-16">
          <Monitor className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-500">No cameras found</h3>
          <p className="text-gray-400 mt-1">Try adjusting your search or filters</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {cameras.map((camera) => {
            const status = statusConfig[camera.status];
            const Icon = typeIcons[camera.cameraType];
            return (
              <CameraCard key={camera.id} camera={camera} status={status} Icon={Icon} />
            );
          })}
        </div>
      )}

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
    </div>
  );
}

function CameraCard({
  camera,
  status,
  Icon,
}: {
  camera: Camera;
  status: { dot: string; bg: string; label: string };
  Icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="card hover:shadow-md transition-shadow">
      <div className="aspect-video bg-gray-900 rounded-lg mb-4 flex items-center justify-center relative overflow-hidden">
        {camera.thumbnail ? (
          <img
            src={camera.thumbnail}
            alt={camera.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <Icon className="w-10 h-10 text-gray-600" />
        )}
        <span className="absolute top-2 right-2 text-xs font-medium px-2 py-0.5 rounded-full bg-black/60 text-white">
          {camera.resolution || "N/A"}
        </span>
      </div>

      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold text-gray-900 truncate">{camera.name}</h3>
        <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full ${status.bg}`}>
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${status.dot}`} />
          {status.label}
        </span>
      </div>

      <div className="space-y-1 text-sm">
        {camera.location && (
          <p className="text-gray-500 truncate">{camera.location}</p>
        )}
        <p className="text-gray-400">
          {typeLabels[camera.cameraType]}
          {camera.fps ? ` \u00B7 ${camera.fps} FPS` : ""}
        </p>
        <p className="text-gray-400">
          Last seen: {new Date(camera.lastSeen).toLocaleString()}
        </p>
      </div>

      <div className="flex gap-2 mt-4 pt-4 border-t border-gray-100">
        <button className="btn-primary flex-1 text-sm py-1.5">Start</button>
        <button className="btn-secondary flex-1 text-sm py-1.5">Edit</button>
      </div>
    </div>
  );
}

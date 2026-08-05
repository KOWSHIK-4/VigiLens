import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { X, Loader2, Camera as CameraIcon, Search, Save, VideoOff } from "lucide-react";
import { detectorService } from "@/services/detectors";
import { cameraService } from "@/services/cameras";
import { showToast } from "@/utils/toast";
import type { Camera, MarketplaceDetector } from "@/types";

interface DetectorCameraModalProps {
  detector: MarketplaceDetector | null;
  onClose: () => void;
}

function getErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    return (err.response?.data as { error?: string } | undefined)?.error ?? err.message;
  }
  return err instanceof Error ? err.message : "Something went wrong";
}

export default function DetectorCameraModal({
  detector,
  onClose,
}: DetectorCameraModalProps) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  const { data: camerasData, isLoading } = useQuery({
    queryKey: ["cameras", { page: 1, limit: 100 }],
    queryFn: () => cameraService.getAll({ page: 1, limit: 100 }),
  });

  useEffect(() => {
    setSelected(new Set());
    setSearch("");
  }, [detector]);

  const cameras = camerasData?.data ?? [];

  const filtered = useMemo(() => {
    const list = camerasData?.data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (c) => c.name.toLowerCase().includes(q) || (c.location ?? "").toLowerCase().includes(q),
    );
  }, [camerasData, search]);

  const mutation = useMutation({
    mutationFn: () => detectorService.assignCameras(detector!.id!, Array.from(selected)),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["detectors"] });
      onClose();
      showToast({
        severity: "info",
        title: "Cameras assigned",
        message: `${updated.name} is now monitoring ${updated.cameraCount} camera(s)`,
      });
    },
    onError: (err) => {
      showToast({
        severity: "critical",
        title: "Failed to assign cameras",
        message: getErrorMessage(err),
      });
    },
  });

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (!detector) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed top-0 right-0 z-50 h-full w-full max-w-md bg-white shadow-2xl flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Assign Cameras</h2>
            <p className="text-xs text-gray-500">
              Select feeds monitored by {detector.name}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="p-4 border-b border-gray-100">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search cameras..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input pl-10"
            />
          </div>
          <div className="flex items-center justify-between mt-2">
            <p className="text-xs text-gray-500">
              {selected.size} of {cameras.length} selected
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setSelected(new Set(cameras.map((c) => c.id)))}
                className="text-xs font-medium text-brand-600 hover:text-brand-700"
              >
                Select all
              </button>
              <button
                onClick={() => setSelected(new Set())}
                className="text-xs font-medium text-gray-500 hover:text-gray-700"
              >
                Clear
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {isLoading ? (
            <div className="flex items-center justify-center h-40">
              <Loader2 className="w-6 h-6 text-gray-400 animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12">
              <VideoOff className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-sm text-gray-500">No cameras found</p>
            </div>
          ) : (
            <div className="space-y-1">
              {filtered.map((camera: Camera) => (
                <label
                  key={camera.id}
                  className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                    selected.has(camera.id) ? "bg-brand-50" : "hover:bg-gray-50"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(camera.id)}
                    onChange={() => toggle(camera.id)}
                    className="w-4 h-4 rounded accent-brand-600"
                  />
                  <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                    <CameraIcon className="w-4 h-4 text-gray-500" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {camera.name}
                    </p>
                    <p className="text-xs text-gray-400 truncate">
                      {camera.location || camera.cameraType} · {camera.status}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary text-sm">
            Cancel
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="btn-primary inline-flex items-center gap-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {mutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            Save Assignment
          </button>
        </div>
      </div>
    </>
  );
}

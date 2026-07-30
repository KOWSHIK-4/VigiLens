import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { cameraService } from "@/services/cameras";
import type { Camera, CreateCameraInput, CameraType } from "@/types";
import { X, Loader2, AlertTriangle } from "lucide-react";

interface AddCameraDialogProps {
  open: boolean;
  onClose: () => void;
}

export function AddCameraDialog({ open, onClose }: AddCameraDialogProps) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<CreateCameraInput>({
    name: "",
    url: "",
    cameraType: "rtsp",
    location: "",
    resolution: "",
    fps: null,
    username: "",
    password: "",
  });
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: () => cameraService.create(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cameras"] });
      onClose();
    },
    onError: (err: any) => {
      setError(err.response?.data?.error || err.message || "Failed to create camera");
    },
  });

  useEffect(() => {
    if (open) {
      setForm({ name: "", url: "", cameraType: "rtsp", location: "", resolution: "", fps: null, username: "", password: "" });
      setError("");
    }
  }, [open]);

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.url.trim()) {
      setError("Name and URL are required");
      return;
    }
    setError("");
    mutation.mutate();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50 backdrop-enter" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 drawer-enter">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">Add Camera</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="input"
              placeholder="Main Entrance"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">URL *</label>
            <input
              type="text"
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              className="input"
              placeholder="rtsp://camera-stream or /dev/video0"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
              <select
                value={form.cameraType}
                onChange={(e) => setForm({ ...form, cameraType: e.target.value as CameraType })}
                className="input"
              >
                <option value="rtsp">RTSP Stream</option>
                <option value="usb">USB Camera</option>
                <option value="ip">IP Camera</option>
                <option value="video_file">Video File</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
              <input
                type="text"
                value={form.location || ""}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                className="input"
                placeholder="Building A, Floor 1"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Resolution</label>
              <input
                type="text"
                value={form.resolution || ""}
                onChange={(e) => setForm({ ...form, resolution: e.target.value })}
                className="input"
                placeholder="1920x1080"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">FPS</label>
              <input
                type="number"
                value={form.fps ?? ""}
                onChange={(e) => setForm({ ...form, fps: e.target.value ? parseInt(e.target.value) : null })}
                className="input"
                placeholder="30"
                min="1"
                max="120"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
              <input
                type="text"
                value={form.username || ""}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                className="input"
                placeholder="admin"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <input
                type="password"
                value={form.password || ""}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="input"
                placeholder="••••••••"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" disabled={mutation.isPending} className="btn-primary flex items-center gap-2">
              {mutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Add Camera
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface EditCameraDialogProps {
  open: boolean;
  onClose: () => void;
  camera: Camera;
}

export function EditCameraDialog({ open, onClose, camera }: EditCameraDialogProps) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<CreateCameraInput>({
    name: camera.name,
    url: camera.url,
    cameraType: camera.cameraType,
    location: camera.location || "",
    resolution: camera.resolution || "",
    fps: camera.fps,
    username: camera.username || "",
    password: "",
  });
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: () => cameraService.update(camera.id, form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cameras"] });
      onClose();
    },
    onError: (err: any) => {
      setError(err.response?.data?.error || err.message || "Failed to update camera");
    },
  });

  useEffect(() => {
    if (open) {
      setForm({
        name: camera.name,
        url: camera.url,
        cameraType: camera.cameraType,
        location: camera.location || "",
        resolution: camera.resolution || "",
        fps: camera.fps,
        username: camera.username || "",
        password: "",
      });
      setError("");
    }
  }, [open, camera]);

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.url.trim()) {
      setError("Name and URL are required");
      return;
    }
    setError("");
    mutation.mutate();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50 backdrop-enter" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 drawer-enter">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">Edit Camera</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="input"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">URL *</label>
            <input
              type="text"
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              className="input"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
              <select
                value={form.cameraType}
                onChange={(e) => setForm({ ...form, cameraType: e.target.value as CameraType })}
                className="input"
              >
                <option value="rtsp">RTSP Stream</option>
                <option value="usb">USB Camera</option>
                <option value="ip">IP Camera</option>
                <option value="video_file">Video File</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
              <input
                type="text"
                value={form.location || ""}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                className="input"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Resolution</label>
              <input
                type="text"
                value={form.resolution || ""}
                onChange={(e) => setForm({ ...form, resolution: e.target.value })}
                className="input"
                placeholder="1920x1080"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">FPS</label>
              <input
                type="number"
                value={form.fps ?? ""}
                onChange={(e) => setForm({ ...form, fps: e.target.value ? parseInt(e.target.value) : null })}
                className="input"
                min="1"
                max="120"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={mutation.isPending} className="btn-primary flex items-center gap-2">
              {mutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Save Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface DeleteCameraDialogProps {
  open: boolean;
  onClose: () => void;
  camera: Camera;
}

export function DeleteCameraDialog({ open, onClose, camera }: DeleteCameraDialogProps) {
  const queryClient = useQueryClient();
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: () => cameraService.remove(camera.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cameras"] });
      onClose();
    },
    onError: (err: any) => {
      setError(err.response?.data?.error || err.message || "Failed to delete camera");
    },
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50 backdrop-enter" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md mx-4 drawer-enter">
        <div className="p-6">
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 mb-4">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-5 h-5 text-red-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Delete Camera</h3>
              <p className="text-sm text-gray-500">
                Are you sure you want to delete <strong>{camera.name}</strong>? This action cannot be undone.
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button onClick={onClose} className="btn-secondary">Cancel</button>
            <button
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {mutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

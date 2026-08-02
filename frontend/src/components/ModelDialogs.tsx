import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { X, Loader2, AlertTriangle } from "lucide-react";
import { modelService } from "@/services/models";
import type { AIModel, CreateModelInput } from "@/types";

interface ModelFormDialogProps {
  open: boolean;
  onClose: () => void;
  model?: AIModel | null;
}

interface ModelFormState {
  name: string;
  version: string;
  detectorKey: string;
  description: string;
  confidenceThreshold: number;
  enabled: boolean;
  gpuSupported: boolean;
  modelPath: string;
}

const emptyForm: ModelFormState = {
  name: "",
  version: "",
  detectorKey: "",
  description: "",
  confidenceThreshold: 50,
  enabled: true,
  gpuSupported: false,
  modelPath: "",
};

function toForm(model: AIModel): ModelFormState {
  return {
    name: model.name,
    version: model.version,
    detectorKey: model.detectorKey,
    description: model.description,
    confidenceThreshold: model.confidenceThreshold,
    enabled: model.enabled,
    gpuSupported: model.gpuSupported,
    modelPath: model.modelPath,
  };
}

function getErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    return (err.response?.data as { error?: string } | undefined)?.error ?? err.message;
  }
  return err instanceof Error ? err.message : "Something went wrong";
}

function validate(form: ModelFormState, isEdit: boolean): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!form.name.trim()) errors.name = "Name is required";
  if (form.name.length > 100) errors.name = "Name must be 100 characters or less";
  if (!form.version.trim()) errors.version = "Version is required";
  if (form.version.length > 50) errors.version = "Version must be 50 characters or less";
  if (!isEdit && !form.detectorKey.trim()) {
    errors.detectorKey = "Detector key is required";
  }
  if (form.detectorKey.length > 100) {
    errors.detectorKey = "Detector key must be 100 characters or less";
  }
  if (!form.modelPath.trim()) errors.modelPath = "Model path is required";
  if (form.modelPath.length > 500) errors.modelPath = "Model path must be 500 characters or less";
  if (form.confidenceThreshold < 0 || form.confidenceThreshold > 100) {
    errors.confidenceThreshold = "Threshold must be between 0 and 100";
  }
  return errors;
}

function ModelFormDialog({ open, onClose, model }: ModelFormDialogProps) {
  const isEdit = Boolean(model);
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ModelFormState>(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState("");

  useEffect(() => {
    if (open) {
      setForm(model ? toForm(model) : emptyForm);
      setErrors({});
      setServerError("");
    }
  }, [open, model]);

  const mutation = useMutation({
    mutationFn: () => {
      const input: CreateModelInput = {
        name: form.name.trim(),
        version: form.version.trim(),
        description: form.description.trim(),
        detectorKey: form.detectorKey.trim(),
        confidenceThreshold: form.confidenceThreshold,
        enabled: form.enabled,
        gpuSupported: form.gpuSupported,
        modelPath: form.modelPath.trim(),
      };
      return isEdit && model
        ? modelService.update(model.id, input)
        : modelService.create(input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["models"] });
      onClose();
    },
    onError: (err) => {
      setServerError(getErrorMessage(err));
    },
  });

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const fieldErrors = validate(form, isEdit);
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length > 0) return;
    setServerError("");
    mutation.mutate();
  };

  const update = (updates: Partial<ModelFormState>) => {
    setForm((prev) => ({ ...prev, ...updates }));
    setErrors({});
    setServerError("");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50 backdrop-enter" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto drawer-enter">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 sticky top-0 bg-white">
          <h3 className="text-lg font-semibold text-gray-900">
            {isEdit ? "Edit Model" : "Add Model"}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {serverError && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              {serverError}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => update({ name: e.target.value })}
                className={`input ${errors.name ? "border-red-400 focus:ring-red-500" : ""}`}
                placeholder="Person Detection"
              />
              {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Version *</label>
              <input
                type="text"
                value={form.version}
                onChange={(e) => update({ version: e.target.value })}
                className={`input ${errors.version ? "border-red-400 focus:ring-red-500" : ""}`}
                placeholder="1.0.0"
              />
              {errors.version && <p className="text-xs text-red-500 mt-1">{errors.version}</p>}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Detector Key {isEdit ? "" : "*"}
            </label>
            <input
              type="text"
              value={form.detectorKey}
              onChange={(e) => update({ detectorKey: e.target.value })}
              disabled={isEdit}
              className={`input ${errors.detectorKey ? "border-red-400 focus:ring-red-500" : ""} ${
                isEdit ? "bg-gray-50 text-gray-500" : ""
              }`}
              placeholder="person"
            />
            {errors.detectorKey ? (
              <p className="text-xs text-red-500 mt-1">{errors.detectorKey}</p>
            ) : (
              <p className="text-xs text-gray-400 mt-1">
                {isEdit
                  ? "Detector key cannot be changed after creation"
                  : "Unique key used by the detection engine"}
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => update({ description: e.target.value })}
              rows={2}
              className="input resize-none"
              placeholder="Describe what this model detects"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Model Path *</label>
            <input
              type="text"
              value={form.modelPath}
              onChange={(e) => update({ modelPath: e.target.value })}
              className={`input font-mono text-sm ${errors.modelPath ? "border-red-400 focus:ring-red-500" : ""}`}
              placeholder="/models/person/yolo11n.pt"
            />
            {errors.modelPath && <p className="text-xs text-red-500 mt-1">{errors.modelPath}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Confidence Threshold: <span className="font-semibold text-gray-900">{form.confidenceThreshold}%</span>
            </label>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={form.confidenceThreshold}
              onChange={(e) => update({ confidenceThreshold: Number(e.target.value) })}
              className="w-full accent-brand-600"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="flex items-center justify-between gap-3 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
              <span className="text-sm font-medium text-gray-700">Enabled</span>
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => update({ enabled: e.target.checked })}
                className="w-4 h-4"
              />
            </label>
            <label className="flex items-center justify-between gap-3 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
              <span className="text-sm font-medium text-gray-700">GPU Supported</span>
              <input
                type="checkbox"
                checked={form.gpuSupported}
                onChange={(e) => update({ gpuSupported: e.target.checked })}
                className="w-4 h-4"
              />
            </label>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={mutation.isPending} className="btn-primary flex items-center gap-2">
              {mutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              {isEdit ? "Save Changes" : "Add Model"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface DeleteModelDialogProps {
  open: boolean;
  onClose: () => void;
  model: AIModel;
}

export function DeleteModelDialog({ open, onClose, model }: DeleteModelDialogProps) {
  const queryClient = useQueryClient();
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: () => modelService.remove(model.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["models"] });
      onClose();
    },
    onError: (err) => {
      setError(getErrorMessage(err));
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
              <h3 className="text-lg font-semibold text-gray-900">Delete Model</h3>
              <p className="text-sm text-gray-500">
                Are you sure you want to delete{" "}
                <strong>{model.name}</strong> v{model.version}? This action cannot be
                undone.
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

export function AddModelDialog(props: Omit<ModelFormDialogProps, "model">) {
  return <ModelFormDialog {...props} model={null} />;
}

export function EditModelDialog(props: ModelFormDialogProps) {
  return <ModelFormDialog {...props} />;
}

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { detectionService } from "@/services/detections";
import type { Detection } from "@/types";
import { getApiErrorMessage } from "@/utils/apiError";
import { X, Loader2, AlertTriangle } from "lucide-react";

interface DeleteDetectionDialogProps {
  open: boolean;
  onClose: () => void;
  detection: Detection | null;
}

export function DeleteDetectionDialog({ open, onClose, detection }: DeleteDetectionDialogProps) {
  const queryClient = useQueryClient();
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: () => detectionService.remove(detection!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["detections"] });
      onClose();
    },
    onError: (err: unknown) => {
      setError(getApiErrorMessage(err, "Failed to delete detection"));
    },
  });

  if (!open || !detection) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50 backdrop-enter" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md mx-4 drawer-enter">
        <div className="p-6">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>

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
              <h3 className="text-lg font-semibold text-gray-900">Delete Detection</h3>
              <p className="text-sm text-gray-500">
                Are you sure you want to delete <strong>{detection.label}</strong>? This action cannot be undone.
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

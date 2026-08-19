import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X, Loader2, Save } from "lucide-react";
import { detectorService } from "@/services/detectors";
import { showToast } from "@/utils/toast";
import { getApiErrorMessage } from "@/utils/apiError";
import type { MarketplaceDetector } from "@/types";

interface DetectorEditDialogProps {
  detector: MarketplaceDetector | null;
  onClose: () => void;
}

export default function DetectorEditDialog({
  detector,
  onClose,
}: DetectorEditDialogProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [version, setVersion] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (detector) {
      setName(detector.name);
      setVersion(detector.version);
      setDescription(detector.description);
    }
  }, [detector]);

  const mutation = useMutation({
    mutationFn: () =>
      detectorService.update(detector!.id!, {
        name: name.trim(),
        version: version.trim(),
        description: description.trim(),
      }),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["detectors"] });
      onClose();
      showToast({
        severity: "info",
        title: "Detector updated",
        message: `${updated.name} v${updated.version}`,
      });
    },
    onError: (err) => {
      showToast({
        severity: "critical",
        title: "Failed to update detector",
        message: getApiErrorMessage(err),
      });
    },
  });

  if (!detector) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed top-0 right-0 z-50 h-full w-full max-w-md bg-white shadow-2xl overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Edit Detector</h2>
            <p className="text-xs text-gray-500">{detector.key}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Detector name"
              className="input"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Version
            </label>
            <input
              type="text"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="e.g. 2.4.0"
              className="input"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="input resize-none"
            />
          </div>
        </div>

        <div className="sticky bottom-0 bg-white border-t border-gray-200 px-6 py-4 flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary text-sm">
            Cancel
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !name.trim() || !version.trim()}
            className="btn-primary inline-flex items-center gap-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {mutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            Save
          </button>
        </div>
      </div>
    </>
  );
}

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X, Loader2, Gauge, BellRing, Clock, Cpu, Save } from "lucide-react";
import { detectorService } from "@/services/detectors";
import { showToast } from "@/utils/toast";
import { getApiErrorMessage } from "@/utils/apiError";
import type { MarketplaceDetector, ProcessorPreference } from "@/types";

interface DetectorConfigDialogProps {
  detector: MarketplaceDetector | null;
  onClose: () => void;
}

const intervalOptions = [
  { value: 500, label: "500 ms" },
  { value: 1000, label: "1 second" },
  { value: 2000, label: "2 seconds" },
  { value: 5000, label: "5 seconds" },
  { value: 10000, label: "10 seconds" },
  { value: 30000, label: "30 seconds" },
  { value: 60000, label: "1 minute" },
];

const cooldownOptions = [
  { value: 0, label: "Off (no cooldown)" },
  { value: 5000, label: "5 seconds" },
  { value: 15000, label: "15 seconds" },
  { value: 30000, label: "30 seconds" },
  { value: 60000, label: "1 minute" },
  { value: 300000, label: "5 minutes" },
];

function intervalToOption(ms: number | null): number {
  if (!ms) return 5000;
  for (const opt of intervalOptions) {
    if (ms <= opt.value) return opt.value;
  }
  return 60000;
}

function cooldownToOption(ms: number | null): number {
  if (ms == null) return 30000;
  if (ms <= 0) return 0;
  for (const opt of cooldownOptions) {
    if (ms <= opt.value) return opt.value;
  }
  return 300000;
}

export default function DetectorConfigDialog({
  detector,
  onClose,
}: DetectorConfigDialogProps) {
  const queryClient = useQueryClient();
  const [threshold, setThreshold] = useState(50);
  const [severity, setSeverity] = useState<"info" | "warning" | "critical">("info");
  const [intervalMs, setIntervalMs] = useState(5000);
  const [cooldownMs, setCooldownMs] = useState(30000);
  const [processor, setProcessor] = useState<ProcessorPreference>("auto");

  useEffect(() => {
    if (detector) {
      setThreshold(detector.confidenceThreshold ?? detector.defaultConfidenceThreshold);
      setSeverity(detector.alertSeverity ?? "info");
      setIntervalMs(intervalToOption(detector.detectionIntervalMs));
      setCooldownMs(cooldownToOption(detector.alertCooldownMs));
      setProcessor(detector.preferredProcessor ?? "auto");
    }
  }, [detector]);

  const mutation = useMutation({
    mutationFn: () =>
      detectorService.updateSettings(detector!.id!, {
        confidenceThreshold: threshold,
        alertSeverity: severity,
        detectionIntervalMs: intervalMs,
        alertCooldownMs: cooldownMs,
        preferredProcessor: processor,
      }),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["detectors"] });
      onClose();
      showToast({
        severity: "info",
        title: "Configuration saved",
        message: `${updated.name} configuration updated`,
      });
    },
    onError: (err) => {
      showToast({
        severity: "critical",
        title: "Failed to save configuration",
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
            <h2 className="text-lg font-semibold text-gray-900">Configure Detector</h2>
            <p className="text-xs text-gray-500">{detector.name}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
                <Gauge className="w-4 h-4 text-brand-600" />
                Confidence Threshold
              </label>
              <span className="text-sm font-semibold text-gray-900 tabular-nums">
                {threshold}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              className="w-full accent-brand-600"
              aria-label="Confidence threshold"
            />
            <p className="text-xs text-gray-400 mt-1">
              Detections below this confidence are ignored.
            </p>
          </div>

          <div>
            <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1.5">
              <BellRing className="w-4 h-4 text-brand-600" />
              Alert Severity
            </label>
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value as "info" | "warning" | "critical")}
              className="input"
            >
              <option value="info">Info</option>
              <option value="warning">Warning</option>
              <option value="critical">Critical</option>
            </select>
          </div>

          <div>
            <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1.5">
              <Clock className="w-4 h-4 text-brand-600" />
              Detection Interval
            </label>
            <select
              value={intervalMs}
              onChange={(e) => setIntervalMs(Number(e.target.value))}
              className="input"
            >
              {intervalOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  Every {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1.5">
              <BellRing className="w-4 h-4 text-brand-600" />
              Alert Cooldown
            </label>
            <select
              value={cooldownMs}
              onChange={(e) => setCooldownMs(Number(e.target.value))}
              className="input"
            >
              {cooldownOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-400 mt-1">
              Minimum time between alerts for the same detector to prevent alert storms.
            </p>
          </div>

          <div>
            <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1.5">
              <Cpu className="w-4 h-4 text-brand-600" />
              Processor Preference
            </label>
            <select
              value={processor}
              onChange={(e) => setProcessor(e.target.value as ProcessorPreference)}
              className="input"
            >
              <option value="auto">Auto (recommended)</option>
              <option value="gpu">GPU</option>
              <option value="cpu">CPU only</option>
            </select>
            <p className="text-xs text-gray-400 mt-1">
              GPU preference requires a hardware accelerator; auto picks the best available.
            </p>
          </div>
        </div>

        <div className="sticky bottom-0 bg-white border-t border-gray-200 px-6 py-4 flex justify-end gap-2">
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
            Save Changes
          </button>
        </div>
      </div>
    </>
  );
}

import { useEffect, useState } from "react";
import {
  Brain,
  Cpu,
  Gauge,
  Play,
  Power,
  PowerOff,
  RefreshCw,
  Zap,
} from "lucide-react";
import type { AIModel } from "@/types";
import ModelStatusBadge from "./ModelStatusBadge";

export type ModelAction = "load" | "unload" | "test" | null;

interface ModelCardProps {
  model: AIModel;
  busyAction: ModelAction;
  onToggleEnable: (model: AIModel, enabled: boolean) => void;
  onThresholdChange: (model: AIModel, threshold: number) => void;
  onLoad: (model: AIModel) => void;
  onUnload: (model: AIModel) => void;
  onTest: (model: AIModel) => void;
  onDetails: (model: AIModel) => void;
}

export default function ModelCard({
  model,
  busyAction,
  onToggleEnable,
  onThresholdChange,
  onLoad,
  onUnload,
  onTest,
  onDetails,
}: ModelCardProps) {
  const [threshold, setThreshold] = useState(model.confidenceThreshold);

  useEffect(() => {
    setThreshold(model.confidenceThreshold);
  }, [model.confidenceThreshold]);

  const commitThreshold = () => {
    if (threshold !== model.confidenceThreshold) {
      onThresholdChange(model, threshold);
    }
  };

  const isBusy = busyAction !== null;
  const canLoad = model.enabled && model.status !== "loaded" && model.status !== "loading";
  const canUnload = model.status === "loaded" || model.status === "loading";
  const canTest = model.status === "loaded";

  return (
    <div
      onClick={() => onDetails(model)}
      className="card flex flex-col gap-4 cursor-pointer hover:shadow-md hover:border-brand-300 transition-all"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center flex-shrink-0">
            <Brain className="w-5 h-5 text-brand-600" />
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-gray-900 truncate">{model.name}</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              v{model.version} · {model.detectorKey}
            </p>
          </div>
        </div>
        <ModelStatusBadge status={model.status} />
      </div>

      <p className="text-sm text-gray-600 line-clamp-2 min-h-[40px]">
        {model.description}
      </p>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-1.5 text-gray-600">
            <Gauge className="w-4 h-4 text-gray-400" />
            Confidence Threshold
          </span>
          <span className="font-semibold text-gray-900">{threshold}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={threshold}
          disabled={!model.enabled}
          onChange={(e) => setThreshold(Number(e.target.value))}
          onMouseUp={commitThreshold}
          onTouchEnd={commitThreshold}
          onKeyUp={commitThreshold}
          onClick={(e) => e.stopPropagation()}
          className="w-full accent-brand-600 disabled:opacity-50"
        />
      </div>

      <div className="flex items-center justify-between text-xs text-gray-500">
        <span
          className={`inline-flex items-center gap-1 px-2 py-1 rounded-full ${
            model.gpuSupported
              ? "bg-indigo-50 text-indigo-600"
              : "bg-gray-100 text-gray-500"
          }`}
        >
          <Cpu className="w-3.5 h-3.5" />
          {model.gpuSupported ? "GPU Supported" : "CPU Only"}
        </span>
        <span className="flex items-center gap-1">
          <Zap className="w-3.5 h-3.5 text-gray-400" />
          Updated {new Date(model.updatedAt).toLocaleDateString()}
        </span>
      </div>

      <div
        className="flex items-center gap-2 pt-3 border-t border-gray-100"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={() => onLoad(model)}
          disabled={!canLoad || isBusy}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-brand-600 text-white hover:bg-brand-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Play className="w-4 h-4" />
          Load
        </button>
        <button
          onClick={() => onUnload(model)}
          disabled={!canUnload || isBusy}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-gray-200 text-gray-700 hover:bg-gray-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <PowerOff className="w-4 h-4" />
          Unload
        </button>
        <button
          onClick={() => onTest(model)}
          disabled={!canTest || isBusy}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <RefreshCw className="w-4 h-4" />
          Test
        </button>
        <button
          role="switch"
          aria-checked={model.enabled}
          aria-label={`${model.enabled ? "Disable" : "Enable"} ${model.name}`}
          onClick={() => onToggleEnable(model, !model.enabled)}
          disabled={isBusy}
          className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${
            model.enabled ? "bg-brand-600" : "bg-gray-300"
          } disabled:opacity-40`}
        >
          <span
            className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
              model.enabled ? "translate-x-[22px]" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>

      {busyAction && (
        <div className="text-xs text-brand-600 font-medium flex items-center gap-1.5">
          <Power className="w-3.5 h-3.5 animate-pulse" />
          {busyAction === "load" && "Loading model..."}
          {busyAction === "unload" && "Unloading model..."}
          {busyAction === "test" && "Running test..."}
        </div>
      )}
    </div>
  );
}

import { X, Brain, Cpu, Gauge, FolderOpen, KeyRound, Tag, Clock } from "lucide-react";
import type { AIModel } from "@/types";
import ModelStatusBadge from "./ModelStatusBadge";

interface ModelDetailsDrawerProps {
  model: AIModel | null;
  onClose: () => void;
}

export default function ModelDetailsDrawer({
  model,
  onClose,
}: ModelDetailsDrawerProps) {
  if (!model) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="fixed top-0 right-0 z-50 h-full w-full max-w-lg bg-white shadow-2xl overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-brand-50 flex items-center justify-center flex-shrink-0">
              <Brain className="w-5 h-5 text-brand-600" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-gray-900 truncate">
                {model.name}
              </h2>
              <p className="text-xs text-gray-500">v{model.version}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div className="flex items-center justify-between">
            <ModelStatusBadge status={model.status} />
            <span
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${
                model.enabled
                  ? "bg-green-50 text-green-700 border border-green-200"
                  : "bg-gray-100 text-gray-500 border border-gray-200"
              }`}
            >
              {model.enabled ? "Enabled" : "Disabled"}
            </span>
          </div>

          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1.5">
              Description
            </p>
            <p className="text-sm text-gray-700 leading-relaxed">
              {model.description}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <DetailItem
              icon={<Tag className="w-4 h-4" />}
              label="Version"
              value={`v${model.version}`}
            />
            <DetailItem
              icon={<KeyRound className="w-4 h-4" />}
              label="Detector Key"
              value={model.detectorKey}
            />
            <DetailItem
              icon={<Gauge className="w-4 h-4" />}
              label="Confidence Threshold"
              value={`${model.confidenceThreshold}%`}
            />
            <DetailItem
              icon={<Cpu className="w-4 h-4" />}
              label="GPU Support"
              value={model.gpuSupported ? "Supported" : "CPU Only"}
            />
            <div className="col-span-2">
              <DetailItem
                icon={<FolderOpen className="w-4 h-4" />}
                label="Model Path"
                value={model.modelPath}
              />
            </div>
            <DetailItem
              icon={<Clock className="w-4 h-4" />}
              label="Created"
              value={new Date(model.createdAt).toLocaleString()}
            />
            <DetailItem
              icon={<Clock className="w-4 h-4" />}
              label="Last Updated"
              value={new Date(model.updatedAt).toLocaleString()}
            />
          </div>
        </div>
      </div>
    </>
  );
}

function DetailItem({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="bg-gray-50 rounded-lg p-3">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
        {label}
      </p>
      <div className="flex items-center gap-1.5 text-sm text-gray-900 break-all">
        {icon}
        <span className="font-medium">{value}</span>
      </div>
    </div>
  );
}

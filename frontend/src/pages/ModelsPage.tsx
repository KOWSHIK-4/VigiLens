import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { Search, Brain, RefreshCw, AlertTriangle } from "lucide-react";
import { modelService } from "@/services/models";
import { showToast } from "@/components/Toast";
import ModelCard, { type ModelAction } from "@/components/ModelCard";
import ModelDetailsDrawer from "@/components/ModelDetailsDrawer";
import type { AIModel } from "@/types";

const filters = [
  { value: "", label: "All Models" },
  { value: "enabled", label: "Enabled" },
  { value: "disabled", label: "Disabled" },
  { value: "loaded", label: "Loaded" },
  { value: "error", label: "Error" },
];

function getErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    return (err.response?.data as { error?: string } | undefined)?.error ?? err.message;
  }
  return err instanceof Error ? err.message : "Something went wrong";
}

function SkeletonCard() {
  return (
    <div className="card animate-pulse">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gray-200" />
        <div className="flex-1 space-y-2">
          <div className="h-4 bg-gray-200 rounded w-3/4" />
          <div className="h-3 bg-gray-100 rounded w-1/2" />
        </div>
        <div className="h-6 w-20 bg-gray-200 rounded-full" />
      </div>
      <div className="mt-4 space-y-2">
        <div className="h-3 bg-gray-100 rounded" />
        <div className="h-3 bg-gray-100 rounded w-2/3" />
      </div>
      <div className="mt-4 h-2 bg-gray-200 rounded" />
      <div className="mt-6 grid grid-cols-3 gap-2">
        <div className="h-9 bg-gray-200 rounded-lg" />
        <div className="h-9 bg-gray-200 rounded-lg" />
        <div className="h-9 bg-gray-200 rounded-lg" />
      </div>
    </div>
  );
}

export default function ModelsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<AIModel | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["models", { search, filter }],
    queryFn: () =>
      modelService.getAll({
        page: 1,
        limit: 100,
        search: search || undefined,
        status: filter === "loaded" || filter === "error" ? filter : undefined,
        enabled:
          filter === "enabled" ? true : filter === "disabled" ? false : undefined,
      }),
    refetchInterval: 5000,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["models"] });

  const loadMutation = useMutation({
    mutationFn: (model: AIModel) => modelService.load(model.id),
    onSuccess: (updated) => {
      invalidate();
      showToast({
        severity: "info",
        title: "Model loading",
        message: `${updated.name} v${updated.version} is being prepared`,
      });
    },
    onError: (err, model) => {
      showToast({
        severity: "critical",
        title: "Load failed",
        message: `${model.name}: ${getErrorMessage(err)}`,
      });
    },
  });

  const unloadMutation = useMutation({
    mutationFn: (model: AIModel) => modelService.unload(model.id),
    onSuccess: (updated) => {
      invalidate();
      showToast({
        severity: "info",
        title: "Model unloaded",
        message: `${updated.name} v${updated.version} has been unloaded`,
      });
    },
    onError: (err, model) => {
      showToast({
        severity: "critical",
        title: "Unload failed",
        message: `${model.name}: ${getErrorMessage(err)}`,
      });
    },
  });

  const testMutation = useMutation({
    mutationFn: (model: AIModel) => modelService.test(model.id),
    onSuccess: (result) => {
      showToast({
        severity: "info",
        title: "Test passed",
        message: `${result.message} in ${result.inferenceTimeMs}ms at ${result.thresholdApplied}% threshold`,
      });
    },
    onError: (err, model) => {
      showToast({
        severity: "critical",
        title: "Test failed",
        message: `${model.name}: ${getErrorMessage(err)}`,
      });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ model, enabled }: { model: AIModel; enabled: boolean }) =>
      modelService.update(model.id, { enabled }),
    onSuccess: (updated) => {
      invalidate();
      showToast({
        severity: "info",
        title: updated.enabled ? "Model enabled" : "Model disabled",
        message: `${updated.name} v${updated.version} is now ${
          updated.enabled ? "enabled" : "disabled"
        }`,
      });
    },
    onError: (err, { model }) => {
      showToast({
        severity: "critical",
        title: "Update failed",
        message: `${model.name}: ${getErrorMessage(err)}`,
      });
    },
  });

  const thresholdMutation = useMutation({
    mutationFn: ({ model, threshold }: { model: AIModel; threshold: number }) =>
      modelService.update(model.id, { confidenceThreshold: threshold }),
    onSuccess: (updated) => {
      invalidate();
      showToast({
        severity: "info",
        title: "Threshold updated",
        message: `${updated.name} confidence threshold set to ${updated.confidenceThreshold}%`,
      });
    },
    onError: (err, { model }) => {
      showToast({
        severity: "critical",
        title: "Threshold update failed",
        message: `${model.name}: ${getErrorMessage(err)}`,
      });
    },
  });

  const busyFor = (model: AIModel): ModelAction => {
    if (loadMutation.variables?.id === model.id && loadMutation.isPending) {
      return "load";
    }
    if (unloadMutation.variables?.id === model.id && unloadMutation.isPending) {
      return "unload";
    }
    if (testMutation.variables?.id === model.id && testMutation.isPending) {
      return "test";
    }
    return null;
  };

  const models = data?.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">AI Models</h1>
        <p className="text-sm text-gray-500 mt-1">
          Manage detection models independently of cameras — enable, load, and
          configure detectors
        </p>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search models..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input pl-10"
          />
        </div>

        <div className="flex gap-2 flex-wrap">
          {filters.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                filter === f.value
                  ? "bg-brand-600 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {Array.from({ length: 6 }, (_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : isError ? (
        <div className="card text-center py-12">
          <AlertTriangle className="w-12 h-12 text-red-300 mx-auto mb-3" />
          <p className="text-gray-700 font-medium">Failed to load AI models</p>
          <p className="text-gray-400 text-sm mt-1">
            Check your connection and try again
          </p>
          <button
            onClick={() => refetch()}
            className="btn-primary mt-4 inline-flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            Retry
          </button>
        </div>
      ) : models.length === 0 ? (
        <div className="card text-center py-12">
          <Brain className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">No AI models found</p>
          <p className="text-gray-400 text-sm mt-1">
            {search || filter
              ? "Try adjusting your search or filters"
              : "Register a detector to see it here"}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {models.map((model) => (
            <ModelCard
              key={model.id}
              model={model}
              busyAction={busyFor(model)}
              onToggleEnable={(m, enabled) =>
                toggleMutation.mutate({ model: m, enabled })
              }
              onThresholdChange={(m, threshold) =>
                thresholdMutation.mutate({ model: m, threshold })
              }
              onLoad={(m) => loadMutation.mutate(m)}
              onUnload={(m) => unloadMutation.mutate(m)}
              onTest={(m) => testMutation.mutate(m)}
              onDetails={(m) => setSelected(m)}
            />
          ))}
        </div>
      )}

      {selected && (
        <ModelDetailsDrawer model={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

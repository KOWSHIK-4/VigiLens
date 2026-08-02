import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Brain,
  ChevronLeft,
  ChevronRight,
  Cpu,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Tag,
  Trash2,
} from "lucide-react";
import { modelService } from "@/services/models";
import { showToast } from "@/utils/toast";
import ModelStatusBadge from "@/components/ModelStatusBadge";
import {
  AddModelDialog,
  EditModelDialog,
  DeleteModelDialog,
} from "@/components/ModelDialogs";
import ModelStats, { ModelStatsSkeleton } from "@/components/ModelStats";
import type { AIModel } from "@/types";

const PAGE_SIZE = 10;

const filters = [
  { value: "", label: "All" },
  { value: "enabled", label: "Enabled" },
  { value: "disabled", label: "Disabled" },
  { value: "loaded", label: "Loaded" },
  { value: "error", label: "Error" },
];

const sortableColumns = [
  { key: "name", label: "Model" },
  { key: "confidenceThreshold", label: "Confidence" },
  { key: "status", label: "Status" },
  { key: "enabled", label: "Enabled" },
  { key: "gpuSupported", label: "GPU" },
  { key: "updatedAt", label: "Updated" },
];

function getErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    return (err.response?.data as { error?: string } | undefined)?.error ?? err.message;
  }
  return err instanceof Error ? err.message : "Something went wrong";
}

function VersionBadge({ version }: { version: string }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-100">
      <Tag className="w-3 h-3" />
      v{version}
    </span>
  );
}

function GpuBadge({ supported }: { supported: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
        supported
          ? "bg-indigo-50 text-indigo-700 border border-indigo-100"
          : "bg-gray-100 text-gray-500 border border-gray-200"
      }`}
    >
      <Cpu className="w-3 h-3" />
      {supported ? "GPU" : "CPU"}
    </span>
  );
}

function ConfidenceSlider({
  model,
  onCommit,
}: {
  model: AIModel;
  onCommit: (model: AIModel, threshold: number) => void;
}) {
  const [value, setValue] = useState(model.confidenceThreshold);

  const sync = (v: number) => {
    setValue(v);
    onCommit(model, v);
  };

  return (
    <div className="flex items-center gap-2 min-w-[140px]">
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        disabled={!model.enabled}
        onChange={(e) => setValue(Number(e.target.value))}
        onMouseUp={(e) => sync(Number((e.target as HTMLInputElement).value))}
        onTouchEnd={(e) => sync(Number((e.target as HTMLInputElement).value))}
        onKeyUp={(e) => sync(Number((e.target as HTMLInputElement).value))}
        className="w-full accent-brand-600 disabled:opacity-40"
        aria-label={`${model.name} confidence threshold`}
      />
      <span className="text-sm font-semibold text-gray-900 w-10 text-right tabular-nums">
        {value}%
      </span>
    </div>
  );
}

function Switch({
  checked,
  disabled,
  onToggle,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onToggle}
      disabled={disabled}
      className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${
        checked ? "bg-brand-600" : "bg-gray-300"
      } disabled:opacity-40 disabled:cursor-not-allowed`}
    >
      <span
        className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-[22px]" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

function TableSkeleton() {
  return (
    <div className="card overflow-hidden p-0">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <tbody className="divide-y divide-gray-100 animate-pulse">
            {Array.from({ length: 8 }, (_, i) => (
              <tr key={i}>
                {Array.from({ length: 7 }, (__, j) => (
                  <td key={j} className="px-4 py-4">
                    <div className="h-4 bg-gray-200 rounded" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ModelsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [sortBy, setSortBy] = useState("name");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<AIModel | null>(null);
  const [deleting, setDeleting] = useState<AIModel | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["models", { search, filter, sortBy, sortOrder, page }],
    queryFn: () =>
      modelService.getAll({
        page,
        limit: PAGE_SIZE,
        search: search || undefined,
        status: filter === "loaded" || filter === "error" ? filter : undefined,
        enabled:
          filter === "enabled" ? true : filter === "disabled" ? false : undefined,
        sortBy,
        sortOrder,
      }),
    refetchInterval: 5000,
  });

  const { data: statsData, isLoading: statsLoading } = useQuery({
    queryKey: ["models", "stats"],
    queryFn: () => modelService.getAll({ page: 1, limit: 100 }),
    refetchInterval: 10000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["models"] });

  const toggleMutation = useMutation({
    mutationFn: ({ model, enabled }: { model: AIModel; enabled: boolean }) =>
      enabled ? modelService.enable(model.id) : modelService.disable(model.id),
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
      modelService.setThreshold(model.id, threshold),
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

  const busyFor = useMemo(() => {
    const busy = new Set<string>();
    for (const m of [loadMutation, unloadMutation, testMutation]) {
      if (m.isPending && m.variables) busy.add(m.variables.id);
    }
    return busy;
  }, [loadMutation, unloadMutation, testMutation]);

  const models = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, data?.totalPages ?? 1);

  const handleSort = (key: string) => {
    if (sortBy === key) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(key);
      setSortOrder("asc");
    }
    setPage(1);
  };

  const SortIcon = ({ column }: { column: string }) => {
    if (sortBy !== column) return <ArrowUpDown className="w-3.5 h-3.5 text-gray-300" />;
    return sortOrder === "asc" ? (
      <ArrowUp className="w-3.5 h-3.5 text-brand-600" />
    ) : (
      <ArrowDown className="w-3.5 h-3.5 text-brand-600" />
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">AI Models</h1>
          <p className="text-sm text-gray-500 mt-1">
            Manage detection models independently of cameras — enable, load, and
            configure detectors
          </p>
        </div>
        <button
          className="btn-primary inline-flex items-center gap-2"
          onClick={() => setAddOpen(true)}
        >
          <Plus className="w-4 h-4" />
          Add Model
        </button>
      </div>

      {statsLoading ? (
        <ModelStatsSkeleton />
      ) : (
        <ModelStats models={statsData?.data ?? []} total={statsData?.total ?? 0} />
      )}

      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search by name, key, or description..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="input pl-10"
          />
        </div>

        <div className="flex gap-2 flex-wrap">
          {filters.map((f) => (
            <button
              key={f.value}
              onClick={() => {
                setFilter(f.value);
                setPage(1);
              }}
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
        <TableSkeleton />
      ) : isError ? (
        <div className="card text-center py-12">
          <Brain className="w-12 h-12 text-red-300 mx-auto mb-3" />
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
              : "No detection models are registered yet"}
          </p>
        </div>
      ) : (
        <div className="card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {sortableColumns.map((col) => (
                    <th
                      key={col.key}
                      scope="col"
                      onClick={() => handleSort(col.key)}
                      className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider cursor-pointer select-none hover:text-brand-600 transition-colors"
                    >
                      <span className="inline-flex items-center gap-1">
                        {col.label}
                        <SortIcon column={col.key} />
                      </span>
                    </th>
                  ))}
                  <th
                    scope="col"
                    className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider"
                  >
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {models.map((model) => (
                  <tr key={model.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3 min-w-[220px]">
                        <div className="w-9 h-9 rounded-lg bg-brand-50 flex items-center justify-center flex-shrink-0">
                          <Brain className="w-5 h-5 text-brand-600" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-gray-900 truncate">
                            {model.name}
                          </p>
                          <p className="text-xs text-gray-500 font-mono truncate">
                            {model.detectorKey}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <VersionBadge version={model.version} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <ModelStatusBadge status={model.status} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <ConfidenceSlider
                        model={model}
                        onCommit={(m, threshold) =>
                          thresholdMutation.mutate({ model: m, threshold })
                        }
                      />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Switch
                        checked={model.enabled}
                        label={`${model.enabled ? "Disable" : "Enable"} ${model.name}`}
                        onToggle={() =>
                          toggleMutation.mutate({
                            model,
                            enabled: !model.enabled,
                          })
                        }
                      />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <GpuBadge supported={model.gpuSupported} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                      {new Date(model.updatedAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => loadMutation.mutate(model)}
                          disabled={
                            !model.enabled ||
                            model.status === "loaded" ||
                            model.status === "loading" ||
                            busyFor.has(model.id)
                          }
                          className="px-2.5 py-1.5 text-xs font-medium rounded-lg bg-brand-50 text-brand-700 hover:bg-brand-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          Load
                        </button>
                        <button
                          onClick={() => unloadMutation.mutate(model)}
                          disabled={
                            (model.status !== "loaded" &&
                              model.status !== "loading") ||
                            busyFor.has(model.id)
                          }
                          className="px-2.5 py-1.5 text-xs font-medium rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          Unload
                        </button>
                        <button
                          onClick={() => testMutation.mutate(model)}
                          disabled={model.status !== "loaded" || busyFor.has(model.id)}
                          className="px-2.5 py-1.5 text-xs font-medium rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          Test
                        </button>
                        <div className="w-px h-5 bg-gray-200 mx-0.5" />
                        <button
                          onClick={() => setEditing(model)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-brand-600 hover:bg-brand-50 transition-colors"
                          aria-label={`Edit ${model.name}`}
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setDeleting(model)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                          aria-label={`Delete ${model.name}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-gray-100 bg-gray-50">
            <p className="text-sm text-gray-500">
              Showing{" "}
              <span className="font-medium text-gray-700">
                {total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}–
                {Math.min(page * PAGE_SIZE, total)}
              </span>{" "}
              of <span className="font-medium text-gray-700">{total}</span> models
            </p>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="p-2 rounded-lg bg-white border border-gray-200 text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label="Previous page"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(
                  (p) =>
                    p === 1 ||
                    p === totalPages ||
                    Math.abs(p - page) <= 1,
                )
                .reduce<Array<number | "...">>((acc, p, idx, arr) => {
                  if (idx > 0 && p - (arr[idx - 1] as number) > 1) {
                    acc.push("...");
                  }
                  acc.push(p);
                  return acc;
                }, [])
                .map((p, idx) =>
                  p === "..." ? (
                    <span
                      key={`gap-${idx}`}
                      className="px-1.5 text-gray-400 select-none"
                    >
                      …
                    </span>
                  ) : (
                    <button
                      key={p}
                      onClick={() => setPage(p)}
                      className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors ${
                        page === p
                          ? "bg-brand-600 text-white"
                          : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-100"
                      }`}
                    >
                      {p}
                    </button>
                  ),
                )}
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="p-2 rounded-lg bg-white border border-gray-200 text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label="Next page"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      <AddModelDialog open={addOpen} onClose={() => setAddOpen(false)} />
      <EditModelDialog
        open={Boolean(editing)}
        model={editing}
        onClose={() => setEditing(null)}
      />
      <DeleteModelDialog
        open={Boolean(deleting)}
        model={deleting as AIModel}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}

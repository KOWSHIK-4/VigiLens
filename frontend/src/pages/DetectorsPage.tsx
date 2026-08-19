import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Search,
  RefreshCw,
  Store,
  CheckCircle2,
  PowerOff,
  AlertCircle,
  Cpu,
} from "lucide-react";
import { detectorService } from "@/services/detectors";
import { engineService } from "@/services/engine";
import { showToast } from "@/utils/toast";
import { getApiErrorMessage } from "@/utils/apiError";
import DetectorCard from "@/components/DetectorCard";
import DetectorConfigDialog from "@/components/DetectorConfigDialog";
import DetectorCameraModal from "@/components/DetectorCameraModal";
import DetectorEditDialog from "@/components/DetectorEditDialog";
import DetectorDetailsDrawer from "@/components/DetectorDetailsDrawer";
import type { EngineDetector, MarketplaceDetector } from "@/types";

type Tab = "installed" | "available";

function CardSkeleton() {
  return (
    <div className="card animate-pulse space-y-3">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-gray-200" />
          <div className="space-y-2">
            <div className="h-4 bg-gray-200 rounded w-32" />
            <div className="h-3 bg-gray-200 rounded w-20" />
          </div>
        </div>
        <div className="h-5 bg-gray-200 rounded-full w-20" />
      </div>
      <div className="h-3 bg-gray-200 rounded w-full" />
      <div className="h-3 bg-gray-200 rounded w-2/3" />
      <div className="h-8 bg-gray-200 rounded w-1/3 mt-4" />
    </div>
  );
}

export default function DetectorsPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("installed");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [configFor, setConfigFor] = useState<MarketplaceDetector | null>(null);
  const [camerasFor, setCamerasFor] = useState<MarketplaceDetector | null>(null);
  const [editFor, setEditFor] = useState<MarketplaceDetector | null>(null);
  const [detailsFor, setDetailsFor] = useState<MarketplaceDetector | null>(null);

  const {
    data: marketplace,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["detectors", "marketplace"],
    queryFn: () => detectorService.getMarketplace(),
    refetchInterval: 5000,
  });

  const { data: categories } = useQuery({
    queryKey: ["detectors", "categories"],
    queryFn: () => detectorService.getCategories(),
  });

  const { data: engineDescriptors } = useQuery({
    queryKey: ["detectors", "engine"],
    queryFn: () => engineService.getAll(),
    refetchInterval: 5000,
  });

  const descriptorByKey = useMemo(() => {
    const map = new Map<string, EngineDetector>();
    for (const d of engineDescriptors ?? []) map.set(d.key, d);
    return map;
  }, [engineDescriptors]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["detectors"] });

  const toggleMutation = useMutation({
    mutationFn: ({ detector, enabled }: { detector: MarketplaceDetector; enabled: boolean }) =>
      enabled ? detectorService.enable(detector.id!) : detectorService.disable(detector.id!),
    onSuccess: (updated) => {
      invalidate();
      showToast({
        severity: "info",
        title: updated.enabled ? "Detector enabled" : "Detector disabled",
        message: `${updated.name} is now ${updated.enabled ? "enabled" : "disabled"}`,
      });
    },
    onError: (err, { detector }) => {
      showToast({
        severity: "critical",
        title: "Update failed",
        message: `${detector.name}: ${getApiErrorMessage(err)}`,
      });
    },
  });

  const installMutation = useMutation({
    mutationFn: (detector: MarketplaceDetector) => detectorService.install(detector.key),
    onSuccess: (updated) => {
      invalidate();
      showToast({
        severity: "info",
        title: "Detector installed",
        message: `${updated.name} v${updated.version} is ready to configure`,
      });
    },
    onError: (err, detector) => {
      showToast({
        severity: "critical",
        title: "Install failed",
        message: `${detector.name}: ${getApiErrorMessage(err)}`,
      });
    },
  });

  const restartMutation = useMutation({
    mutationFn: (detector: MarketplaceDetector) => detectorService.restart(detector.id!),
    onSuccess: (updated) => {
      invalidate();
      showToast({
        severity: "info",
        title: "Restart initiated",
        message: `${updated.name} is restarting`,
      });
    },
    onError: (err, detector) => {
      showToast({
        severity: "critical",
        title: "Restart failed",
        message: `${detector.name}: ${getApiErrorMessage(err)}`,
      });
    },
  });

  const busyFor = useMemo(() => {
    const busy = new Set<string>();
    if (toggleMutation.isPending && toggleMutation.variables) {
      busy.add(toggleMutation.variables.detector.id ?? toggleMutation.variables.detector.key);
    }
    if (installMutation.isPending && installMutation.variables) {
      busy.add(installMutation.variables.key);
    }
    if (restartMutation.isPending && restartMutation.variables) {
      busy.add(restartMutation.variables.id ?? restartMutation.variables.key);
    }
    return busy;
  }, [toggleMutation, installMutation, restartMutation]);

  const isBusy = (d: MarketplaceDetector) =>
    busyFor.has(d.id ?? "") || busyFor.has(d.key);

  const installed = marketplace?.filter((d) => d.installed) ?? [];
  const available = marketplace?.filter((d) => !d.installed) ?? [];
  const runningCount = installed.filter(
    (d) => d.runtimeStatus === "ready" || d.status === "running",
  ).length;
  const errorCount = installed.filter(
    (d) => d.runtimeStatus === "error" || d.status === "error",
  ).length;

  const visible = (tab === "installed" ? installed : available).filter((d) => {
    const q = search.trim().toLowerCase();
    const matchesSearch =
      !q ||
      d.name.toLowerCase().includes(q) ||
      d.key.toLowerCase().includes(q) ||
      d.description.toLowerCase().includes(q);
    const matchesCategory = !category || d.category === category;
    const matchesType = !typeFilter || d.type === typeFilter;
    return matchesSearch && matchesCategory && matchesType;
  });

  const selectedDetector = useMemo(() => {
    if (!detailsFor) return null;
    return marketplace?.find((d) => d.key === detailsFor.key) ?? detailsFor;
  }, [detailsFor, marketplace]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">AI Detector Marketplace</h1>
          <p className="text-sm text-gray-500 mt-1">
            Browse, install, and configure detection models for your camera network
          </p>
        </div>
        <button
          onClick={() => refetch()}
          className="btn-secondary inline-flex items-center gap-2 text-sm"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<Store className="w-5 h-5 text-brand-600" />}
          label="Detectors"
          value={marketplace?.length ?? 0}
          bg="bg-brand-50"
        />
        <StatCard
          icon={<CheckCircle2 className="w-5 h-5 text-green-600" />}
          label="Installed"
          value={installed.length}
          bg="bg-green-50"
        />
        <StatCard
          icon={<Cpu className="w-5 h-5 text-indigo-600" />}
          label="Running"
          value={runningCount}
          bg="bg-indigo-50"
        />
        <StatCard
          icon={<AlertCircle className="w-5 h-5 text-red-500" />}
          label="Errors"
          value={errorCount}
          bg="bg-red-50"
        />
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search detectors..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input pl-10"
          />
        </div>

        <div className="relative">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="input pr-8 appearance-none cursor-pointer"
            aria-label="Filter by detector type"
          >
            <option value="">All types</option>
            <option value="object_detection">Object Detection</option>
            <option value="classification">Classification</option>
            <option value="segmentation">Segmentation</option>
          </select>
        </div>

        <div className="flex gap-2 flex-wrap overflow-x-auto pb-1">
          <button
            onClick={() => setCategory("")}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex-shrink-0 ${
              category === ""
                ? "bg-brand-600 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            All
          </button>
          {(categories ?? []).map((cat) => (
            <button
              key={cat}
              onClick={() => setCategory(category === cat ? "" : cat)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex-shrink-0 ${
                category === cat
                  ? "bg-brand-600 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        <TabButton
          active={tab === "installed"}
          onClick={() => setTab("installed")}
          label="Installed"
          count={installed.length}
        />
        <TabButton
          active={tab === "available"}
          onClick={() => setTab("available")}
          label="Available"
          count={available.length}
        />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {Array.from({ length: 6 }, (_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : isError ? (
        <div className="card text-center py-12">
          <Store className="w-12 h-12 text-red-300 mx-auto mb-3" />
          <p className="text-gray-700 font-medium">Failed to load detectors</p>
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
      ) : visible.length === 0 ? (
        <div className="card text-center py-12">
          <PowerOff className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">No {tab} detectors found</p>
          <p className="text-gray-400 text-sm mt-1">
            {search || category
              ? "Try adjusting your search or category filter"
              : tab === "available"
                ? "All detectors are installed"
                : "No detectors are installed yet — browse the Available tab"}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {visible.map((detector) => (
            <DetectorCard
              key={detector.key}
              detector={detector}
              busy={isBusy(detector)}
              availability={descriptorByKey.get(detector.key)?.availability}
              engineType={descriptorByKey.get(detector.key)?.type}
              onToggle={(d) =>
                toggleMutation.mutate({ detector: d, enabled: !d.enabled })
              }
              onInstall={(d) => installMutation.mutate(d)}
              onConfigure={(d) => setConfigFor(d)}
              onCameras={(d) => setCamerasFor(d)}
              onEdit={(d) => setEditFor(d)}
              onRestart={(d) => restartMutation.mutate(d)}
              onDetails={(d) => setDetailsFor(d)}
            />
          ))}
        </div>
      )}

      <DetectorConfigDialog
        detector={configFor}
        onClose={() => setConfigFor(null)}
      />
      <DetectorCameraModal
        detector={camerasFor}
        onClose={() => setCamerasFor(null)}
      />
      <DetectorEditDialog
        detector={editFor}
        onClose={() => setEditFor(null)}
      />
      <DetectorDetailsDrawer
        detector={selectedDetector}
        onClose={() => setDetailsFor(null)}
        onConfigure={(d) => {
          setDetailsFor(null);
          setConfigFor(d);
        }}
        onCameras={(d) => {
          setDetailsFor(null);
          setCamerasFor(d);
        }}
        onEdit={(d) => {
          setDetailsFor(null);
          setEditFor(d);
        }}
        onRestart={(d) => restartMutation.mutate(d)}
      />
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  bg,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  bg: string;
}) {
  return (
    <div className="card flex items-center gap-4">
      <div
        className={`w-11 h-11 rounded-xl ${bg} flex items-center justify-center flex-shrink-0`}
      >
        {icon}
      </div>
      <div>
        <p className="text-sm font-medium text-gray-500">{label}</p>
        <p className="text-3xl font-bold text-gray-900 tabular-nums">{value}</p>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-lg text-sm font-medium inline-flex items-center gap-2 transition-colors ${
        active ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
      }`}
    >
      {label}
      <span
        className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
          active ? "bg-brand-50 text-brand-700" : "bg-gray-200 text-gray-600"
        }`}
      >
        {count}
      </span>
    </button>
  );
}

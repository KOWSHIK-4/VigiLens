import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BellRing,
  Camera,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  RefreshCw,
  Search,
  ShieldX,
  Users,
  X,
} from "lucide-react";
import { teamsService } from "@/services/teams";
import { cameraService } from "@/services/cameras";
import { alertService } from "@/services/alerts";
import { incidentService } from "@/services/incidents";
import { hasPermission } from "@/utils/permissions";
import { useAuth } from "@/hooks/useAuth";
import type { Team } from "@/types";

const PAGE_SIZE = 10;

const sortableColumns = [
  { key: "name", label: "Name" },
  { key: "createdAt", label: "Created" },
];

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function TableSkeleton() {
  return (
    <div className="card overflow-hidden p-0">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <tbody className="divide-y divide-gray-100 animate-pulse">
            {Array.from({ length: 8 }, (_, i) => (
              <tr key={i}>
                {Array.from({ length: 4 }, (__, j) => (
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

export default function TeamsPage() {
  const { user: currentUser } = useAuth();
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("name");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);

  const canView = hasPermission(currentUser, "teams.read");

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["teams", { search, sortBy, sortOrder, page }],
    queryFn: () =>
      teamsService.getAll({
        page,
        limit: PAGE_SIZE,
        search: search || undefined,
        sortBy: sortBy as "name" | "createdAt" | "updatedAt",
        sortOrder,
      }),
    enabled: canView,
  });

  const teams = data?.data ?? [];
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

  const canViewCameras = hasPermission(currentUser, "cameras.read");
  const canViewAlerts = hasPermission(currentUser, "alerts.read");

  const teamCameras = useQuery({
    queryKey: ["cameras", { teamId: selectedTeam?.id }],
    queryFn: () => cameraService.getAll({ teamId: selectedTeam?.id, page: 1, limit: 5 }),
    enabled: Boolean(selectedTeam) && canViewCameras,
  });

  const teamAlerts = useQuery({
    queryKey: ["alerts", { teamId: selectedTeam?.id }],
    queryFn: () => alertService.getAll({ teamId: selectedTeam?.id, page: 1, limit: 5 }),
    enabled: Boolean(selectedTeam) && canViewAlerts,
  });

  const teamIncidents = useQuery({
    queryKey: ["incidents", { teamId: selectedTeam?.id }],
    queryFn: () => incidentService.getAll({ teamId: selectedTeam?.id, page: 1, limit: 5 }),
    enabled: Boolean(selectedTeam) && canViewAlerts,
  });

  if (!canView) {
    return (
      <div className="card text-center py-16">
        <ShieldX className="w-12 h-12 text-gray-300 mx-auto mb-3" />
        <p className="text-gray-500 font-medium">You do not have access to Teams</p>
        <p className="text-gray-400 text-sm mt-1">
          Contact an administrator for the teams.read permission
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Teams</h1>
        <p className="text-sm text-gray-500 mt-1">
          Organisational groups your users are assigned to
        </p>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search teams..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="input pl-10"
          />
        </div>
      </div>

      {isLoading ? (
        <TableSkeleton />
      ) : isError ? (
        <div className="card text-center py-12">
          <Users className="w-12 h-12 text-red-300 mx-auto mb-3" />
          <p className="text-gray-700 font-medium">Failed to load teams</p>
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
      ) : teams.length === 0 ? (
        <div className="card text-center py-12">
          <Users className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">No teams found</p>
          <p className="text-gray-400 text-sm mt-1">
            {search ? "Try adjusting your search" : "No teams exist yet"}
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
                    className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider"
                  >
                    Members
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider"
                  >
                    Description
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {teams.map((team: Team) => (
                  <tr
                      key={team.id}
                      onClick={() => setSelectedTeam(team)}
                      className="hover:bg-gray-50 transition-colors cursor-pointer"
                    >
                    <td className="px-4 py-3">
                      <p className="font-semibold text-gray-900 truncate">{team.name}</p>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                      {formatDateTime(team.createdAt)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-center">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-medium bg-brand-50 text-brand-700">
                        <Users className="w-3.5 h-3.5" />
                        {team._count?.members ?? 0}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500 max-w-xs truncate">
                      {team.description || "—"}
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
              of <span className="font-medium text-gray-700">{total}</span> teams
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
                  (p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1,
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
                    <span key={`gap-${idx}`} className="px-1.5 text-gray-400 select-none">
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

      {selectedTeam && (
        <div className="card p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-gray-900">{selectedTeam.name}</h2>
              <p className="text-sm text-gray-500 mt-1">
                {selectedTeam.description || "No description"} ·{" "}
                <span className="inline-flex items-center gap-1">
                  <Users className="w-3.5 h-3.5" />
                  {selectedTeam._count?.members ?? 0} members
                </span>
              </p>
            </div>
            <button
              onClick={() => setSelectedTeam(null)}
              className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              aria-label="Close team details"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-5">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-2">
                <Camera className="w-4 h-4 text-brand-600" />
                Cameras
              </h3>
              {!canViewCameras ? (
                <p className="text-sm text-gray-400">Requires cameras.read</p>
              ) : teamCameras.isLoading ? (
                <p className="text-sm text-gray-400">Loading…</p>
              ) : (teamCameras.data?.data ?? []).length === 0 ? (
                <p className="text-sm text-gray-400">No cameras assigned</p>
              ) : (
                <ul className="divide-y divide-gray-100 border border-gray-100 rounded-lg">
                  {(teamCameras.data?.data ?? []).map((cam) => (
                    <li key={cam.id} className="px-3 py-2 flex items-center justify-between text-sm">
                      <span className="font-medium text-gray-800 truncate">{cam.name}</span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          cam.displayStatus === "online"
                            ? "bg-green-50 text-green-700"
                            : cam.displayStatus === "offline" || cam.displayStatus === "error"
                              ? "bg-red-50 text-red-700"
                              : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {cam.displayStatus ?? cam.status ?? "unknown"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-2">
                <BellRing className="w-4 h-4 text-brand-600" />
                Alerts
              </h3>
              {!canViewAlerts ? (
                <p className="text-sm text-gray-400">Requires alerts.read</p>
              ) : teamAlerts.isLoading ? (
                <p className="text-sm text-gray-400">Loading…</p>
              ) : (teamAlerts.data?.data ?? []).length === 0 ? (
                <p className="text-sm text-gray-400">No alerts assigned</p>
              ) : (
                <ul className="divide-y divide-gray-100 border border-gray-100 rounded-lg">
                  {(teamAlerts.data?.data ?? []).map((alert) => (
                    <li key={alert.id} className="px-3 py-2 text-sm flex items-center justify-between gap-2">
                      <span className="font-medium text-gray-800 truncate">{alert.title}</span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap capitalize ${
                          alert.severity === "critical"
                            ? "bg-red-50 text-red-700"
                            : alert.severity === "warning"
                              ? "bg-amber-50 text-amber-700"
                              : "bg-blue-50 text-blue-700"
                        }`}
                      >
                        {alert.severity}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-2">
                <ClipboardList className="w-4 h-4 text-brand-600" />
                Incidents
              </h3>
              {!canViewAlerts ? (
                <p className="text-sm text-gray-400">Requires alerts.read</p>
              ) : teamIncidents.isLoading ? (
                <p className="text-sm text-gray-400">Loading…</p>
              ) : (teamIncidents.data?.data ?? []).length === 0 ? (
                <p className="text-sm text-gray-400">No incidents assigned</p>
              ) : (
                <ul className="divide-y divide-gray-100 border border-gray-100 rounded-lg">
                  {(teamIncidents.data?.data ?? []).map((incident) => (
                    <li key={incident.id} className="px-3 py-2 text-sm flex items-center justify-between gap-2">
                      <span className="font-medium text-gray-800 truncate">{incident.title}</span>
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap capitalize bg-gray-100 text-gray-600">
                        {incident.status}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
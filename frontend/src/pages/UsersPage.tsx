import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  UserRoundX,
  Users,
} from "lucide-react";
import { userService } from "@/services/users";
import UserAvatar from "@/components/UserAvatar";
import RoleBadge from "@/components/RoleBadge";
import UserStatusBadge from "@/components/UserStatusBadge";
import UserStatsCards, { UserStatsSkeleton } from "@/components/UserStats";
import {
  AddUserDialog,
  AssignRoleDialog,
  DeleteUserDialog,
  EditUserDialog,
  ResetPasswordDialog,
  ToggleStatusDialog,
} from "@/components/UserDialogs";
import { can } from "@/utils/permissions";
import { useAuth } from "@/hooks/useAuth";
import type { User, UserRole, UserStatus } from "@/types";

const PAGE_SIZE = 10;

const roleFilters: Array<{ value: "" | UserRole; label: string }> = [
  { value: "", label: "All Roles" },
  { value: "super_admin", label: "Super Admin" },
  { value: "admin", label: "Admin" },
  { value: "operator", label: "Operator" },
  { value: "viewer", label: "Viewer" },
];

const statusFilters: Array<{ value: "" | UserStatus; label: string }> = [
  { value: "", label: "All Status" },
  { value: "active", label: "Active" },
  { value: "disabled", label: "Disabled" },
];

const sortableColumns = [
  { key: "name", label: "Name" },
  { key: "email", label: "Email" },
  { key: "role", label: "Role" },
  { key: "status", label: "Status" },
  { key: "lastLogin", label: "Last Login" },
  { key: "createdAt", label: "Created" },
];

function formatDateTime(value: string | null): string {
  if (!value) return "—";
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

export default function UsersPage() {
  const { user: currentUser } = useAuth();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"" | UserRole>("");
  const [statusFilter, setStatusFilter] = useState<"" | UserStatus>("");
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [deleting, setDeleting] = useState<User | null>(null);
  const [assigning, setAssigning] = useState<User | null>(null);
  const [toggling, setToggling] = useState<User | null>(null);
  const [resetting, setResetting] = useState<User | null>(null);

  const canManage = can(currentUser?.role, "users:write");
  const canAssignRole = can(currentUser?.role, "users:assign-role");
  const canToggleStatus = can(currentUser?.role, "users:toggle-status");
  const canResetPassword = can(currentUser?.role, "users:reset-password");

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["users", { search, roleFilter, statusFilter, sortBy, sortOrder, page }],
    queryFn: () =>
      userService.getAll({
        page,
        limit: PAGE_SIZE,
        search: search || undefined,
        role: roleFilter || undefined,
        status: statusFilter || undefined,
        sortBy,
        sortOrder,
      }),
  });

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["users", "stats"],
    queryFn: () => userService.getStats(),
    refetchInterval: 30000,
  });

  const users = data?.data ?? [];
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
          <h1 className="text-2xl font-bold text-gray-900">Users</h1>
          <p className="text-sm text-gray-500 mt-1">
            Manage accounts, roles and access across your organisation
          </p>
        </div>
        {canManage && (
          <button
            className="btn-primary inline-flex items-center gap-2"
            onClick={() => setAddOpen(true)}
          >
            <Plus className="w-4 h-4" />
            Add User
          </button>
        )}
      </div>

      {statsLoading || !stats ? (
        <UserStatsSkeleton />
      ) : (
        <UserStatsCards stats={stats} />
      )}

      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search by name or email..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="input pl-10"
          />
        </div>

        <div className="flex gap-2 flex-wrap">
          {roleFilters.map((f) => (
            <button
              key={f.value || "all-roles"}
              onClick={() => {
                setRoleFilter(f.value);
                setPage(1);
              }}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                roleFilter === f.value
                  ? "bg-brand-600 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex gap-2 flex-wrap">
          {statusFilters.map((f) => (
            <button
              key={f.value || "all-status"}
              onClick={() => {
                setStatusFilter(f.value);
                setPage(1);
              }}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                statusFilter === f.value
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
          <Users className="w-12 h-12 text-red-300 mx-auto mb-3" />
          <p className="text-gray-700 font-medium">Failed to load users</p>
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
      ) : users.length === 0 ? (
        <div className="card text-center py-12">
          <Users className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">No users found</p>
          <p className="text-gray-400 text-sm mt-1">
            {search || roleFilter || statusFilter
              ? "Try adjusting your search or filters"
              : "No user accounts exist yet"}
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
                {users.map((user) => (
                  <tr key={user.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3 min-w-[200px]">
                        <UserAvatar name={user.name} avatar={user.avatar} size="sm" />
                        <div className="min-w-0">
                          <p className="font-semibold text-gray-900 truncate">
                            {user.name}
                            {user.id === currentUser?.id && (
                              <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wide bg-brand-50 text-brand-700 border border-brand-100 align-middle">
                                You
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-gray-500 truncate">{user.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <RoleBadge role={user.role} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <UserStatusBadge status={user.status} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                      {formatDateTime(user.lastLogin)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                      {formatDateTime(user.createdAt)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        {canAssignRole && user.id !== currentUser?.id && (
                          <button
                            onClick={() => setAssigning(user)}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-brand-600 hover:bg-brand-50 transition-colors"
                            aria-label={`Assign role to ${user.name}`}
                            title="Assign Role"
                          >
                            <ShieldCheck className="w-4 h-4" />
                          </button>
                        )}
                        {canResetPassword && (
                          <button
                            onClick={() => setResetting(user)}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-brand-600 hover:bg-brand-50 transition-colors"
                            aria-label={`Reset password for ${user.name}`}
                            title="Reset Password"
                          >
                            <KeyRound className="w-4 h-4" />
                          </button>
                        )}
                        {canToggleStatus && user.id !== currentUser?.id && (
                          <button
                            onClick={() => setToggling(user)}
                            className={`p-1.5 rounded-lg transition-colors ${
                              user.status === "active"
                                ? "text-gray-400 hover:text-amber-600 hover:bg-amber-50"
                                : "text-gray-400 hover:text-green-600 hover:bg-green-50"
                            }`}
                            aria-label={`${user.status === "active" ? "Disable" : "Enable"} ${user.name}`}
                            title={user.status === "active" ? "Disable User" : "Enable User"}
                          >
                            <UserRoundX className="w-4 h-4" />
                          </button>
                        )}
                        {canManage && (
                          <button
                            onClick={() => setEditing(user)}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-brand-600 hover:bg-brand-50 transition-colors"
                            aria-label={`Edit ${user.name}`}
                            title="Edit User"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                        )}
                        {canManage && user.id !== currentUser?.id && (
                          <button
                            onClick={() => setDeleting(user)}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                            aria-label={`Delete ${user.name}`}
                            title="Delete User"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
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
              of <span className="font-medium text-gray-700">{total}</span> users
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

      <AddUserDialog open={addOpen} onClose={() => setAddOpen(false)} />
      <EditUserDialog
        open={Boolean(editing)}
        user={editing}
        onClose={() => setEditing(null)}
      />
      <DeleteUserDialog
        open={Boolean(deleting)}
        user={deleting as User}
        onClose={() => setDeleting(null)}
      />
      <AssignRoleDialog
        open={Boolean(assigning)}
        user={assigning as User}
        onClose={() => setAssigning(null)}
      />
      <ToggleStatusDialog
        open={Boolean(toggling)}
        user={toggling as User}
        onClose={() => setToggling(null)}
      />
      <ResetPasswordDialog
        open={Boolean(resetting)}
        user={resetting as User}
        onClose={() => setResetting(null)}
      />
    </div>
  );
}

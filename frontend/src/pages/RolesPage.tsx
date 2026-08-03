import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { Loader2, Lock, Pencil, Shield, X } from "lucide-react";
import { roleService } from "@/services/roles";
import { showToast } from "@/utils/toast";
import RoleBadge from "@/components/RoleBadge";
import { can } from "@/utils/permissions";
import { useAuth } from "@/hooks/useAuth";
import type { Permission, Role, UserRole } from "@/types";

const ROLE_ICON_TINTS: Record<UserRole, string> = {
  super_admin: "bg-purple-50",
  admin: "bg-blue-50",
  operator: "bg-emerald-50",
  viewer: "bg-gray-100",
};

const ROLE_ICON_COLORS: Record<UserRole, string> = {
  super_admin: "text-purple-600",
  admin: "text-blue-600",
  operator: "text-emerald-600",
  viewer: "text-gray-500",
};

const CATEGORY_LABELS: Record<string, string> = {
  users: "Users",
  roles: "Roles",
  cameras: "Cameras",
  detections: "Detections",
  models: "AI Models",
  analytics: "Analytics",
  reports: "Reports",
  alerts: "Alerts",
  general: "General",
};

function getErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    return (err.response?.data as { error?: string } | undefined)?.error ?? err.message;
  }
  return err instanceof Error ? err.message : "Something went wrong";
}

function permissionGroups(permissions: Permission[]): Array<{ category: string; items: Permission[] }> {
  const groups = new Map<string, Permission[]>();
  for (const permission of permissions) {
    const list = groups.get(permission.category) ?? [];
    list.push(permission);
    groups.set(permission.category, list);
  }
  return Array.from(groups.entries()).map(([category, items]) => ({
    category,
    items: items.sort((a, b) => a.key.localeCompare(b.key)),
  }));
}

interface RolePermissionDialogProps {
  open: boolean;
  onClose: () => void;
  role: Role;
}

function RolePermissionDialog({ open, onClose, role }: RolePermissionDialogProps) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");

  const { data: allPermissions } = useQuery({
    queryKey: ["roles", "permissions"],
    enabled: open && role.name !== "super_admin",
    queryFn: () =>
      roleService.getAll().then((roles) => {
        const seen = new Map<string, Permission>();
        roles.forEach((r) => {
          r.permissions.forEach((p) => seen.set(p.key, p));
        });
        return Array.from(seen.values());
      }),
  });

  useEffect(() => {
    if (open) {
      setSelected(new Set(role.permissions.map((p) => p.key)));
      setError("");
    }
  }, [open, role]);

  const mutation = useMutation({
    mutationFn: () => roleService.updatePermissions(role.name, Array.from(selected)),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["roles"] });
      showToast({
        severity: "info",
        title: "Permissions updated",
        message: `${updated.name} role permissions saved`,
      });
      onClose();
    },
    onError: (err) => {
      setError(getErrorMessage(err));
    },
  });

  if (!open) return null;

  if (role.name === "super_admin") {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div className="fixed inset-0 bg-black/50 backdrop-enter" onClick={onClose} />
        <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md mx-4 drawer-enter">
          <div className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
                <Lock className="w-5 h-5 text-gray-500" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  System Role
                </h3>
                <p className="text-sm text-gray-500">
                  {role.name.replace("_", " ")} permissions cannot be edited
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={onClose} className="btn-primary">Close</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const groups = permissionGroups(allPermissions ?? []);
  const dirty = !(
    selected.size === role.permissions.length &&
    role.permissions.every((p) => selected.has(p.key))
  );

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50 backdrop-enter" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto drawer-enter">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 sticky top-0 bg-white z-10">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">
              Edit {role.name.replace("_", " ")} Permissions
            </h3>
            <p className="text-sm text-gray-500 mt-0.5">
              Select the capabilities granted to this role
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {error}
            </div>
          )}

          {groups.map((group) => (
            <div key={group.category}>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                {CATEGORY_LABELS[group.category] ?? group.category}
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {group.items.map((permission) => (
                  <label
                    key={permission.key}
                    className={`flex items-start gap-2.5 p-2.5 border rounded-lg cursor-pointer transition-colors ${
                      selected.has(permission.key)
                        ? "border-brand-300 bg-brand-50"
                        : "border-gray-200 hover:bg-gray-50"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(permission.key)}
                      onChange={() => toggle(permission.key)}
                      className="w-4 h-4 mt-0.5"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-gray-800">
                        {permission.name}
                      </span>
                      <span className="block text-xs text-gray-400 font-mono truncate">
                        {permission.key}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50 sticky bottom-0">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !dirty}
            className="btn-primary flex items-center gap-2"
          >
            {mutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            Save Permissions
          </button>
        </div>
      </div>
    </div>
  );
}

interface RoleCardProps {
  role: Role;
  canManage: boolean;
  onEdit: (role: Role) => void;
}

function RoleCard({ role, canManage, onEdit }: RoleCardProps) {
  const groups = permissionGroups(role.permissions);
  const protectedRole = role.name === "super_admin";

  return (
    <div className="card flex flex-col transition-all hover:shadow-lg hover:-translate-y-0.5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={`w-11 h-11 rounded-xl ${ROLE_ICON_TINTS[role.name]} flex items-center justify-center flex-shrink-0`}
          >
            <Shield className={`w-5 h-5 ${ROLE_ICON_COLORS[role.name]}`} />
          </div>
          <div className="min-w-0">
            <RoleBadge role={role.name} />
            <div className="flex items-center gap-2 mt-1.5">
              <span className="text-xs text-gray-500">
                {role.userCount} user{role.userCount === 1 ? "" : "s"}
              </span>
              <span className="text-xs text-gray-300">•</span>
              <span className="text-xs text-gray-500">
                {role.permissions.length} permission{role.permissions.length === 1 ? "" : "s"}
              </span>
            </div>
          </div>
        </div>
        {canManage && !protectedRole ? (
          <button
            onClick={() => onEdit(role)}
            className="p-2 rounded-lg text-gray-400 hover:text-brand-600 hover:bg-brand-50 transition-colors flex-shrink-0"
            aria-label={`Edit ${role.name} permissions`}
            title="Edit Permissions"
          >
            <Pencil className="w-4 h-4" />
          </button>
        ) : protectedRole ? (
          <span
            className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-500 border border-gray-200 flex-shrink-0"
            title="System-managed role"
          >
            <Lock className="w-3 h-3" />
            System
          </span>
        ) : null}
      </div>

      <p className="text-sm text-gray-600 mb-5 flex-1">{role.description}</p>

      <div className="space-y-4">
        {groups.map((group) => (
          <div key={group.category}>
            <h5 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
              {CATEGORY_LABELS[group.category] ?? group.category}
            </h5>
            <div className="flex flex-wrap gap-1.5">
              {group.items.map((permission) => (
                <span
                  key={permission.key}
                  className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-gray-50 text-gray-600 border border-gray-200"
                  title={permission.description}
                >
                  {permission.name}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RolesSkeleton() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="card animate-pulse">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-11 h-11 rounded-xl bg-gray-200" />
            <div className="space-y-2">
              <div className="h-4 bg-gray-200 rounded w-28" />
              <div className="h-3 bg-gray-200 rounded w-16" />
            </div>
          </div>
          <div className="h-3 bg-gray-200 rounded w-3/4 mb-2" />
          <div className="h-3 bg-gray-200 rounded w-2/3 mb-6" />
          <div className="flex flex-wrap gap-1.5">
            {Array.from({ length: 6 }, (_, j) => (
              <div key={j} className="h-6 bg-gray-100 rounded-md w-20" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function RolesPage() {
  const { user: currentUser } = useAuth();
  const [editing, setEditing] = useState<Role | null>(null);
  const canManageRoles = can(currentUser?.role, "roles:manage");

  const { data: roles, isLoading, isError } = useQuery({
    queryKey: ["roles"],
    queryFn: () => roleService.getAll(),
  });

  if (isError) {
    return (
      <div className="card text-center py-12">
        <Shield className="w-12 h-12 text-red-300 mx-auto mb-3" />
        <p className="text-gray-700 font-medium">Failed to load roles</p>
        <p className="text-gray-400 text-sm mt-1">
          You may not have permission to view roles
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Role Management</h1>
        <p className="text-sm text-gray-500 mt-1">
          Roles bundle permissions that control access to VigiLens resources
        </p>
      </div>

      {isLoading ? (
        <RolesSkeleton />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {(roles ?? []).map((role) => (
            <RoleCard
              key={role.name}
              role={role}
              canManage={canManageRoles && role.name !== "super_admin"}
              onEdit={setEditing}
            />
          ))}
        </div>
      )}

      <RolePermissionDialog
        open={Boolean(editing)}
        role={editing as Role}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  Loader2,
  RefreshCw,
  UserRound,
  UserRoundX,
  X,
} from "lucide-react";
import { userService } from "@/services/users";
import { showToast } from "@/utils/toast";
import { getApiErrorMessage } from "@/utils/apiError";
import UserAvatar from "@/components/UserAvatar";
import { ROLE_LABELS } from "@/utils/permissions";
import type { CreateUserInput, User, UserRole } from "@/types";

const ROLE_OPTIONS: Array<{ value: UserRole; label: string }> = [
  { value: "super_admin", label: "Super Admin" },
  { value: "admin", label: "Admin" },
  { value: "operator", label: "Operator" },
  { value: "viewer", label: "Viewer" },
];

interface UserFormDialogProps {
  open: boolean;
  onClose: () => void;
  user?: User | null;
}

function UserFormDialog({ open, onClose, user }: UserFormDialogProps) {
  const isEdit = Boolean(user);
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("operator");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState("");

  useEffect(() => {
    if (open) {
      setName(user?.name ?? "");
      setEmail(user?.email ?? "");
      setPassword("");
      setRole(user?.role ?? "operator");
      setErrors({});
      setServerError("");
    }
  }, [open, user]);

  const mutation = useMutation({
    mutationFn: () => {
      if (isEdit && user) {
        return userService.update(user.id, {
          name: name.trim(),
          email: email.trim(),
        });
      }
      const input: CreateUserInput = {
        name: name.trim(),
        email: email.trim(),
        role,
        password,
      };
      return userService.create(input);
    },
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      showToast({
        severity: "info",
        title: isEdit ? "User updated" : "User created",
        message: `${saved.name} (${saved.email})`,
      });
      onClose();
    },
    onError: (err) => {
      setServerError(getApiErrorMessage(err));
    },
  });

  if (!open) return null;

  const validate = () => {
    const next: Record<string, string> = {};
    if (name.trim().length < 2) next.name = "Name must be at least 2 characters";
    if (name.length > 100) next.name = "Name must be 100 characters or less";
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) next.email = "Enter a valid email address";
    if (!isEdit && password.length < 8) {
      next.password = "Password must be at least 8 characters";
    }
    return next;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const fieldErrors = validate();
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length > 0) return;
    setServerError("");
    mutation.mutate();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50 backdrop-enter" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto drawer-enter">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 sticky top-0 bg-white">
          <h3 className="text-lg font-semibold text-gray-900">
            {isEdit ? "Edit User" : "Add User"}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {serverError && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              {serverError}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setErrors({});
                setServerError("");
              }}
              className={`input ${errors.name ? "border-red-400 focus:ring-red-500" : ""}`}
              placeholder="Jane Cooper"
            />
            {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
            <input
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setErrors({});
                setServerError("");
              }}
              className={`input ${errors.email ? "border-red-400 focus:ring-red-500" : ""}`}
              placeholder="jane@vigilens.io"
            />
            {errors.email && <p className="text-xs text-red-500 mt-1">{errors.email}</p>}
          </div>

          {!isEdit && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Temporary Password *
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setErrors({});
                }}
                className={`input ${errors.password ? "border-red-400 focus:ring-red-500" : ""}`}
                placeholder="Minimum 8 characters"
              />
              {errors.password && (
                <p className="text-xs text-red-500 mt-1">{errors.password}</p>
              )}
            </div>
          )}

          {!isEdit && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Role *</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as UserRole)}
                className="input"
              >
                {ROLE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {isEdit && user && (
            <div className="flex items-center justify-between gap-3 p-3 bg-gray-50 border border-gray-200 rounded-lg">
              <div>
                <p className="text-sm font-medium text-gray-700">Current Role</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Use “Assign Role” to change access level
                </p>
              </div>
              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-brand-50 text-brand-700 border border-brand-100">
                {ROLE_LABELS[role]}
              </span>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={mutation.isPending} className="btn-primary flex items-center gap-2">
              {mutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              {isEdit ? "Save Changes" : "Add User"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function AddUserDialog(props: Omit<UserFormDialogProps, "user">) {
  return <UserFormDialog {...props} user={null} />;
}

export function EditUserDialog(props: UserFormDialogProps) {
  return <UserFormDialog {...props} />;
}

interface DeleteUserDialogProps {
  open: boolean;
  onClose: () => void;
  user: User;
}

export function DeleteUserDialog({ open, onClose, user }: DeleteUserDialogProps) {
  const queryClient = useQueryClient();
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: () => userService.remove(user.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      showToast({
        severity: "info",
        title: "User deleted",
        message: `${user.name} has been removed`,
      });
      onClose();
    },
    onError: (err) => {
      setError(getApiErrorMessage(err));
    },
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50 backdrop-enter" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md mx-4 drawer-enter">
        <div className="p-6">
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 mb-4">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <div className="flex items-start gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-5 h-5 text-red-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Delete User</h3>
              <div className="flex items-center gap-2 mt-2">
                <UserAvatar name={user.name} avatar={user.avatar} size="sm" />
                <div>
                  <p className="text-sm font-medium text-gray-900">{user.name}</p>
                  <p className="text-sm text-gray-500">{user.email}</p>
                </div>
              </div>
              <p className="text-sm text-gray-500 mt-3">
                This will permanently remove the account and revoke access. This action
                cannot be undone.
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button onClick={onClose} className="btn-secondary">Cancel</button>
            <button
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {mutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Delete User
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface AssignRoleDialogProps {
  open: boolean;
  onClose: () => void;
  user: User;
}

export function AssignRoleDialog({ open, onClose, user }: AssignRoleDialogProps) {
  const queryClient = useQueryClient();
  const [role, setRole] = useState<UserRole>(user.role);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setRole(user.role);
      setError("");
    }
  }, [open, user]);

  const mutation = useMutation({
    mutationFn: () => userService.assignRole(user.id, role),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      showToast({
        severity: "info",
        title: "Role updated",
        message: `${updated.name} is now a ${ROLE_LABELS[updated.role]}`,
      });
      onClose();
    },
    onError: (err) => {
      setError(getApiErrorMessage(err));
    },
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50 backdrop-enter" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md mx-4 drawer-enter">
        <div className="p-6">
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 mb-4">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-full bg-brand-50 flex items-center justify-center flex-shrink-0">
              <UserRound className="w-5 h-5 text-brand-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Assign Role</h3>
              <p className="text-sm text-gray-500">
                Change the access level for <strong>{user.name}</strong>
              </p>
            </div>
          </div>

          <div className="space-y-2">
            {ROLE_OPTIONS.map((option) => (
              <label
                key={option.value}
                className={`flex items-center justify-between gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                  role === option.value
                    ? "border-brand-500 bg-brand-50"
                    : "border-gray-200 hover:bg-gray-50"
                }`}
              >
                <span className="text-sm font-medium text-gray-700">{option.label}</span>
                <input
                  type="radio"
                  name="role"
                  value={option.value}
                  checked={role === option.value}
                  onChange={() => setRole(option.value)}
                  className="w-4 h-4"
                />
              </label>
            ))}
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button onClick={onClose} className="btn-secondary">Cancel</button>
            <button
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending || role === user.role}
              className="btn-primary flex items-center gap-2"
            >
              {mutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Assign Role
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface ToggleStatusDialogProps {
  open: boolean;
  onClose: () => void;
  user: User;
}

export function ToggleStatusDialog({ open, onClose, user }: ToggleStatusDialogProps) {
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const disabling = user.status === "active";

  const mutation = useMutation({
    mutationFn: () => userService.setStatus(user.id, disabling ? "disabled" : "active"),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      showToast({
        severity: "info",
        title: disabling ? "User disabled" : "User enabled",
        message: `${updated.name} is now ${disabling ? "disabled" : "active"}`,
      });
      onClose();
    },
    onError: (err) => {
      setError(getApiErrorMessage(err));
    },
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50 backdrop-enter" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md mx-4 drawer-enter">
        <div className="p-6">
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 mb-4">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <div className="flex items-start gap-3 mb-4">
            <div
              className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                disabling ? "bg-amber-100" : "bg-green-100"
              }`}
            >
              {disabling ? (
                <UserRoundX className="w-5 h-5 text-amber-600" />
              ) : (
                <CheckCircle2 className="w-5 h-5 text-green-600" />
              )}
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">
                {disabling ? "Disable User" : "Enable User"}
              </h3>
              <div className="flex items-center gap-2 mt-2">
                <UserAvatar name={user.name} avatar={user.avatar} size="sm" />
                <div>
                  <p className="text-sm font-medium text-gray-900">{user.name}</p>
                  <p className="text-sm text-gray-500">{user.email}</p>
                </div>
              </div>
              <p className="text-sm text-gray-500 mt-3">
                {disabling
                  ? "The user will be signed out and blocked from logging in until re-enabled."
                  : "The user will regain access to the platform."}
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button onClick={onClose} className="btn-secondary">Cancel</button>
            <button
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending}
              className={`px-4 py-2 text-white rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2 ${
                disabling
                  ? "bg-amber-600 hover:bg-amber-700"
                  : "bg-green-600 hover:bg-green-700"
              }`}
            >
              {mutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              {disabling ? "Disable User" : "Enable User"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface ResetPasswordDialogProps {
  open: boolean;
  onClose: () => void;
  user: User;
}

export function ResetPasswordDialog({ open, onClose, user }: ResetPasswordDialogProps) {
  const queryClient = useQueryClient();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) {
      setPassword("");
      setError("");
      setErrors({});
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: () => userService.resetPassword(user.id, password),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      showToast({
        severity: "info",
        title: "Password reset",
        message: `Password updated for ${user.name}`,
      });
      onClose();
    },
    onError: (err) => {
      setError(getApiErrorMessage(err));
    },
  });

  const validate = () => {
    const next: Record<string, string> = {};
    if (password.length < 8) next.password = "Password must be at least 8 characters";
    return next;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const fieldErrors = validate();
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length > 0) return;
    setError("");
    mutation.mutate();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50 backdrop-enter" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md mx-4 drawer-enter">
        <div className="p-6">
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 mb-4">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <div className="flex items-start gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-brand-50 flex items-center justify-center flex-shrink-0">
              <KeyRound className="w-5 h-5 text-brand-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Reset Password</h3>
              <div className="flex items-center gap-2 mt-2">
                <UserAvatar name={user.name} avatar={user.avatar} size="sm" />
                <div>
                  <p className="text-sm font-medium text-gray-900">{user.name}</p>
                  <p className="text-sm text-gray-500">{user.email}</p>
                </div>
              </div>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                New Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setErrors({});
                  setError("");
                }}
                className={`input ${errors.password ? "border-red-400 focus:ring-red-500" : ""}`}
                placeholder="Minimum 8 characters"
                autoFocus
              />
              {errors.password && (
                <p className="text-xs text-red-500 mt-1">{errors.password}</p>
              )}
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
              <button
                type="submit"
                disabled={mutation.isPending}
                className="btn-primary flex items-center gap-2"
              >
                {mutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                <RefreshCw className="w-4 h-4" />
                Reset Password
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

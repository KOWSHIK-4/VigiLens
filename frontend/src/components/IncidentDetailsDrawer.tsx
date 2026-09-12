import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  Camera,
  Flag,
  GitBranch,
  Loader2,
  MessageSquare,
  User,
  UserPlus,
  X,
} from "lucide-react";
import { incidentService } from "@/services/incidents";
import { userService } from "@/services/users";
import { showToast } from "@/utils/toast";
import { formatDateTime, formatRelativeTime } from "@/utils/format";
import { getSeverityStyle } from "@/utils/statusConfig";
import type { Incident, IncidentStatus } from "@/types";
import { useAuth } from "@/hooks/useAuth";
import { hasPermission } from "@/utils/permissions";

interface IncidentDetailsDrawerProps {
  incident: Incident | null;
  onClose: () => void;
}

const STATUS_STYLES: Record<IncidentStatus, string> = {
  new: "bg-brand-50 text-brand-700 border-brand-200",
  acknowledged: "bg-amber-50 text-amber-700 border-amber-200",
  investigating: "bg-purple-50 text-purple-700 border-purple-200",
  resolved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  reopened: "bg-red-50 text-red-700 border-red-200",
};

const STATUS_LABELS: Record<IncidentStatus, string> = {
  new: "New",
  acknowledged: "Acknowledged",
  investigating: "Investigating",
  resolved: "Resolved",
  reopened: "Reopened",
};

const ACTIVITY_LABELS: Record<string, string> = {
  opened: "Incident opened",
  status_changed: "Status changed",
  assigned: "Assigned",
  unassigned: "Unassigned",
  note_added: "Note added",
  priority_changed: "Priority changed",
  description_set: "Description set",
};

const ACTIVITY_ICONS: Record<string, React.ReactNode> = {
  opened: <Flag className="w-3.5 h-3.5" />,
  status_changed: <GitBranch className="w-3.5 h-3.5" />,
  assigned: <UserPlus className="w-3.5 h-3.5" />,
  unassigned: <User className="w-3.5 h-3.5" />,
  note_added: <MessageSquare className="w-3.5 h-3.5" />,
  priority_changed: <AlertTriangle className="w-3.5 h-3.5" />,
};

export default function IncidentDetailsDrawer({
  incident,
  onClose,
}: IncidentDetailsDrawerProps) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canManage = hasPermission(user, "alerts.manage");
  const closeRef = useRef<HTMLButtonElement>(null);
  const [noteBody, setNoteBody] = useState("");

  useEffect(() => {
    if (!incident) return;
    setNoteBody("");
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", handler);
      document.body.style.overflow = "";
    };
  }, [incident, onClose]);

  const { data: incidentDetail } = useQuery({
    queryKey: ["incidents", incident?.id],
    queryFn: () => incidentService.getById(incident!.id),
    enabled: Boolean(incident?.id),
  });

  const { data: usersData } = useQuery({
    queryKey: ["users", "assignable"],
    queryFn: () => userService.getAll({ limit: 100, status: "active" }),
    enabled: canManage && Boolean(incident?.id),
  });
  const assignableUsers = usersData?.data ?? [];

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["incidents"] });
  };

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: IncidentStatus }) =>
      incidentService.changeStatus(id, status),
    onSuccess: invalidate,
    onError: () => {
      showToast({ severity: "critical", title: "Status change failed", message: "The status transition was rejected." });
    },
  });

  const priorityMutation = useMutation({
    mutationFn: ({ id, priority }: { id: string; priority: "info" | "warning" | "critical" }) =>
      incidentService.changePriority(id, priority),
    onSuccess: invalidate,
    onError: () => {
      showToast({ severity: "critical", title: "Priority update failed", message: "Could not update the incident priority." });
    },
  });

  const assignMutation = useMutation({
    mutationFn: ({ id, assigneeId }: { id: string; assigneeId: string | null }) =>
      incidentService.assign(id, assigneeId),
    onSuccess: invalidate,
    onError: () => {
      showToast({ severity: "critical", title: "Assignment failed", message: "Could not update the incident assignment." });
    },
  });

  const noteMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) =>
      incidentService.addNote(id, body),
    onSuccess: () => {
      setNoteBody("");
      invalidate();
    },
    onError: () => {
      showToast({ severity: "critical", title: "Note failed", message: "Could not add the investigation note." });
    },
  });

  if (!incident) return null;

  const detail = incidentDetail ?? incident;
  const severityStyle = getSeverityStyle(detail.priority);
  const isResolved = detail.status === "resolved";
  const openedAgo = formatRelativeTime(detail.openedAt);

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm backdrop-enter"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Incident details"
        className="fixed top-0 right-0 z-50 h-full w-full max-w-lg bg-white shadow-2xl overflow-y-auto drawer-enter"
      >
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-2">
            <SeverityIcon style={severityStyle} />
            <h2 className="text-lg font-semibold text-gray-900">
              Incident Details
            </h2>
          </div>
          <button
            ref={closeRef}
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            aria-label="Close incident details"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div className={`border rounded-xl p-4 ${severityStyle.bg}`}>
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium border ${STATUS_STYLES[detail.status]}`}
              >
                {STATUS_LABELS[detail.status]}
              </span>
              <span
                className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium border ${severityStyle.badge}`}
              >
                {severityStyle.label} priority
              </span>
              <span className="text-xs text-gray-400">{openedAgo}</span>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mt-3 leading-snug">
              {detail.title}
            </h3>
            {detail.description && (
              <p className="text-sm text-gray-700 mt-1.5 leading-relaxed">
                {detail.description}
              </p>
            )}
            {detail.alert?.detection?.camera && (
              <p className="text-xs text-gray-500 mt-2 flex items-center gap-1.5">
                <Camera className="w-3.5 h-3.5" />
                {detail.alert.detection.camera.name}
                {detail.alert.detection.camera.location &&
                  ` — ${detail.alert.detection.camera.location}`}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <DetailItem label="Opened" value={formatDateTime(detail.openedAt)} />
            <DetailItem label="Created" value={formatDateTime(detail.createdAt)} />
            {detail.acknowledgedAt && (
              <DetailItem label="Acknowledged" value={formatDateTime(detail.acknowledgedAt)} />
            )}
            {detail.investigatingAt && (
              <DetailItem label="Investigating since" value={formatDateTime(detail.investigatingAt)} />
            )}
            {detail.resolvedAt && (
              <DetailItem
                label="Resolved"
                value={`${formatDateTime(detail.resolvedAt)}${detail.resolvedByName ? ` by ${detail.resolvedByName}` : ""}`}
              />
            )}
            <DetailItem
              label="Assignee"
              value={detail.assignedToName ?? "Unassigned"}
            />
            <DetailItem
              label="Alert"
              value={
                detail.alert
                  ? `${detail.alert.severity} · ${detail.alert.title}`
                  : "—"
              }
            />
          </div>

          {canManage && (
            <div className="border-t border-gray-200 pt-4 space-y-4">
              <div>
                <h3 className="text-sm font-medium text-gray-900 mb-2">
                  Status transition
                </h3>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => statusMutation.mutate({ id: detail.id, status: "acknowledged" })}
                    disabled={isResolved || detail.status === "acknowledged" || statusMutation.isPending}
                    className="btn-secondary text-sm"
                  >
                    Acknowledge
                  </button>
                  <button
                    onClick={() => statusMutation.mutate({ id: detail.id, status: "investigating" })}
                    disabled={isResolved || detail.status === "investigating" || statusMutation.isPending}
                    className="btn-secondary text-sm"
                  >
                    Investigate
                  </button>
                  <button
                    onClick={() => statusMutation.mutate({ id: detail.id, status: "resolved" })}
                    disabled={detail.status === "resolved" || statusMutation.isPending}
                    className="btn-secondary text-sm"
                  >
                    Resolve
                  </button>
                  <button
                    onClick={() => statusMutation.mutate({ id: detail.id, status: "reopened" })}
                    disabled={!isResolved || statusMutation.isPending}
                    className="btn-secondary text-sm"
                  >
                    Reopen
                  </button>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-medium text-gray-900 mb-2">
                  Priority
                </h3>
                <div className="flex gap-2">
                  {(["info", "warning", "critical"] as const).map((p) => (
                    <button
                      key={p}
                      onClick={() => priorityMutation.mutate({ id: detail.id, priority: p })}
                      disabled={detail.priority === p || priorityMutation.isPending}
                      className={`text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors ${
                        detail.priority === p
                          ? "bg-brand-600 text-white border-brand-600"
                          : "bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100"
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="text-sm font-medium text-gray-900 mb-2">
                  Assignment
                </h3>
                <div className="flex gap-2 items-center">
                  <select
                    value={detail.assignedToUserId ?? ""}
                    onChange={(e) =>
                      assignMutation.mutate({ id: detail.id, assigneeId: e.target.value || null })
                    }
                    disabled={isResolved || assignMutation.isPending}
                    className="input text-sm flex-1"
                    aria-label="Assign incident"
                  >
                    <option value="">Unassigned</option>
                    {assignableUsers.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.email})
                      </option>
                    ))}
                  </select>
                  {detail.assignedToUserId && !isResolved && (
                    <button
                      onClick={() => assignMutation.mutate({ id: detail.id, assigneeId: null })}
                      disabled={assignMutation.isPending}
                      className="btn-secondary text-sm flex items-center gap-1.5"
                    >
                      <UserPlus className="w-4 h-4" />
                      Unassign
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {canManage && (
            <div className="border-t border-gray-200 pt-4">
              <h3 className="text-sm font-medium text-gray-900 mb-2 flex items-center gap-1.5">
                <MessageSquare className="w-4 h-4 text-brand-600" />
                Investigation notes
              </h3>
              <div className="flex gap-2">
                <textarea
                  value={noteBody}
                  onChange={(e) => setNoteBody(e.target.value)}
                  rows={2}
                  placeholder="Record an investigation note..."
                  className="input text-sm flex-1 resize-none"
                  aria-label="Investigation note body"
                />
                <button
                  onClick={() => noteMutation.mutate({ id: detail.id, body: noteBody })}
                  disabled={!noteBody.trim() || noteMutation.isPending}
                  className="btn-primary h-fit"
                  title="Add note"
                >
                  {noteMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    "Add"
                  )}
                </button>
              </div>
              {detail.notes && detail.notes.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {detail.notes.map((note) => (
                    <li key={note.id} className="rounded-lg bg-gray-50 border border-gray-100 p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-gray-700">
                          {note.authorName}
                        </span>
                        <span className="text-xs text-gray-400" title={formatDateTime(note.createdAt)}>
                          {formatRelativeTime(note.createdAt)}
                        </span>
                      </div>
                      <p className="text-sm text-gray-700 mt-1 whitespace-pre-wrap break-words">
                        {note.body}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="border-t border-gray-200 pt-4">
            <h3 className="text-sm font-medium text-gray-900 mb-3 flex items-center gap-1.5">
              <Activity className="w-4 h-4 text-brand-600" />
              Activity timeline
            </h3>
            {detail.activity && detail.activity.length > 0 ? (
              <ol className="relative border-l border-gray-200 ml-2 space-y-4">
                {detail.activity.map((entry) => (
                  <li key={entry.id} className="ml-4">
                    <span className="absolute -left-[7px] mt-1 w-3 h-3 rounded-full bg-brand-100 border-2 border-brand-400" />
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-gray-800 flex items-center gap-1.5">
                        <span className="text-brand-600">
                          {ACTIVITY_ICONS[entry.action] ?? <Activity className="w-3.5 h-3.5" />}
                        </span>
                        {ACTIVITY_LABELS[entry.action] ?? entry.action}
                      </p>
                      <span className="text-xs text-gray-400 shrink-0" title={formatDateTime(entry.createdAt)}>
                        {formatRelativeTime(entry.createdAt)}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {entry.authorName}
                      {entry.fromValue && entry.toValue
                        ? ` · ${entry.fromValue} → ${entry.toValue}`
                        : entry.toValue
                          ? ` · ${entry.toValue}`
                          : ""}
                    </p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-gray-400">No activity recorded yet.</p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function SeverityIcon({ style }: { style: ReturnType<typeof getSeverityStyle> }) {
  const Icon = style.icon;
  return <Icon className={`w-5 h-5 ${style.iconColor}`} />;
}

function DetailItem({
  icon,
  label,
  value,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div>
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
        {label}
      </p>
      <div className="flex items-center gap-1.5 text-sm text-gray-900">
        {icon}
        <span className="font-medium break-words">{value}</span>
      </div>
    </div>
  );
}
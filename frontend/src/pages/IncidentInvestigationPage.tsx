import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Camera,
  CheckCircle2,
  ClipboardList,
  Flag,
  GitBranch,
  History,
  Loader2,
  MessageSquare,
  Search,
  ShieldAlert,
  User,
  UserPlus,
} from "lucide-react";
import { incidentService } from "@/services/incidents";
import { userService } from "@/services/users";
import { showToast } from "@/utils/toast";
import { formatDateTime, formatRelativeTime } from "@/utils/format";
import { getSeverityStyle } from "@/utils/statusConfig";
import DetectionSnapshot from "@/components/DetectionSnapshot";
import type { IncidentStatus } from "@/types";
import { useAuth } from "@/hooks/useAuth";
import { hasPermission } from "@/utils/permissions";

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
  resolution_updated: "Resolution summary updated",
};

export default function IncidentInvestigationPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canManage = hasPermission(user, "alerts.manage");
  const [noteBody, setNoteBody] = useState("");
  const [resolution, setResolution] = useState("");

  const { data: incident, isLoading, isError, refetch } = useQuery({
    queryKey: ["incidents", id],
    queryFn: () => incidentService.getById(id!),
    enabled: Boolean(id),
  });

  const { data: relatedData } = useQuery({
    queryKey: ["incidents", id, "related-detections"],
    queryFn: () => incidentService.getRelatedDetections(id!),
    enabled: Boolean(id),
  });

  const { data: usersData } = useQuery({
    queryKey: ["users", "assignable"],
    queryFn: () => userService.getAll({ limit: 100, status: "active" }),
    enabled: canManage && Boolean(id),
  });
  const assignableUsers = usersData?.data ?? [];

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["incidents"] });
  };

  const statusMutation = useMutation({
    mutationFn: ({
      incidentId,
      status,
      resolutionSummary,
    }: {
      incidentId: string;
      status: IncidentStatus;
      resolutionSummary?: string;
    }) => incidentService.changeStatus(incidentId, status, resolutionSummary),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["incidents", id] });
      invalidate();
    },
    onError: () => {
      showToast({ severity: "critical", title: "Status change failed", message: "The status transition was rejected." });
    },
  });

  const priorityMutation = useMutation({
    mutationFn: ({ incidentId, priority }: { incidentId: string; priority: "info" | "warning" | "critical" }) =>
      incidentService.changePriority(incidentId, priority),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["incidents", id] });
      invalidate();
    },
    onError: () => {
      showToast({ severity: "critical", title: "Priority update failed", message: "Could not update the incident priority." });
    },
  });

  const assignMutation = useMutation({
    mutationFn: ({ incidentId, assigneeId }: { incidentId: string; assigneeId: string | null }) =>
      incidentService.assign(incidentId, assigneeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["incidents", id] });
      invalidate();
    },
    onError: () => {
      showToast({ severity: "critical", title: "Assignment failed", message: "Could not update the incident assignment." });
    },
  });

  const noteMutation = useMutation({
    mutationFn: ({ incidentId, body }: { incidentId: string; body: string }) =>
      incidentService.addNote(incidentId, body),
    onSuccess: () => {
      setNoteBody("");
      queryClient.invalidateQueries({ queryKey: ["incidents", id] });
      invalidate();
    },
    onError: () => {
      showToast({ severity: "critical", title: "Note failed", message: "Could not add the investigation note." });
    },
  });

  const resolutionMutation = useMutation({
    mutationFn: ({ incidentId, summary }: { incidentId: string; summary: string }) =>
      incidentService.updateResolutionSummary(incidentId, summary),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["incidents", id] });
      invalidate();
    },
    onError: () => {
      showToast({ severity: "critical", title: "Save failed", message: "Could not save the resolution summary." });
    },
  });

  const handleResolve = () => {
    if (!incident) return;
    statusMutation.mutate({
      incidentId: incident.id,
      status: "resolved",
      resolutionSummary: resolution,
    });
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="w-8 h-8 animate-spin text-brand-600" />
      </div>
    );
  }

  if (isError || !incident) {
    return (
      <div className="card flex flex-col items-center gap-3 border-red-200 bg-red-50 py-10 text-center">
        <ShieldAlert className="w-8 h-8 text-red-500" />
        <p className="font-semibold text-red-700">Failed to load incident</p>
        {isError && (
          <button onClick={() => refetch()} className="btn-secondary">
            Try again
          </button>
        )}
      </div>
    );
  }

  const detail = incident;
  const severityStyle = getSeverityStyle(detail.priority);
  const isResolved = detail.status === "resolved";
  const baseDetection = relatedData?.detection;
  const relatedDetections = relatedData?.related ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          onClick={() => navigate("/incidents")}
          className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1.5"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to incidents
        </button>
        <div className="flex items-center gap-2">
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
        </div>
      </div>

      <div className={`border rounded-xl p-5 ${severityStyle.bg}`}>
        <h1 className="text-xl font-bold text-gray-900 leading-snug">{detail.title}</h1>
        {detail.description && (
          <p className="text-sm text-gray-700 mt-1.5 leading-relaxed">{detail.description}</p>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-3 text-sm text-gray-600">
          <span className="flex items-center gap-1.5">
            <Camera className="w-4 h-4" />
            {detail.alert?.detection?.camera?.name ?? "Unknown camera"}
            {detail.alert?.detection?.camera?.location
              ? ` — ${detail.alert.detection.camera.location}`
              : ""}
          </span>
          <span className="flex items-center gap-1.5">
            <User className="w-4 h-4" />
            {detail.assignedToName ?? "Unassigned"}
          </span>
          <span className="text-xs text-gray-500 flex items-center gap-1.5">
            <History className="w-3.5 h-3.5" />
            Opened {formatRelativeTime(detail.openedAt)}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <TimelineItem label="Opened" value={detail.openedAt} icon={<Flag className="w-4 h-4" />} />
        <TimelineItem label="Acknowledged" value={detail.acknowledgedAt} icon={<CheckCircle2 className="w-4 h-4" />} />
        <TimelineItem label="Investigating" value={detail.investigatingAt} icon={<Search className="w-4 h-4" />} />
        <TimelineItem label="Resolved" value={detail.resolvedAt} icon={<CheckCircle2 className="w-4 h-4" />} />
        <TimelineItem
          label="Assignee"
          value={detail.assignedToName ?? "Unassigned"}
          icon={<User className="w-4 h-4" />}
        />
      </div>

      {baseDetection && (
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <Camera className="w-4 h-4 text-brand-600" />
            Triggering detection
          </h2>
          <div className="flex items-start gap-4">
            <div className="w-32 h-32 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
              <DetectionSnapshot imageUrl={baseDetection.imageUrl} alt={baseDetection.label} />
            </div>
            <div className="text-sm text-gray-600">
              <p className="font-medium text-gray-900">{baseDetection.label}</p>
              <p className="mt-1">
                Confidence: {(baseDetection.confidence * 100).toFixed(1)}%
              </p>
              <p className="mt-1">{formatDateTime(baseDetection.timestamp)}</p>
              <Link
                to="/detections"
                state={{ highlightDetection: baseDetection }}
                className="text-brand-600 hover:text-brand-700 text-xs font-medium mt-2 inline-block"
              >
                View in detections feed
              </Link>
            </div>
          </div>
        </div>
      )}

      {canManage && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="card p-5 space-y-4">
            <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              <GitBranch className="w-4 h-4 text-brand-600" />
              Workflow actions
            </h2>
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
                Status transition
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => statusMutation.mutate({ incidentId: detail.id, status: "acknowledged" })}
                  disabled={isResolved || detail.status === "acknowledged" || statusMutation.isPending}
                  className="btn-secondary text-sm"
                >
                  Acknowledge
                </button>
                <button
                  onClick={() => statusMutation.mutate({ incidentId: detail.id, status: "investigating" })}
                  disabled={isResolved || detail.status === "investigating" || statusMutation.isPending}
                  className="btn-secondary text-sm"
                >
                  Investigate
                </button>
                <button
                  onClick={handleResolve}
                  disabled={detail.status === "resolved" || statusMutation.isPending}
                  className="btn-secondary text-sm"
                >
                  Resolve
                </button>
                <button
                  onClick={() => statusMutation.mutate({ incidentId: detail.id, status: "reopened" })}
                  disabled={!isResolved || statusMutation.isPending}
                  className="btn-secondary text-sm"
                >
                  Reopen
                </button>
              </div>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
                Priority
              </p>
              <div className="flex gap-2">
                {(["info", "warning", "critical"] as const).map((p) => (
                  <button
                    key={p}
                    onClick={() => priorityMutation.mutate({ incidentId: detail.id, priority: p })}
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
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
                Assignment
              </p>
              <div className="flex gap-2 items-center">
                <select
                  value={detail.assignedToUserId ?? ""}
                  onChange={(e) =>
                    assignMutation.mutate({ incidentId: detail.id, assigneeId: e.target.value || null })
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
                    onClick={() => assignMutation.mutate({ incidentId: detail.id, assigneeId: null })}
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

          <div className="card p-5 space-y-5">
            <div>
              <h2 className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-brand-600" />
                Investigation notes
              </h2>
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
                  onClick={() => noteMutation.mutate({ incidentId: detail.id, body: noteBody })}
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
                        <span className="text-xs font-medium text-gray-700">{note.authorName}</span>
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

            <div className="border-t border-gray-200 pt-4">
              <h2 className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-2">
                <ClipboardList className="w-4 h-4 text-brand-600" />
                Resolution summary
              </h2>
              <textarea
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                rows={3}
                placeholder="Root cause, actions taken and lessons learned..."
                className="input text-sm w-full resize-none"
                aria-label="Resolution summary"
              />
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => resolutionMutation.mutate({ incidentId: detail.id, summary: resolution })}
                  disabled={!resolution.trim() || resolutionMutation.isPending}
                  className="btn-secondary text-sm"
                  title="Save draft resolution summary"
                >
                  Save summary
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {detail.resolutionSummary && (
        <div className="card p-5 border-emerald-200 bg-emerald-50">
          <h2 className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            Resolution summary
          </h2>
          <p className="text-sm text-gray-700 whitespace-pre-wrap break-words">
            {detail.resolutionSummary}
          </p>
          {detail.resolvedByName && (
            <p className="text-xs text-gray-500 mt-2">
              Resolved by {detail.resolvedByName} on {formatDateTime(detail.resolvedAt ?? "")}
            </p>
          )}
        </div>
      )}

      {relatedDetections.length > 0 && (
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            Related detections · same camera window
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {relatedDetections.map((det) => (
              <div
                key={det.id}
                className="rounded-lg border border-gray-200 p-3 flex items-start gap-3"
              >
                <div className="w-14 h-14 rounded-md overflow-hidden bg-gray-100 flex-shrink-0">
                  <DetectionSnapshot imageUrl={det.imageUrl} alt={det.label} />
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 text-sm truncate">{det.label}</p>
                  <p className="text-xs text-gray-500">
                    {(det.confidence * 100).toFixed(1)}% confidence
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5" title={formatDateTime(det.timestamp)}>
                    {formatRelativeTime(det.timestamp)}
                  </p>
                  {det.status === "critical" && (
                    <span className="inline-flex mt-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-50 text-red-700 border border-red-200 uppercase tracking-wide">
                      critical
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card p-5">
        <h2 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <Activity className="w-4 h-4 text-brand-600" />
          Activity timeline
        </h2>
        {detail.activity && detail.activity.length > 0 ? (
          <ol className="relative border-l border-gray-200 ml-2 space-y-4">
            {detail.activity.map((entry) => (
              <li key={entry.id} className="ml-4">
                <span className="absolute -left-[7px] mt-1 w-3 h-3 rounded-full bg-brand-100 border-2 border-brand-400" />
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-gray-800 flex items-center gap-1.5">
                    <span className="text-brand-600">
                      <Activity className="w-3.5 h-3.5" />
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
  );
}

function TimelineItem({
  label,
  value,
  icon,
}: {
  label: string;
  value: string | null;
  icon: React.ReactNode;
}) {
  return (
    <div className="card p-3">
      <div className="flex items-center gap-1.5 text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
        {icon}
        {label}
      </div>
      <p className="text-sm font-semibold text-gray-900">
        {value ? (
          <span title={formatDateTime(value)}>{formatRelativeTime(value)}</span>
        ) : (
          <span className="text-gray-400 font-normal">—</span>
        )}
      </p>
    </div>
  );
}
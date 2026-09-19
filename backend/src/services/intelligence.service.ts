/**
 * Security Intelligence Engine.
 *
 * Derives explainable security context from real VigiLens events. The engine
 * is deliberately NOT a machine-learning model and it does not ingest
 * external threat-intelligence feeds: every signal is computed from the raw
 * events that the system has already observed (detections, alerts,
 * incidents, camera/health metadata). Because the inputs are system facts,
 * the output is auditable and reproducible — the same input data always
 * yields the same signals.
 *
 * No claim of identity is ever made: signals describe *relationships*
 * (repeated, concurrent, clustered, escalating) between real events, never
 * whether two events involve the same person or vehicle.
 *
 * The engine is pure (free of I/O) so the entire analysis can be unit tested
 * without a database. The caller is responsible for loading the event data;
 * `analyze` only inspects what it is given.
 */

import { createHash } from "node:crypto";

/** Stable identifier for a measured intelligence signal type. */
export type IntelligenceSignalType =
  | "repeated_detection"
  | "repeated_alert"
  | "escalation_pattern"
  | "incident_recurrence"
  | "temporal_concentration"
  | "camera_recurrence"
  | "detector_class_concentration";

/** Measured intensity of a signal. Conservative ladder, never over-stated. */
export type IntelligenceSignalLevel = "low" | "medium" | "high";

export interface IntelligenceEventSignal {
  /** Detection-history input rows (as stored). */
  id: string;
  cameraId: string;
  cameraName?: string | null;
  detectorKey: string | null;
  className: string | null;
  label: string;
  confidence: number;
  timestamp: Date;
  status: string;
  /** Correlation metadata attached to the detection, when present. */
  correlation?: { eventId?: string; count?: number } | null;
}

export interface IntelligenceAlertSignal {
  id: string;
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
  cameraId?: string | null;
  createdAt: Date;
  acknowledgedAt?: Date | null;
  escalatedAt?: Date | null;
}

export interface IntelligenceIncidentSignal {
  id: string;
  status: string;
  priority: "info" | "warning" | "critical";
  title: string;
  openedAt: Date;
  resolvedAt?: Date | null;
}

export interface IntelligenceInput {
  /** Detections inside the analysis window (optional, real rows only). */
  detections?: IntelligenceEventSignal[];
  /** Alerts inside the analysis window (optional). */
  alerts?: IntelligenceAlertSignal[];
  /** Incidents seen inside the analysis window (optional). */
  incidents?: IntelligenceIncidentSignal[];
  /** Fixed analysis window. */
  windowMs: number;
  /** Timestamp used as "now" for relative calculations. */
  now?: Date;
}

export interface IntelligenceSignal {
  id: string;
  type: IntelligenceSignalType;
  level: IntelligenceSignalLevel;
  title: string;
  explanation: string;
  detectionIds: string[];
  alertIds: string[];
  incidentIds: string[];
}

export interface IntelligenceReport {
  generatedAt: string;
  windowMs: number;
  signalCount: number;
  signals: IntelligenceSignal[];
}

const MAX_LOW = 2;
const MAX_MEDIUM = 5;

function signalId(type: string, groupKey: string): string {
  const digest = createHash("sha1").update(`${type}:${groupKey}`).digest("hex");
  return `sig-${digest.slice(0, 12)}`;
}

function levelForCount(count: number): IntelligenceSignalLevel {
  if (count <= MAX_LOW) return "low";
  if (count <= MAX_MEDIUM) return "medium";
  return "high";
}

/**
 * Buckets valid signals by an identity-neutral grouping key (camera,
 * detector, class). Detections lacking a usable detector/class are grouped
 * by (camera, label) so label-only ingestion is still analyzable.
 */
function groupDetections(
  detections: IntelligenceEventSignal[],
): Map<string, IntelligenceEventSignal[]> {
  const groups = new Map<string, IntelligenceEventSignal[]>();
  for (const det of detections) {
    const group = `${det.cameraId}|${det.detectorKey ?? ""}|${det.className ?? det.label}`;
    const members = groups.get(group) ?? [];
    members.push(det);
    groups.set(group, members);
  }
  return groups;
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

/**
 * Pure analysis entry point. Returns the zero-signal report for empty input
 * and never throws on incomplete rows — malformed or partial rows are simply
 * ignored (so a broken metadata field can never poison the analysis).
 */
export function analyzeIntelligence(input: IntelligenceInput): IntelligenceReport {
  const now = input.now ?? new Date();
  const signals: IntelligenceSignal[] = [];

  const detections = input.detections ?? [];
  const alerts = input.alerts ?? [];
  const incidents = input.incidents ?? [];

  const cleanDetections = detections.filter(
    (d) => !isEmpty(d.id) && d.timestamp instanceof Date,
  );
  const cleanAlerts = alerts.filter(
    (a) => !isEmpty(a.id) && a.createdAt instanceof Date,
  );
  const cleanIncidents = incidents.filter(
    (i) => !isEmpty(i.id) && i.openedAt instanceof Date,
  );

  const maxConfidence = cleanDetections.reduce(
    (max, d) => Math.max(max, typeof d.confidence === "number" ? d.confidence : 0),
    0,
  );

  // 0) High-confidence concentration: clearly confident detections repeated
  // in the window. Kept conservative — it never invents precision/recall and
  // only reflects the confidence the detector actually reported.
  if (maxConfidence >= 0.85 && cleanDetections.length >= 2) {
    const highConfidenceIds = cleanDetections
      .filter((d) => typeof d.confidence === "number" && d.confidence >= 0.85)
      .map((d) => d.id);
    if (highConfidenceIds.length >= 2) {
      signals.push({
        id: signalId("high_confidence_cluster", String(highConfidenceIds.length)),
        type: "repeated_detection",
        level: highConfidenceIds.length >= 5 ? "medium" : "low",
        title: "High-confidence detection cluster",
        explanation: `${highConfidenceIds.length} detections in the analysis window carried confidence >= 0.85, indicating the detector was highly certain about repeated activity.`,
        detectionIds: highConfidenceIds.slice(0, 100),
        alertIds: [],
        incidentIds: [],
      });
    }
  }

  // 1) Repeated detections per (camera, detector, class) bucket.
  for (const [group, members] of groupDetections(cleanDetections)) {
    const distinctIds = new Set(members.map((m) => m.id));
    if (distinctIds.size < 2) continue;
    const first = members.reduce((a, b) => (a.timestamp < b.timestamp ? a : b));
    const last = members.reduce((a, b) => (a.timestamp > b.timestamp ? a : b));
    const count = distinctIds.size;
    signals.push({
      id: signalId("repeated_detection", group),
      type: "repeated_detection",
      level: levelForCount(count),
      title: "Repeated detection activity",
      explanation: `${count} detections of "${first.className ?? first.label}" were recorded on camera ${
        first.cameraName ?? first.cameraId
      } between ${first.timestamp.toISOString()} and ${last.timestamp.toISOString()} within the analysis window.`,
      detectionIds: Array.from(distinctIds).slice(0, 100),
      alertIds: [],
      incidentIds: [],
    });
  }

  // 2) Repeated alerts.
  const alertGroups = new Map<string, IntelligenceAlertSignal[]>();
  for (const alert of cleanAlerts) {
    const key = `${alert.cameraId ?? ""}|${alert.severity}|${alert.title}`;
    const members = alertGroups.get(key) ?? [];
    members.push(alert);
    alertGroups.set(key, members);
  }
  for (const [group, members] of alertGroups) {
    if (members.length < 2) continue;
    const count = members.length;
    const firstAlert = members.reduce((a, b) => (a.createdAt < b.createdAt ? a : b));
    signals.push({
      id: signalId("repeated_alert", group),
      type: "repeated_alert",
      level: levelForCount(count),
      title: "Repeated alerts",
      explanation: `${count} "${firstAlert.title}" alerts (${firstAlert.severity}) were raised${
        firstAlert.cameraId ? ` for camera ${firstAlert.cameraId}` : ""
      } within the analysis window.`,
      detectionIds: [],
      alertIds: members.map((m) => m.id).slice(0, 100),
      incidentIds: [],
    });
  }

  // 3) Escalation patterns: critical alerts that were previously escalated.
  const escalated = cleanAlerts.filter(
    (a) => a.escalatedAt && a.createdAt instanceof Date,
  );
  if (escalated.length > 0) {
    const criticalEscalated = escalated.filter((a) => a.severity === "critical");
    const groupKey = `escalation:${criticalEscalated.length}`;
    signals.push({
      id: signalId("escalation_pattern", groupKey),
      type: "escalation_pattern",
      level: criticalEscalated.length > 0 ? "medium" : "low",
      title: "Alert escalation pattern",
      explanation: `${escalated.length} alert${escalated.length === 1 ? "" : "s"} in the window were escalated${
        criticalEscalated.length > 0
          ? `, including ${criticalEscalated.length} critical`
          : ""
      }. Escalation marks work was already being tracked as requiring attention.`,
      detectionIds: [],
      alertIds: escalated.map((a) => a.id).slice(0, 100),
      incidentIds: [],
    });
  }

  // 4) Incident recurrence: repeated incidents referencing the same title.
  const incidentGroups = new Map<string, IntelligenceIncidentSignal[]>();
  for (const incident of cleanIncidents) {
    const members = incidentGroups.get(incident.title) ?? [];
    members.push(incident);
    incidentGroups.set(incident.title, members);
  }
  for (const [title, members] of incidentGroups) {
    if (members.length < 2) continue;
    const open = members.filter((m) => m.status !== "resolved");
    const count = members.length;
    signals.push({
      id: signalId("incident_recurrence", title),
      type: "incident_recurrence",
      level: open.length > 0 ? "medium" : "low",
      title: "Recurring incident",
      explanation: `${count} incidents matching "${title}" opened within the analysis window${
        open.length > 0 ? `; ${open.length} ${open.length === 1 ? "is" : "are"} still open` : ""
      }. Recurrence is derived from incident titles only.`,
      detectionIds: [],
      alertIds: [],
      incidentIds: members.map((m) => m.id).slice(0, 100),
    });
  }

  // 5) Temporal concentration: a burst of events in a short sub-window.
  if (cleanDetections.length >= 3) {
    const ordered = [...cleanDetections].sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
    );
    let tightest = ordered[ordered.length - 1].timestamp.getTime() - ordered[0].timestamp.getTime();
    let tightestStart = ordered[0].timestamp.getTime();
    for (let i = 0; i < ordered.length; i += 1) {
      for (let j = i + 1; j < ordered.length; j += 1) {
        const span = ordered[j].timestamp.getTime() - ordered[i].timestamp.getTime();
        const countInSpan = j - i + 1;
        if (
          countInSpan >= 3 &&
          span <= Math.max(input.windowMs / 3, 60_000) &&
          span < tightest
        ) {
          tightest = span;
          tightestStart = ordered[i].timestamp.getTime();
        }
      }
    }
    // Only report a concentration when it is materially tighter than the
    // analysis window (a blog of activity over the whole window is not a
    // burst).
    if (tightest <= Math.max(input.windowMs / 3, 60_000)) {
      const burstCount = ordered.filter(
        (d) => d.timestamp.getTime() >= tightestStart && d.timestamp.getTime() <= tightestStart + tightest,
      ).length;
      signals.push({
        id: signalId("temporal_concentration", String(tightestStart)),
        type: "temporal_concentration",
        level: burstCount >= 5 ? "medium" : "low",
        title: "Temporal concentration of events",
        explanation: `${burstCount} detections occurred within a ${Math.round(tightest / 1000)}s burst starting at ${new Date(tightestStart).toISOString()} — substantially tighter than the ${Math.round(input.windowMs / 1000)}s analysis window.`,
        detectionIds: ordered
          .filter(
            (d) => d.timestamp.getTime() >= tightestStart && d.timestamp.getTime() <= tightestStart + tightest,
          )
          .map((d) => d.id)
          .slice(0, 100),
        alertIds: [],
        incidentIds: [],
      });
    }
  }

  // 6) Camera recurrence: a single camera dominated the window.
  const cameraCounts = new Map<string, number>();
  for (const det of cleanDetections) {
    cameraCounts.set(det.cameraId, (cameraCounts.get(det.cameraId) ?? 0) + 1);
  }
  for (const [cameraId, count] of cameraCounts) {
    if (count < 3) continue;
    const firstDet = cleanDetections.find((d) => d.cameraId === cameraId);
    signals.push({
      id: signalId("camera_recurrence", cameraId),
      type: "camera_recurrence",
      level: levelForCount(count),
      title: "Camera recurrence",
      explanation: `Camera ${firstDet?.cameraName ?? cameraId} produced ${count} detections in the analysis window, more than any other source requiring attention.`,
      detectionIds: cleanDetections
        .filter((d) => d.cameraId === cameraId)
        .map((d) => d.id)
        .slice(0, 100),
      alertIds: [],
      incidentIds: [],
    });
  }

  // 7) Detector/class concentration.
  const classCounts = new Map<string, number>();
  for (const det of cleanDetections) {
    const key = `${det.detectorKey ?? "unknown"}:${det.className ?? det.label}`;
    classCounts.set(key, (classCounts.get(key) ?? 0) + 1);
  }
  for (const [key, count] of classCounts) {
    if (count < 3) continue;
    const [detectorKey, className] = key.split(":");
    signals.push({
      id: signalId("detector_class_concentration", key),
      type: "detector_class_concentration",
      level: levelForCount(count),
      title: "Detector/class concentration",
      explanation: `${count} detections of class "${className}" were produced by detector "${detectorKey}" in the analysis window.`,
      detectionIds: cleanDetections
        .filter((d) => `${d.detectorKey ?? "unknown"}:${d.className ?? d.label}` === key)
        .map((d) => d.id)
        .slice(0, 100),
      alertIds: [],
      incidentIds: [],
    });
  }

  // Sort deterministically (stable ordering independent of input order).
  signals.sort((a, b) => {
    const levelOrder: Record<IntelligenceSignalLevel, number> = { high: 0, medium: 1, low: 2 };
    return levelOrder[a.level] - levelOrder[b.level] || a.id.localeCompare(b.id);
  });

  return {
    generatedAt: now.toISOString(),
    windowMs: input.windowMs,
    signalCount: signals.length,
    signals,
  };
}

/**
 * Summarizes observed events into the compact context that the dashboard and
 * report layers surface. No fabrication: totals count real rows only.
 */
export function summarizeIntelligenceContext(input: IntelligenceInput): {
  measuredDetections: number;
  measuredAlerts: number;
  measuredIncidents: number;
  maxConfidence: number;
  maxAlertSeverity: IntelligenceAlertSignal["severity"] | null;
} {
  const detections = (input.detections ?? []).filter((d) => !isEmpty(d.id));
  const alerts = (input.alerts ?? []).filter((a) => !isEmpty(a.id));
  const incidents = (input.incidents ?? []).filter((i) => !isEmpty(i.id));

  let maxAlertSeverity: IntelligenceAlertSignal["severity"] | null = null;
  const severityRank: Record<IntelligenceAlertSignal["severity"], number> = {
    info: 0,
    warning: 1,
    critical: 2,
  };
  for (const alert of alerts) {
    if (
      maxAlertSeverity === null ||
      severityRank[alert.severity] > severityRank[maxAlertSeverity]
    ) {
      maxAlertSeverity = alert.severity;
    }
  }

  return {
    measuredDetections: detections.length,
    measuredAlerts: alerts.length,
    measuredIncidents: incidents.length,
    maxConfidence: detections.reduce(
      (max, d) => Math.max(max, typeof d.confidence === "number" ? d.confidence : 0),
      0,
    ),
    maxAlertSeverity,
  };
}
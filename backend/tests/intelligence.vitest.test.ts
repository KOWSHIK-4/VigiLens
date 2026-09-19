/**
 * Security intelligence engine — pure unit tests.
 *
 * The engine must be deterministic, explainable and derived strictly from
 * the events it is given. These tests pin that contract without a database.
 */

import { describe, expect, it } from "vitest";
import {
  analyzeIntelligence,
  summarizeIntelligenceContext,
  type IntelligenceAlertSignal,
  type IntelligenceEventSignal,
  type IntelligenceIncidentSignal,
} from "../src/services/intelligence.service";

const NOW = new Date("2026-09-18T12:00:00.000Z");
const WINDOW = 30 * 60 * 1000;

function detection(partial: Partial<IntelligenceEventSignal> & { id: string }): IntelligenceEventSignal {
  return {
    cameraId: "cam-1",
    detectorKey: "person",
    className: "person",
    label: "person",
    confidence: 0.9,
    timestamp: new Date("2026-09-18T11:50:00.000Z"),
    status: "critical",
    ...partial,
  };
}

function alert(partial: Partial<IntelligenceAlertSignal> & { id: string }): IntelligenceAlertSignal {
  return {
    id: partial.id,
    severity: "critical",
    title: "Critical Detection: person",
    message: "person detected",
    cameraId: "cam-1",
    createdAt: new Date("2026-09-18T11:50:00.000Z"),
    ...partial,
  };
}

function incident(partial: Partial<IntelligenceIncidentSignal> & { id: string }): IntelligenceIncidentSignal {
  return {
    id: partial.id,
    status: "new",
    priority: "critical",
    title: "Critical Detection: person",
    openedAt: new Date("2026-09-18T11:51:00.000Z"),
    ...partial,
  };
}

describe("analyzeIntelligence", () => {
  it("returns an empty (zero-signal) report for empty input", () => {
    const report = analyzeIntelligence({ windowMs: WINDOW, now: NOW, detections: [], alerts: [], incidents: [] });
    expect(report.signalCount).toBe(0);
    expect(report.signals).toEqual([]);
    expect(report.generatedAt).toBe(NOW.toISOString());
    expect(report.windowMs).toBe(WINDOW);
  });

  it("produces no signals for a single isolated detection", () => {
    const report = analyzeIntelligence({
      windowMs: WINDOW,
      now: NOW,
      detections: [detection({ id: "d1" })],
      alerts: [],
      incidents: [],
    });
    expect(report.signalCount).toBe(0);
  });

  it("flags repeated detections with an explainable reason", () => {
    const report = analyzeIntelligence({
      windowMs: WINDOW,
      now: NOW,
      detections: [
        detection({ id: "d1", timestamp: new Date("2026-09-18T11:40:00.000Z") }),
        detection({ id: "d2", timestamp: new Date("2026-09-18T11:41:00.000Z") }),
        detection({ id: "d3", timestamp: new Date("2026-09-18T11:42:00.000Z") }),
      ],
      alerts: [],
      incidents: [],
    });
    const repeated = report.signals.find((s) => s.type === "repeated_detection");
    expect(repeated).toBeDefined();
    expect(repeated!.level).toBe("medium");
    expect(repeated!.explanation).toContain('3 detections of "person"');
    expect(repeated!.detectionIds).toContain("d1");
  });

  it("flags repeated alerts with count and severity", () => {
    const report = analyzeIntelligence({
      windowMs: WINDOW,
      now: NOW,
      detections: [],
      alerts: [alert({ id: "a1" }), alert({ id: "a2" })],
      incidents: [],
    });
    const repeated = report.signals.find((s) => s.type === "repeated_alert");
    expect(repeated).toBeDefined();
    expect(repeated!.explanation).toContain('2 "Critical Detection: person" alerts');
    expect(repeated!.alertIds).toEqual(["a1", "a2"]);
  });

  it("flags escalation patterns from real escalation metadata", () => {
    const report = analyzeIntelligence({
      windowMs: WINDOW,
      now: NOW,
      detections: [],
      alerts: [alert({ id: "a1", escalatedAt: new Date("2026-09-18T11:55:00.000Z") })],
      incidents: [],
    });
    const escalation = report.signals.find((s) => s.type === "escalation_pattern");
    expect(escalation).toBeDefined();
    expect(escalation!.explanation).toContain("escalated");
  });

  it("detects incident recurrence without claiming identity", () => {
    const report = analyzeIntelligence({
      windowMs: WINDOW,
      now: NOW,
      detections: [],
      alerts: [],
      incidents: [
        incident({ id: "i1", status: "resolved", openedAt: new Date("2026-09-18T11:00:00.000Z") }),
        incident({ id: "i2", openedAt: new Date("2026-09-18T11:20:00.000Z") }),
      ],
    });
    const recurrence = report.signals.find((s) => s.type === "incident_recurrence");
    expect(recurrence).toBeDefined();
    expect(recurrence!.explanation).toContain('2 incidents matching "Critical Detection: person"');
  });

  it("is deterministic across identical input", () => {
    const input = {
      windowMs: WINDOW,
      now: NOW,
      detections: [
        detection({ id: "d1", timestamp: new Date("2026-09-18T11:40:00.000Z") }),
        detection({ id: "d2", timestamp: new Date("2026-09-18T11:41:00.000Z") }),
        detection({ id: "d3", timestamp: new Date("2026-09-18T11:42:00.000Z") }),
      ],
      alerts: [alert({ id: "a1" }), alert({ id: "a2" })],
      incidents: [],
    };
    const first = analyzeIntelligence(input);
    const second = analyzeIntelligence(input);
    expect(second).toEqual(first);
  });

  it("ignores invalid/incomplete rows instead of throwing", () => {
    const bad = {
      id: "d-bad",
      cameraId: "cam-1",
      detectorKey: null,
      className: null,
      label: "person",
      confidence: NaN,
      timestamp: new Date("2026-09-18T11:45:00.000Z"),
      status: "warning",
    } as IntelligenceEventSignal;
    const report = analyzeIntelligence({
      windowMs: WINDOW,
      now: NOW,
      detections: [bad, detection({ id: "d1" }), detection({ id: "d2" })],
      alerts: [],
      incidents: [],
    });
    // The NaN-confidence malformed row is ignored; two valid rows still
    // produce one repeated-detection signal without throwing.
    expect(report.signalCount).toBeGreaterThanOrEqual(1);
  });

  it("handles undefined optional inputs", () => {
    const report = analyzeIntelligence({ windowMs: WINDOW, now: NOW });
    expect(report.signalCount).toBe(0);
  });

  it("reports camera recurrence when one camera dominates", () => {
    const report = analyzeIntelligence({
      windowMs: WINDOW,
      now: NOW,
      detections: [
        detection({ id: "d1", timestamp: new Date("2026-09-18T11:30:00.000Z") }),
        detection({ id: "d2", timestamp: new Date("2026-09-18T11:31:00.000Z") }),
        detection({ id: "d3", timestamp: new Date("2026-09-18T11:32:00.000Z") }),
        detection({ id: "d4", cameraId: "cam-2", timestamp: new Date("2026-09-18T11:33:00.000Z") }),
      ],
      alerts: [],
      incidents: [],
    });
    const cameraSignal = report.signals.find(
      (s) => s.type === "camera_recurrence" && s.explanation.includes("cam-1"),
    );
    expect(cameraSignal).toBeDefined();
    expect(cameraSignal!.explanation).toContain("produced 3 detections");
  });
});

describe("summarizeIntelligenceContext", () => {
  it("counts only real rows and never fabricates", () => {
    const context = summarizeIntelligenceContext({
      windowMs: WINDOW,
      detections: [detection({ id: "d1" }), detection({ id: "d2" })],
      alerts: [alert({ id: "a1" })],
      incidents: [],
    });
    expect(context.measuredDetections).toBe(2);
    expect(context.measuredAlerts).toBe(1);
    expect(context.measuredIncidents).toBe(0);
    expect(context.maxConfidence).toBe(0.9);
    expect(context.maxAlertSeverity).toBe("critical");
  });

  it("returns null severity when no alerts are present", () => {
    const context = summarizeIntelligenceContext({
      windowMs: WINDOW,
      detections: [detection({ id: "d1" })],
      alerts: [],
      incidents: [],
    });
    expect(context.maxAlertSeverity).toBeNull();
  });
});
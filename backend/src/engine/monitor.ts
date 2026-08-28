/**
 * Detector Engine v2 — Continuous Monitoring Scheduler.
 *
 * Runs the inference engine automatically on the cameras assigned to each
 * enabled detector, at the detector's configured `detectionIntervalMs`.
 *
 * The scheduler is deliberately conservative:
 *   - only runnable detectors (a real model wired to the AI service) with
 *     an enabled + loaded model and at least one enabled camera assignment
 *     produce loops;
 *   - every loop run is isolated — a failure in one camera never takes down
 *     the scheduler;
 *   - per-loop runtime state (frames, detections, failures, video position)
 *     is accumulated so the API can expose a live monitoring view.
 *
 * Dependencies (`FrameSource`, `EngineRunner`, `loadLoops`) are injected so
 * the scheduler can be unit-tested without a camera, AI service or database.
 */

import { config } from "../config";
import { logger } from "../config/logger";
import { prisma } from "../config/prisma";
import { engineService } from "./engineService";
import { aiServiceClient, type AiServiceClient, type CaptureCredentials } from "./aiClient";
import { loadCameraCredentials } from "../services/camera.service";
import type { CameraType } from "@prisma/client";
import type { PipelineResult } from "./pipeline";

export type MonitorLoopStatus = "idle" | "running" | "ok" | "error" | "skipped";

export interface MonitorCameraRef {
  id: string;
  name: string;
  url: string;
  cameraType: CameraType;
}

export interface MonitorLoop {
  id: string;
  detectorId: string;
  detectorKey: string;
  detectorName: string;
  camera: MonitorCameraRef;
  intervalMs: number;
  status: MonitorLoopStatus;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  framesProcessed: number;
  detectionsCreated: number;
  errorCount: number;
  consecutiveFailures: number;
  lastError: string | null;
  lastErrorAt: string | null;
  lastProcessingTimeMs: number | null;
  videoPosSeconds: number;
}

export interface MonitorStatus {
  running: boolean;
  startedAt: string | null;
  stoppedAt: string | null;
  tickMs: number;
  loopCount: number;
  framesProcessed: number;
  detectionsCreated: number;
  errorCount: number;
  lastTickAt: string | null;
  nextTickAt: string | null;
  loops: MonitorLoop[];
}

/** Captures a single frame from a camera source. */
export interface FrameSource {
  capture(camera: MonitorCameraRef, videoPosSeconds: number): Promise<{ buffer: Buffer }>;
}

/** Runs one frame through the inference engine for a detector + camera. */
export interface EngineRunner {
  processFrame(
    detectorKey: string,
    cameraId: string,
    image: Buffer,
    options?: { force?: boolean },
  ): Promise<PipelineResult>;
}

/** Loads the loops the scheduler should drive from current configuration. */
export type LoopLoader = () => Promise<MonitorLoop[]>;

interface LoopRuntimeState {
  status: MonitorLoopStatus;
  intervalMs: number;
  nextRunAt: Date | null;
  lastRunAt: Date | null;
  lastSuccessAt: Date | null;
  framesProcessed: number;
  detectionsCreated: number;
  errorCount: number;
  consecutiveFailures: number;
  lastError: string | null;
  lastErrorAt: Date | null;
  lastProcessingTimeMs: number | null;
  videoPosSeconds: number;
}

/** Frame source backed by the AI service `/capture` endpoint. */
export class AiServiceFrameSource implements FrameSource {
  /**
   * Credentials are resolved by camera id at capture time instead of being
   * carried on the loop objects: monitor loops are serialized verbatim by
   * the monitor status API, so storing secrets on them would leak.
   */
  constructor(
    private readonly client: AiServiceClient,
    private readonly loadCredentials: (cameraId: string) => Promise<CaptureCredentials | null> = loadCameraCredentials,
  ) {}

  async capture(camera: MonitorCameraRef, videoPosSeconds: number): Promise<{ buffer: Buffer }> {
    const credentials = await this.loadCredentials(camera.id).catch(() => null);
    const buffer = await this.client.captureFrame(
      camera.url,
      camera.cameraType,
      videoPosSeconds,
      undefined,
      credentials ?? undefined,
    );
    return { buffer };
  }
}

/** Engine runner backed by the real inference engine. */
export const realEngineRunner: EngineRunner = {
  async processFrame(detectorKey, cameraId, image, options = {}) {
    return engineService.processFrame(detectorKey, cameraId, image, options);
  },
};

function toMonitorLoop(model: {
  id: string;
  name: string;
  detectorKey: string;
  settings?: { detectionIntervalMs: number } | null;
  cameraAssignments: Array<{
    camera: { id: string; name: string; url: string; cameraType: CameraType };
  }>;
}): MonitorLoop[] {
  const intervalMs = model.settings?.detectionIntervalMs ?? 5000;
  return model.cameraAssignments.map((assignment) => ({
    id: `${model.id}::${assignment.camera.id}`,
    detectorId: model.id,
    detectorKey: model.detectorKey,
    detectorName: model.name,
    camera: {
      id: assignment.camera.id,
      name: assignment.camera.name,
      url: assignment.camera.url,
      cameraType: assignment.camera.cameraType,
    },
    intervalMs,
    status: "idle",
    nextRunAt: null,
    lastRunAt: null,
    lastSuccessAt: null,
    framesProcessed: 0,
    detectionsCreated: 0,
    errorCount: 0,
    consecutiveFailures: 0,
    lastError: null,
    lastErrorAt: null,
    lastProcessingTimeMs: null,
    videoPosSeconds: 0,
  }));
}

/**
 * Loads the current monitor loops from the database. Only runnable
 * detectors (real AI model), enabled + loaded models and enabled camera
 * assignments produce loops.
 */
export async function loadMonitorLoops(): Promise<MonitorLoop[]> {
  const models = await prisma.aIModel.findMany({
    where: { enabled: true, status: "loaded" },
    include: {
      settings: true,
      cameraAssignments: {
        where: { enabled: true },
        include: { camera: true },
      },
    },
  });

  const loops: MonitorLoop[] = [];
  for (const model of models) {
    if (!(await engineService.isDetectorRunnable(model.detectorKey))) continue;
    loops.push(...toMonitorLoop(model));
  }
  return loops;
}

export class MonitorScheduler {
  private readonly frameSource: FrameSource;
  private readonly runner: EngineRunner;
  private readonly loadLoops: LoopLoader;
  private readonly tickMs: number;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private startedAt: Date | null = null;
  private stoppedAt: Date | null = null;
  private lastTickAt: Date | null = null;
  private nextTickAt: Date | null = null;
  private tickInFlight = false;
  private readonly loopStates = new Map<string, LoopRuntimeState>();

  constructor(options: {
    frameSource: FrameSource;
    runner: EngineRunner;
    loadLoops: LoopLoader;
    tickMs?: number;
  }) {
    this.frameSource = options.frameSource;
    this.runner = options.runner;
    this.loadLoops = options.loadLoops;
    this.tickMs = options.tickMs ?? 1000;
  }

  isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.startedAt = new Date();
    this.stoppedAt = null;
    this.loopStates.clear();
    this.lastTickAt = null;
    this.nextTickAt = new Date(Date.now() + this.tickMs);
    this.timer = setInterval(() => {
      void this.tick();
    }, this.tickMs);
    if (this.timer.unref) this.timer.unref();
    logger.info("Continuous monitoring scheduler started", { tickMs: this.tickMs });
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.stoppedAt = new Date();
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    logger.info("Continuous monitoring scheduler stopped");
  }

  async getStatus(): Promise<MonitorStatus> {
    const loops = await this.loadLoops();
    const currentIds = new Set(loops.map((l) => l.id));
    for (const id of [...this.loopStates.keys()]) {
      if (!currentIds.has(id)) this.loopStates.delete(id);
    }

    const merged = loops.map((loop) => this.merge(loop));
    const total = merged.reduce(
      (acc, l) => {
        acc.framesProcessed += l.framesProcessed;
        acc.detectionsCreated += l.detectionsCreated;
        acc.errorCount += l.errorCount;
        return acc;
      },
      { framesProcessed: 0, detectionsCreated: 0, errorCount: 0 },
    );

    return {
      running: this.running,
      startedAt: this.startedAt?.toISOString() ?? null,
      stoppedAt: this.stoppedAt?.toISOString() ?? null,
      tickMs: this.tickMs,
      loopCount: merged.length,
      framesProcessed: total.framesProcessed,
      detectionsCreated: total.detectionsCreated,
      errorCount: total.errorCount,
      lastTickAt: this.lastTickAt?.toISOString() ?? null,
      nextTickAt: this.nextTickAt?.toISOString() ?? null,
      loops: merged,
    };
  }

  private async tick(): Promise<void> {
    if (this.tickInFlight) return;
    this.tickInFlight = true;
    this.lastTickAt = new Date();
    this.nextTickAt = new Date(Date.now() + this.tickMs);
    try {
      const loops = await this.loadLoops();
      const due = loops.filter((loop) => this.isDue(loop));
      if (due.length > 0) {
        await Promise.all(due.map((loop) => this.runLoop(loop)));
      }
    } catch (err) {
      logger.error("Monitor tick failed", { error: err instanceof Error ? err.message : String(err) });
    } finally {
      this.tickInFlight = false;
    }
  }

  private isDue(loop: MonitorLoop): boolean {
    if (!this.running) return false;
    const state = this.loopStates.get(loop.id);
    if (!state || state.nextRunAt == null) return true;
    return Date.now() >= state.nextRunAt.getTime();
  }

  private ensureState(loop: MonitorLoop): LoopRuntimeState {
    let state = this.loopStates.get(loop.id);
    if (!state) {
      state = {
        status: "idle",
        intervalMs: loop.intervalMs,
        nextRunAt: null,
        lastRunAt: null,
        lastSuccessAt: null,
        framesProcessed: 0,
        detectionsCreated: 0,
        errorCount: 0,
        consecutiveFailures: 0,
        lastError: null,
        lastErrorAt: null,
        lastProcessingTimeMs: null,
        videoPosSeconds: 0,
      };
      this.loopStates.set(loop.id, state);
    }
    state.intervalMs = loop.intervalMs;
    return state;
  }

  private async runLoop(loop: MonitorLoop): Promise<void> {
    const state = this.ensureState(loop);
    if (state.status === "running") return;

    state.status = "running";
    state.lastRunAt = new Date();
    state.nextRunAt = new Date(Date.now() + state.intervalMs);
    const started = process.hrtime.bigint();

    try {
      const frame = await this.frameSource.capture(loop.camera, state.videoPosSeconds);
      const result = await this.runner.processFrame(loop.detectorKey, loop.camera.id, frame.buffer);
      const durationMs = Number(process.hrtime.bigint() - started) / 1e6;

      state.status = "ok";
      state.lastSuccessAt = new Date();
      state.framesProcessed += 1;
      state.detectionsCreated += result.detections.length;
      state.consecutiveFailures = 0;
      state.lastError = null;
      state.lastErrorAt = null;
      state.lastProcessingTimeMs = Math.round(durationMs);
      if (loop.camera.cameraType === "video_file") {
        state.videoPosSeconds += Math.max(1, Math.round(state.intervalMs / 1000));
      }
      logger.info("Monitor loop processed", {
        loop: loop.id,
        detectorKey: loop.detectorKey,
        cameraId: loop.camera.id,
        detections: result.detections.length,
        durationMs: state.lastProcessingTimeMs,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      state.status = "error";
      state.errorCount += 1;
      state.consecutiveFailures += 1;
      state.lastError = message;
      state.lastErrorAt = new Date();
      logger.warn("Monitor loop failed", {
        loop: loop.id,
        detectorKey: loop.detectorKey,
        cameraId: loop.camera.id,
        error: message,
        consecutiveFailures: state.consecutiveFailures,
      });
    }
  }

  private merge(loop: MonitorLoop): MonitorLoop {
    const state = this.loopStates.get(loop.id);
    if (!state) {
      return { ...loop, status: "idle", nextRunAt: new Date().toISOString() };
    }
    return {
      ...loop,
      status: state.status,
      nextRunAt: state.nextRunAt?.toISOString() ?? null,
      lastRunAt: state.lastRunAt?.toISOString() ?? null,
      lastSuccessAt: state.lastSuccessAt?.toISOString() ?? null,
      framesProcessed: state.framesProcessed,
      detectionsCreated: state.detectionsCreated,
      errorCount: state.errorCount,
      consecutiveFailures: state.consecutiveFailures,
      lastError: state.lastError,
      lastErrorAt: state.lastErrorAt?.toISOString() ?? null,
      lastProcessingTimeMs: state.lastProcessingTimeMs,
      videoPosSeconds: state.videoPosSeconds,
    };
  }
}

export const monitorScheduler = new MonitorScheduler({
  frameSource: new AiServiceFrameSource(aiServiceClient),
  runner: realEngineRunner,
  loadLoops: loadMonitorLoops,
  tickMs: config.monitor.tickMs,
});

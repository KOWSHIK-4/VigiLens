import { describe, it, expect, vi, beforeEach } from "vitest";
import { setTimeout as sleep } from "node:timers/promises";
import {
  MonitorScheduler,
  type EngineRunner,
  type FrameSource,
  type MonitorLoop,
} from "../src/engine/monitor";
import type { CameraHealthReporter } from "../src/services/camera.service";

const camera: MonitorLoop["camera"] = {
  id: "cam-1",
  name: "Front Gate",
  url: "rtsp://camera-stream",
  cameraType: "rtsp",
};

function loop(overrides: Partial<MonitorLoop> = {}): MonitorLoop {
  return {
    id: "loop-1",
    detectorId: "det-1",
    detectorKey: "person",
    detectorName: "Person Detection",
    camera,
    intervalMs: 10,
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
    runsStarted: 0,
    runsSucceeded: 0,
    ...overrides,
  };
}

/** Fails a fixed number of consecutive captures, then succeeds forever. */
class RecoveryFrameSource implements FrameSource {
  constructor(private readonly failureCount: number) {}
  failures = 0;
  successes = 0;

  async capture() {
    if (this.failures < this.failureCount) {
      this.failures += 1;
      throw new Error("stream unreachable");
    }
    this.successes += 1;
    return { buffer: Buffer.from("fake-jpeg") };
  }
}

class OkFrameSource implements FrameSource {
  frames = 0;
  async capture() {
    this.frames += 1;
    return { buffer: Buffer.from("fake-jpeg") };
  }
}

const runner: EngineRunner = {
  async processFrame() {
    return {
      detections: [],
      metrics: {
        framesProcessed: 1,
        framesSkipped: 0,
        inferenceTimeMs: 1,
        preprocessingTimeMs: 0,
        postprocessingTimeMs: 0,
        trackingTimeMs: 0,
        totalProcessingTimeMs: 1,
        detectionsPerFrame: 0,
        lastDetectionAt: null,
        lastFrameAt: new Date(),
        lastSuccessfulInferenceAt: new Date(),
        lastError: null,
        lastErrorAt: null,
        errorCount: 0,
      },
      processedAt: new Date(),
    };
  },
};

async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs = 3000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return true;
    await sleep(20);
  }
  return (await condition()) === true;
}

function makeReporter() {
  return {
    reportStreamFailure: vi.fn<CameraHealthReporter["reportStreamFailure"]>(),
    reportStreamRecovery: vi.fn<CameraHealthReporter["reportStreamRecovery"]>(),
  };
}

describe("MonitorScheduler camera stream recovery reporting", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("promotes a camera to online on its first successful frame", async () => {
    const reporter = makeReporter();
    const scheduler = new MonitorScheduler({
      frameSource: new OkFrameSource(),
      runner,
      loadLoops: async () => [loop()],
      tickMs: 10,
      reporter,
    });
    scheduler.start();
    const done = await waitFor(() => reporter.reportStreamRecovery.mock.calls.length >= 1);
    scheduler.stop();

    expect(done).toBe(true);
    expect(reporter.reportStreamRecovery).toHaveBeenCalledTimes(1);
    expect(reporter.reportStreamRecovery).toHaveBeenCalledWith("cam-1", expect.any(String), expect.any(Number));
    expect(reporter.reportStreamFailure).not.toHaveBeenCalled();
  });

  it("does not report a failure below the sustained-failure threshold", async () => {
    const reporter = makeReporter();
    const scheduler = new MonitorScheduler({
      frameSource: new RecoveryFrameSource(2), // transient blips
      runner,
      loadLoops: async () => [loop()],
      tickMs: 10,
      reporter,
    });
    scheduler.start();
    // Let it fail twice, recover, then run clean for a while.
    const recovered = await waitFor(async () => {
      const s = await scheduler.getStatus();
      return s.loops[0].consecutiveFailures === 0 && s.loops[0].framesProcessed >= 1;
    });
    await sleep(100);
    scheduler.stop();

    expect(recovered).toBe(true);
    expect(reporter.reportStreamFailure).not.toHaveBeenCalled();
    // Only the initial healthy promotion is reported for a non-sustained blip.
    expect(reporter.reportStreamRecovery).toHaveBeenCalledTimes(1);
  });

  it("reports a sustained failure once per episode and a recovery after it", async () => {
    const reporter = makeReporter();
    const scheduler = new MonitorScheduler({
      frameSource: new RecoveryFrameSource(3),
      runner,
      loadLoops: async () => [loop()],
      tickMs: 10,
      reporter,
    });
    scheduler.start();
    const recovered = await waitFor(async () => {
      const s = await scheduler.getStatus();
      return s.loops[0].consecutiveFailures === 0 && s.loops[0].framesProcessed >= 1;
    });
    scheduler.stop();

    expect(recovered).toBe(true);
    // Exactly one outage persisted for the episode (not one per failed tick).
    expect(reporter.reportStreamFailure).toHaveBeenCalledTimes(1);
    expect(reporter.reportStreamFailure).toHaveBeenCalledWith("cam-1", "stream unreachable", 3);
    // A recovery is reported after the stream comes back.
    expect(reporter.reportStreamRecovery).toHaveBeenCalledTimes(1);
    expect(reporter.reportStreamRecovery).toHaveBeenCalledWith("cam-1", expect.any(String), expect.any(Number));
  });

  it("reports a second episode after a recovery (per-episode, not once ever)", async () => {
    const reporter = makeReporter();
    // Scripted capture outcomes: two failure episodes, each with a recovery.
    const plan = [
      "fail", "fail", "fail", "ok",
      "fail", "fail", "fail", "ok",
    ];
    const scheduler = new MonitorScheduler({
      frameSource: new class implements FrameSource {
        private idx = 0;
        async capture() {
          const outcome = this.idx < plan.length ? plan[this.idx] : "ok";
          this.idx += 1;
          if (outcome === "fail") throw new Error("stream unreachable");
          return { buffer: Buffer.from("fake-jpeg") };
        }
      }(),
      runner,
      loadLoops: async () => [loop()],
      tickMs: 10,
      reporter,
    });
    scheduler.start();
    const recovered = await waitFor(async () => {
      const s = await scheduler.getStatus();
      return s.loops[0].consecutiveFailures === 0 && s.loops[0].framesProcessed >= 2;
    });
    await sleep(200);
    scheduler.stop();

    expect(recovered).toBe(true);
    expect(reporter.reportStreamFailure).toHaveBeenCalledTimes(2);
    expect(reporter.reportStreamRecovery).toHaveBeenCalledTimes(2);
  });
});
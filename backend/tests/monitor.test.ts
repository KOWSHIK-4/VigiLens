import { setTimeout as sleep } from "node:timers/promises";
import {
  MonitorScheduler,
  type EngineRunner,
  type FrameSource,
  type MonitorLoop,
} from "../src/engine/monitor";

const cameraRtsp: MonitorLoop["camera"] = {
  id: "cam-1",
  name: "Main Entrance",
  url: "rtsp://camera-stream",
  cameraType: "rtsp",
};

const cameraVideoFile: MonitorLoop["camera"] = {
  id: "cam-5",
  name: "Demo Recording",
  url: "/recordings/demo.mp4",
  cameraType: "video_file",
};

function loop(overrides: Partial<MonitorLoop> = {}): MonitorLoop {
  return {
    id: "loop-1",
    detectorId: "det-1",
    detectorKey: "person",
    detectorName: "Person Detection",
    camera: cameraRtsp,
    intervalMs: 1000,
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
    ...overrides,
  };
}

class FakeFrameSource implements FrameSource {
  frames: Array<{ camera: MonitorLoop["camera"]; videoPosSeconds: number }> = [];
  failNext = false;

  async capture(camera: MonitorLoop["camera"], videoPosSeconds: number) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("capture failed");
    }
    this.frames.push({ camera, videoPosSeconds });
    return { buffer: Buffer.from("fake-jpeg") };
  }
}

class FakeRunner implements EngineRunner {
  calls: Array<{ detectorKey: string; cameraId: string; image: Buffer }> = [];
  detections = 0;
  failNext: string | null = null;

  async processFrame(detectorKey: string, cameraId: string, image: Buffer) {
    if (this.failNext) {
      const err = new Error(this.failNext);
      this.failNext = null;
      throw err;
    }
    this.calls.push({ detectorKey, cameraId, image });
    return {
      detections: Array.from({ length: this.detections }, () => ({
        id: "d",
        className: "person",
        confidence: 0.9,
        bbox: { x1: 0, y1: 0, x2: 1, y2: 1 },
        cameraId,
        detectorId: "det-1",
        detectorKey,
        normalized: true,
        processingTimeMs: 5,
      })),
      metrics: {
        framesProcessed: 1,
        framesSkipped: 0,
        inferenceTimeMs: 5,
        preprocessingTimeMs: 0,
        postprocessingTimeMs: 0,
        trackingTimeMs: 0,
        totalProcessingTimeMs: 5,
        detectionsPerFrame: this.detections,
        lastDetectionAt: new Date(),
        lastFrameAt: new Date(),
        lastSuccessfulInferenceAt: new Date(),
        lastError: null,
        lastErrorAt: null,
        errorCount: 0,
      },
      processedAt: new Date(),
    };
  }
}

let passed = 0;
let failed = 0;

function ok(name: string) {
  passed += 1;
  console.log(`  PASS  ${name}`);
}

function fail(name: string, detail: unknown) {
  failed += 1;
  console.error(`  FAIL  ${name}`);
  console.error(`        ${JSON.stringify(detail)}`);
}

async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 3000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return true;
    await sleep(50);
  }
  return (await condition()) === true;
}

async function run() {
  {
    const source = new FakeFrameSource();
    const runner = new FakeRunner();
    const scheduler = new MonitorScheduler({
      frameSource: source,
      runner,
      loadLoops: async () => [loop()],
      tickMs: 20,
    });

    if (!scheduler.isRunning()) ok("scheduler starts stopped");
    scheduler.start();
    if (scheduler.isRunning()) ok("start() makes scheduler running");
    scheduler.start(); // idempotent
    if (scheduler.isRunning()) ok("start() is idempotent");

    const processed = await waitFor(() => runner.calls.length >= 1);
    if (processed) ok("scheduler drives the engine runner");
    else fail("engine runner called", runner.calls.length);

    const status = await scheduler.getStatus();
    if (status.running && status.loopCount === 1 && status.loops[0].framesProcessed >= 1) {
      ok("getStatus aggregates loop frames");
    } else {
      fail("getStatus frames", status.loops[0]);
    }
    if (status.loops[0].status === "ok" && status.loops[0].lastSuccessAt) {
      ok("successful run marks loop ok with lastSuccessAt");
    } else {
      fail("loop ok state", status.loops[0]);
    }
    if (status.loops[0].nextRunAt) {
      ok("successful run schedules nextRunAt");
    } else {
      fail("nextRunAt", status.loops[0]);
    }

    scheduler.stop();
    if (!scheduler.isRunning()) ok("stop() stops the scheduler");
  }

  {
    const source = new FakeFrameSource();
    const runner = new FakeRunner();
    runner.detections = 3;
    const scheduler = new MonitorScheduler({
      frameSource: source,
      runner,
      loadLoops: async () => [loop({ id: "loop-det" })],
      tickMs: 20,
    });
    scheduler.start();
    await sleep(150);
    const status = await scheduler.getStatus();
    const l = status.loops[0];
    if (l.framesProcessed >= 1 && l.detectionsCreated >= 3) {
      ok("detection counts aggregate from engine results");
    } else {
      fail("detections aggregate", l);
    }
    scheduler.stop();
  }

  {
    const source = new FakeFrameSource();
    const runner = new FakeRunner();
    runner.failNext = "boom";
    const scheduler = new MonitorScheduler({
      frameSource: source,
      runner,
      loadLoops: async () => [loop({ id: "loop-fail" })],
      tickMs: 20,
    });
    scheduler.start();
    const errored = await waitFor(
      async () => {
        const s = await scheduler.getStatus();
        return s.loops[0].errorCount >= 1 && s.loops[0].status === "error";
      },
      3000,
    );
    if (errored) {
      const s = await scheduler.getStatus();
      const l = s.loops[0];
      if (l.errorCount >= 1 && l.consecutiveFailures >= 1 && l.lastError === "boom") {
        ok("failure isolates and records error state");
      } else {
        fail("error state details", l);
      }
    } else {
      fail("error recorded", "no error surfaced");
    }

    // Next tick should retry and recover.
    const recovered = await waitFor(
      async () => {
        const s = await scheduler.getStatus();
        return s.loops[0].consecutiveFailures === 0 && s.loops[0].framesProcessed >= 1;
      },
      3000,
    );
    if (recovered) ok("scheduler retries and recovers after failure");
    else fail("recovery", "consecutiveFailures not reset");

    const s = await scheduler.getStatus();
    if (s.loops[0].framesProcessed === 1 && s.loops[0].errorCount >= 1) {
      ok("recovered run resets failures but keeps error count");
    } else {
      fail("counters after recovery", s.loops[0]);
    }
    scheduler.stop();
  }

  {
    const source = new FakeFrameSource();
    const runner = new FakeRunner();
    const scheduler = new MonitorScheduler({
      frameSource: source,
      runner,
      loadLoops: async () => [loop({ id: "loop-video", camera: cameraVideoFile, intervalMs: 1000 })],
      tickMs: 20,
    });
    scheduler.start();
    const progressed = await waitFor(
      async () => {
        const s = await scheduler.getStatus();
        return s.loops[0].videoPosSeconds >= 1;
      },
      3000,
    );
    if (progressed) ok("video_file loops advance their read position");
    else fail("video position", "did not advance");
    scheduler.stop();
  }

  {
    const source = new FakeFrameSource();
    const runner = new FakeRunner();
    const scheduler = new MonitorScheduler({
      frameSource: source,
      runner,
      loadLoops: async () => [loop({ id: "loop-a" }), loop({ id: "loop-b" })],
      tickMs: 20,
    });
    const before = await scheduler.getStatus();
    if (before.loopCount === 2 && before.loops.every((l) => l.status === "idle")) {
      ok("getStatus lists idle loops before start");
    } else {
      fail("idle loops", before.loops);
    }
    scheduler.start();
    await sleep(100);
    scheduler.stop();
  }
}

run()
  .then(() => {
    console.log(`\nMonitor scheduler tests: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

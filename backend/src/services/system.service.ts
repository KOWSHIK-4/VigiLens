import { promises as fs } from "node:fs";
import os from "node:os";
import { appVersion } from "../config/version";
import type { DetectorRuntimeStatus } from "../engine/types";
import {
  monitorScheduler,
  type MonitorLoop,
  type MonitorStatus,
} from "../engine/monitor";
import { engineService } from "../engine/engineService";
import { runtimeRegistry } from "../engine/runtimeRegistry";
import {
  healthService,
  type OverallStatus,
  type ServiceHealth,
} from "./health.service";

interface CpuSample {
  idle: number;
  total: number;
  timestamp: number;
}

let cpuSample: CpuSample | null = null;

function getCpuUsage(): { usagePercent: number; cores: number } {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    for (const time of Object.values(cpu.times)) {
      total += time;
    }
    idle += cpu.times.idle;
  }
  const now = Date.now();
  const current: CpuSample = { idle, total, timestamp: now };
  const previous = cpuSample;
  cpuSample = current;

  if (!previous) {
    // No delta available yet; report real average usage since boot.
    const sinceBoot = total > 0 ? (1 - idle / total) * 100 : 0;
    return {
      usagePercent: Math.round(Math.max(0, Math.min(100, sinceBoot)) * 10) / 10,
      cores: cpus.length,
    };
  }
  const idleDelta = current.idle - previous.idle;
  const totalDelta = current.total - previous.total;
  const usage =
    totalDelta > 0 ? (1 - idleDelta / totalDelta) * 100 : 0;
  return {
    usagePercent: Math.round(Math.max(0, Math.min(100, usage)) * 10) / 10,
    cores: cpus.length,
  };
}

function getMemoryUsage(): {
  totalBytes: number;
  usedBytes: number;
  usagePercent: number;
} {
  const totalBytes = os.totalmem();
  const usedBytes = totalBytes - os.freemem();
  const usagePercent =
    totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0;
  return {
    totalBytes,
    usedBytes,
    usagePercent: Math.round(usagePercent * 10) / 10,
  };
}

async function getDiskUsage(mount: string): Promise<{
  totalBytes: number;
  freeBytes: number;
  usagePercent: number;
  mount: string;
}> {
  try {
    const stats = await fs.statfs(mount);
    const totalBytes = Number(stats.blocks) * Number(stats.bsize);
    const freeBytes = Number(stats.bavail) * Number(stats.bsize);
    const usedBytes = totalBytes - freeBytes;
    const usagePercent = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0;
    return {
      totalBytes,
      freeBytes,
      usagePercent: Math.round(usagePercent * 10) / 10,
      mount,
    };
  } catch {
    return { totalBytes: 0, freeBytes: 0, usagePercent: 0, mount };
  }
}

export interface SchedulerLoopSummary {
  id: string;
  detectorKey: string;
  detectorName: string;
  cameraName: string;
  status: MonitorLoop["status"];
  intervalMs: number;
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

export interface MonitorSchedulerSummary {
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
  loops: SchedulerLoopSummary[];
}

export interface EngineHealthSummary {
  key: string;
  status: DetectorRuntimeStatus;
  healthy: boolean;
  latencyMs: number | null;
  throughputFps: number | null;
  framesProcessed: number;
  errorCount: number;
  consecutiveFailures: number;
  aiReachable: boolean | null;
  lastInferenceAt: string | null;
  lastSuccessfulInferenceAt: string | null;
  lastDetectionAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
}

interface EngineHealthLike {
  key: string;
  status: DetectorRuntimeStatus;
  healthy: boolean;
  latencyMs: number | null;
  throughputFps: number | null;
  framesProcessed: number;
  errorCount: number;
  consecutiveFailures: number;
  aiReachable: boolean | null;
  lastInferenceAt: string | null;
  lastSuccessfulInferenceAt: string | null;
  lastDetectionAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
}

export function toSchedulerLoopSummary(loop: MonitorLoop): SchedulerLoopSummary {
  return {
    id: loop.id,
    detectorKey: loop.detectorKey,
    detectorName: loop.detectorName,
    cameraName: loop.camera.name,
    status: loop.status,
    intervalMs: loop.intervalMs,
    nextRunAt: loop.nextRunAt,
    lastRunAt: loop.lastRunAt,
    lastSuccessAt: loop.lastSuccessAt,
    framesProcessed: loop.framesProcessed,
    detectionsCreated: loop.detectionsCreated,
    errorCount: loop.errorCount,
    consecutiveFailures: loop.consecutiveFailures,
    lastError: loop.lastError,
    lastErrorAt: loop.lastErrorAt,
    lastProcessingTimeMs: loop.lastProcessingTimeMs,
    videoPosSeconds: loop.videoPosSeconds,
  };
}

export function toSchedulerSummary(status: MonitorStatus): MonitorSchedulerSummary {
  return {
    running: status.running,
    startedAt: status.startedAt,
    stoppedAt: status.stoppedAt,
    tickMs: status.tickMs,
    loopCount: status.loopCount,
    framesProcessed: status.framesProcessed,
    detectionsCreated: status.detectionsCreated,
    errorCount: status.errorCount,
    lastTickAt: status.lastTickAt,
    nextTickAt: status.nextTickAt,
    loops: status.loops.map(toSchedulerLoopSummary),
  };
}

export function toEngineSummary(health: EngineHealthLike): EngineHealthSummary {
  return {
    key: health.key,
    status: health.status,
    healthy: health.healthy,
    latencyMs: health.latencyMs,
    throughputFps: health.throughputFps,
    framesProcessed: health.framesProcessed,
    errorCount: health.errorCount,
    consecutiveFailures: health.consecutiveFailures,
    aiReachable: health.aiReachable,
    lastInferenceAt: health.lastInferenceAt,
    lastSuccessfulInferenceAt: health.lastSuccessfulInferenceAt,
    lastDetectionAt: health.lastDetectionAt,
    lastError: health.lastError,
    lastErrorAt: health.lastErrorAt,
  };
}

async function getEngineHealthSummaries(): Promise<EngineHealthSummary[]> {
  const descriptors = await runtimeRegistry.describeAll();
  const summaries = await Promise.all(
    descriptors.map(async (descriptor) => {
      const health = await engineService.getHealth(descriptor.key);
      return health ? toEngineSummary(health) : null;
    }),
  );
  return summaries.filter((summary): summary is EngineHealthSummary => summary !== null);
}

export interface SystemMonitoringReport {
  status: OverallStatus;
  timestamp: string;
  version: string;
  uptime: {
    process: number;
    system: number;
  };
  services: ServiceHealth[];
  scheduler: MonitorSchedulerSummary;
  engines: EngineHealthSummary[];
  resources: {
    cpu: { usagePercent: number; cores: number };
    memory: {
      totalBytes: number;
      usedBytes: number;
      usagePercent: number;
    };
    disk: {
      totalBytes: number;
      freeBytes: number;
      usagePercent: number;
      mount: string;
    };
  };
}

export const systemService = {
  async getMonitoring(): Promise<SystemMonitoringReport> {
    const storagePath = await healthService.getStorageBasePath();
    const [health, disk, scheduler, engines] = await Promise.all([
      healthService.getReadiness(),
      getDiskUsage(storagePath),
      monitorScheduler.getStatus(),
      getEngineHealthSummaries(),
    ]);

    return {
      status: health.status,
      timestamp: new Date().toISOString(),
      version: appVersion,
      uptime: {
        process: Math.round(process.uptime()),
        system: Math.round(os.uptime()),
      },
      services: health.services,
      scheduler: toSchedulerSummary(scheduler),
      engines,
      resources: {
        cpu: getCpuUsage(),
        memory: getMemoryUsage(),
        disk,
      },
    };
  },
};

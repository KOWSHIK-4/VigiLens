import { promises as fs } from "node:fs";
import os from "node:os";
import { appVersion } from "@/config/version";
import {
  healthService,
  type OverallStatus,
  type ServiceHealth,
} from "@/services/health.service";

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

export interface SystemMonitoringReport {
  status: OverallStatus;
  timestamp: string;
  version: string;
  uptime: {
    process: number;
    system: number;
  };
  services: ServiceHealth[];
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
    const [health, disk] = await Promise.all([
      healthService.getReadiness(),
      getDiskUsage(storagePath),
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
      resources: {
        cpu: getCpuUsage(),
        memory: getMemoryUsage(),
        disk,
      },
    };
  },
};

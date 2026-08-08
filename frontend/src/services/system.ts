import api from "./api";
import type { SystemMetrics, SystemMonitoring } from "@/types";

export const systemService = {
  async getMonitoring(): Promise<SystemMonitoring> {
    const { data } = await api.get<{ success: boolean; data: SystemMonitoring }>(
      "/system/monitoring",
    );
    return data.data;
  },

  async getMetrics(): Promise<SystemMetrics> {
    const { data } = await api.get<{ success: boolean; data: SystemMetrics }>(
      "/system/metrics",
    );
    return data.data;
  },
};

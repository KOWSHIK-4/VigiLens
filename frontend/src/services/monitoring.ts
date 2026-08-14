import api from "./api";
import type { MonitorStatus } from "@/types";

export const monitoringService = {
  async getStatus(): Promise<MonitorStatus> {
    const { data } = await api.get<{ success: boolean; data: MonitorStatus }>("/monitor");
    return data.data;
  },

  async start(): Promise<MonitorStatus> {
    const { data } = await api.post<{ success: boolean; data: MonitorStatus }>("/monitor/start");
    return data.data;
  },

  async stop(): Promise<MonitorStatus> {
    const { data } = await api.post<{ success: boolean; data: MonitorStatus }>("/monitor/stop");
    return data.data;
  },
};

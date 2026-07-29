import api from "./api";
import type { Detection } from "@/types";

export const detectionService = {
  async getAll(params?: {
    page?: number;
    limit?: number;
    status?: string;
  }): Promise<{ data: Detection[]; total: number }> {
    const { data } = await api.get("/detections", { params });
    return data;
  },

  async getById(id: string): Promise<Detection> {
    const { data } = await api.get<Detection>(`/detections/${id}`);
    return data;
  },

  async getStats() {
    const { data } = await api.get("/detections/stats");
    return data;
  },
};

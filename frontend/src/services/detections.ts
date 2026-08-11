import api from "./api";
import type { Detection, DetectionFilters } from "@/types";

export const detectionService = {
  async getAll(params: {
    page?: number;
    limit?: number;
    search?: string;
    status?: string;
    cameraId?: string;
    dateFrom?: string;
    dateTo?: string;
    confidenceMin?: string;
    confidenceMax?: string;
    sortBy?: string;
    sortOrder?: string;
  }): Promise<{ data: Detection[]; total: number }> {
    const { data } = await api.get("/detections", { params });
    return data;
  },

  async getById(id: string): Promise<Detection> {
    const { data } = await api.get<Detection>(`/detections/${id}`);
    return data;
  },

  async remove(id: string): Promise<void> {
    await api.delete(`/detections/${id}`);
  },

  async exportCSV(filters?: DetectionFilters): Promise<Blob> {
    const { data } = await api.get("/detections/export/csv", {
      params: filters,
      responseType: "blob",
    });
    return data;
  },

  async getStats() {
    const { data } = await api.get("/detections/stats");
    return data;
  },
};

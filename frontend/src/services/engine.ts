import api from "./api";
import type {
  EngineDetectionsResponse,
  EngineDetector,
  EngineHealth,
  EngineMetrics,
  EngineProcessResponse,
} from "@/types";

export const engineService = {
  async getAll() {
    const { data } = await api.get<{ success: boolean; data: EngineDetector[] }>(
      "/engines",
    );
    return data.data;
  },

  async getByKey(key: string) {
    const { data } = await api.get<{ success: boolean; data: EngineDetector }>(
      `/engines/${key}`,
    );
    return data.data;
  },

  async getMetrics(key: string) {
    const { data } = await api.get<{ success: boolean; data: EngineMetrics }>(
      `/engines/${key}/metrics`,
    );
    return data.data;
  },

  async getHealth(key: string) {
    const { data } = await api.get<{ success: boolean; data: EngineHealth }>(
      `/engines/${key}/health`,
    );
    return data.data;
  },

  async getDetections(key: string, limit = 25) {
    const { data } = await api.get<{ success: boolean; data: EngineDetectionsResponse }>(
      `/engines/${key}/detections?limit=${limit}`,
    );
    return data.data;
  },

  async processImage(key: string, image: Blob | File, cameraId?: string) {
    const form = new FormData();
    form.append("image", image, "frame.jpg");
    if (cameraId) form.append("camera_id", cameraId);

    const { data } = await api.post<{ success: boolean; data: EngineProcessResponse }>(
      `/engines/${key}/process`,
      form,
      { headers: { "Content-Type": "multipart/form-data" } },
    );
    return data.data;
  },
};

import api from "./api";
import type {
  Detector,
  DetectorCameraRef,
  DetectorCamerasInput,
  DetectorFilters,
  DetectorHealth,
  DetectorSettingsInput,
  DetectorUpdateInput,
  MarketplaceDetector,
  PaginatedResponse,
} from "@/types";

export const detectorService = {
  async getMarketplace() {
    const { data } = await api.get<{ success: boolean; data: MarketplaceDetector[] }>(
      "/detectors/marketplace",
    );
    return data.data;
  },

  async getCategories() {
    const { data } = await api.get<{ success: boolean; data: string[] }>(
      "/detectors/categories",
    );
    return data.data;
  },

  async getAll(params?: DetectorFilters) {
    const { data } = await api.get<PaginatedResponse<Detector>>("/detectors", {
      params,
    });
    return data;
  },

  async getById(id: string) {
    const { data } = await api.get<{ success: boolean; data: Detector }>(
      `/detectors/${id}`,
    );
    return data.data;
  },

  async install(detectorKey: string) {
    const { data } = await api.post<{ success: boolean; data: Detector }>(
      "/detectors",
      { detectorKey },
    );
    return data.data;
  },

  async uninstall(id: string) {
    const { data } = await api.delete<{
      success: boolean;
      data: { success: boolean; id: string; detectorKey: string };
    }>(`/detectors/${id}`);
    return data.data;
  },

  async enable(id: string) {
    const { data } = await api.patch<{ success: boolean; data: Detector }>(
      `/detectors/${id}/enable`,
    );
    return data.data;
  },

  async disable(id: string) {
    const { data } = await api.patch<{ success: boolean; data: Detector }>(
      `/detectors/${id}/disable`,
    );
    return data.data;
  },

  async update(id: string, input: DetectorUpdateInput) {
    const { data } = await api.patch<{ success: boolean; data: Detector }>(
      `/detectors/${id}`,
      input,
    );
    return data.data;
  },

  async updateSettings(id: string, input: DetectorSettingsInput) {
    const { data } = await api.patch<{ success: boolean; data: Detector }>(
      `/detectors/${id}/settings`,
      input,
    );
    return data.data;
  },

  async assignCameras(id: string, input: DetectorCamerasInput) {
    const { data } = await api.put<{ success: boolean; data: Detector }>(
      `/detectors/${id}/cameras`,
      input,
    );
    return data.data;
  },

  async health(id: string) {
    const { data } = await api.get<{ success: boolean; data: DetectorHealth }>(
      `/detectors/${id}/health`,
    );
    return data.data;
  },

  async restart(id: string) {
    const { data } = await api.post<{ success: boolean; data: Detector }>(
      `/detectors/${id}/restart`,
    );
    return data.data;
  },
};

export type { DetectorCameraRef };

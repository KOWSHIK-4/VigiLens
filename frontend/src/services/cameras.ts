import api from "./api";
import type { Camera, CreateCameraInput, UpdateCameraInput, CameraFilters, CameraHealthLog, PaginatedResponse } from "@/types";

export const cameraService = {
  async getAll(filters?: CameraFilters): Promise<PaginatedResponse<Camera>> {
    const params = new URLSearchParams();
    if (filters) {
      if (filters.page) params.set("page", String(filters.page));
      if (filters.limit) params.set("limit", String(filters.limit));
      if (filters.search) params.set("search", filters.search);
      if (filters.status) params.set("status", filters.status);
      if (filters.cameraType) params.set("cameraType", filters.cameraType);
      if (filters.sortBy) params.set("sortBy", filters.sortBy);
      if (filters.sortOrder) params.set("sortOrder", filters.sortOrder);
    }
    const { data } = await api.get<PaginatedResponse<Camera>>(`/cameras?${params}`);
    return data;
  },

  async getById(id: string): Promise<Camera> {
    const { data } = await api.get<{ success: boolean; data: Camera }>(`/cameras/${id}`);
    return data.data;
  },

  async create(input: CreateCameraInput): Promise<Camera> {
    const { data } = await api.post<{ success: boolean; data: Camera }>("/cameras", input);
    return data.data;
  },

  async update(id: string, input: UpdateCameraInput): Promise<Camera> {
    const { data } = await api.patch<{ success: boolean; data: Camera }>(`/cameras/${id}`, input);
    return data.data;
  },

  async remove(id: string): Promise<void> {
    await api.delete(`/cameras/${id}`);
  },

  async start(id: string): Promise<Camera> {
    const { data } = await api.post<{ success: boolean; data: Camera }>(`/cameras/${id}/start`);
    return data.data;
  },

  async stop(id: string): Promise<Camera> {
    const { data } = await api.post<{ success: boolean; data: Camera }>(`/cameras/${id}/stop`);
    return data.data;
  },

  async healthCheck(id: string): Promise<Camera> {
    const { data } = await api.post<{ success: boolean; data: Camera }>(`/cameras/${id}/health`);
    return data.data;
  },

  async getHealthLogs(id: string, limit = 50): Promise<CameraHealthLog[]> {
    const { data } = await api.get<{ success: boolean; data: CameraHealthLog[] }>(`/cameras/${id}/health-logs?limit=${limit}`);
    return data.data;
  },
};

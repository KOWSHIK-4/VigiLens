import api from "./api";
import type {
  CreateIncidentInput,
  Incident,
  IncidentFilters,
  IncidentRelatedDetections,
  IncidentStatus,
  IncidentSummary,
  PaginatedResponse,
} from "@/types";

export const incidentService = {
  async getAll(params?: IncidentFilters) {
    const { data } = await api.get<PaginatedResponse<Incident>>("/incidents", {
      params,
    });
    return data;
  },

  async getById(id: string) {
    const { data } = await api.get<{ success: boolean; data: Incident }>(
      `/incidents/${id}`,
    );
    return data.data;
  },

  async getRelatedDetections(id: string) {
    const { data } = await api.get<{ success: boolean; data: IncidentRelatedDetections }>(
      `/incidents/${id}/related-detections`,
    );
    return data.data;
  },

  async updateResolutionSummary(id: string, resolutionSummary: string) {
    const { data } = await api.patch<{ success: boolean; data: Incident }>(
      `/incidents/${id}/resolution`,
      { resolutionSummary },
    );
    return data.data;
  },

  async getSummary() {
    const { data } = await api.get<{ success: boolean; data: IncidentSummary }>(
      "/incidents/summary",
    );
    return data.data;
  },

  async create(input: CreateIncidentInput) {
    const { data } = await api.post<{ success: boolean; data: Incident }>(
      "/incidents",
      input,
    );
    return data.data;
  },

  async changeStatus(id: string, status: IncidentStatus, resolutionSummary?: string) {
    const { data } = await api.patch<{ success: boolean; data: Incident }>(
      `/incidents/${id}/status`,
      resolutionSummary !== undefined ? { status, resolutionSummary } : { status },
    );
    return data.data;
  },

  async changePriority(id: string, priority: "info" | "warning" | "critical") {
    const { data } = await api.patch<{ success: boolean; data: Incident }>(
      `/incidents/${id}/priority`,
      { priority },
    );
    return data.data;
  },

  async assign(id: string, assigneeId: string | null) {
    const { data } = await api.patch<{ success: boolean; data: Incident }>(
      `/incidents/${id}/assign`,
      { assigneeId },
    );
    return data.data;
  },

  async addNote(id: string, body: string) {
    const { data } = await api.post<{ success: boolean; data: Incident }>(
      `/incidents/${id}/notes`,
      { body },
    );
    return data.data;
  },

  async exportCSV(params?: IncidentFilters): Promise<Blob> {
    const { data } = await api.get("/incidents/export", {
      params,
      responseType: "blob",
    });
    return data;
  },
};
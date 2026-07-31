import api from "./api";
import type {
  AIModel,
  ModelFilters,
  ModelTestResult,
  PaginatedResponse,
  UpdateModelInput,
} from "@/types";

export const modelService = {
  async getAll(params?: ModelFilters) {
    const { data } = await api.get<PaginatedResponse<AIModel>>("/models", {
      params,
    });
    return data;
  },

  async getById(id: string) {
    const { data } = await api.get<{ success: boolean; data: AIModel }>(
      `/models/${id}`,
    );
    return data.data;
  },

  async update(id: string, input: UpdateModelInput) {
    const { data } = await api.patch<{ success: boolean; data: AIModel }>(
      `/models/${id}`,
      input,
    );
    return data.data;
  },

  async load(id: string) {
    const { data } = await api.post<{ success: boolean; data: AIModel }>(
      `/models/${id}/load`,
    );
    return data.data;
  },

  async unload(id: string) {
    const { data } = await api.post<{ success: boolean; data: AIModel }>(
      `/models/${id}/unload`,
    );
    return data.data;
  },

  async test(id: string) {
    const { data } = await api.post<{ success: boolean; data: ModelTestResult }>(
      `/models/${id}/test`,
    );
    return data.data;
  },
};

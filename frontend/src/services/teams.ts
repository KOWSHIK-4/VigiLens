import api from "./api";
import type { PaginatedResponse, Team, TeamFilters } from "@/types";

export const teamsService = {
  async getAll(params?: TeamFilters) {
    const { data } = await api.get<PaginatedResponse<Team>>("/teams", { params });
    return data;
  },

  async getById(id: string) {
    const { data } = await api.get<{ success: boolean; data: Team }>(`/teams/${id}`);
    return data.data;
  },
};
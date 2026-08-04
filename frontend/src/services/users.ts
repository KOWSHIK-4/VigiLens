import api from "./api";
import type {
  CreateUserInput,
  PaginatedResponse,
  UpdateUserInput,
  User,
  UserFilters,
  UserRole,
  UserStats,
  UserStatus,
} from "@/types";

export const userService = {
  async getAll(params?: UserFilters) {
    const { data } = await api.get<PaginatedResponse<User>>("/users", {
      params,
    });
    return data;
  },

  async getById(id: string) {
    const { data } = await api.get<{ success: boolean; data: User }>(
      `/users/${id}`,
    );
    return data.data;
  },

  async getStats() {
    const { data } = await api.get<{ success: boolean; data: UserStats }>(
      "/users/stats",
    );
    return data.data;
  },

  async create(input: CreateUserInput) {
    const { data } = await api.post<{ success: boolean; data: User }>(
      "/users",
      input,
    );
    return data.data;
  },

  async update(id: string, input: UpdateUserInput) {
    const { data } = await api.patch<{ success: boolean; data: User }>(
      `/users/${id}`,
      input,
    );
    return data.data;
  },

  async assignRole(id: string, role: UserRole) {
    const { data } = await api.patch<{ success: boolean; data: User }>(
      `/users/${id}/role`,
      { role },
    );
    return data.data;
  },

  async setStatus(id: string, status: UserStatus) {
    const { data } = await api.patch<{ success: boolean; data: User }>(
      `/users/${id}/status`,
      { status },
    );
    return data.data;
  },

  async remove(id: string) {
    const { data } = await api.delete<{ success: boolean; data: unknown }>(
      `/users/${id}`,
    );
    return data.data;
  },

  async resetPassword(id: string, password: string) {
    const { data } = await api.patch<{ success: boolean; data: { success: boolean } }>(
      `/users/${id}/password`,
      { password },
    );
    return data.data;
  },
};

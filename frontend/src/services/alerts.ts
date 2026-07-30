import api from "./api";
import type { Alert, PaginatedResponse } from "@/types";

export const alertService = {
  async getAll(params?: {
    page?: number;
    limit?: number;
    severity?: string;
    isRead?: string;
    search?: string;
  }) {
    const { data } = await api.get<PaginatedResponse<Alert>>("/alerts", {
      params,
    });
    return data;
  },

  async markAsRead(id: string) {
    const { data } = await api.patch<{ success: boolean; data: Alert }>(
      `/alerts/${id}/read`,
    );
    return data.data;
  },

  async markAllAsRead() {
    const { data } = await api.patch<{
      success: boolean;
      data: { unreadCount: number };
    }>("/alerts/read-all");
    return data.data;
  },

  async delete(id: string) {
    const { data } = await api.delete<{ success: boolean; data: { id: string } }>(
      `/alerts/${id}`,
    );
    return data.data;
  },

  async getUnreadCount() {
    const { data } = await api.get<{
      success: boolean;
      data: { count: number };
    }>("/alerts/unread-count");
    return data.data.count;
  },
};

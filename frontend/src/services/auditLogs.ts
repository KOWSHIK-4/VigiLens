import api from "./api";
import type {
  AuditLog,
  AuditLogChartData,
  AuditLogFilters,
  AuditLogStats,
  PaginatedResponse,
} from "@/types";

export const auditLogService = {
  async getAll(params?: AuditLogFilters) {
    const { data } = await api.get<PaginatedResponse<AuditLog>>("/audit-logs", {
      params,
    });
    return data;
  },

  async getById(id: string) {
    const { data } = await api.get<{ success: boolean; data: AuditLog }>(
      `/audit-logs/${id}`,
    );
    return data.data;
  },

  async getStats() {
    const { data } = await api.get<{ success: boolean; data: AuditLogStats }>(
      "/audit-logs/stats",
    );
    return data.data;
  },

  async getChartData() {
    const { data } = await api.get<{ success: boolean; data: AuditLogChartData }>(
      "/audit-logs/charts",
    );
    return data.data;
  },

  async exportCSV(params?: Omit<AuditLogFilters, "page" | "limit" | "sortBy" | "sortOrder">) {
    const response = await api.get("/audit-logs/export", {
      params,
      responseType: "blob",
    });
    return response.data as Blob;
  },
};

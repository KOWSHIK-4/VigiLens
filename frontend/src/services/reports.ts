import api from "./api";
import type { PaginatedResponse, Report, ReportType } from "@/types";

export interface GenerateReportInput {
  title: string;
  type: ReportType;
  dateRange: { from: string; to: string };
}

export interface ReportFilters {
  page?: number;
  limit?: number;
  search?: string;
  type?: string;
  status?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export const reportService = {
  async getAll(params?: ReportFilters) {
    const { data } = await api.get<PaginatedResponse<Report>>("/reports", { params });
    return data;
  },

  async getById(id: string) {
    const { data } = await api.get<{ success: boolean; data: Report }>(`/reports/${id}`);
    return data.data;
  },

  async generate(input: GenerateReportInput) {
    const { data } = await api.post<{ success: boolean; data: Report }>("/reports/generate", input);
    return data.data;
  },

  async delete(id: string) {
    const { data } = await api.delete<{ success: boolean; data: { id: string } }>(`/reports/${id}`);
    return data.data;
  },

  async download(id: string, format: "pdf" | "csv" = "pdf") {
    const response = await api.get(`/reports/download/${id}`, {
      params: { format },
      responseType: "blob",
    });
    const blob = new Blob([response.data]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `report-${id}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  },
};

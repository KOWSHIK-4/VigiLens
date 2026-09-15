import api from "./api";
import type { SecurityDashboardData } from "@/types";

export const securityService = {
  async getDashboard(): Promise<SecurityDashboardData> {
    const { data } = await api.get<{ success: boolean; data: SecurityDashboardData }>(
      "/security/dashboard",
    );
    return data.data;
  },
};
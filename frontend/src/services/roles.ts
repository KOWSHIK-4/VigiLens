import api from "./api";
import type { Role, UserRole } from "@/types";

export const roleService = {
  async getAll() {
    const { data } = await api.get<{ success: boolean; data: Role[] }>(
      "/roles",
    );
    return data.data;
  },

  async updatePermissions(name: UserRole, permissionKeys: string[]) {
    const { data } = await api.patch<{ success: boolean; data: Role }>(
      `/roles/${name}/permissions`,
      { permissionKeys },
    );
    return data.data;
  },
};

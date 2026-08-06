import api from "./api";
import type { Permission, Role } from "@/types";

export interface RoleInput {
  name: string;
  description?: string;
}

export const roleService = {
  async getAll() {
    const { data } = await api.get<{ success: boolean; data: Role[] }>(
      "/roles",
    );
    return data.data;
  },

  async create(input: RoleInput) {
    const { data } = await api.post<{ success: boolean; data: Role }>(
      "/roles",
      input,
    );
    return data.data;
  },

  async update(name: string, input: Partial<RoleInput>) {
    const { data } = await api.patch<{ success: boolean; data: Role }>(
      `/roles/${name}`,
      input,
    );
    return data.data;
  },

  async updatePermissions(name: string, permissionKeys: string[]) {
    const { data } = await api.patch<{ success: boolean; data: Role }>(
      `/roles/${name}/permissions`,
      { permissionKeys },
    );
    return data.data;
  },

  async remove(name: string) {
    const { data } = await api.delete<{ success: boolean; data: unknown }>(
      `/roles/${name}`,
    );
    return data.data;
  },
};

export async function fetchAllPermissions(): Promise<Permission[]> {
  const { data } = await api.get<{ success: boolean; data: Permission[] }>(
    "/roles/permissions",
  );
  return data.data;
}

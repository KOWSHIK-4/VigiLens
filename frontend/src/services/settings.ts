import api from "./api";
import type {
  SettingsCategory,
  SettingsUpdateInput,
  SettingsValue,
  SystemSetting,
} from "@/types";

export const settingsService = {
  async getAll() {
    const { data } = await api.get<{ success: boolean; data: SystemSetting[] }>(
      "/settings",
    );
    return data.data;
  },

  async getByCategory(category: SettingsCategory) {
    const { data } = await api.get<{ success: boolean; data: SystemSetting[] }>(
      `/settings/${category}`,
    );
    return data.data;
  },

  async update(category: SettingsCategory, values: SettingsUpdateInput) {
    const { data } = await api.patch<{ success: boolean; data: SystemSetting[] }>(
      `/settings/${category}`,
      values,
    );
    return data.data;
  },

  async reset(category: SettingsCategory) {
    const { data } = await api.post<{ success: boolean; data: SystemSetting[] }>(
      `/settings/${category}/reset`,
    );
    return data.data;
  },
};

export type { SettingsValue };

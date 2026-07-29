import api from "./api";
import type { Camera } from "@/types";

export const cameraService = {
  async getAll(): Promise<Camera[]> {
    const { data } = await api.get<Camera[]>("/cameras");
    return data;
  },

  async getById(id: string): Promise<Camera> {
    const { data } = await api.get<Camera>(`/cameras/${id}`);
    return data;
  },
};

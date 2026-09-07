import api from "./api";
import { useAuth } from "@/hooks/useAuth";
import type { AuthResponse, ChangePasswordInput, User } from "@/types";

export const authService = {
  async login(email: string, password: string): Promise<AuthResponse> {
    const { data } = await api.post<{ success: boolean; data: AuthResponse }>(
      "/auth/login",
      {
        email,
        password,
      },
    );
    localStorage.setItem("token", data.data.token);
    useAuth.getState().setUser(data.data.user);
    return data.data;
  },

  async register(
    name: string,
    email: string,
    password: string,
  ): Promise<AuthResponse> {
    const { data } = await api.post<{ success: boolean; data: AuthResponse }>(
      "/auth/register",
      {
        name,
        email,
        password,
      },
    );
    localStorage.setItem("token", data.data.token);
    useAuth.getState().setUser(data.data.user);
    return data.data;
  },

  async me(): Promise<User> {
    const { data } = await api.get<{ success: boolean; data: User }>(
      "/auth/me",
    );
    return data.data;
  },

  async logout(): Promise<void> {
    try {
      await api.post("/auth/logout");
    } catch {
      // Ignore logout API failures — local cleanup still proceeds
    }
    localStorage.removeItem("token");
    window.location.href = "/login";
  },

  async changePassword(input: ChangePasswordInput): Promise<void> {
    await api.post("/auth/change-password", input);
    // The backend clears `mustChangePassword` on success; refresh the stored
    // user so role-based UI and the redirect guard reflect it immediately.
    const user = await this.me();
    useAuth.getState().setUser(user);
  },

  getToken(): string | null {
    return localStorage.getItem("token");
  },

  isAuthenticated(): boolean {
    return !!localStorage.getItem("token");
  },
};

import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "/api",
  headers: { "Content-Type": "application/json" },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem("token");
      window.location.href = "/login";
    } else if (
      error.response?.status === 403 &&
      error.response?.data?.code === "PASSWORD_CHANGE_REQUIRED" &&
      !window.location.pathname.startsWith("/change-password") &&
      !window.location.pathname.startsWith("/login")
    ) {
      window.location.href = "/change-password";
    }
    return Promise.reject(error);
  },
);

export default api;

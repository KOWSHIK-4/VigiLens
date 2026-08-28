import axios from "axios";

const configuredApiUrl = import.meta.env.VITE_API_URL;
const isLocalDevUrl = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?/i.test(
  configuredApiUrl ?? "",
);

// Never route a production build to a localhost URL that leaked in via .env
// (the committed frontend/.env points at http://localhost:4000). In production
// we always use the same-origin /api proxy on Vercel.
export const API_BASE_URL = configuredApiUrl && (import.meta.env.DEV || !isLocalDevUrl)
  ? configuredApiUrl
  : "/api";

const api = axios.create({
  baseURL: API_BASE_URL,
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

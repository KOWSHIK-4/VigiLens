import { BrowserRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Layout from "@/components/Layout";
import ProtectedRoute from "@/components/ProtectedRoute";
import LoginPage from "@/pages/LoginPage";
import DashboardPage from "@/pages/DashboardPage";
import CamerasPage from "@/pages/CamerasPage";
import DetectionsPage from "@/pages/DetectionsPage";
import AnalyticsPage from "@/pages/AnalyticsPage";
import LiveCameraPage from "@/pages/LiveCameraPage";
import AlertsPage from "@/pages/AlertsPage";
import ReportsPage from "@/pages/ReportsPage";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30000,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<DashboardPage />} />
            <Route path="cameras" element={<CamerasPage />} />
            <Route path="detections" element={<DetectionsPage />} />
            <Route path="analytics" element={<AnalyticsPage />} />
            <Route path="live-camera" element={<LiveCameraPage />} />
            <Route path="alerts" element={<AlertsPage />} />
            <Route path="reports" element={<ReportsPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

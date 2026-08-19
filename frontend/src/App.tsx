import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Layout from "@/components/Layout";
import ProtectedRoute from "@/components/ProtectedRoute";
import AuthProvider from "@/components/AuthProvider";
import ErrorBoundary from "@/components/ErrorBoundary";
import LoginPage from "@/pages/LoginPage";
import ChangePasswordPage from "@/pages/ChangePasswordPage";
import NotFoundPage from "@/pages/NotFoundPage";

const DashboardPage = lazy(() => import("@/pages/DashboardPage"));
const CamerasPage = lazy(() => import("@/pages/CamerasPage"));
const DetectionsPage = lazy(() => import("@/pages/DetectionsPage"));
const AnalyticsPage = lazy(() => import("@/pages/AnalyticsPage"));
const LiveCameraPage = lazy(() => import("@/pages/LiveCameraPage"));
const AlertsPage = lazy(() => import("@/pages/AlertsPage"));
const ReportsPage = lazy(() => import("@/pages/ReportsPage"));
const ModelsPage = lazy(() => import("@/pages/ModelsPage"));
const DetectorsPage = lazy(() => import("@/pages/DetectorsPage"));
const UsersPage = lazy(() => import("@/pages/UsersPage"));
const RolesPage = lazy(() => import("@/pages/RolesPage"));
const AuditLogsPage = lazy(() => import("@/pages/AuditLogsPage"));
const SettingsPage = lazy(() => import("@/pages/SettingsPage"));
const SystemMonitoringPage = lazy(() => import("@/pages/SystemMonitoringPage"));
const MonitoringPage = lazy(() => import("@/pages/MonitoringPage"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30000,
    },
  },
});

function PageFallback() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
    </div>
  );
}

function LazyRoute({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary>
      <Suspense fallback={<PageFallback />}>{children}</Suspense>
    </ErrorBoundary>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/change-password"
            element={
              <ProtectedRoute>
                <AuthProvider>
                  <ChangePasswordPage />
                </AuthProvider>
              </ProtectedRoute>
            }
          />
          <Route
            element={
              <ProtectedRoute>
                <AuthProvider>
                  <Layout />
                </AuthProvider>
              </ProtectedRoute>
            }
          >
            <Route
              index
              element={
                <LazyRoute>
                  <DashboardPage />
                </LazyRoute>
              }
            />
            <Route
              path="cameras"
              element={
                <LazyRoute>
                  <CamerasPage />
                </LazyRoute>
              }
            />
            <Route
              path="detections"
              element={
                <LazyRoute>
                  <DetectionsPage />
                </LazyRoute>
              }
            />
            <Route
              path="analytics"
              element={
                <LazyRoute>
                  <AnalyticsPage />
                </LazyRoute>
              }
            />
            <Route
              path="live-camera"
              element={
                <LazyRoute>
                  <LiveCameraPage />
                </LazyRoute>
              }
            />
            <Route
              path="alerts"
              element={
                <LazyRoute>
                  <AlertsPage />
                </LazyRoute>
              }
            />
            <Route
              path="reports"
              element={
                <LazyRoute>
                  <ReportsPage />
                </LazyRoute>
              }
            />
            <Route
              path="models"
              element={
                <LazyRoute>
                  <ModelsPage />
                </LazyRoute>
              }
            />
            <Route
              path="detectors"
              element={
                <LazyRoute>
                  <DetectorsPage />
                </LazyRoute>
              }
            />
            <Route
              path="users"
              element={
                <LazyRoute>
                  <UsersPage />
                </LazyRoute>
              }
            />
            <Route
              path="roles"
              element={
                <LazyRoute>
                  <RolesPage />
                </LazyRoute>
              }
            />
            <Route
              path="audit-logs"
              element={
                <LazyRoute>
                  <AuditLogsPage />
                </LazyRoute>
              }
            />
            <Route
              path="settings"
              element={
                <LazyRoute>
                  <SettingsPage />
                </LazyRoute>
              }
            />
            <Route
              path="system-monitoring"
              element={
                <LazyRoute>
                  <SystemMonitoringPage />
                </LazyRoute>
              }
            />
            <Route
              path="monitoring"
              element={
                <LazyRoute>
                  <MonitoringPage />
                </LazyRoute>
              }
            />
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

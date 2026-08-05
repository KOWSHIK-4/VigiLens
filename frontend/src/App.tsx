import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Layout from "@/components/Layout";
import ProtectedRoute from "@/components/ProtectedRoute";
import AuthProvider from "@/components/AuthProvider";
import LoginPage from "@/pages/LoginPage";

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

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
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
                <Suspense fallback={<PageFallback />}>
                  <DashboardPage />
                </Suspense>
              }
            />
            <Route
              path="cameras"
              element={
                <Suspense fallback={<PageFallback />}>
                  <CamerasPage />
                </Suspense>
              }
            />
            <Route
              path="detections"
              element={
                <Suspense fallback={<PageFallback />}>
                  <DetectionsPage />
                </Suspense>
              }
            />
            <Route
              path="analytics"
              element={
                <Suspense fallback={<PageFallback />}>
                  <AnalyticsPage />
                </Suspense>
              }
            />
            <Route
              path="live-camera"
              element={
                <Suspense fallback={<PageFallback />}>
                  <LiveCameraPage />
                </Suspense>
              }
            />
            <Route
              path="alerts"
              element={
                <Suspense fallback={<PageFallback />}>
                  <AlertsPage />
                </Suspense>
              }
            />
            <Route
              path="reports"
              element={
                <Suspense fallback={<PageFallback />}>
                  <ReportsPage />
                </Suspense>
              }
            />
            <Route
              path="models"
              element={
                <Suspense fallback={<PageFallback />}>
                  <ModelsPage />
                </Suspense>
              }
            />
            <Route
              path="detectors"
              element={
                <Suspense fallback={<PageFallback />}>
                  <DetectorsPage />
                </Suspense>
              }
            />
            <Route
              path="users"
              element={
                <Suspense fallback={<PageFallback />}>
                  <UsersPage />
                </Suspense>
              }
            />
            <Route
              path="roles"
              element={
                <Suspense fallback={<PageFallback />}>
                  <RolesPage />
                </Suspense>
              }
            />
            <Route
              path="audit-logs"
              element={
                <Suspense fallback={<PageFallback />}>
                  <AuditLogsPage />
                </Suspense>
              }
            />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

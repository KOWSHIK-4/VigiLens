import { lazy, Suspense } from "react";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Layout from "@/components/Layout";
import ProtectedRoute from "@/components/ProtectedRoute";
import AuthProvider from "@/components/AuthProvider";
import ErrorBoundary from "@/components/ErrorBoundary";
import RouteErrorBoundary from "@/components/RouteErrorBoundary";
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

// Data router so route guards like SettingsPage's unsaved-changes
// useBlocker actually function; plain <BrowserRouter> does not support
// data-router-only hooks.
const router = createBrowserRouter([
  {
    path: "/login",
    element: <LoginPage />,
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: "/change-password",
    element: (
      <ProtectedRoute>
        <AuthProvider>
          <ChangePasswordPage />
        </AuthProvider>
      </ProtectedRoute>
    ),
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: "/",
    element: (
      <ProtectedRoute>
        <AuthProvider>
          <Layout />
        </AuthProvider>
      </ProtectedRoute>
    ),
    errorElement: <RouteErrorBoundary />,
    children: [
      {
        index: true,
        element: (
          <LazyRoute>
            <DashboardPage />
          </LazyRoute>
        ),
      },
      {
        path: "cameras",
        element: (
          <LazyRoute>
            <CamerasPage />
          </LazyRoute>
        ),
      },
      {
        path: "detections",
        element: (
          <LazyRoute>
            <DetectionsPage />
          </LazyRoute>
        ),
      },
      {
        path: "analytics",
        element: (
          <LazyRoute>
            <AnalyticsPage />
          </LazyRoute>
        ),
      },
      {
        path: "live-camera",
        element: (
          <LazyRoute>
            <LiveCameraPage />
          </LazyRoute>
        ),
      },
      {
        path: "alerts",
        element: (
          <LazyRoute>
            <AlertsPage />
          </LazyRoute>
        ),
      },
      {
        path: "reports",
        element: (
          <LazyRoute>
            <ReportsPage />
          </LazyRoute>
        ),
      },
      {
        path: "models",
        element: (
          <LazyRoute>
            <ModelsPage />
          </LazyRoute>
        ),
      },
      {
        path: "detectors",
        element: (
          <LazyRoute>
            <DetectorsPage />
          </LazyRoute>
        ),
      },
      {
        path: "users",
        element: (
          <LazyRoute>
            <UsersPage />
          </LazyRoute>
        ),
      },
      {
        path: "roles",
        element: (
          <LazyRoute>
            <RolesPage />
          </LazyRoute>
        ),
      },
      {
        path: "audit-logs",
        element: (
          <LazyRoute>
            <AuditLogsPage />
          </LazyRoute>
        ),
      },
      {
        path: "settings",
        element: (
          <LazyRoute>
            <SettingsPage />
          </LazyRoute>
        ),
      },
      {
        path: "system-monitoring",
        element: (
          <LazyRoute>
            <SystemMonitoringPage />
          </LazyRoute>
        ),
      },
      {
        path: "monitoring",
        element: (
          <LazyRoute>
            <MonitoringPage />
          </LazyRoute>
        ),
      },
    ],
  },
  { path: "*", element: <NotFoundPage /> },
]);

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

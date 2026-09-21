import { Outlet, Link, useLocation } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  Brain,
  Camera,
  FileText,
  LayoutDashboard,
  ScanEye,
  BarChart3,
  MonitorPlay,
  Radar,
  ScrollText,
  Settings,
  Shield,
  ShieldCheck,
  Users,
  UsersRound,
  Activity,
  Menu,
  LogOut,
  LifeBuoy,
} from "lucide-react";
import { authService } from "@/services/auth";
import { alertService } from "@/services/alerts";
import { useRealtime } from "@/hooks/useRealtime";
import ToastItem from "./Toast";
import { showToast, useToast } from "@/utils/toast";
import { useEffect, useState } from "react";
import { hasPermission } from "@/utils/permissions";
import { useAuth } from "@/hooks/useAuth";

const navItems = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard, permission: null },
  { path: "/live-camera", label: "Live Camera", icon: MonitorPlay, permission: "cameras.control" },
  { path: "/cameras", label: "Cameras", icon: Camera, permission: "cameras.read" },
  { path: "/detections", label: "Detections", icon: ScanEye, permission: "detections.read" },
  { path: "/analytics", label: "Analytics", icon: BarChart3, permission: "analytics.read" },
  { path: "/reports", label: "Reports", icon: FileText, permission: "reports.read" },
  { path: "/detectors", label: "Detectors", icon: Brain, permission: "models.read" },
];

const adminNavItems = [
  { path: "/users", label: "Users", icon: Users, permission: "users.read" },
  { path: "/teams", label: "Teams", icon: UsersRound, permission: "teams.read" },
  { path: "/roles", label: "Roles", icon: Shield, permission: "roles.read" },
  { path: "/settings", label: "Settings", icon: Settings, permission: "settings.read" },
  { path: "/audit-logs", label: "Audit Logs", icon: ScrollText, permission: "audit.read" },
  {
    path: "/system-monitoring",
    label: "System Health",
    icon: Activity,
    permission: "monitoring.read",
  },
  {
    path: "/monitoring",
    label: "Continuous Monitoring",
    icon: Radar,
    permission: "monitoring.read",
  },
  {
    path: "/security-dashboard",
    label: "Security Ops",
    icon: ShieldCheck,
    permission: "security.read",
  },
];

export default function Layout() {
  const location = useLocation();
  const { toasts, dismiss } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const visibleNav = navItems.filter(
    (item) => !item.permission || hasPermission(user, item.permission),
  );
  const visibleAdminNav = adminNavItems.filter((item) =>
    hasPermission(user, item.permission),
  );

  const canSeeAlerts = hasPermission(user, "alerts.read");

  // Server-authoritative unread badge; refetched on invalidation only (not
  // on a timer — SSE events handle real-time badge bumps below).
  const { data: unreadData } = useQuery({
    queryKey: ["alerts", "unread-count"],
    queryFn: () => alertService.getUnreadCount(),
    enabled: canSeeAlerts,
  });

  const unreadCount = unreadData ?? 0;

  // Push-driven toasts + badge increments via SSE instead of 5s polling.
  const { events } = useRealtime({ enabled: canSeeAlerts });
  useEffect(() => {
    if (!events.length) return;
    for (const evt of events) {
      if (evt.type === "alert" && evt.data.event === "alert_created") {
        showToast({
          severity: (evt.data.severity ?? "info") as "info" | "warning" | "critical",
          title: evt.data.title ?? "New Alert",
          message: evt.data.message ?? "",
        });
        queryClient.setQueryData(
          ["alerts", "unread-count"],
          (prev: number | undefined) => (prev ?? 0) + 1,
        );
      }
    }
  }, [events, queryClient]);

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!sidebarOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSidebarOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sidebarOpen]);

  return (
    <div className="flex h-screen bg-gray-50">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:px-4 focus:py-2 focus:bg-brand-600 focus:text-white focus:rounded-lg focus:text-sm"
      >
        Skip to main content
      </a>
      <div
        className={`lg:hidden fixed top-0 inset-x-0 z-40 h-14 bg-gray-900 text-white flex items-center justify-between px-4`}
      >
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 -ml-2 hover:bg-gray-800 rounded-lg transition-colors"
            aria-label="Open navigation"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-bold tracking-tight leading-none truncate">
              VigiLens
            </h1>
            <p className="text-xs text-gray-400 mt-0.5 truncate">Security Monitoring</p>
          </div>
        </div>
        <button
          onClick={() => authService.logout()}
          className="p-2 hover:bg-gray-800 rounded-lg text-gray-400 hover:text-white transition-colors"
          aria-label="Sign out"
          title="Sign out"
        >
          <LogOut className="w-5 h-5" />
        </button>
      </div>

      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-gray-900 text-white flex flex-col flex-shrink-0 transform transition-transform duration-200 ease-in-out lg:translate-x-0 lg:static ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="p-6 border-b border-gray-700">
          <h1 className="text-2xl font-bold tracking-tight">VigiLens</h1>
          <p className="text-sm text-gray-400 mt-1">Security Monitoring</p>
        </div>

        <nav className="flex-1 p-4 space-y-1 overflow-y-auto" aria-label="Primary">
          {visibleNav.map((item) => {
            const Icon = item.icon;
            const active = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? "bg-brand-600 text-white"
                    : "text-gray-300 hover:bg-gray-800 hover:text-white"
                }`}
              >
                <Icon className="w-4 h-4" aria-hidden="true" />
                {item.label}
              </Link>
            );
          })}
          {visibleAdminNav.length > 0 && (
            <>
              <div className="pt-3 pb-1 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Administration
              </div>
              {visibleAdminNav.map((item) => {
                const Icon = item.icon;
                const active = location.pathname === item.path;
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    aria-current={active ? "page" : undefined}
                    className={`flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                      active
                        ? "bg-brand-600 text-white"
                        : "text-gray-300 hover:bg-gray-800 hover:text-white"
                    }`}
                  >
                    <Icon className="w-4 h-4" aria-hidden="true" />
                    {item.label}
                  </Link>
                );
              })}
            </>
          )}
          {hasPermission(user, "alerts.read") && (
            <>
              <div className="pt-3 pb-1 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Operations
              </div>
              <Link
                to="/alerts"
                aria-current={location.pathname === "/alerts" ? "page" : undefined}
                className={`flex items-center justify-between px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  location.pathname === "/alerts"
                    ? "bg-brand-600 text-white"
                    : "text-gray-300 hover:bg-gray-800 hover:text-white"
                }`}
              >
                <span className="flex items-center gap-3">
                  <Bell className="w-4 h-4" aria-hidden="true" />
                  Alerts
                </span>
                {unreadCount > 0 && (
                  <span className="bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full min-w-[20px] text-center">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </Link>
              <Link
                to="/incidents"
                aria-current={location.pathname === "/incidents" ? "page" : undefined}
                className={`flex items-center px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  location.pathname === "/incidents"
                    ? "bg-brand-600 text-white"
                    : "text-gray-300 hover:bg-gray-800 hover:text-white"
                }`}
              >
                <LifeBuoy className="w-4 h-4 mr-3" aria-hidden="true" />
                Incidents
              </Link>
            </>
          )}
        </nav>

        <div className="p-4 border-t border-gray-700">
          <button
            onClick={() => authService.logout()}
            className="w-full px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors text-left"
          >
            Sign Out
          </button>
        </div>
      </aside>

      <main id="main-content" className="flex-1 overflow-auto" tabIndex={-1}>
        <div className="p-4 md:p-8 pt-16 lg:pt-8">
          <Outlet />
        </div>
      </main>

      <div className="fixed bottom-4 right-4 left-4 sm:left-auto z-50 flex flex-col gap-2 sm:items-end">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </div>
  );
}

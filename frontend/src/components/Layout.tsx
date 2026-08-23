import { Outlet, Link, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
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
  Users,
  Activity,
  Menu,
  LogOut,
} from "lucide-react";
import { authService } from "@/services/auth";
import { alertService } from "@/services/alerts";
import ToastItem from "./Toast";
import { showToast, useToast } from "@/utils/toast";
import { useEffect, useRef, useState } from "react";
import { hasPermission } from "@/utils/permissions";
import { useAuth } from "@/hooks/useAuth";
import type { Alert } from "@/types";

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
    label: "Monitoring",
    icon: Radar,
    permission: "monitoring.read",
  },
];

export default function Layout() {
  const location = useLocation();
  const { toasts, dismiss } = useToast();
  const { user } = useAuth();
  const prevAlertIds = useRef<Set<string>>(new Set());
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const visibleNav = navItems.filter(
    (item) => !item.permission || hasPermission(user, item.permission),
  );
  const visibleAdminNav = adminNavItems.filter((item) =>
    hasPermission(user, item.permission),
  );

  const canSeeAlerts = hasPermission(user, "alerts.read");

  const { data: unreadData } = useQuery({
    queryKey: ["alerts", "unread-count"],
    queryFn: () => alertService.getUnreadCount(),
    refetchInterval: 5000,
    enabled: canSeeAlerts,
  });

  const { data: latestAlerts } = useQuery({
    queryKey: ["alerts", "latest"],
    queryFn: () => alertService.getAll({ page: 1, limit: 5, isRead: "false" }),
    refetchInterval: 5000,
    enabled: canSeeAlerts,
  });

  // The first response seeds known alert ids so pre-existing alerts do not
  // fire a toast storm on page load; afterwards only genuinely new alerts
  // toast. The id set is bounded so long sessions cannot grow it forever.
  const seededAlertIdsRef = useRef(false);

  useEffect(() => {
    if (!latestAlerts?.data) return;
    if (!seededAlertIdsRef.current) {
      latestAlerts.data.forEach((a: Alert) => prevAlertIds.current.add(a.id));
      seededAlertIdsRef.current = true;
      return;
    }
    const newAlerts = latestAlerts.data.filter(
      (a: Alert) => !prevAlertIds.current.has(a.id),
    );
    newAlerts.forEach((alert: Alert) => {
      showToast({
        severity: alert.severity,
        title: alert.title,
        message: alert.message,
      });
    });
    latestAlerts.data.forEach((a: Alert) => prevAlertIds.current.add(a.id));
    while (prevAlertIds.current.size > 500) {
      const oldest = prevAlertIds.current.values().next().value;
      if (oldest === undefined) break;
      prevAlertIds.current.delete(oldest);
    }
  }, [latestAlerts]);

  const unreadCount = unreadData ?? 0;

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  return (
    <div className="flex h-screen bg-gray-50">
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
          <div>
            <h1 className="text-lg font-bold tracking-tight leading-none">
              VigiLens
            </h1>
            <p className="text-xs text-gray-400 mt-0.5">Security Monitoring</p>
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

        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {visibleNav.map((item) => {
            const Icon = item.icon;
            const active = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? "bg-brand-600 text-white"
                    : "text-gray-300 hover:bg-gray-800 hover:text-white"
                }`}
              >
                <Icon className="w-4 h-4" />
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
                    className={`flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                      active
                        ? "bg-brand-600 text-white"
                        : "text-gray-300 hover:bg-gray-800 hover:text-white"
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {item.label}
                  </Link>
                );
              })}
            </>
          )}
          {hasPermission(user, "alerts.read") && (
            <Link
              to="/alerts"
              className={`flex items-center justify-between px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                location.pathname === "/alerts"
                  ? "bg-brand-600 text-white"
                  : "text-gray-300 hover:bg-gray-800 hover:text-white"
              }`}
            >
              <span className="flex items-center gap-3">
                <Bell className="w-4 h-4" />
                Alerts
              </span>
              {unreadCount > 0 && (
                <span className="bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full min-w-[20px] text-center">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </Link>
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

      <main className="flex-1 overflow-auto">
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

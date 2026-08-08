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
  ScrollText,
  Settings,
  Shield,
  Users,
  Activity,
} from "lucide-react";
import { authService } from "@/services/auth";
import { alertService } from "@/services/alerts";
import ToastItem from "./Toast";
import { showToast, useToast } from "@/utils/toast";
import { useEffect, useRef } from "react";
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
];

export default function Layout() {
  const location = useLocation();
  const { toasts, dismiss } = useToast();
  const { user } = useAuth();
  const prevAlertIds = useRef<Set<string>>(new Set());

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

  useEffect(() => {
    if (!latestAlerts?.data) return;
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
  }, [latestAlerts]);

  const unreadCount = unreadData ?? 0;

  return (
    <div className="flex h-screen bg-gray-50">
      <aside className="w-64 bg-gray-900 text-white flex flex-col flex-shrink-0">
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
        <div className="p-8">
          <Outlet />
        </div>
      </main>

      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </div>
  );
}

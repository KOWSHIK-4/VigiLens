import { Outlet, Link, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { authService } from "@/services/auth";
import { alertService } from "@/services/alerts";
import { ToastItem, showToast, useToast } from "./Toast";
import { useEffect, useRef } from "react";
import type { Alert } from "@/types";

const navItems = [
  { path: "/", label: "Dashboard" },
  { path: "/live-camera", label: "Live Camera" },
  { path: "/cameras", label: "Cameras" },
  { path: "/detections", label: "Detections" },
  { path: "/analytics", label: "Analytics" },
  { path: "/reports", label: "Reports" },
];

export default function Layout() {
  const location = useLocation();
  const { toasts, dismiss } = useToast();
  const prevAlertIds = useRef<Set<string>>(new Set());

  const { data: unreadData } = useQuery({
    queryKey: ["alerts", "unread-count"],
    queryFn: () => alertService.getUnreadCount(),
    refetchInterval: 5000,
  });

  const { data: latestAlerts } = useQuery({
    queryKey: ["alerts", "latest"],
    queryFn: () => alertService.getAll({ page: 1, limit: 5, isRead: "false" }),
    refetchInterval: 5000,
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

        <nav className="flex-1 p-4 space-y-1">
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`block px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                location.pathname === item.path
                  ? "bg-brand-600 text-white"
                  : "text-gray-300 hover:bg-gray-800 hover:text-white"
              }`}
            >
              {item.label}
            </Link>
          ))}
          <Link
            to="/alerts"
            className={`flex items-center justify-between px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              location.pathname === "/alerts"
                ? "bg-brand-600 text-white"
                : "text-gray-300 hover:bg-gray-800 hover:text-white"
            }`}
          >
            <span className="flex items-center gap-2">
              <Bell className="w-4 h-4" />
              Alerts
            </span>
            {unreadCount > 0 && (
              <span className="bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full min-w-[20px] text-center">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </Link>
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

import { useEffect, useState } from "react";
import { AlertTriangle, Info, X } from "lucide-react";

export interface ToastData {
  id: string;
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
}

const severityConfig = {
  critical: {
    bg: "bg-red-50 border-red-200",
    icon: AlertTriangle,
    iconColor: "text-red-500",
    titleColor: "text-red-800",
    msgColor: "text-red-600",
  },
  warning: {
    bg: "bg-yellow-50 border-yellow-200",
    icon: AlertTriangle,
    iconColor: "text-yellow-500",
    titleColor: "text-yellow-800",
    msgColor: "text-yellow-600",
  },
  info: {
    bg: "bg-blue-50 border-blue-200",
    icon: Info,
    iconColor: "text-blue-500",
    titleColor: "text-blue-800",
    msgColor: "text-blue-600",
  },
};

export function ToastItem({
  toast,
  onDismiss,
}: {
  toast: ToastData;
  onDismiss: (id: string) => void;
}) {
  const cfg = severityConfig[toast.severity];
  const Icon = cfg.icon;

  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), 5000);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  return (
    <div
      className={`${cfg.bg} border rounded-lg shadow-lg p-4 flex items-start gap-3 min-w-[320px] max-w-md animate-slide-in`}
    >
      <Icon className={`w-5 h-5 mt-0.5 ${cfg.iconColor} flex-shrink-0`} />
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold ${cfg.titleColor}`}>{toast.title}</p>
        <p className={`text-xs ${cfg.msgColor} mt-0.5 truncate`}>{toast.message}</p>
      </div>
      <button
        onClick={() => onDismiss(toast.id)}
        className="text-gray-400 hover:text-gray-600 flex-shrink-0"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

let toastListeners: Array<(toast: ToastData) => void> = [];
let toastIdCounter = 0;

export function showToast(toast: Omit<ToastData, "id">) {
  const id = `toast-${++toastIdCounter}`;
  toastListeners.forEach((fn) => fn({ ...toast, id }));
}

export function useToast() {
  const [toasts, setToasts] = useState<ToastData[]>([]);

  useEffect(() => {
    const listener = (toast: ToastData) => {
      setToasts((prev) => [...prev, toast]);
    };
    toastListeners.push(listener);
    return () => {
      toastListeners = toastListeners.filter((l) => l !== listener);
    };
  }, []);

  const dismiss = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return { toasts, dismiss };
}

import { useEffect, useState } from "react";

export interface ToastData {
  id: string;
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
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
      // Keep the newest toasts only so an alert burst cannot stack
      // unbounded overlays on screen.
      setToasts((prev) => [...prev.slice(-4), toast]);
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

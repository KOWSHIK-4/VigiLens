export interface User {
  id: string;
  email: string;
  name: string;
  role: "admin" | "operator" | "viewer";
  createdAt: string;
}

export interface AuthResponse {
  user: User;
  token: string;
}

export interface Detection {
  id: string;
  timestamp: string;
  cameraId: string;
  cameraName: string;
  label: string;
  confidence: number;
  imageUrl: string;
  status: "critical" | "warning" | "info";
}

export interface Camera {
  id: string;
  name: string;
  url: string;
  status: "online" | "offline" | "error";
  location: string;
  lastSeen: string;
}

export interface DashboardStats {
  totalDetections: number;
  criticalAlerts: number;
  activeCameras: number;
  avgConfidence: number;
  detectionsOverTime: { date: string; count: number }[];
  alertsByType: { label: string; count: number }[];
  recentDetections: Detection[];
}

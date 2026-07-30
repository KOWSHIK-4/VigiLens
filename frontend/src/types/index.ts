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

export interface DetectionWithCamera extends Detection {
  camera?: Camera;
  metadata?: Record<string, unknown>;
}

export interface DetectionFilters {
  search?: string;
  status?: string;
  cameraId?: string;
  dateFrom?: string;
  dateTo?: string;
  confidenceMin?: string;
  confidenceMax?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export type CameraStatus = "online" | "offline" | "connecting" | "error";
export type CameraType = "usb" | "rtsp" | "ip" | "video_file";

export interface Camera {
  id: string;
  name: string;
  url: string;
  cameraType: CameraType;
  sourceURL: string | null;
  status: CameraStatus;
  location: string | null;
  resolution: string | null;
  fps: number | null;
  username: string | null;
  thumbnail: string | null;
  isHealthy: boolean;
  lastHealthCheck: string | null;
  lastSeen: string;
  createdAt: string;
  updatedAt: string;
  detections?: DetectionWithCamera[];
  healthLogs?: CameraHealthLog[];
}

export interface CameraHealthLog {
  id: string;
  cameraId: string;
  status: CameraStatus;
  message: string | null;
  responseTime: number | null;
  checkedAt: string;
}

export interface CreateCameraInput {
  name: string;
  url: string;
  cameraType: CameraType;
  sourceURL?: string | null;
  location?: string | null;
  resolution?: string | null;
  fps?: number | null;
  username?: string | null;
  password?: string | null;
}

export type UpdateCameraInput = Partial<CreateCameraInput>;

export interface CameraFilters {
  search?: string;
  status?: CameraStatus;
  cameraType?: CameraType;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface Alert {
  id: string;
  detectionId: string;
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  detection?: DetectionWithCamera;
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

export type UserRole = "super_admin" | "admin" | "operator" | "viewer";
export type UserStatus = "active" | "disabled";

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: UserStatus;
  avatar: string | null;
  lastLogin: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthResponse {
  user: User;
  token: string;
}

export interface Permission {
  id: string;
  key: string;
  name: string;
  description: string;
  category: string;
}

export interface Role {
  name: UserRole;
  description: string;
  isSystem: boolean;
  userCount: number;
  permissions: Permission[];
}

export interface UserStats {
  total: number;
  active: number;
  disabled: number;
  online: number;
}

export interface UserFilters {
  page?: number;
  limit?: number;
  search?: string;
  role?: UserRole;
  status?: UserStatus;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  role?: UserRole;
}

export interface UpdateUserInput {
  name?: string;
  email?: string;
  avatar?: string | null;
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

export type ReportType = "daily" | "weekly" | "monthly" | "camera" | "detection" | "alert";
export type ReportStatus = "generating" | "completed" | "failed";

export interface Report {
  id: string;
  title: string;
  type: ReportType;
  generatedBy: string;
  createdAt: string;
  dateRange: { from: string; to: string };
  reportUrl: string | null;
  status: ReportStatus;
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

export interface AnalyticsOverview {
  totalDetections: number;
  todayDetections: number;
  activeCameras: number;
  offlineCameras: number;
  totalCameras: number;
  averageConfidence: number;
  detectionRate: number;
  mostActiveCamera: { name: string; count: number };
  mostCommonDetectionType: string;
  severityDistribution: { name: string; value: number }[];
}

export interface DailyDetection {
  date: string;
  total: number;
  critical: number;
  warning: number;
  info: number;
}

export interface CameraAnalytics {
  id: string;
  name: string;
  location: string | null;
  status: string;
  detectionCount: number;
  percentageOfMax: number;
}

export interface DetectorStat {
  label: string;
  count: number;
  percentage: number;
  avgConfidence: number;
  minConfidence: number;
  maxConfidence: number;
}

export interface TimelineHour {
  hour: string;
  value: number;
}

export interface ConfidenceBucket {
  range: string;
  count: number;
  percentage: number;
}

export interface AnalyticsParams {
  period?: "7" | "30" | "90";
  from?: string;
  to?: string;
}

export type ModelStatus = "loaded" | "loading" | "disabled" | "error";

export interface AIModel {
  id: string;
  name: string;
  version: string;
  description: string;
  detectorKey: string;
  confidenceThreshold: number;
  enabled: boolean;
  status: ModelStatus;
  gpuSupported: boolean;
  modelPath: string;
  createdAt: string;
  updatedAt: string;
}

export interface ModelFilters {
  page?: number;
  limit?: number;
  search?: string;
  status?: ModelStatus;
  enabled?: boolean;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface UpdateModelInput {
  name?: string;
  version?: string;
  description?: string;
  confidenceThreshold?: number;
  enabled?: boolean;
  gpuSupported?: boolean;
  modelPath?: string;
}

export interface CreateModelInput {
  name: string;
  version: string;
  description?: string;
  detectorKey: string;
  confidenceThreshold?: number;
  enabled?: boolean;
  gpuSupported?: boolean;
  modelPath?: string;
}

export interface ModelTestResult {
  success: boolean;
  modelId: string;
  modelName: string;
  message: string;
  inferenceTimeMs: number;
  framesProcessed: number;
  detections: number;
  thresholdApplied: number;
}

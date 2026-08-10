export type UserRole = string;
export type UserStatus = "active" | "disabled";

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: UserStatus;
  avatar: string | null;
  lastLogin: string | null;
  isLocked: boolean;
  failedLoginAttempts: number;
  lockedAt: string | null;
  mustChangePassword: boolean;
  deletedAt: string | null;
  permissions?: Permission[];
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
  name: string;
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
  locked: number;
}

export interface UserFilters {
  page?: number;
  limit?: number;
  search?: string;
  role?: string;
  status?: UserStatus;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  role?: string;
  mustChangePassword?: boolean;
}

export interface UpdateUserInput {
  name?: string;
  email?: string;
  avatar?: string | null;
}

export interface ResetPasswordInput {
  password: string;
  mustChangePassword: boolean;
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
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

export type DetectorStatus = "running" | "stopped" | "error";
export type ProcessorPreference = "gpu" | "cpu" | "auto";

export interface DetectorSettings {
  alertSeverity: "info" | "warning" | "critical";
  detectionIntervalMs: number;
  preferredProcessor: ProcessorPreference;
}

export interface DetectorCameraRef {
  id: string;
  name: string;
}

export interface Detector {
  id: string;
  name: string;
  version: string;
  description: string;
  detectorKey: string;
  category: string;
  icon: string;
  inferenceTimeMs: number;
  confidenceThreshold: number;
  enabled: boolean;
  status: DetectorStatus;
  gpuSupported: boolean;
  modelPath: string;
  lastRestartAt: string | null;
  createdAt: string;
  updatedAt: string;
  settings: DetectorSettings;
  cameras: DetectorCameraRef[];
  cameraCount: number;
}

export interface MarketplaceDetector {
  key: string;
  name: string;
  version: string;
  description: string;
  category: string;
  icon: string;
  defaultConfidenceThreshold: number;
  gpuSupported: boolean;
  modelPath: string;
  inferenceTimeMs: number;
  installed: boolean;
  id: string | null;
  enabled: boolean | null;
  status: DetectorStatus | null;
  confidenceThreshold: number | null;
  alertSeverity: DetectorSettings["alertSeverity"] | null;
  detectionIntervalMs: number | null;
  preferredProcessor: ProcessorPreference | null;
  cameraCount: number;
}

export interface DetectorHealth {
  id: string;
  name: string;
  detectorKey: string;
  status: DetectorStatus;
  healthy: boolean;
  message: string;
  latencyMs: number | null;
  uptimeSeconds: number;
  lastHealthCheck: string;
  assignedCameras: number;
  framesProcessed: number | null;
  throughputFps: number | null;
}

export interface DetectorFilters {
  page?: number;
  limit?: number;
  search?: string;
  status?: DetectorStatus;
  category?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface DetectorSettingsInput {
  confidenceThreshold?: number;
  alertSeverity?: DetectorSettings["alertSeverity"];
  detectionIntervalMs?: number;
  preferredProcessor?: ProcessorPreference;
}

// --- Detector Engine v2 (frontend view of the engine API) ---

export type DetectorEngineType = "object_detection" | "classification" | "segmentation";
export type DetectorAvailability = "available" | "unconfigured";
export type DetectorRuntimeStatus =
  | "registered"
  | "configured"
  | "enabled"
  | "disabled"
  | "loading"
  | "ready"
  | "error"
  | "unavailable"
  | "unconfigured";

export interface DetectorConfiguration {
  confidenceThreshold: number;
  detectionIntervalMs: number;
  maxDetectionsPerFrame: number;
  alertSeverity: "info" | "warning" | "critical";
  alertCooldownMs: number;
  cameraIds: string[];
  inputResolution: string;
  processingMode: ProcessorPreference;
}

export interface EngineDetector {
  id: string;
  key: string;
  name: string;
  type: DetectorEngineType;
  version: string;
  status: DetectorRuntimeStatus;
  enabled: boolean;
  availability: DetectorAvailability;
  confidenceThreshold: number;
  supportedInput: string[];
  configuration: DetectorConfiguration;
  modelVersion: string | null;
}

export interface EngineDetection {
  id?: string;
  className: string;
  confidence: number;
  bbox: { x1: number; y1: number; x2: number; y2: number };
  normalized?: { x: number; y: number; width: number; height: number };
  trackId: string | null;
  detectorKey: string;
  processingTimeMs: number;
  timestamp: string;
}

export interface EngineStoredDetection {
  id: string;
  className: string | null;
  label: string;
  confidence: number;
  boundingBox: { x1: number; y1: number; x2: number; y2: number } | null;
  trackId: string | null;
  detectorKey: string | null;
  modelVersion: string | null;
  processingTimeMs: number | null;
  snapshotUrl: string | null;
  cameraId: string;
  timestamp: string;
}

export interface EngineDetectionsResponse {
  key: string;
  count: number;
  detections: EngineStoredDetection[];
}

export interface EngineMetrics {
  framesProcessed: number;
  framesSkipped: number;
  inferenceTimeMs: number;
  preprocessingTimeMs: number;
  postprocessingTimeMs: number;
  trackingTimeMs: number;
  totalProcessingTimeMs: number;
  detectionsPerFrame: number;
  lastDetectionAt: string | null;
  lastFrameAt: string | null;
  lastSuccessfulInferenceAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  errorCount: number;
}

export interface EngineHealth {
  key: string;
  status: DetectorRuntimeStatus;
  enabled: boolean;
  healthy: boolean;
  message: string;
  latencyMs: number | null;
  throughputFps: number | null;
  framesProcessed: number;
  framesSkipped: number;
  errorCount: number;
  lastInferenceAt: string | null;
  lastSuccessfulInferenceAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  consecutiveFailures: number;
  aiReachable: boolean | null;
  lastDetectionAt: string | null;
  lastFrameAt: string | null;
}

export interface EngineProcessResponse {
  key: string;
  cameraId: string;
  detections: EngineDetection[];
  count: number;
  metrics: EngineMetrics;
  processedAt: string;
}

export type AuditLogAction =
  | "user_login"
  | "user_logout"
  | "password_reset"
  | "password_changed"
  | "user_created"
  | "user_updated"
  | "user_deleted"
  | "user_locked"
  | "user_unlocked"
  | "role_changed"
  | "role_created"
  | "role_updated"
  | "role_deleted"
  | "camera_added"
  | "camera_updated"
  | "camera_deleted"
  | "camera_started"
  | "camera_stopped"
  | "ai_model_enabled"
  | "ai_model_disabled"
  | "ai_model_updated"
  | "detection_created"
  | "alert_created"
  | "report_generated"
  | "settings_changed";

export type AuditLogStatus = "success" | "failed";

export interface AuditLog {
  id: string;
  timestamp: string;
  userId: string | null;
  username: string;
  email: string;
  action: AuditLogAction;
  module: string;
  description: string;
  ipAddress: string;
  userAgent: string;
  status: AuditLogStatus;
  metadata: Record<string, unknown> | null;
}

export interface AuditLogFilters {
  page?: number;
  limit?: number;
  search?: string;
  userId?: string;
  action?: AuditLogAction;
  module?: string;
  status?: AuditLogStatus;
  dateFrom?: string;
  dateTo?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface AuditLogStats {
  totalLogs: number;
  todayLogs: number;
  failedLogs: number;
  activeUsers: number;
}

export interface AuditLogChartData {
  actionsPerDay: { date: string; count: number }[];
  moduleUsage: { module: string; count: number }[];
  statusDistribution: { status: string; count: number }[];
  topUsers: { username: string; email: string; count: number }[];
}

export const AUDIT_ACTIONS: AuditLogAction[] = [
  "user_login",
  "user_logout",
  "password_reset",
  "password_changed",
  "user_created",
  "user_updated",
  "user_deleted",
  "user_locked",
  "user_unlocked",
  "role_changed",
  "role_created",
  "role_updated",
  "role_deleted",
  "camera_added",
  "camera_updated",
  "camera_deleted",
  "camera_started",
  "camera_stopped",
  "ai_model_enabled",
  "ai_model_disabled",
  "ai_model_updated",
  "detection_created",
  "alert_created",
  "report_generated",
  "settings_changed",
];

export type SettingsCategory =
  | "general"
  | "security"
  | "ai_detection"
  | "notifications"
  | "cameras"
  | "storage"
  | "email"
  | "backup";

export type SettingType = "boolean" | "number" | "string" | "select" | "color";

export interface SettingOption {
  value: string;
  label: string;
}

export interface SystemSetting {
  key: string;
  category: SettingsCategory;
  label: string;
  description: string;
  type: SettingType;
  value: string | number | boolean;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: SettingOption[];
  updatedAt: string;
  updatedBy: string | null;
}

export type SettingsValue = string | number | boolean;
export type SettingsUpdateInput = Record<string, SettingsValue>;

export const SETTINGS_CATEGORIES: SettingsCategory[] = [
  "general",
  "security",
  "ai_detection",
  "notifications",
  "cameras",
  "storage",
  "email",
  "backup",
];

export type ServiceStatus = "healthy" | "degraded" | "offline" | "not_configured";
export type OverallStatus = "healthy" | "degraded" | "unhealthy";

export interface ServiceHealth {
  name: string;
  label: string;
  status: ServiceStatus;
  responseTimeMs: number;
  lastChecked: string;
  version?: string;
  detail?: string;
}

export interface SystemMonitoring {
  status: OverallStatus;
  timestamp: string;
  version: string;
  uptime: {
    process: number;
    system: number;
  };
  services: ServiceHealth[];
  resources: {
    cpu: { usagePercent: number; cores: number };
    memory: { totalBytes: number; usedBytes: number; usagePercent: number };
    disk: {
      totalBytes: number;
      freeBytes: number;
      usagePercent: number;
      mount: string;
    };
  };
}

export interface SystemMetrics {
  version: string;
  windowSeconds: number;
  slowRequestThresholdMs: number;
  collectedAt: string;
  requests: {
    total: number;
    errorCount: number;
    errorRate: number;
    averageResponseTimeMs: number;
    p95ResponseTimeMs: number;
    maxResponseTimeMs: number;
    slowRequestCount: number;
  };
  detections: {
    total: number;
    averageProcessingTimeMs: number;
  };
  uptime: {
    processSeconds: number;
    sinceStartedSeconds: number;
  };
}

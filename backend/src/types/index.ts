import { z } from "zod";
import type { Request } from "express";

export interface AuthRequest extends Request {
  userId?: string;
  userRole?: string;
  permissions?: Set<string>;
}

export const registerSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  password: z.string().min(8).max(100),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const detectionQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().max(200).optional(),
  status: z.enum(["critical", "warning", "info"]).optional(),
  cameraId: z.string().uuid().optional(),
  dateFrom: z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), "must be a parseable date")
    .optional(),
  dateTo: z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), "must be a parseable date")
    .optional(),
  confidenceMin: z.coerce.number().min(0).max(1).optional(),
  confidenceMax: z.coerce.number().min(0).max(1).optional(),
  sortBy: z.enum(["timestamp", "confidence", "label", "status", "cameraId"]).optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
});

export type DetectionQueryInput = z.infer<typeof detectionQuerySchema>;

/** A date string that JavaScript can actually parse (guards `new Date(x)`). */
export const dateStringSchema = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), "must be a parseable date");

export const analyticsQuerySchema = z.object({
  period: z.enum(["7", "30", "90"]).optional(),
  from: dateStringSchema.optional(),
  to: dateStringSchema.optional(),
});

export type AnalyticsQueryInput = z.infer<typeof analyticsQuerySchema>;

const urlByType = {
  usb: { pattern: /^(\/dev\/|[a-zA-Z]:\\)/, message: "USB camera URL should start with /dev/ or a drive letter" },
  rtsp: { pattern: /^rtsp:\/\//, message: "RTSP URL must start with rtsp://" },
  ip: { pattern: /^https?:\/\//, message: "IP camera URL must start with http:// or https://" },
  video_file: { pattern: /\.(mp4|avi|mkv|mov)$/i, message: "Video file URL should end with .mp4, .avi, .mkv, or .mov" },
};

const cameraBaseSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  url: z.string().min(1, "URL is required"),
  cameraType: z.enum(["usb", "rtsp", "ip", "video_file"]).default("rtsp"),
  sourceURL: z.string().url().optional().nullable(),
  location: z.string().max(200).optional().nullable(),
  resolution: z.string().regex(/^\d+x\d+$/, "Invalid resolution format (e.g. 1920x1080)").optional().nullable(),
  fps: z.number().int().min(1).max(120).optional().nullable(),
  username: z.string().max(100).optional().nullable(),
  password: z.string().max(100).optional().nullable(),
});

export const createCameraSchema = cameraBaseSchema.refine(
  (data) => {
    const check = urlByType[data.cameraType];
    if (!check) return true;
    return check.pattern.test(data.url);
  },
  (data) => ({ message: urlByType[data.cameraType]?.message || "Invalid URL for selected camera type", path: ["url"] }),
);

export const updateCameraSchema = cameraBaseSchema.partial();

export const cameraQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().optional(),
  status: z.enum(["online", "offline", "connecting", "error"]).optional(),
  cameraType: z.enum(["usb", "rtsp", "ip", "video_file"]).optional(),
  sortBy: z.enum(["name", "status", "cameraType", "location", "lastSeen", "createdAt"]).optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
});

export const reportTypeSchema = z.enum(["daily", "weekly", "monthly", "camera", "detection", "alert"]);
export const reportStatusSchema = z.enum(["generating", "completed", "failed"]);

export const generateReportSchema = z.object({
  title: z.string().min(1).max(200),
  type: reportTypeSchema,
  dateRange: z.object({
    from: z.string(),
    to: z.string(),
  }),
});

export const reportQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().optional(),
  type: reportTypeSchema.optional(),
  status: reportStatusSchema.optional(),
  sortBy: z.enum(["title", "type", "status", "createdAt"]).optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
});

export type GenerateReportInput = z.infer<typeof generateReportSchema>;
export type ReportQueryInput = z.infer<typeof reportQuerySchema>;

export const modelStatusSchema = z.enum(["loaded", "loading", "disabled", "error"]);

export const modelQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().optional(),
  status: modelStatusSchema.optional(),
  enabled: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
  sortBy: z
    .enum(["name", "status", "confidenceThreshold", "enabled", "createdAt"])
    .optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
});

export const createModelSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  version: z.string().min(1, "Version is required").max(50),
  description: z.string().max(500).optional(),
  detectorKey: z.string().min(1, "Detector key is required").max(100),
  confidenceThreshold: z.number().min(0).max(100).optional(),
  enabled: z.boolean().optional(),
  gpuSupported: z.boolean().optional(),
  modelPath: z.string().min(1, "Model path is required").max(500).optional(),
});

export const modelThresholdSchema = z.object({
  confidenceThreshold: z
    .number()
    .min(0, "Confidence threshold must be between 0 and 100")
    .max(100, "Confidence threshold must be between 0 and 100"),
});

export const updateModelSchema = z.object({
  name: z.string().min(1, "Name is required").max(100).optional(),
  version: z.string().min(1, "Version is required").max(50).optional(),
  description: z.string().max(500).optional(),
  confidenceThreshold: z.number().min(0).max(100).optional(),
  enabled: z.boolean().optional(),
  gpuSupported: z.boolean().optional(),
  modelPath: z.string().min(1, "Model path is required").max(500).optional(),
});

export const modelIdSchema = z.object({
  id: z.string().uuid("Invalid model id"),
});

export type UpdateModelInput = z.infer<typeof updateModelSchema>;
export type CreateModelInput = z.infer<typeof createModelSchema>;
export type ModelQueryInput = z.infer<typeof modelQuerySchema>;

export const detectorStatusSchema = z.enum(["running", "stopped", "error"]);
export const detectorRuntimeStatusSchema = z.enum([
  "registered",
  "configured",
  "enabled",
  "disabled",
  "loading",
  "ready",
  "error",
  "unavailable",
  "unconfigured",
]);
export const detectorTypeSchema = z.enum(["object_detection", "classification", "segmentation"]);
export const alertSeveritySchema = z.enum(["info", "warning", "critical"]);
export const processorPreferenceSchema = z.enum(["gpu", "cpu", "auto"]);

export const alertQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  severity: alertSeveritySchema.optional(),
  isRead: z.enum(["true", "false"]).optional(),
  search: z.string().max(200).optional(),
});

export const alertIdSchema = z.object({ id: z.string().uuid() });

export type AlertQueryInput = z.infer<typeof alertQuerySchema>;

export const cameraIdSchema = z.object({ id: z.string().uuid() });
export const detectionIdSchema = z.object({ id: z.string().uuid() });
export const auditLogIdSchema = z.object({ id: z.string().uuid() });
export const reportIdSchema = z.object({ id: z.string().uuid() });

/** Detector engine keys are short slugs (e.g. "person_detection"). */
export const engineKeyParamSchema = z.object({
  key: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, "must be a detector key slug"),
});

export const reportDownloadQuerySchema = z.object({
  format: z.enum(["pdf", "csv"]).default("pdf"),
});

export const detectorQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().optional(),
  status: z.union([detectorStatusSchema, detectorRuntimeStatusSchema]).optional(),
  type: detectorTypeSchema.optional(),
  enabled: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
  category: z.string().optional(),
  installed: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
  sortBy: z.enum(["name", "status", "confidenceThreshold", "enabled", "createdAt", "version"]).optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
});

export const installDetectorSchema = z.object({
  detectorKey: z.string().min(1, "Detector key is required").max(100),
});

export const updateDetectorSchema = z
  .object({
    name: z.string().min(1, "Name is required").max(100).optional(),
    description: z.string().max(500).optional(),
    version: z.string().min(1, "Version is required").max(50).optional(),
    enabled: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });

export const detectorIdSchema = z.object({
  id: z.string().uuid("Invalid detector id"),
});

export const detectorSettingsSchema = z.object({
  confidenceThreshold: z
    .number()
    .min(0, "Confidence threshold must be between 0 and 100")
    .max(100, "Confidence threshold must be between 0 and 100")
    .optional(),
  alertSeverity: alertSeveritySchema.optional(),
  detectionIntervalMs: z
    .number()
    .int("Detection interval must be an integer")
    .min(100, "Detection interval must be at least 100ms")
    .max(3_600_000, "Detection interval must be at most 1 hour")
    .optional(),
  alertCooldownMs: z
    .number()
    .int("Alert cooldown must be an integer")
    .min(0, "Alert cooldown must be at least 0ms")
    .max(3_600_000, "Alert cooldown must be at most 1 hour")
    .optional(),
  preferredProcessor: processorPreferenceSchema.optional(),
});

const cameraAssignmentSchema = z.object({
  cameraId: z.string().min(1, "Camera id cannot be empty").max(100),
  enabled: z.boolean().default(true),
});

export const detectorCamerasSchema = z
  .object({
    cameraIds: z
      .array(z.string().min(1, "Camera id cannot be empty").max(100))
      .min(0)
      .max(100, "Cannot assign more than 100 cameras")
      .optional(),
    assignments: z
      .array(cameraAssignmentSchema)
      .min(1, "At least one assignment is required")
      .max(100, "Cannot assign more than 100 cameras")
      .optional(),
  })
  .refine((data) => data.cameraIds !== undefined || data.assignments !== undefined, {
    message: "Provide cameraIds or assignments",
  })
  .refine((data) => !(data.cameraIds !== undefined && data.assignments !== undefined), {
    message: "Provide either cameraIds or assignments, not both",
  });

export type DetectorQueryInput = z.infer<typeof detectorQuerySchema>;
export type InstallDetectorInput = z.infer<typeof installDetectorSchema>;
export type UpdateDetectorInput = z.infer<typeof updateDetectorSchema>;
export type DetectorSettingsInput = z.infer<typeof detectorSettingsSchema>;
export type DetectorCamerasInput = z.infer<typeof detectorCamerasSchema>;

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateCameraInput = z.infer<typeof createCameraSchema>;
export type UpdateCameraInput = z.infer<typeof updateCameraSchema>;

export const roleNameValueSchema = z
  .string()
  .min(1, "Role name is required")
  .max(50, "Role name must be at most 50 characters")
  .regex(
    /^[a-z][a-z0-9_]*$/,
    "Role name must be lowercase letters, numbers or underscores",
  );
export const userRoleSchema = roleNameValueSchema;
export const userStatusSchema = z.enum(["active", "disabled"]);

export const createUserSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").max(100),
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters").max(100),
  role: roleNameValueSchema.default("operator"),
  mustChangePassword: z.boolean().optional(),
});

export const updateUserSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").max(100).optional(),
  email: z.string().email("Invalid email address").optional(),
  avatar: z.string().url("Invalid avatar URL").max(500).optional().nullable(),
});

export const assignRoleSchema = z.object({
  role: roleNameValueSchema,
});

export const userStatusUpdateSchema = z.object({
  status: userStatusSchema,
});

export const userQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().optional(),
  role: roleNameValueSchema.optional(),
  status: userStatusSchema.optional(),
  sortBy: z
    .enum(["name", "email", "role", "status", "lastLogin", "createdAt"])
    .optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
});

export const userIdSchema = z.object({
  id: z.string().uuid("Invalid user id"),
});

export const resetPasswordSchema = z.object({
  password: z.string().min(8, "Password must be at least 8 characters").max(100),
  mustChangePassword: z.boolean().optional(),
});

export const roleNameSchema = z.object({
  name: roleNameValueSchema,
});

export const createRoleSchema = z.object({
  name: roleNameValueSchema,
  description: z.string().max(300).default(""),
  permissionKeys: z
    .array(z.string().min(1, "Permission key cannot be empty"))
    .max(100)
    .default([]),
});

export const updateRoleSchema = z.object({
  description: z.string().max(300).optional(),
  permissionKeys: z
    .array(z.string().min(1, "Permission key cannot be empty"))
    .max(100)
    .optional(),
});

export const updateRolePermissionsSchema = z.object({
  permissionKeys: z.array(z.string().min(1, "Permission key cannot be empty")).max(100),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(8, "New password must be at least 8 characters").max(100),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type AssignRoleInput = z.infer<typeof assignRoleSchema>;
export type UserQueryInput = z.infer<typeof userQuerySchema>;
export type CreateRoleInput = z.infer<typeof createRoleSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
export type UpdateRolePermissionsInput = z.infer<typeof updateRolePermissionsSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const auditLogQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().optional(),
  userId: z.string().uuid().optional(),
  action: z.enum([
    "user_login", "user_logout", "password_reset", "password_changed",
    "user_created", "user_updated", "user_deleted", "user_locked",
    "user_unlocked", "role_changed", "role_created", "role_updated",
    "role_deleted", "camera_added", "camera_updated", "camera_deleted",
    "camera_started", "camera_stopped", "camera_captured",
    "ai_model_enabled", "ai_model_disabled", "ai_model_updated",
    "detection_created", "detection_deleted",
    "detector_created", "detector_updated", "detector_deleted",
    "detector_enabled", "detector_disabled",
    "detector_config_updated", "detector_cameras_updated",
    "monitor_started", "monitor_stopped",
    "alert_created", "report_generated", "settings_changed",
  ]).optional(),
  module: z.string().optional(),
  status: z.enum(["success", "failed"]).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  sortBy: z.enum(["timestamp", "action", "module", "status", "username", "email"]).optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
});

export type AuditLogQueryInput = z.infer<typeof auditLogQuerySchema>;

/** The CSV export ignores paging/sorting but honours the same filters. */
export const auditLogExportQuerySchema = auditLogQuerySchema
  .omit({ page: true, limit: true, sortBy: true, sortOrder: true })
  .extend({
    dateFrom: dateStringSchema.optional(),
    dateTo: dateStringSchema.optional(),
  });

export const settingsCategorySchema = z.enum([
  "general",
  "security",
  "ai_detection",
  "notifications",
  "cameras",
  "storage",
  "email",
  "backup",
]);

export const settingsCategoryParamSchema = z.object({
  category: settingsCategorySchema,
});

export const updateSettingsSchema = z
  .record(
    z.string().min(1, "Setting key cannot be empty").max(100),
    z.union([z.string().max(500), z.number(), z.boolean()]),
  )
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one setting must be provided",
  });

export type SettingsCategory = z.infer<typeof settingsCategorySchema>;
export type SettingsCategoryParam = z.infer<typeof settingsCategoryParamSchema>;
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

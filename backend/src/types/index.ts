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
  search: z.string().optional(),
  status: z.enum(["critical", "warning", "info"]).optional(),
  cameraId: z.string().uuid().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  confidenceMin: z.coerce.number().min(0).max(1).optional(),
  confidenceMax: z.coerce.number().min(0).max(1).optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
});

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

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateCameraInput = z.infer<typeof createCameraSchema>;
export type UpdateCameraInput = z.infer<typeof updateCameraSchema>;

export const userRoleSchema = z.enum(["super_admin", "admin", "operator", "viewer"]);
export const userStatusSchema = z.enum(["active", "disabled"]);

export const createUserSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").max(100),
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters").max(100),
  role: userRoleSchema.default("operator"),
});

export const updateUserSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").max(100).optional(),
  email: z.string().email("Invalid email address").optional(),
  avatar: z.string().url("Invalid avatar URL").max(500).optional().nullable(),
});

export const assignRoleSchema = z.object({
  role: userRoleSchema,
});

export const userStatusUpdateSchema = z.object({
  status: userStatusSchema,
});

export const userQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().optional(),
  role: userRoleSchema.optional(),
  status: userStatusSchema.optional(),
  sortBy: z
    .enum(["name", "email", "role", "status", "lastLogin", "createdAt"])
    .optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
});

export const userIdSchema = z.object({
  id: z.string().uuid("Invalid user id"),
});

export const roleNameSchema = z.object({
  name: userRoleSchema,
});

export const updateRolePermissionsSchema = z.object({
  permissionKeys: z.array(z.string().min(1, "Permission key cannot be empty")).max(100),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type AssignRoleInput = z.infer<typeof assignRoleSchema>;
export type UserQueryInput = z.infer<typeof userQuerySchema>;
export type UpdateRolePermissionsInput = z.infer<typeof updateRolePermissionsSchema>;

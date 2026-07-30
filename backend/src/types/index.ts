import { z } from "zod";
import type { Request } from "express";

export interface AuthRequest extends Request {
  userId?: string;
  userRole?: string;
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

export const createCameraSchema = z.object({
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

export const updateCameraSchema = createCameraSchema.partial();

export const cameraQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().optional(),
  status: z.enum(["online", "offline", "connecting", "error"]).optional(),
  cameraType: z.enum(["usb", "rtsp", "ip", "video_file"]).optional(),
  sortBy: z.enum(["name", "status", "cameraType", "location", "lastSeen", "createdAt"]).optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateCameraInput = z.infer<typeof createCameraSchema>;
export type UpdateCameraInput = z.infer<typeof updateCameraSchema>;

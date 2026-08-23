/**
 * Detector Engine v2 — AI Service Client.
 *
 * Talks to the FastAPI inference service (VigiLens `ai/` app) over HTTP.
 * The client is intentionally thin: it just encodes a frame and decodes
 * the raw detections. Class filtering, confidence filtering and tracking
 * are handled by the pipeline stages.
 */

import { config } from "@/config";
import type { BoundingBox } from "./types";

export type AiErrorReason = "unreachable" | "timeout" | "http" | "invalid_payload" | "invalid_frame";

/** Typed error for AI service failures so callers can classify/recover. */
export class AiServiceError extends Error {
  readonly reason: AiErrorReason;
  readonly status: number | null;

  constructor(reason: AiErrorReason, message: string, status: number | null = null) {
    super(message);
    this.name = "AiServiceError";
    this.reason = reason;
    this.status = status;
  }
}

export interface AiImageDetectionResponse {
  success: boolean;
  detections: Array<{
    class_name: string;
    confidence: number;
    bbox: { x1: number; y1: number; x2: number; y2: number };
  }>;
  count: number;
  output_path: string;
  image_width?: number;
  image_height?: number;
}

export interface AiServiceClient {
  detectImage(
    frame: Buffer,
    detectorKey?: string,
    confidence?: number,
  ): Promise<AiImageDetectionResponse>;
  captureFrame(
    source: string,
    cameraType: string,
    videoPosSeconds?: number,
    timeoutMs?: number,
    credentials?: CaptureCredentials,
  ): Promise<Buffer>;
  isReachable(): Promise<boolean>;
}

/** Stream credentials stored on a camera row (write-only via the API). */
export interface CaptureCredentials {
  username: string;
  password: string;
}

/**
 * Embeds credentials into a stream URL so the AI service can open
 * authenticated feeds. Only network URLs carry userinfo — device paths
 * (`usb`, indexes) and video files are returned untouched. Malformed URLs
 * are returned unchanged; capture will fail downstream with its own error.
 */
export function buildAuthenticatedSourceUrl(
  source: string,
  _cameraType: string,
  credentials?: CaptureCredentials,
): string {
  if (!credentials || !credentials.username || !credentials.password) return source;
  try {
    const url = new URL(source);
    if (url.protocol !== "rtsp:" && url.protocol !== "rtmp:" && url.protocol !== "http:" && url.protocol !== "https:") {
      return source;
    }
    url.username = credentials.username;
    url.password = credentials.password;
    return url.toString();
  } catch {
    return source;
  }
}

function toBoundingBox(bbox: { x1: number; y1: number; x2: number; y2: number }): BoundingBox {
  return {
    x1: Math.round(bbox.x1),
    y1: Math.round(bbox.y1),
    x2: Math.round(bbox.x2),
    y2: Math.round(bbox.y2),
  };
}

function isDetectionPayload(value: unknown): value is AiImageDetectionResponse {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.success === "boolean" &&
    Array.isArray(record.detections) &&
    typeof record.count === "number"
  );
}

export class HttpAiServiceClient implements AiServiceClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(baseUrl: string = config.ai.serviceUrl, timeoutMs = 15000) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.timeoutMs = timeoutMs;
  }

  async detectImage(
    frame: Buffer,
    detectorKey?: string,
    confidence?: number,
  ): Promise<AiImageDetectionResponse> {
    if (!frame || frame.length === 0) {
      throw new AiServiceError("invalid_frame", "Empty frame buffer cannot be inferred");
    }

    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(frame)], { type: "image/jpeg" }),
      "frame.jpg",
    );

    const url = new URL("/detect/image", this.baseUrl);
    if (detectorKey) url.searchParams.set("detector", detectorKey);
    if (confidence !== undefined) {
      url.searchParams.set("confidence", String(confidence));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      let response: Response;
      try {
        response = await fetch(url, {
          method: "POST",
          body: form,
          signal: controller.signal,
        });
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          throw new AiServiceError("timeout", `AI service timed out after ${this.timeoutMs}ms`);
        }
        throw new AiServiceError("unreachable", "AI service is unreachable", null);
      }

      if (!response.ok) {
        throw new AiServiceError(
          "http",
          response.status === 404
            ? `AI service has no model "${detectorKey ?? "default"}" registered`
            : `AI service returned ${response.status}`,
          response.status,
        );
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new AiServiceError("invalid_payload", "AI service returned malformed JSON");
      }
      if (!isDetectionPayload(payload)) {
        throw new AiServiceError("invalid_payload", "AI service returned an unexpected response shape");
      }
      if (payload.success === false) {
        throw new AiServiceError("http", "AI service reported inference failure", response.status);
      }

      return {
        ...payload,
        detections: payload.detections.map((d) => ({
          ...d,
          bbox: toBoundingBox(d.bbox),
        })),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async captureFrame(
    source: string,
    cameraType: string,
    videoPosSeconds = 0,
    timeoutMs = 8000,
    credentials?: CaptureCredentials,
  ): Promise<Buffer> {
    if (!source) {
      throw new AiServiceError("invalid_frame", "Camera source is required for frame capture");
    }

    const authenticatedSource = buildAuthenticatedSourceUrl(source, cameraType, credentials);
    const url = new URL("/capture", this.baseUrl);
    url.searchParams.set("source", authenticatedSource);
    url.searchParams.set("type", cameraType);
    if (videoPosSeconds > 0) url.searchParams.set("video_pos_seconds", String(videoPosSeconds));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response: Response;
      try {
        response = await fetch(url, { signal: controller.signal });
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          throw new AiServiceError("timeout", `AI service timed out after ${timeoutMs}ms capturing a frame`);
        }
        throw new AiServiceError("unreachable", "AI service is unreachable", null);
      }

      if (!response.ok) {
        throw new AiServiceError(
          "http",
          `AI service failed to capture frame from source "${source}": ${response.status}`,
          response.status,
        );
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length === 0) {
        throw new AiServiceError("invalid_payload", "AI service returned an empty frame");
      }
      return buffer;
    } finally {
      clearTimeout(timer);
    }
  }

  async isReachable(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2500);
      try {
        const response = await fetch(`${this.baseUrl}/health`, { signal: controller.signal });
        return response.ok;
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return false;
    }
  }
}

export const aiServiceClient: AiServiceClient = new HttpAiServiceClient();

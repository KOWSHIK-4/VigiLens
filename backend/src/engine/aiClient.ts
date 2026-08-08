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
  detectImage(frame: Buffer, detectorKey?: string): Promise<AiImageDetectionResponse>;
  isReachable(): Promise<boolean>;
}

function toBoundingBox(bbox: { x1: number; y1: number; x2: number; y2: number }): BoundingBox {
  return {
    x1: Math.round(bbox.x1),
    y1: Math.round(bbox.y1),
    x2: Math.round(bbox.x2),
    y2: Math.round(bbox.y2),
  };
}

export class HttpAiServiceClient implements AiServiceClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(baseUrl: string = config.ai.serviceUrl, timeoutMs = 15000) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.timeoutMs = timeoutMs;
  }

  async detectImage(frame: Buffer, detectorKey?: string): Promise<AiImageDetectionResponse> {
    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(frame)], { type: "image/jpeg" }),
      "frame.jpg",
    );

    const url = new URL("/detect/image", this.baseUrl);
    if (detectorKey) url.searchParams.set("detector", detectorKey);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, {
        method: "POST",
        body: form,
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`AI service returned ${response.status}`);
      }
      const payload = (await response.json()) as AiImageDetectionResponse;
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

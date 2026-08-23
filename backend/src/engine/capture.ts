/**
 * Detector Engine v2 — Frame Capture Stage.
 *
 * Fills a frame when the caller handed over a camera source instead of
 * raw bytes (the `process-live` path). Frames that already carry image
 * bytes pass straight through — the monitor scheduler pre-captures via
 * `/capture` and always hands the engine complete frames.
 */

import { logger } from "@/config/logger";
import type { FrameCaptureStage } from "./pipeline";
import type { AiServiceClient } from "./aiClient";
import type { FrameInput, PipelineContext } from "./types";

/** Captures a frame from a camera source through the AI service. */
export class AiServiceFrameCaptureStage implements FrameCaptureStage {
  readonly name = "frameCapture";
  private readonly client: AiServiceClient;

  constructor(client: AiServiceClient) {
    this.client = client;
  }

  async process(frame: FrameInput, _ctx: PipelineContext): Promise<FrameInput> {
    if (frame.image && frame.image.length > 0) {
      return frame;
    }

    if (!frame.source) {
      logger.warn("Frame capture skipped: no image bytes and no camera source", {
        cameraId: frame.cameraId,
        detectorId: frame.detectorId,
      });
      return frame;
    }

    const buffer = await this.client.captureFrame(
      frame.source.url,
      frame.source.cameraType,
      frame.source.videoPosSeconds,
      undefined,
      frame.source.username && frame.source.password
        ? { username: frame.source.username, password: frame.source.password }
        : undefined,
    );
    frame.image = buffer;
    logger.info("Frame captured from camera source", {
      cameraId: frame.cameraId,
      cameraType: frame.source.cameraType,
      bytes: buffer.length,
    });
    return frame;
  }
}

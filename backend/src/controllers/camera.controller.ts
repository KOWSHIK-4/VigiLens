import type { Response, NextFunction } from "express";
import type { AuthRequest } from "@/types";
import { prisma } from "@/config/prisma";
import { success } from "@/utils/apiResponse";

export const cameraController = {
  async getAll(_req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const cameras = await prisma.camera.findMany({
        orderBy: { createdAt: "desc" },
      });
      success(res, cameras);
    } catch (err) {
      next(err);
    }
  },

  async getById(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const camera = await prisma.camera.findUnique({
        where: { id: req.params.id },
        include: {
          detections: {
            orderBy: { timestamp: "desc" },
            take: 20,
          },
        },
      });

      if (!camera) {
        return res.status(404).json({
          success: false,
          error: "Camera not found",
        });
      }

      success(res, camera);
    } catch (err) {
      next(err);
    }
  },
};

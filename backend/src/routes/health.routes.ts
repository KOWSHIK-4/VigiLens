import { Router } from "express";
import { healthService } from "../services/health.service";

const router = Router();

router.get("/", (_req, res) => {
  res.json(healthService.liveness());
});

router.get("/live", (_req, res) => {
  res.json(healthService.liveness());
});

router.get("/ready", async (_req, res) => {
  const report = await healthService.getReadiness();
  res.status(report.status === "unhealthy" ? 503 : 200).json(report);
});

export default router;

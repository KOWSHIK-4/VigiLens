import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { subscribe, getSubscriberCount, getSubscriberSnapshot } from "../services/realtime.service";
import { success } from "../utils/apiResponse";
import type { AuthRequest } from "../types";

const router = Router();

router.get("/events", authenticate, (req, res) => {
  const authReq = req as AuthRequest;
  if (!authReq.userId) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: false, error: "Authentication required" }));
    return;
  }
  const rawTeamIds = typeof req.query.teamIds === "string" ? req.query.teamIds : "";
  const teamIds = rawTeamIds
    .split(",")
    .map((t) => t.trim())
    .filter((t) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t));
  subscribe(authReq.userId, res, authReq.organizationId, teamIds.length > 0 ? teamIds : undefined);
});

router.get("/subscribers", authenticate, (_req, res) => {
  success(res, {
    count: getSubscriberCount(),
    subscribers: getSubscriberSnapshot(),
  });
});

export default router;
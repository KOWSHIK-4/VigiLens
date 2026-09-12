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
  subscribe(authReq.userId, res);
});

router.get("/subscribers", authenticate, (_req, res) => {
  success(res, {
    count: getSubscriberCount(),
    subscribers: getSubscriberSnapshot(),
  });
});

export default router;
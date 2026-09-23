import { Router } from "express";
import rateLimit from "express-rate-limit";
import { authController } from "../controllers/auth.controller";
import { authenticate } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { registerSchema, loginSchema, changePasswordSchema, mfaVerifySchema, mfaDisableSchema } from "../types";

const router = Router();

/**
 * Credential endpoints get a deliberately fixed, much stricter bucket than
 * the settings-driven global API limit (auth.routes intentionally does NOT
 * inherit those values). This paces online guessing; per-account lockout
 * (Security settings -> max_login_attempts) stops targeted brute force.
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: "Too many attempts, please try again later" },
});

router.post("/register", authLimiter, validate(registerSchema), authController.register);
router.post("/login", authLimiter, validate(loginSchema), authController.login);
router.post("/logout", authenticate, authController.logout);
router.get("/me", authenticate, authController.me);
router.post(
  "/change-password",
  authenticate,
  validate(changePasswordSchema),
  authController.changePassword,
);
router.post("/realtime-ticket", authenticate, authController.issueRealtimeTicket);
// TOTP enrollment. The enforce flag (security -> mfa_enforced) can be switched
// on only once these endpoints exist; users without MFA are gated to them.
router.post("/mfa/setup", authenticate, authController.mfaSetup);
router.post("/mfa/verify", authenticate, validate(mfaVerifySchema), authController.mfaVerify);
router.post(
  "/mfa/disable",
  authenticate,
  validate(mfaDisableSchema),
  authController.mfaDisable,
);

export default router;

import { Router } from "express";

import {
    login,
    logout,
    register,
    verifyOtp,
    getMe,
    requestOtp,
    requestPasswordReset,
    resetPassword,
    updateMe,
} from "../controllers/authController.js";

import { authenticate } from "../middleware/authenticate.js";
import { authLimiter } from "../middleware/rateLimiters.js";
import { validateRequest } from "../middleware/validation.js";
import {
    registerSchema,
    loginSchema,
    requestOtpSchema,
    verifyOtpSchema,
    passwordResetSchema,
    updateMeSchema,
} from "../validators/authValidator.js";

const router = Router();

// =====================================================
// AUTHENTICATION
// =====================================================

router.post("/register", authLimiter, registerSchema, validateRequest, register);

router.post("/login", authLimiter, loginSchema, validateRequest, login);

router.post("/logout", authenticate, logout);

// =====================================================
// OTP
// =====================================================

router.post("/request-otp", authLimiter, requestOtpSchema, validateRequest, requestOtp);

router.post("/verify-otp", authLimiter, verifyOtpSchema, validateRequest, verifyOtp);

// =====================================================
// PASSWORD RESET
// =====================================================

router.post(
    "/request-password-reset",
    authLimiter,
    passwordResetSchema,
    validateRequest,
    requestPasswordReset
);

// Backward compatibility
router.post("/send-reset-otp", authLimiter, passwordResetSchema, validateRequest, requestPasswordReset);

router.post("/reset-password", authLimiter, passwordResetSchema, validateRequest, resetPassword);

// =====================================================
// USER PROFILE
// =====================================================

router.get("/me", authenticate, getMe);

router.put("/me", authenticate, updateMeSchema, validateRequest, updateMe);

export default router;

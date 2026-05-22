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

const router = Router();

// =====================================================
// AUTHENTICATION
// =====================================================

router.post("/register", register);

router.post("/login", login);

router.post("/logout", authenticate, logout);

// =====================================================
// OTP
// =====================================================

router.post("/request-otp", requestOtp);

router.post("/verify-otp", verifyOtp);

// =====================================================
// PASSWORD RESET
// =====================================================

router.post("/request-password-reset", requestPasswordReset);

// Backward compatibility
router.post("/send-reset-otp", requestPasswordReset);

router.post("/reset-password", resetPassword);

// =====================================================
// USER PROFILE
// =====================================================

router.get("/me", authenticate, getMe);

router.put("/me", authenticate, updateMe);

export default router;

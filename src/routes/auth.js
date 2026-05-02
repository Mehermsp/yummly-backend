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

router.post("/register", register);
router.post("/login", login);
router.post("/verify-otp", verifyOtp);
router.post("/logout", authenticate, logout);
router.get("/me", authenticate, getMe);
router.put("/me", authenticate, updateMe);
router.post("/request-otp", requestOtp);
router.post("/request-password-reset", requestPasswordReset);
router.post("/send-reset-otp", requestPasswordReset);
router.post("/reset-password", resetPassword);

export default router;

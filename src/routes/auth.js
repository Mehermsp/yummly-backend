import { Router } from "express";
import {
    login,
    logout,
    refresh,
    register,
    verifyOtp,
    getMe,
    requestOtp,
} from "../controllers/authController.js";
import { authenticate } from "../middleware/authenticate.js";

const router = Router();

router.post("/register", register);
router.post("/login", login);
router.post("/verify-otp", verifyOtp);
router.post("/refresh", refresh);
router.post("/logout", authenticate, logout);
router.get("/me", authenticate, getMe);
router.post("/request-otp", requestOtp);

export default router;

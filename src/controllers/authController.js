import { asyncHandler } from "../utils/asyncHandler.js";

import { sendSuccess } from "../utils/http.js";

import * as authService from "../services/auth/authService.js";

import * as otpService from "../services/auth/otpService.js";

import * as passwordService from "../services/auth/passwordService.js";


export const register = asyncHandler(async (req, res) => {
    const user = await authService.register(req.body);

    const otpData = await otpService.sendOtp({
        identifier: user.email,

        type: "register",
    });

    sendSuccess(
        res,
        {
            user,
            verification: otpData,
        },
        "Registration successful. Verify OTP to activate the session.",
        201
    );
});

export const login = asyncHandler(async (req, res) => {
    const session = await authService.login(req.body);

    sendSuccess(res, session, "Login successful");
});

export const verifyOtp = asyncHandler(async (req, res) => {
    const data = await otpService.verifyOtp(req.body);

    sendSuccess(res, data, "OTP verified successfully");
});

export const logout = asyncHandler(async (req, res) => {
    await authService.logout();

    sendSuccess(res, null, "Logged out successfully");
});

export const getMe = asyncHandler(async (req, res) => {
    const user = await authService.getMe(req.user.id);

    sendSuccess(res, user, "User profile fetched successfully");
});

export const requestOtp = asyncHandler(async (req, res) => {
    const data = await otpService.sendOtp({
        identifier: req.body.phone || req.body.email,

        type: req.body.type || "login",
    });

    sendSuccess(res, data, "OTP sent successfully");
});

export const requestPasswordReset = asyncHandler(async (req, res) => {
    const data = await otpService.sendOtp({
        identifier: req.body.email || req.body.phone,

        type: "password_reset",
    });

    sendSuccess(res, data, "Password reset OTP sent successfully");
});
export const resetPassword = asyncHandler(async (req, res) => {
    await passwordService.resetPassword(req.body);

    sendSuccess(res, null, "Password reset successful");
});

export const updateMe = asyncHandler(async (req, res) => {
    const user = await authService.updateMe(req.user.id, req.body);

    sendSuccess(res, user, "User profile updated successfully");
});

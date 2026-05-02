import { env } from "../config/env.js";
import crypto from "crypto";
import { ROLES } from "../constants/index.js";
import {
    comparePassword,
    consumePasswordResetToken,
    createOtpVerification,
    createUser,
    findUserByEmailOrPhone,
    findUserForAuth,
    getUserById,
    hashPassword,
    markPhoneVerified,
    markOtpUsed,
    consumeOtpVerification,
    savePasswordResetToken,
    updateUserPasswordById,
    updateUserProfile,
} from "../models/userModel.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { signAccessToken } from "../utils/jwt.js";
import { buildOtpExpiry, exposeDevOtp, generateOtp } from "../utils/otp.js";
import { AppError, sendSuccess } from "../utils/http.js";

const issueTokens = async (user) => {
    const payload = {
        sub: user.id,
        role: user.role,
        phone: user.phone,
    };
    const accessToken = signAccessToken(payload);

    return {
        accessToken,
        user,
    };
};

export const register = asyncHandler(async (req, res) => {
    const {
        role,
        name,
        email,
        phone,
        password,
        adminBootstrapSecret,
    } = req.body;

    if (!role || !name || !email || !phone || !password) {
        throw new AppError(
            400,
            "role, name, email, phone and password are required"
        );
    }

    if (!Object.values(ROLES).includes(role)) {
        throw new AppError(400, "Invalid user role");
    }

    if (
        role === ROLES.ADMIN &&
        (!env.adminBootstrapSecret ||
            adminBootstrapSecret !== env.adminBootstrapSecret)
    ) {
        throw new AppError(403, "Admin bootstrap secret is invalid");
    }

    const existing = await findUserByEmailOrPhone({ email, phone });
    if (existing) {
        throw new AppError(409, "User already exists with this phone or email");
    }

    const passwordHash = await hashPassword(password);
    const userId = await createUser({
        role,
        name,
        email,
        phone,
        passwordHash,
    });

    const otpCode = generateOtp();
    await createOtpVerification({
        userId,
        email,
        phone,
        otpCode,
        type: "register",
        expiresAt: buildOtpExpiry(),
    });

    const user = await getUserById(userId);

    sendSuccess(
        res,
        {
            user,
            verification: {
                phone,
                otpExpiresInMinutes: env.otpTtlMinutes,
                devOtp: exposeDevOtp(otpCode),
            },
        },
        "Registration successful. Verify OTP to activate the session.",
        201
    );
});

export const login = asyncHandler(async (req, res) => {
    const { identifier, email, phone, password } = req.body;
    const loginIdentifier = identifier || email || phone;

    if (!loginIdentifier) {
        throw new AppError(400, "identifier (or email/phone) is required");
    }

    const user = await findUserForAuth(loginIdentifier);
    if (!user) {
        throw new AppError(404, "User not found");
    }

    if (user.password) {
        const validPassword = await comparePassword(
            password,
            user.password
        );
        if (!validPassword) {
            throw new AppError(401, "Invalid credentials");
        }
    }

    const session = await issueTokens(user);

    sendSuccess(res, session, "Login successful");
});

export const verifyOtp = asyncHandler(async (req, res) => {
    const { phone, email, otpCode, otp, type = "login" } = req.body;
    const otpValue = otpCode || otp;
    const channel = phone ? "phone" : "email";
    const identifier = phone || email;

    if (!identifier || !otpValue || !type) {
        throw new AppError(
            400,
            "phone/email, otp (or otpCode) and type are required"
        );
    }

    const otpRow = await consumeOtpVerification({
        phone: channel === "phone" ? phone : null,
        email: channel === "email" ? email : null,
        otpCode: otpValue,
        type,
    });
    if (!otpRow) {
        throw new AppError(400, "OTP is invalid or expired");
    }

    await markOtpUsed(otpRow.id);

    if (type === "password_reset") {
        const resetToken = crypto.randomBytes(24).toString("hex");
        const resetExpires = new Date(Date.now() + env.otpTtlMinutes * 60 * 1000);

        const user = await getUserById(otpRow.user_id);
        if (!user) {
            throw new AppError(404, "User not found");
        }

        await savePasswordResetToken({
            userId: user.id,
            email: user.email,
            resetToken,
            expiresAt: resetExpires,
        });

        return sendSuccess(
            res,
            { resetToken, expiresAt: resetExpires, email: user.email },
            "OTP verified successfully"
        );
    }

    if (otpRow.user_id) {
        await markPhoneVerified(otpRow.user_id);
    }
    const user = await getUserById(otpRow.user_id);
    const session = await issueTokens(user);

    sendSuccess(res, session, "OTP verified successfully");
});

export const logout = asyncHandler(async (req, res) => {
    // Token is stateless - just clear it on client side
    sendSuccess(res, null, "Logged out successfully");
});

export const getMe = asyncHandler(async (req, res) => {
    const user = await getUserById(req.user.id);
    if (!user) {
        throw new AppError(404, "User not found");
    }
    sendSuccess(res, user, "User profile fetched successfully");
});

export const requestOtp = asyncHandler(async (req, res) => {
    const { phone, email, type = "login" } = req.body;
    const identifier = phone || email;
    if (!identifier) {
        throw new AppError(400, "phone or email is required");
    }

    const user = await findUserForAuth(identifier);
    if (!user) {
        throw new AppError(404, "User not found");
    }

    const otpCode = generateOtp();
    await createOtpVerification({
        userId: user.id,
        email: user.email || null,
        phone: phone || user.phone || null,
        otpCode,
        type,
        expiresAt: buildOtpExpiry(),
    });

    sendSuccess(
        res,
        {
            phone: user.phone || null,
            email: user.email || null,
            otpExpiresInMinutes: env.otpTtlMinutes,
            devOtp: exposeDevOtp(otpCode),
        },
        "OTP sent successfully"
    );
});

export const requestPasswordReset = asyncHandler(async (req, res) => {
    const { email, phone } = req.body;
    const identifier = email || phone;
    if (!identifier) {
        throw new AppError(400, "email or phone is required");
    }

    const user = await findUserForAuth(identifier);
    if (!user) {
        throw new AppError(404, "User not found");
    }

    const otpCode = generateOtp();
    await createOtpVerification({
        userId: user.id,
        email: user.email || null,
        phone: user.phone || null,
        otpCode,
        type: "password_reset",
        expiresAt: buildOtpExpiry(),
    });

    sendSuccess(
        res,
        {
            email: user.email,
            phone: user.phone,
            otpExpiresInMinutes: env.otpTtlMinutes,
            devOtp: exposeDevOtp(otpCode),
        },
        "Password reset OTP sent successfully"
    );
});

export const resetPassword = asyncHandler(async (req, res) => {
    const { email, resetToken, newPassword } = req.body;
    if (!email || !resetToken || !newPassword) {
        throw new AppError(400, "email, resetToken and newPassword are required");
    }
    if (String(newPassword).length < 6) {
        throw new AppError(400, "Password must be at least 6 characters");
    }

    const tokenRow = await consumePasswordResetToken({ email, resetToken });
    if (!tokenRow) {
        throw new AppError(400, "Reset token is invalid or expired");
    }

    const passwordHash = await hashPassword(newPassword);
    await updateUserPasswordById(tokenRow.user_id, passwordHash);

    sendSuccess(res, null, "Password reset successful");
});

export const updateMe = asyncHandler(async (req, res) => {
    await updateUserProfile(req.user.id, req.body || {});
    const user = await getUserById(req.user.id);
    sendSuccess(res, user, "User profile updated successfully");
});

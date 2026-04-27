import { env } from "../config/env.js";
import { ROLES } from "../constants/index.js";
import {
    comparePassword,
    createOtpVerification,
    createUser,
    findRefreshToken,
    findUserForAuth,
    getUserById,
    hashPassword,
    markPhoneVerified,
    markOtpUsed,
    revokeRefreshToken,
    revokeUserRefreshTokens,
    storeRefreshToken,
    consumeOtpVerification,
} from "../models/userModel.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
    hashToken,
    signAccessToken,
    signRefreshToken,
    verifyRefreshToken,
} from "../utils/jwt.js";
import { buildOtpExpiry, exposeDevOtp, generateOtp } from "../utils/otp.js";
import { AppError, sendSuccess } from "../utils/http.js";

const issueTokens = async (user) => {
    const payload = {
        sub: user.id,
        role: user.role,
        phone: user.phone,
    };
    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken(payload);
    const decodedRefresh = verifyRefreshToken(refreshToken);
    await storeRefreshToken(
        user.id,
        hashToken(refreshToken),
        new Date(decodedRefresh.exp * 1000)
    );

    return {
        accessToken,
        refreshToken,
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
        vehicleType,
        vehicleNumber,
        adminBootstrapSecret,
    } = req.body;

    if (!role || !name || !email || !phone) {
        throw new AppError(400, "role, name, email and phone are required");
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

    const existing = await findUserForAuth(phone);
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
        vehicleType,
        vehicleNumber,
    });

    const otpCode = generateOtp();
    await createOtpVerification({
        userId,
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
    const { identifier, password } = req.body;

    if (!identifier) {
        throw new AppError(400, "identifier is required");
    }

    const user = await findUserForAuth(identifier);
    if (!user) {
        throw new AppError(404, "User not found");
    }

    if (user.password_hash) {
        const validPassword = await comparePassword(password, user.password_hash);
        if (!validPassword) {
            throw new AppError(401, "Invalid credentials");
        }
    }

    const session = await issueTokens(user);

    sendSuccess(
        res,
        session,
        "Login successful"
    );
});

export const verifyOtp = asyncHandler(async (req, res) => {
    const { phone, otpCode, type } = req.body;

    if (!phone || !otpCode || !type) {
        throw new AppError(400, "phone, otpCode and type are required");
    }

    const otp = await consumeOtpVerification({ phone, otpCode, type });
    if (!otp) {
        throw new AppError(400, "OTP is invalid or expired");
    }

    await markOtpUsed(otp.id);
    await markPhoneVerified(otp.user_id);
    const user = await getUserById(otp.user_id);
    const session = await issueTokens(user);

    sendSuccess(res, session, "OTP verified successfully");
});

export const refresh = asyncHandler(async (req, res) => {
    const { refreshToken } = req.body;

    if (!refreshToken) {
        throw new AppError(400, "refreshToken is required");
    }

    const payload = verifyRefreshToken(refreshToken);
    const persistedToken = await findRefreshToken(hashToken(refreshToken));

    if (!persistedToken) {
        throw new AppError(401, "Refresh token is invalid");
    }

    await revokeRefreshToken(hashToken(refreshToken));
    const user = await getUserById(payload.sub);
    const session = await issueTokens(user);

    sendSuccess(res, session, "Session refreshed");
});

export const logout = asyncHandler(async (req, res) => {
    const { refreshToken, logoutAll } = req.body;

    if (logoutAll) {
        await revokeUserRefreshTokens(req.user.id);
    } else if (refreshToken) {
        await revokeRefreshToken(hashToken(refreshToken));
    }

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
    const { phone, type = "login" } = req.body;
    if (!phone) {
        throw new AppError(400, "phone is required");
    }

    const user = await findUserForAuth(phone);
    if (!user) {
        throw new AppError(404, "User not found");
    }

    const otpCode = generateOtp();
    await createOtpVerification({
        userId: user.id,
        phone,
        otpCode,
        type,
        expiresAt: buildOtpExpiry(),
    });

    sendSuccess(
        res,
        {
            phone,
            otpExpiresInMinutes: env.otpTtlMinutes,
            devOtp: exposeDevOtp(otpCode),
        },
        "OTP sent successfully"
    );
});

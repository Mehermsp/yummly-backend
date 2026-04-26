import express from "express";
import jwt from "jsonwebtoken";
import { getOne, insert, query, update } from "../config/database.js";
import { authenticate } from "../middleware/auth.js";
import {
    asyncHandler,
    AuthenticationError,
    ConflictError,
    ValidationError,
    sendSuccess,
} from "../middleware/errorHandler.js";
import {
    generateAccessToken,
    generateOTP,
    generateRefreshToken,
    hashPassword,
    verifyPassword,
    verifyRefreshToken,
} from "../utils/auth.js";

const router = express.Router();
const OTP_TTL_MINUTES = Number(process.env.OTP_TTL_MINUTES || 10);
const RESET_TOKEN_SECRET =
    process.env.PASSWORD_RESET_SECRET || process.env.JWT_SECRET || "reset-secret";

const APP_ROLES = new Set(["customer", "delivery_partner"]);
const PORTAL_ROLES = new Set(["admin", "vendor", "restaurant_partner"]);

const sanitizeUser = (user) => ({
    id: Number(user.id),
    name: user.name || "",
    email: user.email || "",
    phone: user.phone || "",
    role: user.role || "customer",
    is_available: Boolean(user.is_available),
    profile_image: user.profile_image || "",
    profile_image_public_id: user.profile_image_public_id || "",
    is_email_verified: Boolean(user.is_email_verified),
    delivery_fee_per_order: Number(user.delivery_fee_per_order || 0),
    created_at: user.created_at,
});

const createSessionPayload = (user) => {
    const safeUser = sanitizeUser(user);
    return {
        user: safeUser,
        accessToken: generateAccessToken(safeUser.id, safeUser.role),
        refreshToken: generateRefreshToken(safeUser.id, safeUser.role),
        portalOnly: PORTAL_ROLES.has(safeUser.role),
        appAccessAllowed: APP_ROLES.has(safeUser.role),
        portalMessage: PORTAL_ROLES.has(safeUser.role)
            ? safeUser.role === "admin"
                ? "Admins should sign in through the admin portal."
                : "Restaurant partners should sign in through the restaurant portal."
            : null,
    };
};

const getUserById = (userId) =>
    getOne(
        `SELECT
            id,
            name,
            email,
            phone,
            role,
            is_available,
            profile_image,
            profile_image_public_id,
            is_email_verified,
            delivery_fee_per_order,
            created_at
        FROM users
        WHERE id = ?
        LIMIT 1`,
        [userId]
    );

const getUserByIdentifier = (identifier) =>
    getOne(
        `SELECT
            id,
            name,
            email,
            phone,
            role,
            password,
            is_available,
            profile_image,
            profile_image_public_id,
            is_email_verified,
            delivery_fee_per_order,
            created_at
        FROM users
        WHERE email = ? OR phone = ?
        LIMIT 1`,
        [identifier, identifier]
    );

const clearOtpRecords = async (email, type) => {
    await query(
        "DELETE FROM otp_verifications WHERE email = ? AND type = ?",
        [email, type]
    );
};

const createOtpRecord = async ({ email, type }) => {
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

    await clearOtpRecords(email, type);
    await insert("otp_verifications", {
        email,
        otp,
        type,
        user_id: null,
        expires_at: expiresAt,
        is_used: 0,
    });

    return { otp, expiresAt };
};

const consumeOtpRecord = async ({ email, otp, type }) => {
    const record = await getOne(
        `SELECT *
         FROM otp_verifications
         WHERE email = ?
           AND otp = ?
           AND type = ?
           AND (is_used = 0 OR is_used IS NULL)
           AND expires_at >= NOW()
         ORDER BY id DESC
         LIMIT 1`,
        [email, otp, type]
    );

    if (!record) {
        throw new AuthenticationError("Invalid or expired OTP");
    }

    await update("otp_verifications", { is_used: 1 }, { id: record.id });
    return record;
};

router.post(
    "/request-otp",
    asyncHandler(async (req, res) => {
        const { email, type = "register", name, password } = req.body || {};

        if (!email) {
            throw new ValidationError("Email is required");
        }

        const normalizedEmail = String(email).trim().toLowerCase();

        if (type === "register") {
            if (!name || String(name).trim().length < 2) {
                throw new ValidationError("Name is required");
            }

            if (!password || String(password).length < 8) {
                throw new ValidationError(
                    "Password must be at least 8 characters long"
                );
            }

            const existingUser = await getOne(
                "SELECT id FROM users WHERE email = ? LIMIT 1",
                [normalizedEmail]
            );

            if (existingUser) {
                throw new ConflictError("An account with this email already exists");
            }
        }

        const { otp } = await createOtpRecord({
            email: normalizedEmail,
            type,
        });

        sendSuccess(
            res,
            {
                email: normalizedEmail,
                otpExpiresInMinutes: OTP_TTL_MINUTES,
                devOtp: otp,
            },
            type === "password_reset"
                ? "Password reset OTP sent successfully"
                : "OTP sent successfully"
        );
    })
);

router.post(
    "/register",
    asyncHandler(async (req, res) => {
        const { name, email, password, otp, phone = null, role = "customer" } =
            req.body || {};

        if (!name || !email || !password || !otp) {
            throw new ValidationError("Name, email, password and OTP are required");
        }

        if (role !== "customer") {
            throw new ValidationError("In-app registration is available only for customers");
        }

        const normalizedEmail = String(email).trim().toLowerCase();
        await consumeOtpRecord({
            email: normalizedEmail,
            otp: String(otp).trim(),
            type: "register",
        });

        const existingUser = await getOne(
            "SELECT id FROM users WHERE email = ? LIMIT 1",
            [normalizedEmail]
        );

        if (existingUser) {
            throw new ConflictError("An account with this email already exists");
        }

        const userId = await insert("users", {
            name: String(name).trim(),
            email: normalizedEmail,
            password: await hashPassword(password),
            phone: phone || null,
            role: "customer",
            is_email_verified: 1,
            is_available: 0,
        });

        const user = await getUserById(userId);
        sendSuccess(
            res,
            createSessionPayload(user),
            "Registration completed successfully",
            201
        );
    })
);

router.post(
    "/login",
    asyncHandler(async (req, res) => {
        const { email, identifier, password } = req.body || {};
        const lookup = String(identifier || email || "")
            .trim()
            .toLowerCase();

        if (!lookup || !password) {
            throw new ValidationError("Email and password are required");
        }

        const user = await getUserByIdentifier(lookup);
        if (!user) {
            throw new AuthenticationError("Invalid credentials");
        }

        const isValidPassword = await verifyPassword(password, user.password);
        if (!isValidPassword) {
            throw new AuthenticationError("Invalid credentials");
        }

        sendSuccess(res, createSessionPayload(user), "Login successful");
    })
);

router.post(
    "/refresh-token",
    asyncHandler(async (req, res) => {
        const { refreshToken } = req.body || {};

        if (!refreshToken) {
            throw new ValidationError("Refresh token is required");
        }

        const decoded = verifyRefreshToken(refreshToken);
        const user = await getUserById(decoded.userId || decoded.sub);

        if (!user) {
            throw new AuthenticationError("User not found");
        }

        sendSuccess(res, createSessionPayload(user), "Session refreshed successfully");
    })
);

router.post(
    "/logout",
    authenticate,
    asyncHandler(async (req, res) => {
        sendSuccess(res, { loggedOut: true }, "Logged out successfully");
    })
);

router.get(
    "/me",
    authenticate,
    asyncHandler(async (req, res) => {
        const user = await getUserById(req.user.id);
        sendSuccess(res, sanitizeUser(user), "Profile fetched successfully");
    })
);

router.put(
    "/me",
    authenticate,
    asyncHandler(async (req, res) => {
        const { name, phone, profile_image, profile_image_public_id } =
            req.body || {};

        const updates = {};
        if (name !== undefined) updates.name = String(name).trim();
        if (phone !== undefined) updates.phone = phone || null;
        if (profile_image !== undefined) updates.profile_image = profile_image || null;
        if (profile_image_public_id !== undefined) {
            updates.profile_image_public_id = profile_image_public_id || null;
        }

        if (Object.keys(updates).length) {
            await update("users", updates, { id: req.user.id });
        }

        const user = await getUserById(req.user.id);
        sendSuccess(res, sanitizeUser(user), "Profile updated successfully");
    })
);

router.post(
    "/request-password-reset",
    asyncHandler(async (req, res) => {
        const { email } = req.body || {};

        if (!email) {
            throw new ValidationError("Email is required");
        }

        const normalizedEmail = String(email).trim().toLowerCase();
        const user = await getOne(
            "SELECT id FROM users WHERE email = ? LIMIT 1",
            [normalizedEmail]
        );

        if (!user) {
            throw new AuthenticationError("No account found with this email");
        }

        const { otp } = await createOtpRecord({
            email: normalizedEmail,
            type: "password_reset",
        });

        sendSuccess(
            res,
            {
                email: normalizedEmail,
                otpExpiresInMinutes: OTP_TTL_MINUTES,
                devOtp: otp,
            },
            "Password reset OTP sent successfully"
        );
    })
);

router.post(
    "/verify-otp",
    asyncHandler(async (req, res) => {
        const { email, otp, type = "password_reset" } = req.body || {};

        if (!email || !otp) {
            throw new ValidationError("Email and OTP are required");
        }

        const normalizedEmail = String(email).trim().toLowerCase();
        await consumeOtpRecord({
            email: normalizedEmail,
            otp: String(otp).trim(),
            type,
        });

        if (type === "password_reset") {
            const resetToken = jwt.sign(
                { email: normalizedEmail, type: "password_reset" },
                RESET_TOKEN_SECRET,
                { expiresIn: "15m" }
            );

            sendSuccess(res, { resetToken }, "OTP verified successfully");
            return;
        }

        sendSuccess(res, { verified: true }, "OTP verified successfully");
    })
);

router.post(
    "/reset-password",
    asyncHandler(async (req, res) => {
        const { email, resetToken, newPassword } = req.body || {};

        if (!email || !resetToken || !newPassword) {
            throw new ValidationError(
                "Email, reset token and new password are required"
            );
        }

        const normalizedEmail = String(email).trim().toLowerCase();
        const decoded = jwt.verify(resetToken, RESET_TOKEN_SECRET);

        if (
            decoded.type !== "password_reset" ||
            decoded.email !== normalizedEmail
        ) {
            throw new AuthenticationError("Invalid reset token");
        }

        const user = await getOne(
            "SELECT id FROM users WHERE email = ? LIMIT 1",
            [normalizedEmail]
        );

        if (!user) {
            throw new AuthenticationError("User not found");
        }

        await update(
            "users",
            {
                password: await hashPassword(newPassword),
            },
            { id: user.id }
        );

        sendSuccess(res, { reset: true }, "Password reset successfully");
    })
);

export default router;

import { env } from "../../config/env.js";

import {
    comparePassword,
    createUser,
    findUserByEmailOrPhone,
    findUserForAuth,
    getUserById,
    hashPassword,
    updateUserProfile,
} from "../../models/userModel.js";

import { ROLES } from "../../constants/index.js";

import { AppError } from "../../utils/http.js";

import { sanitizeUser } from "../../utils/sanitizeUser.js";

import { signAccessToken } from "../../utils/jwt.js";

import { logger } from "../../utils/logger.js";

export const issueTokens = async (user) => {
    const payload = {
        sub: user.id,
        role: user.role,
        phone: user.phone,
    };

    const accessToken = signAccessToken(payload);

    return {
        accessToken,

        user: sanitizeUser(user),
    };
};

export const register = async ({
    role,
    name,
    email,
    phone,
    password,
    adminBootstrapSecret,
}) => {
    if (!role || !name || !email || !password) {
        throw new AppError(
            400,
            "role, name, email and password are required"
        );
    }

    const normalizedPhone = phone || (role === ROLES.CUSTOMER ? email : null);

    if (!normalizedPhone) {
        throw new AppError(400, "phone is required for this role");
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

    const existing = await findUserByEmailOrPhone({
        email,
        phone: normalizedPhone,
    });

    if (existing) {
        throw new AppError(409, "User already exists");
    }

    const passwordHash = await hashPassword(password);

    const userId = await createUser({
        role,
        name,
        email,
        phone: normalizedPhone,
        passwordHash,
    });

    const user = await getUserById(userId);

    return user;
};

export const login = async ({ identifier, email, phone, password }) => {
    const loginIdentifier = identifier || email || phone;

    if (!loginIdentifier) {
        throw new AppError(400, "identifier is required");
    }

    const normalizedIdentifier = String(loginIdentifier).trim();

    const user = await findUserForAuth(normalizedIdentifier);

    // SECURITY FIX
    if (!user) {
        throw new AppError(401, "Invalid credentials");
    }

    const validPassword = await comparePassword(password, user.password);

    if (!validPassword) {
        logger.warn("LOGIN_FAILED", {
            identifier: normalizedIdentifier,

            userId: user.id,

            userRole: user.role,
        });

        throw new AppError(401, "Invalid credentials");
    }

    return await issueTokens(user);
};

export const getMe = async (userId) => {
    const user = await getUserById(userId);

    if (!user) {
        throw new AppError(404, "User not found");
    }

    return sanitizeUser(user);
};

export const updateMe = async (userId, payload) => {
    await updateUserProfile(userId, payload || {});

    const user = await getUserById(userId);

    return sanitizeUser(user);
};

export const logout = async () => {
    return true;
};

import bcrypt from "bcryptjs";
import { getOne, query } from "../config/db.js";

const baseUserColumns = [
    "id",
    "role",
    "name",
    "email",
    "phone",
    "is_phone_verified",
    "is_email_verified",
    "restaurant_id",
    "is_available",
    "vehicle_type",
    "vehicle_number",
    "delivery_rating",
    "total_deliveries",
    "created_at",
    "updated_at",
];

let hasUsersIsActiveColumnPromise;

const hasUsersIsActiveColumn = async () => {
    if (!hasUsersIsActiveColumnPromise) {
        hasUsersIsActiveColumnPromise = getOne(
            "SHOW COLUMNS FROM users LIKE ?",
            ["is_active"]
        ).then(Boolean);
    }

    return hasUsersIsActiveColumnPromise;
};

const buildUserSelectSql = async () => {
    const columns = [...baseUserColumns];

    if (await hasUsersIsActiveColumn()) {
        columns.splice(7, 0, "is_active");
    }

    return `
        SELECT
            ${columns.join(",\n            ")}
        FROM users
    `;
};

export const hashPassword = async (password) =>
    password ? bcrypt.hash(password, 10) : null;

export const comparePassword = async (password, passwordHash) => {
    if (!passwordHash || !password) {
        return false;
    }

    return bcrypt.compare(password, passwordHash);
};

export const createUser = async ({
    role,
    name,
    email,
    phone,
    passwordHash,
    vehicleType,
    vehicleNumber,
}) => {
    const result = await query(
        `
        INSERT INTO users (
            role,
            name,
            email,
            phone,
            password_hash,
            vehicle_type,
            vehicle_number
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        [
            role,
            name,
            email,
            phone,
            passwordHash,
            vehicleType || null,
            vehicleNumber || null,
        ]
    );

    return result.insertId;
};

export const findUserForAuth = async (identifier) =>
    getOne(
        `
        SELECT *
        FROM users
        WHERE email = ? OR phone = ?
        LIMIT 1
        `,
        [identifier, identifier]
    );

export const getUserById = async (userId) =>
    getOne(`${await buildUserSelectSql()} WHERE id = ? LIMIT 1`, [userId]);

export const markPhoneVerified = async (userId) =>
    query(
        `
        UPDATE users
        SET is_phone_verified = 1, phone_verified_at = CURRENT_TIMESTAMP
        WHERE id = ?
        `,
        [userId]
    );

export const storeRefreshToken = async (userId, tokenHash, expiresAt) =>
    query(
        `
        INSERT INTO jwt_refresh_tokens (user_id, token_hash, expires_at)
        VALUES (?, ?, ?)
        `,
        [userId, tokenHash, expiresAt]
    );

export const findRefreshToken = async (tokenHash) =>
    getOne(
        `
        SELECT *
        FROM jwt_refresh_tokens
        WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > NOW()
        LIMIT 1
        `,
        [tokenHash]
    );

export const revokeRefreshToken = async (tokenHash) =>
    query(
        `
        UPDATE jwt_refresh_tokens
        SET revoked_at = CURRENT_TIMESTAMP
        WHERE token_hash = ? AND revoked_at IS NULL
        `,
        [tokenHash]
    );

export const revokeUserRefreshTokens = async (userId) =>
    query(
        `
        UPDATE jwt_refresh_tokens
        SET revoked_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND revoked_at IS NULL
        `,
        [userId]
    );

export const createOtpVerification = async ({
    userId,
    phone,
    otpCode,
    type,
    expiresAt,
}) =>
    query(
        `
        INSERT INTO otp_verifications (user_id, phone, otp_code, type, expires_at)
        VALUES (?, ?, ?, ?, ?)
        `,
        [userId || null, phone, otpCode, type, expiresAt]
    );

export const consumeOtpVerification = async ({ phone, otpCode, type }) =>
    getOne(
        `
        SELECT *
        FROM otp_verifications
        WHERE phone = ?
          AND otp_code = ?
          AND type = ?
          AND is_used = 0
          AND expires_at > NOW()
        ORDER BY id DESC
        LIMIT 1
        `,
        [phone, otpCode, type]
    );

export const markOtpUsed = async (otpId) =>
    query(
        `
        UPDATE otp_verifications
        SET is_used = 1, used_at = CURRENT_TIMESTAMP
        WHERE id = ?
        `,
        [otpId]
    );

export const updateDeliveryAvailability = async (userId, isAvailable) =>
    query(
        `
        UPDATE users
        SET is_available = ?
        WHERE id = ? AND role = 'delivery_partner'
        `,
        [isAvailable ? 1 : 0, userId]
    );

export const listUsers = async (role) => {
    const selectSql = await buildUserSelectSql();

    return query(
        `${selectSql} ${role ? "WHERE role = ?" : ""} ORDER BY created_at DESC`,
        role ? [role] : []
    );
};

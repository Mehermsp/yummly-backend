import bcrypt from "bcryptjs";
import { getOne, query } from "../config/db.js";

const USER_SELECT_SQL = `
    SELECT *
    FROM users
`;

export const hashPassword = async (password) =>
    password ? bcrypt.hash(password, 10) : null;

export const comparePassword = async (password, passwordHash) => {
    if (!passwordHash || !password) {
        return false;
    }

    const looksLikeBcryptHash = /^\$2[aby]\$\d{2}\$/.test(passwordHash);
    if (looksLikeBcryptHash) {
        return bcrypt.compare(password, passwordHash);
    }

    // Backward compatibility for legacy plain-text passwords in old rows.
    return String(password) === String(passwordHash);
};

export const createUser = async ({
    role,
    name,
    email,
    phone,
    passwordHash,
}) => {
    const result = await query(
        `
        INSERT INTO users (
            role,
            name,
            email,
            phone,
            password
        ) VALUES (?, ?, ?, ?, ?)
        `,
        [role, name, email, phone, passwordHash]
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

export const findUserByEmailOrPhone = async ({ email, phone }) =>
    getOne(
        `
        SELECT *
        FROM users
        WHERE email = ? OR phone = ?
        LIMIT 1
        `,
        [email, phone]
    );

export const getUserById = async (userId) =>
    getOne(`${USER_SELECT_SQL} WHERE id = ? LIMIT 1`, [userId]);

export const markPhoneVerified = async (userId) =>
    query(
        `
        UPDATE users
        SET is_phone_verified = 1
        WHERE id = ?
        `,
        [userId]
    );

export const markEmailVerified = async (userId) =>
    query(
        `
        UPDATE users
        SET is_email_verified = 1
        WHERE id = ?
        `,
        [userId]
    );

export const createOtpVerification = async ({
    userId,
    email,
    phone,
    otpCode,
    type,
    expiresAt,
}) =>
    query(
        `
        INSERT INTO otp_verifications (user_id, email, phone, otp, type, expires_at)
        VALUES (?, ?, ?, ?, ?, ?)
        `,
        [userId || null, email || null, phone || null, otpCode, type, expiresAt]
    );

export const consumeOtpVerification = async ({ phone, email, otpCode, type }) =>
    getOne(
        `
        SELECT *
        FROM otp_verifications
        WHERE (phone = ? OR email = ?)
          AND otp = ?
          AND type = ?
          AND is_used = 0
          AND expires_at > NOW()
        ORDER BY id DESC
        LIMIT 1
        `,
        [phone || null, email || null, otpCode, type]
    );

export const markOtpUsed = async (otpId) =>
    query(
        `
        UPDATE otp_verifications
        SET is_used = 1
        WHERE id = ?
        `,
        [otpId]
    );

export const updateDeliveryAvailability = async (userId, isAvailable) =>
    query(
        `
        UPDATE users
        SET is_available = ?
        WHERE id = ?
        `,
        [isAvailable ? 1 : 0, userId]
    );

export const listUsers = async (role) =>
    query(
        `${USER_SELECT_SQL} ${
            role ? "WHERE role = ?" : ""
        } ORDER BY created_at DESC`,
        role ? [role] : []
    );

export const updateUserProfile = async (userId, updates = {}) => {
    const fields = [];
    const values = [];

    const assign = (column, value) => {
        if (value === undefined) return;
        fields.push(`${column} = ?`);
        values.push(value);
    };

    assign("name", updates.name);
    assign("phone", updates.phone);
    assign("profile_image", updates.profile_image);
    assign("profile_image_public_id", updates.profile_image_public_id);

    if (!fields.length) return;

    await query(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`, [
        ...values,
        userId,
    ]);
};

export const updateUserPasswordById = async (userId, passwordHash) =>
    query(`UPDATE users SET password = ? WHERE id = ?`, [passwordHash, userId]);

export const savePasswordResetToken = async ({
    userId,
    email,
    resetToken,
    expiresAt,
}) =>
    query(
        `
        INSERT INTO password_resets (user_id, email, reset_token, expires_at, created_at)
        VALUES (?, ?, ?, ?, NOW())
        `,
        [userId, email, resetToken, expiresAt]
    );

export const consumePasswordResetToken = async ({ email, resetToken }) =>
    getOne(
        `
        SELECT *
        FROM password_resets
        WHERE email = ?
          AND reset_token = ?
          AND expires_at > NOW()
        ORDER BY id DESC
        LIMIT 1
        `,
        [email, resetToken]
    );

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

    return bcrypt.compare(password, passwordHash);
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

export const createOtpVerification = async ({
    userId,
    phone,
    otpCode,
    type,
    expiresAt,
}) =>
    query(
        `
        INSERT INTO otp_verifications (user_id, phone, otp, type, expires_at)
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
          AND otp = ?
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
        WHERE id = ? AND role = 'delivery_partner'
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

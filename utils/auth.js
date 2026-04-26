import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import crypto from "crypto";

const JWT_SECRET = process.env.JWT_SECRET || "tastiekit-access-secret";
const JWT_REFRESH_SECRET =
    process.env.JWT_REFRESH_SECRET || "tastiekit-refresh-secret";
const ACCESS_TOKEN_TTL = process.env.JWT_EXPIRY || "7d";
const REFRESH_TOKEN_TTL = process.env.JWT_REFRESH_EXPIRY || "30d";

export function generateAccessToken(userId, role) {
    return jwt.sign({ userId, role }, JWT_SECRET, {
        expiresIn: ACCESS_TOKEN_TTL,
    });
}

export function generateRefreshToken(userId, role) {
    return jwt.sign({ userId, role }, JWT_REFRESH_SECRET, {
        expiresIn: REFRESH_TOKEN_TTL,
    });
}

export function verifyAccessToken(token) {
    return jwt.verify(token, JWT_SECRET);
}

export function verifyRefreshToken(token) {
    return jwt.verify(token, JWT_REFRESH_SECRET);
}

export async function hashPassword(password) {
    return bcrypt.hash(password, 10);
}

export async function verifyPassword(password, passwordHash) {
    return bcrypt.compare(password, passwordHash || "");
}

export function generateOTP() {
    return String(Math.floor(100000 + Math.random() * 900000));
}

export function hashToken(token) {
    return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

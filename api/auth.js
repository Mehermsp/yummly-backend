const express = require("express");
const bcrypt = require("bcryptjs");
const { asyncHandler, HttpError, queryOne, sendOk, toNumber } = require("./shared");
const { USER_ROLES } = require("./constants");

const ALLOWED_REGISTRATION_ROLES = [
    USER_ROLES.CUSTOMER,
    USER_ROLES.RESTAURANT,
    USER_ROLES.DELIVERY,
];

function sanitizeUser(user) {
    if (!user) return null;
    return {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        isAvailable: Boolean(user.is_available),
        isEmailVerified: Boolean(user.is_email_verified),
        profileImage: user.profile_image,
        deliveryFeePerOrder: Number(user.delivery_fee_per_order || 0),
        createdAt: user.created_at,
    };
}

module.exports = function registerAuthRoutes(getPool) {
    const router = express.Router();

    router.post(
        "/register",
        asyncHandler(async (req, res) => {
            const { name, email, password, phone, role } = req.body || {};
            if (!name || !email || !password) {
                throw new HttpError(400, "Name, email, and password are required");
            }

            const normalizedRole = ALLOWED_REGISTRATION_ROLES.includes(role)
                ? role
                : USER_ROLES.CUSTOMER;
            const existingUser = await queryOne(
                getPool(),
                "SELECT id FROM users WHERE email = ?",
                [email.trim().toLowerCase()]
            );
            if (existingUser) {
                throw new HttpError(409, "An account with this email already exists");
            }

            const hashedPassword = await bcrypt.hash(password, 10);
            const pool = getPool();
            const [result] = await pool.query(
                `INSERT INTO users (name, email, password, phone, role)
                 VALUES (?, ?, ?, ?, ?)`,
                [name.trim(), email.trim().toLowerCase(), hashedPassword, phone || null, normalizedRole]
            );

            const user = await queryOne(
                pool,
                `SELECT id, name, email, phone, role, is_available, is_email_verified,
                        profile_image, delivery_fee_per_order, created_at
                 FROM users
                 WHERE id = ?`,
                [result.insertId]
            );

            req.session.userId = toNumber(user.id);
            return sendOk(res, { user: sanitizeUser(user) });
        })
    );

    router.post(
        "/login",
        asyncHandler(async (req, res) => {
            const { email, password } = req.body || {};
            if (!email || !password) {
                throw new HttpError(400, "Email and password are required");
            }

            const user = await queryOne(
                getPool(),
                `SELECT id, name, email, phone, password, role, is_available, is_email_verified,
                        profile_image, delivery_fee_per_order, created_at
                 FROM users
                 WHERE email = ?`,
                [email.trim().toLowerCase()]
            );

            if (!user) {
                throw new HttpError(401, "Invalid email or password");
            }

            const isValidPassword = await bcrypt.compare(password, user.password || "");
            if (!isValidPassword) {
                throw new HttpError(401, "Invalid email or password");
            }

            req.session.userId = toNumber(user.id);

            // For restaurant partners, also check application/restaurant status
            const sanitized = sanitizeUser(user);
            if (user.role === USER_ROLES.RESTAURANT) {
                // Check if application is still pending
                const pendingApp = await queryOne(
                    getPool(),
                    "SELECT status FROM restaurant_applications WHERE owner_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1",
                    [user.id]
                );
                if (pendingApp) {
                    throw new HttpError(403, "Your application is still under review");
                }

                // Fetch approved restaurant
                const restaurant = await queryOne(
                    getPool(),
                    "SELECT * FROM restaurants WHERE owner_id = ? OR user_id = ? ORDER BY id ASC LIMIT 1",
                    [user.id, user.id]
                );
                if (!restaurant) {
                    throw new HttpError(403, "Your restaurant is not approved yet");
                }

                // Generate session token
                const crypto = require("crypto");
                const sessionToken = crypto.randomBytes(32).toString("hex");
                await getPool().query(
                    "INSERT INTO restaurant_sessions (user_id, token) VALUES (?, ?)",
                    [user.id, sessionToken]
                );

                return sendOk(res, { user: sanitized, restaurant, sessionToken });
            }

            return sendOk(res, { user: sanitized });
        })
    );

    router.post(
        "/logout",
        asyncHandler(async (req, res) => {
            req.session.destroy(() => {
                res.clearCookie("tastiekit.sid");
                sendOk(res, { loggedOut: true });
            });
        })
    );

    router.get(
        "/session",
        asyncHandler(async (req, res) => {
            const userId = req.session?.userId || Number(req.headers.userid);
            if (!userId) {
                return res.status(401).json({ success: false, error: "No active session" });
            }

            const user = await queryOne(
                getPool(),
                `SELECT id, name, email, phone, role, is_available, is_email_verified,
                        profile_image, delivery_fee_per_order, created_at
                 FROM users
                 WHERE id = ?`,
                [userId]
            );
            if (!user) {
                return res.status(401).json({ success: false, error: "No active session" });
            }

            const sanitized = sanitizeUser(user);

            // Attach restaurant data for restaurant partners so the PWA /auth/me works
            if (user.role === USER_ROLES.RESTAURANT) {
                const restaurant = await queryOne(
                    getPool(),
                    "SELECT * FROM restaurants WHERE owner_id = ? OR user_id = ? ORDER BY id ASC LIMIT 1",
                    [userId, userId]
                );
                return sendOk(res, { user: sanitized, restaurant: restaurant || null });
            }

            return sendOk(res, { user: sanitized });
        })
    );

    return router;
};

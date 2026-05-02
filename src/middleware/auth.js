import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

const JWT_SECRET = env.jwtAccessSecret;

// Authenticate user
export const authenticate = (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(" ")[1];

        if (!token) {
            return res
                .status(401)
                .json({ error: "Access denied. No token provided." });
        }

        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        if (error.name === "JsonWebTokenError") {
            return res.status(401).json({ error: "Invalid token." });
        }
        if (error.name === "TokenExpiredError") {
            return res.status(401).json({ error: "Token expired." });
        }
        res.status(500).json({ error: "Authentication failed." });
    }
};

// Require specific role
export const requireRole = (role) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: "Authentication required." });
        }

        if (req.user.role !== role) {
            return res.status(403).json({ error: "Insufficient permissions." });
        }

        next();
    };
};

// Optional authentication (doesn't fail if no token)
export const optionalAuth = (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(" ")[1];
        if (token) {
            const decoded = jwt.verify(token, JWT_SECRET);
            req.user = decoded;
        }
        next();
    } catch (error) {
        // If token is invalid, continue without authentication
        next();
    }
};

export default { authenticate, requireRole, optionalAuth, JWT_SECRET };

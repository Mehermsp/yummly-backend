import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

export const signAccessToken = (payload) => {
    const secret = env.jwtAccessSecret?.trim();

    if (!secret) {
        console.error("JWT_ERROR: jwtAccessSecret is empty or undefined");
        console.error(
            "Current env.jwtAccessSecret:",
            JSON.stringify(env.jwtAccessSecret)
        );
        throw new Error(
            "JWT_ACCESS_SECRET is missing or empty. Please check environment variables on Render."
        );
    }

    console.log("JWT Secret loaded successfully (length:", secret.length, ")");

    return jwt.sign(payload, secret, { expiresIn: env.jwtAccessTtl || "7d" });
};

export const verifyAccessToken = (token) => {
    const secret = env.jwtAccessSecret?.trim();

    if (!secret) {
        throw new Error("JWT_ACCESS_SECRET is missing");
    }

    return jwt.verify(token, secret);
};

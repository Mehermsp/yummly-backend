import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

export const signAccessToken = (payload) =>
    jwt.sign(payload, env.jwtAccessSecret, { expiresIn: env.jwtAccessTtl });

export const signRefreshToken = (payload) =>
    jwt.sign(payload, env.jwtRefreshSecret, { expiresIn: env.jwtRefreshTtl });

export const verifyAccessToken = (token) =>
    jwt.verify(token, env.jwtAccessSecret);

export const verifyRefreshToken = (token) =>
    jwt.verify(token, env.jwtRefreshSecret);

export const hashToken = (token) =>
    crypto.createHash("sha256").update(token).digest("hex");

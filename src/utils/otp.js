import { env } from "../config/env.js";

export const generateOtp = () =>
    String(Math.floor(100000 + Math.random() * 900000));

export const buildOtpExpiry = () =>
    new Date(Date.now() + env.otpTtlMinutes * 60 * 1000);

export const exposeDevOtp = (otp) =>
    env.nodeEnv === "production" ? undefined : otp;

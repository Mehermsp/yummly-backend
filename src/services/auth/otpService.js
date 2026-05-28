import crypto from "crypto";

import { env } from "../../config/env.js";

import { buildOtpExpiry, exposeDevOtp, generateOtp } from "../../utils/otp.js";

import { AppError } from "../../utils/http.js";

import { sendEmail } from "../../utils/email.js";

import {
    createOtpVerification,
    consumeOtpVerification,
    markEmailVerified,
    markOtpUsed,
    markPhoneVerified,
    savePasswordResetToken,
    getUserById,
    findUserForAuth,
} from "../../models/userModel.js";

import { issueTokens } from "./authService.js";

const isEmailIdentifier = (value) => /\S+@\S+\.\S+/.test(String(value || ""));

const normalizeOtpLookup = ({ phone, email }) => {
    if (!email && isEmailIdentifier(phone)) {
        return { phone: null, email: phone };
    }

    return { phone, email };
};

export const sendOtp = async ({ identifier, type = "login" }) => {
    if (!identifier) {
        throw new AppError(400, "email or phone is required");
    }

    const user = await findUserForAuth(identifier);

    if (!user) {
        throw new AppError(404, "User not found");
    }

    const otpCode = generateOtp();

    await createOtpVerification({
        userId: user.id,

        email: user.email,

        phone: user.phone,

        otpCode,

        type,

        expiresAt: buildOtpExpiry(),
    });

    await sendEmail({
        to: user.email,

        subject: "TastieKit OTP Verification",

        text: `Your TastieKit OTP is ${otpCode}`,

        html: `
            <div style="font-family: Arial;">
                <h2>OTP Verification</h2>
                <h1>${otpCode}</h1>
            </div>
        `,
    });

    return {
        phone: user.phone,

        email: user.email,

        otpExpiresInMinutes: env.otpTtlMinutes,

        devOtp: exposeDevOtp(otpCode),
    };
};

export const verifyOtp = async ({
    phone,
    email,
    otp,
    otpCode,
    type = "login",
}) => {
    const otpValue = otpCode || otp;
    const lookup = normalizeOtpLookup({ phone, email });

    const row = await consumeOtpVerification({
        phone: lookup.phone,
        email: lookup.email,
        otpCode: otpValue,

        type,
    });

    if (!row) {
        throw new AppError(400, "OTP is invalid or expired");
    }

    await markOtpUsed(row.id);

    // PASSWORD RESET FLOW
    if (type === "password_reset") {
        const resetToken = crypto.randomBytes(24).toString("hex");

        const resetExpires = new Date(
            Date.now() + env.otpTtlMinutes * 60 * 1000
        );

        const user = await getUserById(row.user_id);

        await savePasswordResetToken({
            userId: user.id,

            email: user.email,

            resetToken,

            expiresAt: resetExpires,
        });

        return {
            resetToken,

            expiresAt: resetExpires,

            email: user.email,
        };
    }

    if (row.email) {
        await markEmailVerified(row.user_id);
    }

    if (row.phone) {
        await markPhoneVerified(row.user_id);
    }

    const user = await getUserById(row.user_id);

    return await issueTokens(user);
};

import nodemailer from "nodemailer";
import axios from "axios";
import { env } from "../config/env.js";
import { logger } from "./logger.js";

let transporter;

const getTransporter = () => {
    if (transporter) return transporter;
    if (!env.smtpHost || !env.smtpUser || !env.smtpPass) return null;

    transporter = nodemailer.createTransport({
        host: env.smtpHost,
        port: env.smtpPort || 587,
        secure: env.smtpSecure === true,
        auth: {
            user: env.smtpUser,
            pass: env.smtpPass,
        },
    });

    return transporter;
};

const getSender = () => {
    const email = env.smtpFrom || env.emailFrom || env.smtpUser;
    return {
        name: env.emailFromName || "TastieKit",
        email,
    };
};

const sendViaBrevoApi = async ({ to, subject, text, html }) => {
    if (!env.brevoApiKey) return false;

    const sender = getSender();
    if (!sender.email) {
        logger.warn("Email skipped: sender address is not configured");
        return false;
    }

    try {
        await axios.post(
            "https://api.brevo.com/v3/smtp/email",
            {
                sender,
                to: [{ email: to }],
                subject,
                textContent: text || undefined,
                htmlContent: html || undefined,
            },
            {
                headers: {
                    "Content-Type": "application/json",
                    Accept: "application/json",
                    "api-key": env.brevoApiKey,
                },
            },
        );

        return true;
    } catch (error) {
        const status = error?.response?.status;
        const body = error?.response?.data;
        logger.error("Brevo email request failed", {
            status,
            error: error?.message,
            body,
        });
        return false;
    }
};

export const sendEmail = async ({ to, subject, text, html }) => {
    if (!to) return false;
    const tx = getTransporter();
    const sender = getSender();

    if (tx) {
        try {
            await tx.sendMail({
                from: sender.email ? `${sender.name} <${sender.email}>` : sender.name,
                to,
                subject,
                text,
                html,
            });
            return true;
        } catch (error) {
            logger.error("SMTP email send failed", { error: error?.message });
        }
    }

    const sentViaBrevo = await sendViaBrevoApi({ to, subject, text, html });
    if (sentViaBrevo) return true;

    logger.warn("Email skipped: SMTP and Brevo are not configured");
    return false;
};

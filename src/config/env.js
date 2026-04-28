import dotenv from "dotenv";

dotenv.config();

const splitCsv = (value, fallback = []) =>
    value
        ? value
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean)
        : fallback;

const parseBoolean = (value, fallback = false) => {
    if (value === undefined || value === null || value === "") {
        return fallback;
    }
    return ["true", "1", "yes", "on"].includes(String(value).toLowerCase());
};

export const env = {
    nodeEnv: process.env.NODE_ENV,
    port: Number(process.env.PORT),

    jwtAccessSecret: process.env.JWT_ACCESS_SECRET,
    jwtAccessTtl: process.env.JWT_ACCESS_TTL || "",

    otpTtlMinutes: Number(process.env.OTP_TTL_MINUTES || 5),

    // === Database Config (Fixed to match Render) ===
    dbHost: process.env.DB_HOST,
    dbPort: Number(process.env.DB_PORT || 3306),
    dbUser: process.env.DB_USER,
    dbPassword: process.env.DB_PASS || process.env.DB_PASSWORD, // Support both names
    dbName: process.env.DB_NAME,

    dbPoolLimit: Number(
        process.env.DB_CONNECTION_LIMIT || process.env.DB_POOL_LIMIT || 10
    ),
    dbConnectTimeout: Number(process.env.DB_CONNECT_TIMEOUT || 20000),

    dbSsl: parseBoolean(process.env.DB_SSL, true), // Usually true on Render
    dbSslRejectUnauthorized: parseBoolean(process.env.DB_SSL_REJECT, false),

    allowedOrigins: splitCsv(process.env.CORS_ORIGINS, [
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:8081",
        "http://localhost:19006",
    ]),

    adminBootstrapSecret: process.env.ADMIN_BOOTSTRAP_SECRET || "",
};

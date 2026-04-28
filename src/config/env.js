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
    nodeEnv: process.env.NODE_ENV || "development",
    port: Number(process.env.PORT || 5000),
    jwtAccessSecret:
        process.env.JWT_ACCESS_SECRET || "dev-access-secret-change-me",
    jwtAccessTtl: process.env.JWT_ACCESS_TTL || "",
    otpTtlMinutes: Number(process.env.OTP_TTL_MINUTES || 5),
    dbHost: process.env.DB_HOST || "127.0.0.1",
    dbPort: Number(process.env.DB_PORT || 3306),
    dbUser: process.env.DB_USER || "root",
    dbPassword: process.env.DB_PASSWORD || process.env.DB_PASS || "",
    dbName: process.env.DB_NAME || "tastiekit",
    dbPoolLimit: Number(
        process.env.DB_CONNECTION_LIMIT || process.env.DB_POOL_LIMIT || 10
    ),
    dbConnectTimeout: Number(process.env.DB_CONNECT_TIMEOUT || 20000),
    dbSsl: parseBoolean(process.env.DB_SSL, false),
    dbSslRejectUnauthorized: parseBoolean(process.env.DB_SSL_REJECT, true),
    allowedOrigins: splitCsv(process.env.CORS_ORIGINS, [
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:8081",
        "http://localhost:19006",
    ]),
    adminBootstrapSecret: process.env.ADMIN_BOOTSTRAP_SECRET || "",
};

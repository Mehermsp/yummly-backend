import dotenv from "dotenv";

dotenv.config();

const splitCsv = (value, fallback = []) =>
    value
        ? value
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean)
        : fallback;

export const env = {
    nodeEnv: process.env.NODE_ENV || "development",
    port: Number(process.env.PORT || 5000),
    jwtAccessSecret:
        process.env.JWT_ACCESS_SECRET || "dev-access-secret-change-me",
    jwtRefreshSecret:
        process.env.JWT_REFRESH_SECRET || "dev-refresh-secret-change-me",
    jwtAccessTtl: process.env.JWT_ACCESS_TTL || "15m",
    jwtRefreshTtl: process.env.JWT_REFRESH_TTL || "30d",
    otpTtlMinutes: Number(process.env.OTP_TTL_MINUTES || 5),
    dbHost: process.env.DB_HOST || "127.0.0.1",
    dbPort: Number(process.env.DB_PORT || 3306),
    dbUser: process.env.DB_USER || "root",
    dbPassword: process.env.DB_PASSWORD || "",
    dbName: process.env.DB_NAME || "tastiekit",
    dbPoolLimit: Number(process.env.DB_POOL_LIMIT || 10),
    allowedOrigins: splitCsv(process.env.CORS_ORIGINS, [
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:8081",
        "http://localhost:19006",
    ]),
    adminBootstrapSecret: process.env.ADMIN_BOOTSTRAP_SECRET || "",
};

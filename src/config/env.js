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

// Critical environment validation
const requiredEnv = [
    "JWT_ACCESS_SECRET",
    "DB_HOST",
    "DB_USER",
    "DB_PASS",
    "DB_NAME",
];

requiredEnv.forEach((key) => {
    if (!process.env[key] || String(process.env[key]).trim() === "") {
        console.error(`❌ Missing required environment variable: ${key}`);
        // In production, we should throw, but Render sometimes needs graceful handling
    }
});

export const env = {
    nodeEnv: process.env.NODE_ENV || "development",
    port: Number(process.env.PORT) || 5000,

    // JWT - Critical Fix
    jwtAccessSecret: String(process.env.JWT_ACCESS_SECRET || "").trim(),
    jwtAccessTtl: process.env.JWT_ACCESS_TTL || "7d",

    otpTtlMinutes: Number(process.env.OTP_TTL_MINUTES || 5),

    // Database Config
    dbHost: process.env.DB_HOST,
    dbPort: Number(process.env.DB_PORT || 3306),
    dbUser: process.env.DB_USER,
    dbPassword: (process.env.DB_PASS || process.env.DB_PASSWORD || "").trim(),
    dbName: process.env.DB_NAME,

    dbPoolLimit: Number(
        process.env.DB_CONNECTION_LIMIT || process.env.DB_POOL_LIMIT || 10
    ),
    dbConnectTimeout: Number(process.env.DB_CONNECT_TIMEOUT || 20000),

    dbSsl: parseBoolean(process.env.DB_SSL, true),
    dbSslRejectUnauthorized: parseBoolean(process.env.DB_SSL_REJECT, false),

    allowedOrigins: splitCsv(process.env.CORS_ORIGINS),

    adminBootstrapSecret: process.env.ADMIN_BOOTSTRAP_SECRET || "",
};

// Final safety check for JWT Secret
if (!env.jwtAccessSecret) {
    console.error("❌ CRITICAL ERROR: JWT_ACCESS_SECRET is missing or empty!");
    if (env.nodeEnv === "production") {
        throw new Error("JWT_ACCESS_SECRET environment variable is required");
    }
}

console.log(
    "✅ Environment loaded | JWT Secret:",
    env.jwtAccessSecret ? "Present" : "MISSING"
);

export default env;

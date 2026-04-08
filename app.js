const express = require("express");
const session = require("express-session");
const cors = require("cors");
const bodyParser = require("body-parser");
const path = require("path");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const rateLimit = require("./middleware/rateLimit");
const winston = require("winston");

require("dotenv").config({ path: path.join(__dirname, ".env") });

const isProduction = process.env.NODE_ENV === "production";
const defaultAllowedOrigins = [
    "http://localhost:5173",
    "http://localhost:3000",
    "http://localhost:19006",
    "https://tastiekit-restaurant.vercel.app",
    "https://tastiekit-restaurant.onrender.com",
    "https://tastiekit-app.netlify.app",
    "https://tastiekit.netlify.app",
];
const envAllowedOrigins = (process.env.CORS_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
const allowedOrigins = new Set(
    [...defaultAllowedOrigins, ...envAllowedOrigins, process.env.FRONTEND_URL]
        .filter(Boolean)
        .map((origin) => origin.trim())
);

if (isProduction && !process.env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET is required in production");
}

const { initDb, getPool, ensureColumns } = require("./config/db");
const { sendEmail, formatDeliveryPartnerHtml } = require("./services/email");
const createIsAdmin = require("./middleware/isAdmin");
const createRequireSelfOrAdmin = require("./middleware/requireSelfOrAdmin");
const registerSystemRoutes = require("./routes/system");
const registerAuthRoutes = require("./routes/auth");
const registerRestaurantRoutes = require("./routes/restaurant");
const registerMenuRoutes = require("./routes/menu");
const registerOrderRoutes = require("./routes/orders");
const registerCartRoutes = require("./routes/cart");
const registerWishlistRoutes = require("./routes/wishlist");
const registerUserRoutes = require("./routes/users");
const registerAdminRoutes = require("./routes/admin");
const registerDeliveryRoutes = require("./routes/delivery");
const registerNotificationRoutes = require("./routes/notifications");
const registerAddressRoutes = require("./routes/addresses");
const registerReviewRoutes = require("./routes/reviews");

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(
    helmet({
        crossOriginResourcePolicy: { policy: "cross-origin" },
        contentSecurityPolicy: false,
        hsts: isProduction
            ? { maxAge: 31536000, includeSubDomains: true, preload: true }
            : false,
    })
);
app.use(rateLimit.ipLimiter);
app.use("/auth", rateLimit.authLimiter);
app.use("/upload", rateLimit.uploadLimiter);
app.use(
    cors({
        origin: (origin, callback) => {
            // Allow requests with no origin (like mobile apps or Postman)
            if (!origin) return callback(null, true);
            const normalizedOrigin = origin.trim();
            if (allowedOrigins.has(normalizedOrigin)) {
                callback(null, normalizedOrigin);
            } else {
                callback(new Error("Not allowed by CORS"));
            }
        },
        credentials: true,
        methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization", "userid"],
    })
);
app.use(bodyParser.json({ limit: "1mb" }));
app.use(cookieParser());
app.use(
    session({
        name: "tastiekit.sid",
        secret: process.env.SESSION_SECRET || "tastiekit-restaurant-secret-key",
        resave: false,
        saveUninitialized: false,
        cookie: {
            secure: isProduction,
            httpOnly: true,
            sameSite: "lax",
            maxAge: 24 * 60 * 60 * 1000, // 24 hours
        },
    })
);

// User rate limit after session
app.use(rateLimit.userLimiter);

// Middleware to pass userId from session
app.use((req, res, next) => {
    if (req.session && req.session.userId) {
        req.headers.userid = req.session.userId;
    }
    next();
});

const PORT = process.env.PORT || 8000;
const isAdmin = createIsAdmin(getPool);
const requireSelfOrAdmin = createRequireSelfOrAdmin(getPool);

// Winston logger
const logger = winston.createLogger({
    level: "info",
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.Console({
            format: winston.format.simple(),
        }),
        new winston.transports.File({ filename: "error.log", level: "error" }),
        new winston.transports.File({ filename: "combined.log" }),
    ],
});

// Health check
app.get("/healthz", (req, res) => {
    res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

// Create deps object
const deps = {
    getPool,
    ensureColumns,
    sendEmail,
    formatDeliveryPartnerHtml,
    isAdmin,
    requireSelfOrAdmin,
    logger,
};

const notificationHelpers = registerNotificationRoutes(app, deps);

// Register all routes
registerSystemRoutes(app, deps);
registerAuthRoutes(app, deps);
registerRestaurantRoutes(app, deps);
registerMenuRoutes(app, deps);
registerCartRoutes(app, deps);
registerWishlistRoutes(app, deps);
registerUserRoutes(app, deps);
registerAddressRoutes(app, deps);
registerReviewRoutes(app, deps);
registerOrderRoutes(app, deps);
registerAdminRoutes(app, deps);
registerDeliveryRoutes(app, deps);

// Serve static files from the Vite build
const staticDir = path.join(__dirname, "../tastiekit-restaurant/dist");
console.log(`[Static] Serving from: ${staticDir}`);
app.use(express.static(staticDir, { index: false }));

// SPA fallback - only serve index.html for non-API routes when no static file matches
app.use((req, res, next) => {
    if (req.method !== "GET") return next();
    const apiPatterns = [
        "/api",
        "/uploads",
        "/upload",
        "/healthz",
        "/health",
        "/ping",
        "/diagnostics",
        "/auth",
        "/user",
        "/users",
        "/menu",
        "/restaurants",
        "/restaurant",
        "/orders",
        "/cart",
        "/wishlist",
        "/admin",
        "/delivery",
        "/notifications",
        "/reviews",
    ];
    if (apiPatterns.some((p) => req.path.startsWith(p))) return next();
    // Check if the requested path exists as a file or directory
    const fs = require("fs");
    const requestedPath = path.join(staticDir, req.path);
    const fileExists = fs.existsSync(requestedPath);
    console.log(`[SPA Fallback] path=${req.path}, fileExists=${fileExists}`);
    if (!fileExists) {
        res.sendFile(path.join(staticDir, "index.html"));
    } else {
        next();
    }
});

async function start() {
    try {
        await initDb();
        
        app.listen(PORT, () => {
            logger.info(`🚀 Server running on port ${PORT}`);
        });
        logger.info(`✅ Health at /healthz`);
    } catch (e) {
        logger.error(`Failed to start server: ${e.message}`);
        process.exit(1);
    }
}

start();

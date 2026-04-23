const express = require("express");
const session = require("express-session");
const cors = require("cors");
const bodyParser = require("body-parser");
const path = require("path");
const fs = require("fs");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const compression = require("compression");
const rateLimit = require("./middleware/rateLimit");
const winston = require("winston");

require("dotenv").config({ path: path.join(__dirname, ".env") });

const isProduction = process.env.NODE_ENV === "production";
const defaultAllowedOrigins = [
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:4174",
    "http://localhost:3000",
    "http://localhost:19006",
    "http://localhost:4173",
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
const registerAdminPortalRoutes = require("./routes/adminPortal");
const registerDeliveryRoutes = require("./routes/delivery");
const registerNotificationRoutes = require("./routes/notifications");
const registerAddressRoutes = require("./routes/addresses");
const registerReviewRoutes = require("./routes/reviews");
const registerUnifiedApi = require("./api");

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
app.use(
    compression({
        threshold: 1024,
    })
);
app.use(cookieParser());

class BoundedSessionStore extends session.Store {
    constructor({
        ttlMs = 24 * 60 * 60 * 1000,
        maxEntries = 5000,
        cleanupIntervalMs = 5 * 60 * 1000,
    } = {}) {
        super();
        this.ttlMs = ttlMs;
        this.maxEntries = maxEntries;
        this.sessions = new Map();
        this.cleanupTimer = setInterval(
            () => this.pruneExpired(),
            cleanupIntervalMs
        );
        if (this.cleanupTimer.unref) this.cleanupTimer.unref();
    }

    get(sid, callback) {
        const row = this.sessions.get(sid);
        if (!row) return callback(null, null);
        if (row.expiresAt <= Date.now()) {
            this.sessions.delete(sid);
            return callback(null, null);
        }
        callback(null, row.session);
    }

    set(sid, sessionData, callback) {
        const expiresAt = Date.now() + this.resolveTtl(sessionData);
        this.sessions.set(sid, { session: sessionData, expiresAt });
        this.evictOverflow();
        callback?.(null);
    }

    destroy(sid, callback) {
        this.sessions.delete(sid);
        callback?.(null);
    }

    touch(sid, sessionData, callback) {
        const row = this.sessions.get(sid);
        if (!row) {
            callback?.(null);
            return;
        }
        row.expiresAt = Date.now() + this.resolveTtl(sessionData);
        this.sessions.set(sid, row);
        callback?.(null);
    }

    resolveTtl(sessionData) {
        const cookieMaxAge = Number(sessionData?.cookie?.maxAge);
        if (Number.isFinite(cookieMaxAge) && cookieMaxAge > 0) {
            return cookieMaxAge;
        }
        return this.ttlMs;
    }

    pruneExpired() {
        const now = Date.now();
        for (const [sid, row] of this.sessions.entries()) {
            if (row.expiresAt <= now) {
                this.sessions.delete(sid);
            }
        }
    }

    evictOverflow() {
        if (this.sessions.size <= this.maxEntries) return;
        const overflow = this.sessions.size - this.maxEntries;
        const iterator = this.sessions.keys();
        for (let i = 0; i < overflow; i += 1) {
            const next = iterator.next();
            if (next.done) break;
            this.sessions.delete(next.value);
        }
    }
}

const sessionStore = new BoundedSessionStore({
    ttlMs: Number(process.env.SESSION_TTL_MS) || 24 * 60 * 60 * 1000,
    maxEntries: Number(process.env.SESSION_STORE_MAX_ENTRIES) || 5000,
});

app.use(
    session({
        name: "tastiekit.sid",
        secret: process.env.SESSION_SECRET || "tastiekit-restaurant-secret-key",
        store: sessionStore,
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
const dbState = {
    connected: false,
    initializing: false,
    lastError: null,
};

// Health check
app.get("/healthz", (req, res) => {
    res.status(200).json({
        status: dbState.connected ? "ok" : "degraded",
        database: {
            connected: dbState.connected,
            initializing: dbState.initializing,
            lastError: dbState.lastError,
        },
        timestamp: new Date().toISOString(),
    });
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

app.use((req, res, next) => {
    if (getPool()) return next();

    const openPaths = ["/healthz", "/health", "/ping", "/diagnostics"];
    if (openPaths.some((pathPrefix) => req.path.startsWith(pathPrefix))) {
        return next();
    }

    const dbPaths = [
        "/api",
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
        "/upload",
        "/uploads",
    ];
    if (!dbPaths.some((pathPrefix) => req.path.startsWith(pathPrefix))) {
        return next();
    }

    return res.status(503).json({
        error: "Service initializing",
        detail: "Database connection is not ready yet. Please retry shortly.",
    });
});

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
registerAdminPortalRoutes(app, deps);
registerDeliveryRoutes(app, deps);
app.use("/api/v1", registerUnifiedApi(getPool));

// Serve static files from the Vite build (supports different deployment roots)
const staticDirCandidates = [
    path.join(__dirname, "../tastiekit-restaurant/dist"),
    path.join(process.cwd(), "tastiekit-restaurant/dist"),
    path.join(process.cwd(), "src/tastiekit-restaurant/dist"),
];
const staticDir =
    staticDirCandidates.find((dir) =>
        fs.existsSync(path.join(dir, "index.html"))
    ) || staticDirCandidates[0];
const staticIndexFile = path.join(staticDir, "index.html");
const hasStaticBundle = fs.existsSync(staticIndexFile);
console.log(
    `[Static] Serving from: ${staticDir} (bundle ${
        hasStaticBundle ? "found" : "missing"
    })`
);
if (hasStaticBundle) {
    app.use(express.static(staticDir, { index: false }));
}

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
    if (!hasStaticBundle) {
        return res.status(404).json({
            error: "Frontend bundle not found",
            detail: "tastiekit-restaurant/dist/index.html is missing",
        });
    }
    // Check if the requested path exists as a file or directory
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
    const connectDbWithRetry = async (attempt = 1) => {
        if (dbState.connected || dbState.initializing) return;

        dbState.initializing = true;
        try {
            await initDb();
            dbState.connected = true;
            dbState.lastError = null;
            logger.info("Database initialized successfully");
        } catch (e) {
            dbState.connected = false;
            dbState.lastError = e.message;
            const retryMs = Math.min(30000, attempt * 2000);
            logger.error(
                `Database init failed (attempt ${attempt}): ${e.message}. Retrying in ${retryMs}ms`
            );
            setTimeout(() => connectDbWithRetry(attempt + 1), retryMs);
        } finally {
            dbState.initializing = false;
        }
    };

    app.listen(PORT, () => {
        logger.info(`Server running on port ${PORT}`);
        logger.info("Health at /healthz");
        connectDbWithRetry();
    });
}

start();


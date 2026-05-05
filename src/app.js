import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import { env } from "./config/env.js";
import { errorHandler } from "./middleware/errorHandler.js";
import apiRoutes from "./routes/index.js";
import cacheMiddleware from "./utils/cacheMiddleware.js";

export function createApp() {
    const app = express();

    // Core Middleware
    app.use(helmet());
    const corsOrigins = env.allowedOrigins?.length ? env.allowedOrigins : ["*"];
    app.use(
        cors({
            origin: corsOrigins,
            credentials: true,
        })
    );
    app.use(compression());
    app.use(express.json({ limit: "10mb" }));
    app.use(express.urlencoded({ extended: true, limit: "10mb" }));

    // Redis cache for all GET API requests (except auth/login/register)
    app.use("/api", (req, res, next) => {
        // Only cache GET requests, skip auth endpoints
        if (
            req.method === "GET" &&
            !/^\/auth\/(login|register)/.test(req.path)
        ) {
            // Cache key: user-specific if logged in, else by URL
            const userId = req.user?.id || req.session?.userId || "anon";
            return cacheMiddleware(
                () => `api:${userId}:${req.originalUrl}`,
                120
            )(req, res, next);
        }
        next();
    });
    app.use("/api", apiRoutes);

    // Health check endpoint
    app.get("/health", (req, res) => {
        res.status(200).json({
            success: true,
            message: "TastieKit API is healthy",
            timestamp: new Date().toISOString(),
        });
    });

    // 404 Handler for unmatched routes
    app.use((req, res, next) => {
        res.status(404).json({
            success: false,
            message: `Not Found - ${req.method} ${req.originalUrl}`,
        });
    });

    // Global Error Handler
    app.use(errorHandler);

    return app;
}

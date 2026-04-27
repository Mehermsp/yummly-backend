import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import { errorHandler } from "./middleware/errorHandler.js";
import apiRoutes from "./routes/index.js";

export function createApp() {
    const app = express();

    // Core Middleware
    app.use(helmet());
    app.use(
        cors({
            origin: process.env.CORS_ORIGINS?.split(",") || ["*"],
            credentials: true,
        })
    );
    app.use(compression());
    app.use(express.json({ limit: "10mb" }));
    app.use(express.urlencoded({ extended: true, limit: "10mb" }));

    // API Routes
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

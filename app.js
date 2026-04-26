import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import { errorHandler } from "./middleware/errorHandler.js";

import authRoutes from "./src/routes/auth.js";
import customerRoutes from "./src/routes/customer.js";
import orderRoutes from "./src/routes/orders.js";
import deliveryRoutes from "./src/routes/delivery.js";
import restaurantRoutes from "./src/routes/restaurant.js";
import restaurantsRoutes from "./src/routes/restaurants.js";
import adminRoutes from "./src/routes/admin.js";
import paymentRoutes from "./src/routes/payment.js";
import notificationRoutes from "./src/routes/notifications.js";
import cartRoutes from "./src/routes/cart.js";
import reviewRoutes from "./src/routes/reviews.js";

export function createApp() {
    const app = express();

    // Core Middleware
    app.use(helmet());
    app.use(cors({ origin: process.env.CORS_ORIGINS?.split(",") }));
    app.use(compression());
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // API Routes
    app.use("/api/auth", authRoutes);
    app.use("/api/customer", customerRoutes);
    app.use("/api/orders", orderRoutes);
    app.use("/api/delivery", deliveryRoutes);
    app.use("/api/restaurant", restaurantRoutes);
    app.use("/api/restaurants", restaurantsRoutes);
    app.use("/api/admin", adminRoutes);
    app.use("/api/payment", paymentRoutes);
    app.use("/api/notifications", notificationRoutes);
    app.use("/api/cart", cartRoutes);
    app.use("/api/reviews", reviewRoutes);

    // Health check endpoint
    app.get("/health", (req, res) => {
        res.status(200).json({
            success: true,
            message: "TastieKit API is healthy",
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

import http from "http";
import dotenv from "dotenv";
import { createApp } from "./app.js";
import { initializeDatabase } from "./config/db.js";
import { logger } from "./utils/logger.js";
import { createSocketServer } from "./socket.js";

dotenv.config();

const startServer = async () => {
    try {
        await initializeDatabase();
        logger.info("Database connection pool initialized successfully.");

        const app = createApp();
        const server = http.createServer(app);
        createSocketServer(server);

        const PORT = process.env.PORT || 5000;
        server.listen(PORT, () => {
            logger.info(`TastieKit API listening on port ${PORT}`);
        });
    } catch (error) {
        logger.error("Failed to start server", {
            error: error.message,
            stack: error.stack,
        });
        process.exit(1);
    }
};

startServer();

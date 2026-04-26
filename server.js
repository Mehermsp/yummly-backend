import http from "http";
import dotenv from "dotenv";
import { createApp } from "./app.js";
import { initializeDatabase } from "./src/config/db.js";
// import { createSocketServer } from './socket.js'; // Socket.IO can be integrated here later

dotenv.config();

const startServer = async () => {
    try {
        await initializeDatabase();
        console.log("Database connection pool initialized successfully.");

        const app = createApp();
        const server = http.createServer(app);

        const PORT = process.env.PORT || 5000;
        server.listen(PORT, () => {
            console.log(`TastieKit API listening on port ${PORT}`);
        });
    } catch (error) {
        console.error("Failed to start server:", error);
        process.exit(1);
    }
};

startServer();

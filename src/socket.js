import { Server } from "socket.io";
import { env } from "./config/env.js";

export const createSocketServer = (server) => {
    const io = new Server(server, {
        cors: {
            origin: env.allowedOrigins,
            credentials: true,
        },
    });

    io.on("connection", (socket) => {
        socket.on("notifications:subscribe", (userId) => {
            socket.join(`user:${userId}`);
        });
    });

    return io;
};

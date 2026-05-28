import { Server } from "socket.io";
import { env } from "./config/env.js";

let ioInstance = null;

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

        socket.on("orders:subscribe", (orderId) => {
            socket.join(`order:${orderId}`);
        });

        socket.on("restaurant:subscribe", (restaurantId) => {
            socket.join(`restaurant:${restaurantId}`);
        });

        socket.on("delivery:subscribe", (deliveryPartnerId) => {
            socket.join(`delivery:${deliveryPartnerId}`);
        });

        socket.on("admin:subscribe", (area = "dashboard") => {
            socket.join(`admin:${area}`);
        });
    });

    ioInstance = io;
    return io;
};

export const getIO = () => ioInstance;

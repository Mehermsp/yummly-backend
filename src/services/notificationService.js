import { query } from "../config/db.js";
import { countUnreadNotifications } from "../models/notificationModel.js";
import { getIO } from "../socket.js";
import { logger } from "../utils/logger.js";

const safeJson = (value) => JSON.stringify(value || {});

const emitToRoom = (room, eventName, payload) => {
    try {
        getIO()?.to(room).emit(eventName, payload);
    } catch (error) {
        logger.warn("Socket emit skipped", {
            room,
            eventName,
            error: error?.message,
        });
    }
};

export const emitRealtimeEvent = ({ room, eventName, payload }) => {
    if (!room || !eventName) return;
    emitToRoom(room, eventName, payload);
};

export const createNotification = async ({
    userId,
    title,
    message,
    type = "system",
    data = {},
    push = true,
}) => {
    if (!userId || !title || !message) return null;

    let result;
    try {
        result = await query(
            `
            INSERT INTO notifications (user_id, title, message, type, data, is_read, created_at)
            VALUES (?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP)
            `,
            [userId, title, message, type, safeJson(data)]
        );
    } catch (error) {
        if (!/Unknown column|doesn't have a default value/i.test(error?.message || "")) {
            throw error;
        }

        result = await query(
            `
            INSERT INTO notifications (user_id, title, message, type)
            VALUES (?, ?, ?, ?)
            `,
            [userId, title, message, type]
        );
    }

    const notification = {
        id: result.insertId,
        user_id: userId,
        title,
        message,
        type,
        data,
        is_read: 0,
        created_at: new Date().toISOString(),
    };

    if (push) {
        try {
            await query(
                `
                INSERT INTO notification_outbox (
                    notification_id,
                    channel,
                    recipient_user_id,
                    payload,
                    status,
                    next_attempt_at
                ) VALUES (?, 'push', ?, ?, 'pending', CURRENT_TIMESTAMP)
                `,
                [
                    result.insertId,
                    userId,
                    safeJson({
                        title,
                        message,
                        type,
                        data,
                    }),
                ]
            );
        } catch (error) {
            logger.error("Notification outbox enqueue failed", {
                userId,
                error: error?.message,
            });
        }
    }

    emitToRoom(`user:${userId}`, "notification:new", notification);
    try {
        emitToRoom(`user:${userId}`, "notification:unread-count", {
            unreadCount: await countUnreadNotifications(userId),
        });
    } catch (error) {
        logger.warn("Notification unread count skipped", {
            userId,
            error: error?.message,
        });
    }

    return notification;
};

export const notifyMany = async (notifications = []) => {
    const results = [];
    for (const notification of notifications) {
        results.push(await createNotification(notification));
    }
    return results;
};

export const notifyAdmins = async ({ title, message, type = "admin", data = {} }) => {
    let admins;
    try {
        admins = await query(
            `SELECT id FROM users WHERE role = 'admin' AND is_active = 1`
        );
    } catch {
        admins = await query(`SELECT id FROM users WHERE role = 'admin'`);
    }

    await notifyMany(
        admins.map((admin) => ({
            userId: admin.id,
            title,
            message,
            type,
            data,
        }))
    );
};

export const notifyOrderStakeholders = async ({
    order,
    title,
    message,
    type = "order",
    data = {},
    includeAdmins = true,
}) => {
    if (!order) return;

    const restaurant = await query(
        `SELECT owner_id, user_id FROM restaurants WHERE id = ? LIMIT 1`,
        [order.restaurant_id]
    );

    const restaurantUserId =
        restaurant[0]?.owner_id || restaurant[0]?.user_id || null;

    const userIds = [
        order.customer_id || order.user_id,
        restaurantUserId,
        order.delivery_partner_id,
    ]
        .filter(Boolean)
        .map(Number);

    const uniqueUserIds = [...new Set(userIds)];

    await notifyMany(
        uniqueUserIds.map((userId) => ({
            userId,
            title,
            message,
            type,
            data: {
                orderId: order.id,
                orderNumber: order.order_number,
                ...data,
            },
        }))
    );

    emitToRoom(`order:${order.id}`, "order:updated", {
        orderId: order.id,
        status: order.status,
        data,
    });
    emitToRoom(`restaurant:${order.restaurant_id}`, "order:updated", {
        orderId: order.id,
        status: order.status,
        data,
    });
    if (order.delivery_partner_id) {
        emitToRoom(
            `delivery:${order.delivery_partner_id}`,
            "delivery:assignment-updated",
            {
                orderId: order.id,
                status: order.status,
                data,
            }
        );
    }
    emitToRoom("admin:orders", "order:updated", {
        orderId: order.id,
        status: order.status,
        data,
    });

    if (includeAdmins) {
        await notifyAdmins({
            title,
            message,
            type: "admin_order",
            data: {
                orderId: order.id,
                orderNumber: order.order_number,
                ...data,
            },
        });
    }
};

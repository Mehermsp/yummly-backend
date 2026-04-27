import { query } from "../config/db.js";

export const listNotifications = async (userId, { limit, offset }) => {
    const items = await query(
        `
        SELECT
            id,
            title,
            message,
            type,
            data,
            is_read,
            read_at,
            created_at
        FROM notifications
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
        `,
        [userId, limit, offset]
    );
    const [{ total }] = await query(
        `SELECT COUNT(*) AS total FROM notifications WHERE user_id = ?`,
        [userId]
    );

    return { items, total };
};

export const markNotificationRead = async (userId, notificationId) =>
    query(
        `
        UPDATE notifications
        SET is_read = 1, read_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ?
        `,
        [notificationId, userId]
    );

export const markAllNotificationsRead = async (userId) =>
    query(
        `
        UPDATE notifications
        SET is_read = 1, read_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND is_read = 0
        `,
        [userId]
    );

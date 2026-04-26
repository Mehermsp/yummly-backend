import { asyncHandler } from "../utils/asyncHandler.js";
import { sendPaginated, sendSuccess } from "../utils/http.js";
import { buildPagination, getPagination } from "../utils/pagination.js";
import {
    listNotifications,
    markAllNotificationsRead,
    markNotificationRead,
} from "../models/notificationModel.js";

export const getNotifications = asyncHandler(async (req, res) => {
    const { page, limit, offset } = getPagination(req.query);
    const { items, total } = await listNotifications(req.user.id, {
        limit,
        offset,
    });

    sendPaginated(
        res,
        items,
        buildPagination(page, limit, total),
        "Notifications fetched successfully"
    );
});

export const readNotification = asyncHandler(async (req, res) => {
    await markNotificationRead(req.user.id, req.params.notificationId);
    sendSuccess(res, null, "Notification marked as read");
});

export const readAllNotifications = asyncHandler(async (req, res) => {
    await markAllNotificationsRead(req.user.id);
    sendSuccess(res, null, "All notifications marked as read");
});

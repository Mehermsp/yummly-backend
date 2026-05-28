import { Router } from "express";
import { query } from "../../config/db.js";
import { notifyMany } from "../../services/notificationService.js";
import { sendSuccess } from "../../utils/http.js";
import { asyncHandler } from "../../utils/asyncHandler.js";

const router = Router();

const roleByTarget = {
    customers: "customer",
    restaurants: "restaurant_partner",
    delivery: "delivery_partner",
};

router.post(
    "/broadcast",
    asyncHandler(async (req, res) => {
        const title = String(req.body?.title || "").trim();
        const message = String(req.body?.message || "").trim();
        const target = String(req.body?.target || req.body?.role || "all");
        const userIds = Array.isArray(req.body?.userIds)
            ? req.body.userIds
                  .map((id) => Number(id))
                  .filter((id) => Number.isFinite(id) && id > 0)
            : [];

        if (!title || !message) {
            res.status(400).json({
                success: false,
                message: "Title and message are required",
            });
            return;
        }

        let recipients = [];
        if (target === "custom") {
            recipients = userIds;
        } else {
            const role = roleByTarget[target];
            const rows = await query(
                `
                SELECT id
                FROM users
                WHERE (? IS NULL OR role = ?)
                `,
                [role || null, role || null]
            );
            recipients = rows.map((row) => Number(row.id));
        }

        const uniqueRecipients = [...new Set(recipients)].filter(
            (id) => Number.isFinite(id) && id > 0
        );

        await notifyMany(
            uniqueRecipients.map((userId) => ({
                userId,
                title,
                message,
                type: "admin_broadcast",
                data: {
                    target,
                    sentByAdminId: req.user.id,
                },
            }))
        );

        try {
            await query(
                `
                INSERT INTO admin_activity_log (admin_id, action, entity_type, entity_id, details)
                VALUES (?, 'broadcast_notification', 'notification', NULL, ?)
                `,
                [
                    req.user.id,
                    JSON.stringify({
                        title,
                        target,
                        recipientCount: uniqueRecipients.length,
                    }),
                ]
            );
        } catch {
            // Activity logging should not block successful broadcasts.
        }

        sendSuccess(
            res,
            {
                recipientCount: uniqueRecipients.length,
            },
            "Notification broadcast queued successfully",
            201
        );
    })
);

export default router;

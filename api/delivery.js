const express = require("express");
const { asyncHandler, HttpError, normalizeBoolean, query, queryOne, sendOk } = require("./shared");

module.exports = function registerDeliveryRoutes(getPool) {
    const router = express.Router();

    router.get(
        "/dashboard",
        asyncHandler(async (req, res) => {
            const assignments = await query(
                getPool(),
                `SELECT da.*, o.order_number, o.status AS order_status, o.total, o.delivery_fee,
                        r.name AS restaurant_name, o.door_no, o.street, o.area, o.city, o.state, o.zip_code
                 FROM delivery_assignments da
                 INNER JOIN orders o ON o.id = da.order_id
                 INNER JOIN restaurants r ON r.id = o.restaurant_id
                 WHERE da.delivery_partner_id = ?
                 ORDER BY da.assigned_at DESC`,
                [req.user.id]
            );
            return sendOk(res, {
                partner: req.user,
                assignments: assignments.map((row) => ({
                    id: row.id,
                    orderId: row.order_id,
                    orderNumber: row.order_number,
                    status: row.status,
                    orderStatus: row.order_status,
                    restaurantName: row.restaurant_name,
                    total: Number(row.total || 0),
                    deliveryFee: Number(row.delivery_fee || 0),
                    assignedAt: row.assigned_at,
                    acceptedAt: row.accepted_at,
                    rejectedAt: row.rejected_at,
                    pickupTime: row.pickup_time,
                    deliveryTime: row.delivery_time,
                    address: {
                        doorNo: row.door_no,
                        street: row.street,
                        area: row.area,
                        city: row.city,
                        state: row.state,
                        pincode: row.zip_code,
                    },
                })),
            });
        })
    );

    router.patch(
        "/availability",
        asyncHandler(async (req, res) => {
            const isAvailable = normalizeBoolean(req.body?.isAvailable, true);
            await getPool().query("UPDATE users SET is_available = ? WHERE id = ?", [
                isAvailable ? 1 : 0,
                req.user.id,
            ]);
            return sendOk(res, { updated: true, isAvailable });
        })
    );

    router.patch(
        "/assignments/:assignmentId/status",
        asyncHandler(async (req, res) => {
            const assignment = await queryOne(
                getPool(),
                "SELECT * FROM delivery_assignments WHERE id = ? AND delivery_partner_id = ?",
                [req.params.assignmentId, req.user.id]
            );
            if (!assignment) {
                throw new HttpError(404, "Assignment not found");
            }

            const { status, rejectionReason } = req.body || {};
            const allowedStatuses = ["accepted", "rejected", "picked_up", "delivered"];
            if (!allowedStatuses.includes(status)) {
                throw new HttpError(400, "Invalid assignment status");
            }

            await getPool().query(
                `UPDATE delivery_assignments
                 SET status = ?,
                     accepted_at = CASE WHEN ? = 'accepted' THEN NOW() ELSE accepted_at END,
                     rejected_at = CASE WHEN ? = 'rejected' THEN NOW() ELSE rejected_at END,
                     pickup_time = CASE WHEN ? = 'picked_up' THEN NOW() ELSE pickup_time END,
                     delivery_time = CASE WHEN ? = 'delivered' THEN NOW() ELSE delivery_time END,
                     rejection_reason = ?
                 WHERE id = ?`,
                [status, status, status, status, status, rejectionReason || null, assignment.id]
            );

            const orderStatusMap = {
                accepted: "ready",
                picked_up: "picked_up",
                delivered: "delivered",
            };
            if (orderStatusMap[status]) {
                await getPool().query(
                    `UPDATE orders
                     SET status = ?, updated_at = NOW(),
                         delivered_at = CASE WHEN ? = 'delivered' THEN NOW() ELSE delivered_at END,
                         actual_delivery_time = CASE WHEN ? = 'delivered' THEN NOW() ELSE actual_delivery_time END
                     WHERE id = ?`,
                    [orderStatusMap[status], orderStatusMap[status], orderStatusMap[status], assignment.order_id]
                );
                await getPool().query(
                    "INSERT INTO order_status_logs (order_id, status) VALUES (?, ?)",
                    [assignment.order_id, orderStatusMap[status]]
                );
            }

            return sendOk(res, { updated: true });
        })
    );

    return router;
};

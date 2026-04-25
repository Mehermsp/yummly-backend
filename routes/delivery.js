function registerDeliveryRoutes(
    app,
    { getPool, ensureAvailabilityColumn, sendEmail }
) {
    function normalizeOrderStatus(status) {
        const normalized = String(status || "").trim().toLowerCase();
        return (
            {
                accepted: "ready",
                prepared: "ready",
            }[normalized] || normalized
        );
    }

    function canDeliveryTransition(currentStatus, nextStatus) {
        const current = normalizeOrderStatus(currentStatus);
        const next = normalizeOrderStatus(nextStatus);
        const transitions = {
            ready: ["picked_up"],
            picked_up: ["on_the_way"],
            on_the_way: ["delivered"],
            delivered: [],
            cancelled: [],
        };

        return current === next || (transitions[current] || []).includes(next);
    }

    app.get("/delivery/orders", async (req, res) => {
        const userId = req.headers.userid;

        // Verify user has delivery_partner role
        const [userCheck] = await getPool().query(
            "SELECT role FROM users WHERE id = ? AND role = 'delivery_partner'",
            [userId]
        );

        if (!userCheck.length) {
            return res.status(403).json({
                error: "Access denied. Delivery partner role required.",
            });
        }

        const [orders] = await getPool().query(
            `
        SELECT o.*,
               u.name as customer_name,
               u.phone as customer_phone,
               r.name as restaurant_name,
               r.phone as restaurant_phone,
               r.address as restaurant_address,
               r.area as restaurant_area,
               r.city as restaurant_city,
               a.door_no,
               a.street,
               a.area,
               a.city,
               a.state,
               a.pincode as zip_code,
               a.landmark
        FROM orders o
        LEFT JOIN users u ON o.user_id = u.id
        LEFT JOIN restaurants r ON o.restaurant_id = r.id
        LEFT JOIN addresses a ON o.address_id = a.id
        WHERE o.delivery_partner_id = ?
        ORDER BY o.created_at DESC
    `,
            [userId]
        );

        for (const order of orders) {
            const [items] = await getPool().query(
                "SELECT menu_id as id, name, price, qty FROM order_items WHERE order_id = ?",
                [order.id]
            );
            order.items = items;
        }

        res.json(orders);
    });

    app.get("/delivery/availability", async (req, res) => {
        try {
            await ensureAvailabilityColumn();
            const userId = req.headers.userid;

            const [rows] = await getPool().query(
                `SELECT is_available
             FROM users
             WHERE id = ?
             AND LOWER(TRIM(role)) = 'delivery_partner'`,
                [userId]
            );

            if (!rows.length) {
                return res
                    .status(404)
                    .json({ error: "Delivery boy not found" });
            }

            res.json({ isAvailable: !!rows[0].is_available });
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: "Failed to fetch availability" });
        }
    });

    app.put("/delivery/availability", async (req, res) => {
        try {
            await ensureAvailabilityColumn();
            const userId = req.headers.userid;
            const { isAvailable } = req.body;

            const [result] = await getPool().query(
                `UPDATE users
             SET is_available = ?
             WHERE id = ?
             AND LOWER(TRIM(role)) = 'delivery_partner'`,
                [isAvailable ? 1 : 0, userId]
            );

            if (!result.affectedRows) {
                return res
                    .status(404)
                    .json({ error: "Delivery boy not found" });
            }

            res.json({ success: true, isAvailable: !!isAvailable });
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: "Failed to update availability" });
        }
    });

    app.put("/delivery/orders/:id/status", async (req, res) => {
        try {
            const orderId = parseInt(req.params.id);
            const userId = req.headers.userid;
            const { status, deliveryNotes, estimatedDeliveryTime } = req.body;

            const [rows] = await getPool().query(
                `
            SELECT o.delivery_partner_id, o.status, 
                   u.email, u.name
            FROM orders o
            JOIN users u ON o.user_id = u.id
            WHERE o.id = ?
            `,
                [orderId]
            );

            if (!rows.length)
                return res.status(404).json({ error: "Order not found" });

            const order = rows[0];
            const normalizedStatus = normalizeOrderStatus(status);

            if (order.delivery_partner_id != userId) {
                return res.status(403).json({
                    error: "Not authorized for this order",
                });
            }

            // Verify user has delivery_partner role
            const [userCheck] = await getPool().query(
                "SELECT role FROM users WHERE id = ? AND role = 'delivery_partner'",
                [userId]
            );

            if (!userCheck.length) {
                return res.status(403).json({
                    error: "Access denied. Delivery partner role required.",
                });
            }

            if (!canDeliveryTransition(order.status, normalizedStatus)) {
                return res.status(400).json({
                    error: `Invalid delivery status transition from ${normalizeOrderStatus(
                        order.status
                    )} to ${normalizedStatus}`,
                });
            }

            await getPool().query(
                `
            UPDATE orders
            SET status = ?,
                delivery_notes = ?,
                delivered_at = CASE WHEN ? = 'delivered' THEN NOW() ELSE delivered_at END
            WHERE id = ?
            `,
                [normalizedStatus, deliveryNotes || "", normalizedStatus, orderId]
            );

            try {
                if (normalizedStatus === "picked_up") {
                    await sendEmail(
                        order.email,
                        "Your Order is Out for Delivery",
                        `
  <div style="font-family:'Segoe UI', Arial; background:#f4f6fb; padding:40px 20px;">
    <div style="max-width:520px; margin:auto; background:#fff; padding:35px; border-radius:16px; box-shadow:0 10px 30px rgba(0,0,0,0.08);">
      <h2 style="color:#FF9800;">Out for Delivery!</h2>
      <p>Your TastieKit order is on the way.</p>
      <p>Please keep your phone available for delivery updates.</p>
      <p style="color:#777;">Enjoy your meal!</p>
    </div>
  </div>
  `
                    );
                }

                if (normalizedStatus === "delivered") {
                    await sendEmail(
                        order.email,
                        "Your Order has been Delivered!",
                        `
  <div style="font-family:'Segoe UI', Arial; background:#f4f6fb; padding:40px 20px;">
    <div style="max-width:520px; margin:auto; background:#fff; padding:35px; border-radius:16px; box-shadow:0 10px 30px rgba(0,0,0,0.08);">
      <h2 style="color:#4CAF50;">Delivered Successfully</h2>
      <p>Your order has been delivered.</p>
      <p>We hope you enjoy your meal.</p>
      <p style="color:#777;">Thank you for choosing TastieKit.</p>
    </div>
  </div>
  `
                    );
                }

                console.log("Delivery email sent successfully");
            } catch (emailErr) {
                console.error(
                    "Delivery email failed but status updated:",
                    emailErr.message
                );
            }

            res.json({ success: true });
        } catch (err) {
            console.error("Delivery status error:", err);
            res.status(500).json({ error: "Status update failed" });
        }
    });

    app.get("/delivery/income", async (req, res) => {
        try {
            const userId = req.headers.userid;

            const [orders] = await getPool().query(
                `
            SELECT id, total, created_at
            FROM orders
            WHERE delivery_partner_id = ?
            AND status = 'delivered'
            `,
                [userId]
            );

            const incomePerOrder = 40;

            const totalIncome = orders.length * incomePerOrder;

            res.json({
                totalDeliveries: orders.length,
                totalIncome,
                orders,
            });
        } catch (err) {
            res.status(500).json({ error: "Failed to fetch income" });
        }
    });
}

module.exports = registerDeliveryRoutes;

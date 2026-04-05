function registerAdminRoutes(
    app,
    { getPool, isAdmin, ensureAvailabilityColumn, sendEmail, formatDeliveryPartnerHtml }
) {
    app.get("/admin/orders", isAdmin, async (req, res) => {
        try {
            const { startDate, endDate } = req.query;

            let query = `
            SELECT o.*, u.name, u.email,
                   db.name as delivery_partner_name,
                   db.phone as delivery_partner_phone,
                   db.email as delivery_partner_email
            FROM orders o
            JOIN users u ON o.user_id = u.id
            LEFT JOIN users db ON o.delivery_partner_id = db.id
        `;

            const params = [];

            if (startDate && endDate) {
                query += ` WHERE DATE(o.created_at) BETWEEN ? AND ?`;
                params.push(startDate, endDate);
            }

            query += ` ORDER BY o.created_at DESC`;

            const [orders] = await getPool().query(query, params);

            if (!orders.length) {
                return res.json([]);
            }

            const orderIds = orders.map((order) => order.id);
            const [items] = await getPool().query(
                `
            SELECT order_id, menu_id as id, name, price, qty
            FROM order_items
            WHERE order_id IN (?)
            ORDER BY order_id DESC, id ASC
            `,
                [orderIds]
            );

            const itemsByOrderId = new Map();
            for (const item of items) {
                if (!itemsByOrderId.has(item.order_id)) {
                    itemsByOrderId.set(item.order_id, []);
                }
                itemsByOrderId.get(item.order_id).push({
                    id: item.id,
                    name: item.name,
                    price: item.price,
                    qty: item.qty,
                });
            }

            for (const order of orders) {
                order.items = itemsByOrderId.get(order.id) || [];
            }

            res.json(orders);
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: "Failed to fetch admin orders" });
        }
    });

    app.put("/admin/orders/:id/status", isAdmin, async (req, res) => {
        try {
            const id = parseInt(req.params.id);
            const { status } = req.body;

            const [rows] = await getPool().query(
                "SELECT status FROM orders WHERE id = ?",
                [id]
            );

            if (!rows.length) {
                return res.status(404).json({ error: "Order not found" });
            }

            const currentStatus = rows[0].status.toLowerCase().trim();

            if (currentStatus === "cancelled" || currentStatus === "delivered") {
                return res.status(400).json({
                    error: "Cannot modify cancelled or delivered order",
                });
            }

            await getPool().query("UPDATE orders SET status = ? WHERE id = ?", [
                status,
                id,
            ]);

            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: "Failed to update status" });
        }
    });

    app.get("/admin/revenue-summary", isAdmin, async (req, res) => {
        try {
            const { startDate, endDate } = req.query;

            let dateFilter = "";
            const params = [];

            if (startDate && endDate) {
                dateFilter = "AND DATE(created_at) BETWEEN ? AND ?";
                params.push(startDate, endDate);
            }

            const [orders] = await getPool().query(
                `
            SELECT id, total, delivery_partner_id
            FROM orders
            WHERE status = 'delivered'
            ${dateFilter}
            `,
                params
            );

            const totalRevenue = orders.reduce(
                (sum, o) => sum + Number(o.total),
                0
            );

            const deliveryIncomePerOrder = 40;
            const totalDeliveryIncome = orders.length * deliveryIncomePerOrder;
            const preparationCost = totalRevenue * 0.6;
            const profit = totalRevenue - totalDeliveryIncome - preparationCost;

            res.json({
                totalRevenue,
                totalDeliveryIncome,
                preparationCost,
                profit,
            });
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: "Revenue calculation failed" });
        }
    });

    app.put("/admin/orders/:id/assign", isAdmin, async (req, res) => {
        try {
            await ensureAvailabilityColumn();
            const orderId = parseInt(req.params.id);
            const { deliveryBoyId } = req.body;

            const [rows] = await getPool().query(
                `SELECT o.status, o.user_id, o.total, u.name as customer_name, u.email as customer_email
             FROM orders o
             JOIN users u ON o.user_id = u.id
             WHERE o.id = ?`,
                [orderId]
            );

            if (!rows.length)
                return res.status(404).json({ error: "Order not found" });

            const status = rows[0].status.toLowerCase();

            if (status === "delivered" || status === "cancelled") {
                return res.status(400).json({
                    error: "Cannot assign completed order",
                });
            }

            const [deliveryRows] = await getPool().query(
                `SELECT id, name, email, phone, is_available
             FROM users
             WHERE id = ?
             AND LOWER(TRIM(role)) = 'delivery'`,
                [deliveryBoyId]
            );

            if (!deliveryRows.length) {
                return res.status(404).json({ error: "Delivery boy not found" });
            }

            const deliveryBoy = deliveryRows[0];

            if (!deliveryBoy.is_available) {
                return res.status(400).json({
                    error: "Delivery boy is not active for work",
                });
            }

            await getPool().query(
                `
            UPDATE orders 
            SET delivery_partner_id = ?, 
                status = 'accepted' 
            WHERE id = ?
            `,
                [deliveryBoyId, orderId]
            );

            try {
                const order = rows[0];
                await sendEmail(
                    order.customer_email,
                    `Delivery Partner Assigned - YM${String(orderId).padStart(5, "0")}`,
                    `
<div style="font-family:'Segoe UI', Arial; background:#f4f6fb; padding:40px 20px;">
  <div style="max-width:580px; margin:auto; background:#ffffff; padding:35px; border-radius:16px; box-shadow:0 10px 30px rgba(0,0,0,0.08);">
    <h2 style="margin:0; color:#E53935;">Your order has been assigned</h2>
    <p style="color:#555; line-height:1.6; margin-top:16px;">
      Hi ${order.customer_name}, your Yummly order YM${String(orderId).padStart(5, "0")} is now assigned to a delivery partner.
    </p>
    ${formatDeliveryPartnerHtml(deliveryBoy)}
    <p style="margin-top:20px; color:#555;">
      Order total: Rs.${order.total}
    </p>
    <p style="margin-top:10px; color:#777;">
      You can also see these details inside My Orders in the app.
    </p>
  </div>
</div>
                `
                );
            } catch (emailErr) {
                console.error("Assignment email failed:", emailErr.message);
            }

            res.json({ success: true });
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: "Assignment failed" });
        }
    });

    app.get("/admin/delivery-stats", isAdmin, async (req, res) => {
        await ensureAvailabilityColumn();
        const [stats] = await getPool().query(`
        SELECT u.id, u.name,
        SUM(CASE WHEN o.status IN ('accepted','preparing','picked_up') THEN 1 ELSE 0 END) AS active_orders,
        SUM(CASE WHEN o.status = 'delivered' THEN 1 ELSE 0 END) AS completed_orders
        FROM users u
        LEFT JOIN orders o ON u.id = o.delivery_partner_id
        WHERE u.role = 'delivery'
        GROUP BY u.id
    `);

        res.json(stats);
    });

    app.get("/admin/delivery-boys", isAdmin, async (req, res) => {
        try {
            await ensureAvailabilityColumn();
            const [rows] = await getPool().query(`
            SELECT 
                u.id,
                u.name,
                u.email,
                u.phone,
                u.is_available,
                COUNT(CASE WHEN o.status IN ('accepted','preparing','picked_up') THEN 1 END) AS active_orders,
                COUNT(CASE WHEN o.status = 'delivered' THEN 1 END) AS completed_orders
            FROM users u
            LEFT JOIN orders o ON u.id = o.delivery_partner_id
            WHERE LOWER(TRIM(u.role)) = 'delivery'
            GROUP BY u.id
        `);

            console.log("Delivery boys from DB:", rows);

            res.json(rows);
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: "Failed to fetch delivery boys" });
        }
    });

    app.put("/admin/delivery-boys/:id/availability", isAdmin, async (req, res) => {
        try {
            await ensureAvailabilityColumn();
            const deliveryBoyId = parseInt(req.params.id);
            const { isAvailable } = req.body;

            const [result] = await getPool().query(
                `UPDATE users
             SET is_available = ?
             WHERE id = ?
             AND LOWER(TRIM(role)) = 'delivery'`,
                [isAvailable ? 1 : 0, deliveryBoyId]
            );

            if (!result.affectedRows) {
                return res.status(404).json({ error: "Delivery boy not found" });
            }

            res.json({ success: true, isAvailable: !!isAvailable });
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: "Failed to update availability" });
        }
    });
}

module.exports = registerAdminRoutes;

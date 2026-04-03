function registerOrderRoutes(app, { getPool, sendEmail, requireSelfOrAdmin }) {
    app.post("/orders", async (req, res) => {
        console.log("Incoming order data:", req.body);
        try {
            const {
                userId,
                items,
                total,
                paymentMethod,
                doorNo,
                street,
                area,
                city,
                state,
                zipCode,
                phone,
                notes,
                paymentId,
            } = req.body;

            if (!items || items.length === 0) {
                return res.status(400).json({ error: "No items in order" });
            }

            const [userRows] = await getPool().query(
                "SELECT name,email FROM users WHERE id = ?",
                [userId]
            );

            if (!userRows.length) {
                return res.status(400).json({ error: "User not found" });
            }

            const user = userRows[0];
            if (!doorNo || !street || !city || !zipCode || !phone) {
                return res
                    .status(400)
                    .json({ error: "Complete address required" });
            }

            const [r] = await getPool().query(
                `INSERT INTO orders 
    (user_id,total,status,payment_method,door_no,street,area,city,state,zip_code,phone,notes,payment_id,created_at) 
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())`,
                [
                    userId,
                    total,
                    "pending",
                    paymentMethod,
                    doorNo,
                    street,
                    area,
                    city,
                    state,
                    zipCode,
                    phone,
                    notes,
                    paymentId,
                ]
            );

            const orderId = r.insertId;

            for (const it of items) {
                await getPool().query(
                    "INSERT INTO order_items (order_id, menu_id, name, price, qty) VALUES (?,?,?,?,?)",
                    [orderId, it.id, it.name, it.price, it.qty]
                );
            }

            const receiptHtml = `
<div style="font-family:'Segoe UI', Arial; background:#f4f6fb; padding:40px 20px;">
  <div style="max-width:650px; margin:auto; background:#ffffff; padding:35px; border-radius:16px; box-shadow:0 10px 30px rgba(0,0,0,0.08);">

    <div style="text-align:center;">
      <h1 style="margin:0; color:#E53935;">Yummly</h1>
      <p style="color:#777;">Order Receipt</p>
    </div>

    <hr style="margin:25px 0; border:none; border-top:1px solid #eee;" />

    <p><strong>Order ID:</strong> YM${String(orderId).padStart(5, "0")}</p>
    <p><strong>Payment Method:</strong> ${paymentMethod.toUpperCase()}</p>
    <p><strong>Total Paid:</strong> Rs.${total}</p>

    <h3 style="margin-top:25px;">Ordered Items</h3>

    <table width="100%" cellpadding="10" cellspacing="0" style="border-collapse:collapse;">
      <tr style="background:#f9f9f9;">
        <th align="left">Item</th>
        <th align="center">Qty</th>
        <th align="right">Total</th>
      </tr>
      ${items
          .map(
              (it) => `
        <tr>
          <td>${it.name}</td>
          <td align="center">${it.qty}</td>
          <td align="right">Rs.${it.price * it.qty}</td>
        </tr>
      `
          )
          .join("")}
    </table>

    <h3 style="margin-top:25px;">Delivery Address</h3>
    <p style="color:#555;">
      ${doorNo}, ${street}, ${area || ""}<br/>
      ${city}, ${state} - ${zipCode}
    </p>

    <hr style="margin:30px 0;" />

    <p style="text-align:center; color:#4CAF50; font-weight:600;">
      Your food is being prepared
    </p>

    <p style="font-size:12px; color:#bbb; text-align:center;">
      Copyright ${new Date().getFullYear()} Yummly
    </p>

  </div>
</div>
`;

            try {
                await sendEmail(
                    user.email,
                    `Yummly Receipt - Order #${orderId}`,
                    receiptHtml
                );
                console.log("Receipt email sent");
            } catch (emailErr) {
                console.error(
                    "Email failed but order saved:",
                    emailErr.message
                );
            }

            try {
                const [admins] = await getPool().query(
                    "SELECT email, name FROM users WHERE role = 'admin'"
                );

                const adminHtml = `
    <div style="font-family:'Segoe UI', Arial; background:#f4f6fb; padding:40px 20px;">
      <div style="max-width:600px; margin:auto; background:#fff; padding:35px; border-radius:16px; box-shadow:0 10px 30px rgba(0,0,0,0.08);">

        <h2 style="color:#E53935;">New Order Received!</h2>

        <p>A new order has been placed on Yummly.</p>

        <hr style="margin:20px 0;" />

        <p><strong>Order ID:</strong> YM${String(orderId).padStart(5, "0")}</p>
        <p><strong>Customer:</strong> ${user.name}</p>
        <p><strong>Total Amount:</strong> Rs.${total}</p>
        <p><strong>Payment:</strong> ${paymentMethod.toUpperCase()}</p>

        <hr style="margin:20px 0;" />

        <h3>Delivery Address</h3>
        <p style="color:#555;">
          ${doorNo}, ${street}, ${area || ""}<br/>
          ${city}, ${state} - ${zipCode}
        </p>

        <hr style="margin:20px 0;" />

        <p style="color:#FF9800; font-weight:600;">
          Please assign a delivery partner as soon as possible.
        </p>

        <p style="font-size:12px; color:#bbb; text-align:center;">
          Copyright ${new Date().getFullYear()} Yummly
        </p>

      </div>
    </div>
    `;

                await Promise.all(
                    admins.map((admin) =>
                        sendEmail(
                            admin.email,
                            `New Order - YM${String(orderId).padStart(5, "0")}`,
                            adminHtml
                        )
                    )
                );

                console.log("Admin notification sent");
            } catch (adminEmailErr) {
                console.error("Admin email failed:", adminEmailErr.message);
            }

            res.json({
                orderId,
                message: "Order placed and receipt sent",
            });
        } catch (err) {
            console.error("Order creation error:", err);
            res.status(500).json({ error: "Failed to create order" });
        }
    });

    app.get("/orders/:id", async (req, res) => {
        try {
            const id = parseInt(req.params.id);
            const requesterId = parseInt(req.headers.userid, 10);

            const [rows] = await getPool().query(
                `
            SELECT o.id, o.user_id as userId, o.total, o.status, o.created_at, o.delivered_at,
                   o.door_no, o.street, o.area, o.city, o.state, o.zip_code,
                   o.phone, o.notes,
                   db.id as delivery_boy_id,
                   db.name as delivery_boy_name,
                   db.phone as delivery_boy_phone,
                   db.email as delivery_boy_email
            FROM orders o
            LEFT JOIN users db ON o.delivery_boy_id = db.id
            WHERE o.id = ?
            `,
                [id]
            );

            if (!rows.length) {
                return res.status(404).json({ error: "Order not found" });
            }

            const order = rows[0];

            if (!requesterId) {
                return res.status(401).json({ error: "Unauthorized" });
            }

            const [requesterRows] = await getPool().query(
                "SELECT role FROM users WHERE id = ?",
                [requesterId]
            );

            const isAdmin =
                requesterRows.length && requesterRows[0].role === "admin";
            const isAssignedDelivery =
                order.delivery_boy_id &&
                Number(order.delivery_boy_id) === requesterId;

            if (
                !isAdmin &&
                order.userId !== requesterId &&
                !isAssignedDelivery
            ) {
                return res.status(403).json({ error: "Forbidden" });
            }

            const [items] = await getPool().query(
                `
            SELECT menu_id as id, name, price, qty
            FROM order_items
            WHERE order_id = ?
            `,
                [id]
            );

            order.items = items;

            res.json(order);
        } catch (err) {
            console.error("Get order error:", err);
            res.status(500).json({ error: "Failed to fetch order" });
        }
    });

    app.get("/user/:userId/orders", requireSelfOrAdmin, async (req, res) => {
        try {
            const userId = parseInt(req.params.userId);
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 5;
            const status = req.query.status;

            const offset = (page - 1) * limit;

            let query = `
            SELECT o.id, o.total, o.status, o.created_at, o.delivered_at,
                   o.delivery_boy_id,
                   db.name as delivery_boy_name,
                   db.phone as delivery_boy_phone,
                   db.email as delivery_boy_email
            FROM orders o
            LEFT JOIN users db ON o.delivery_boy_id = db.id
            WHERE o.user_id = ?
        `;

            const params = [userId];

            if (status && status !== "all") {
                query += " AND status = ?";
                params.push(status);
            }

            query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
            params.push(limit, offset);

            const [rows] = await getPool().query(query, params);

            res.json(rows);
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: "Failed to fetch orders" });
        }
    });

    app.put("/orders/:id/cancel", async (req, res) => {
        try {
            const id = parseInt(req.params.id);

            const [rows] = await getPool().query(
                "SELECT status FROM orders WHERE id = ?",
                [id]
            );

            if (!rows.length) {
                return res.status(404).json({ error: "Order not found" });
            }

            const currentStatus = rows[0].status.toLowerCase().trim();

            if (
                currentStatus === "picked_up" ||
                currentStatus === "delivered" ||
                currentStatus === "cancelled"
            ) {
                return res.status(400).json({
                    error: "Order can no longer be cancelled",
                });
            }

            await getPool().query(
                "UPDATE orders SET status = 'cancelled' WHERE id = ?",
                [id]
            );

            res.json({ success: true });
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: "Cancel failed" });
        }
    });
}

module.exports = registerOrderRoutes;

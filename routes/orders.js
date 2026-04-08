function registerOrderRoutes(app, { getPool, sendEmail, requireSelfOrAdmin }) {
    const ORDER_STATUS = {
        PLACED: "placed",
        CONFIRMED: "confirmed",
        PREPARING: "preparing",
        PREPARED: "prepared",
        PICKED_UP: "picked_up",
        DELIVERED: "delivered",
        CANCELLED: "cancelled",
    };

    // Helper function to generate order number
    function generateOrderNumber() {
        const timestamp = Date.now().toString().slice(-8);
        const randomSuffix = Math.floor(Math.random() * 1000).toString().padStart(3, "0");
        return `YM${timestamp}${randomSuffix}`;
    }

    function normalizeOrderStatus(status) {
        const normalized = String(status || ORDER_STATUS.PLACED)
            .trim()
            .toLowerCase();

        return (
            {
                accepted: ORDER_STATUS.CONFIRMED,
                ready: ORDER_STATUS.PREPARED,
            }[normalized] || normalized
        );
    }

    function canRestaurantTransition(currentStatus, nextStatus) {
        const current = normalizeOrderStatus(currentStatus);
        const next = normalizeOrderStatus(nextStatus);

        const transitions = {
            [ORDER_STATUS.PLACED]: [
                ORDER_STATUS.CONFIRMED,
                ORDER_STATUS.CANCELLED,
            ],
            [ORDER_STATUS.CONFIRMED]: [
                ORDER_STATUS.PREPARING,
                ORDER_STATUS.CANCELLED,
            ],
            [ORDER_STATUS.PREPARING]: [
                ORDER_STATUS.PREPARED,
                ORDER_STATUS.CANCELLED,
            ],
            [ORDER_STATUS.PREPARED]: [],
            [ORDER_STATUS.PICKED_UP]: [],
            [ORDER_STATUS.DELIVERED]: [],
            [ORDER_STATUS.CANCELLED]: [],
        };

        return current === next || (transitions[current] || []).includes(next);
    }

    // Helper function to log order status change
    async function logOrderStatus(orderId, status) {
        try {
            await getPool().query(
                "INSERT INTO order_status_logs (order_id, status, updated_at) VALUES (?, ?, NOW())",
                [orderId, status]
            );
        } catch (error) {
            console.error("Error logging order status:", error);
        }
    }

    // Create new order
    app.post("/orders", async (req, res) => {
        try {
            const {
                userId,
                restaurantId,
                addressId,
                items,
                subtotal,
                taxAmount,
                discountAmount,
                deliveryFee,
                total,
                paymentMethod,
                paymentId,
                notes,
            } = req.body;

            const sessionUserId = parseInt(req.headers.userid, 10);
            const payloadUserId = userId ? parseInt(userId, 10) : null;
            if (
                sessionUserId &&
                payloadUserId &&
                sessionUserId !== payloadUserId
            ) {
                return res.status(403).json({ error: "User mismatch" });
            }

            const resolvedUserId = sessionUserId || payloadUserId;
            const normalizedPaymentMethod =
                paymentMethod === "cod" ? "cash" : paymentMethod || "cash";

            // Validation - allow order without addressId since we can create new one
            if (
                !resolvedUserId ||
                !restaurantId ||
                !items ||
                items.length === 0
            ) {
                return res
                    .status(400)
                    .json({ error: "Missing required fields" });
            }

            if (!subtotal || !total) {
                return res.status(400).json({ error: "Invalid order amounts" });
            }

            // Get user details
            const [users] = await getPool().query(
                "SELECT name, email, phone FROM users WHERE id = ?",
                [resolvedUserId]
            );

            if (!users.length) {
                return res.status(404).json({ error: "User not found" });
            }

            const user = users[0];

            // Get or create address
            let address;
            let resolvedAddressId = addressId;

            if (addressId) {
                const [addresses] = await getPool().query(
                    "SELECT * FROM addresses WHERE id = ? AND user_id = ?",
                    [addressId, resolvedUserId]
                );

                if (!addresses.length) {
                    return res.status(404).json({ error: "Address not found" });
                }
                address = addresses[0];
            } else {
                // Create new address from form data
                const { doorNo, street, area, city, state, zipCode, landmark } = req.body;
                const [addrResult] = await getPool().query(
                    `INSERT INTO addresses (user_id, door_no, street, area, city, state, pincode, landmark, is_default, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NOW())`,
                    [resolvedUserId, doorNo, street, area, city, state, zipCode, landmark || null]
                );
                resolvedAddressId = addrResult.insertId;
                
                const [newAddresses] = await getPool().query(
                    "SELECT * FROM addresses WHERE id = ?",
                    [resolvedAddressId]
                );
                address = newAddresses[0];
            }

            // Get restaurant details
            const [restaurants] = await getPool().query(
                "SELECT name FROM restaurants WHERE id = ?",
                [restaurantId]
            );

            if (!restaurants.length) {
                return res.status(404).json({ error: "Restaurant not found" });
            }

            const restaurant = restaurants[0];

            // Generate order number
            const orderNumber = generateOrderNumber();

            // Create order
            const [result] = await getPool().query(
                `INSERT INTO orders 
                 (order_number, user_id, restaurant_id, address_id, subtotal, tax_amount, discount_amount, delivery_fee, total,
                  payment_method, payment_id, payment_status, status, notes, phone, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
                [
                    orderNumber,
                    resolvedUserId,
                    restaurantId,
                    resolvedAddressId,
                    subtotal,
                    taxAmount || 0,
                    discountAmount || 0,
                    deliveryFee || 0,
                    total,
                    normalizedPaymentMethod,
                    paymentId || null,
                    normalizedPaymentMethod === "cash" ? "pending" : "paid",
                    ORDER_STATUS.PLACED,
                    notes || null,
                    user.phone,
                ]
            );

            const orderId = result.insertId;

            // Add order items
            for (const item of items) {
                await getPool().query(
                    "INSERT INTO order_items (order_id, menu_id, name, price, qty) VALUES (?, ?, ?, ?, ?)",
                    [orderId, item.id, item.name, item.price, item.qty]
                );
            }

            // Log initial status
            await logOrderStatus(orderId, ORDER_STATUS.PLACED);

            // Clear user's cart
            await getPool().query("DELETE FROM carts WHERE user_id = ?", [
                resolvedUserId,
            ]);

            // Get restaurant owner and send notification
            const [restaurantOwners] = await getPool().query(
                "SELECT owner_id, user_id FROM restaurants WHERE id = ?",
                [restaurantId]
            );
            const restaurantUserId =
                restaurantOwners[0]?.user_id || restaurantOwners[0]?.owner_id;
            if (restaurantUserId) {
                await getPool().query(
                    `INSERT INTO notifications (user_id, title, message, type, data, is_read, created_at)
                     VALUES (?, ?, ?, ?, ?, 0, NOW())`,
                    [
                        restaurantUserId,
                        "New Order Received",
                        `You have a new order #${orderNumber} from ${user.name}. Total: ₹${total}`,
                        "order",
                        JSON.stringify({ orderId, orderNumber }),
                    ]
                );
            }

            // Send confirmation email to customer
            try {
                const itemsHtml = items
                    .map(
                        (item) =>
                            `<tr style="border-bottom: 1px solid #eee;">
                            <td style="padding: 10px;">${item.name}</td>
                            <td style="padding: 10px; text-align: center;">${
                                item.qty
                            }</td>
                            <td style="padding: 10px; text-align: right;">₹${(
                                item.price * item.qty
                            ).toFixed(2)}</td>
                        </tr>`
                    )
                    .join("");

                const confirmationHtml = `
                    <div style="font-family: 'Segoe UI', Arial; background: #f4f6fb; padding: 40px 20px;">
                        <div style="max-width: 650px; margin: auto; background: #fff; padding: 35px; border-radius: 16px; box-shadow: 0 10px 30px rgba(0,0,0,0.08);">
                            <div style="text-align: center; margin-bottom: 30px;">
                                <h1 style="margin: 0; color: #E53935; font-size: 28px;">Yummly</h1>
                                <p style="color: #777; margin-top: 5px;">Order Confirmation</p>
                            </div>

                            <hr style="border: none; border-top: 1px solid #eee;" />

                            <h2 style="color: #333; margin-top: 20px;">Order Confirmed!</h2>
                            <p style="color: #666;">Thank you for your order. Your food is being prepared.</p>

                            <div style="background: #f9f9f9; padding: 15px; border-radius: 8px; margin: 20px 0;">
                                <p style="margin: 5px 0;"><strong>Order #:</strong> ${orderNumber}</p>
                                <p style="margin: 5px 0;"><strong>Restaurant:</strong> ${
                                    restaurant.name
                                }</p>
                                <p style="margin: 5px 0;"><strong>Estimated Delivery:</strong> 30-45 minutes</p>
                            </div>

                            <h3 style="color: #333;">Order Items</h3>
                            <table width="100%" cellpadding="10" cellspacing="0" style="border-collapse: collapse;">
                                <thead style="background: #f0f0f0;">
                                    <tr>
                                        <th style="text-align: left;">Item</th>
                                        <th style="text-align: center;">Qty</th>
                                        <th style="text-align: right;">Price</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${itemsHtml}
                                </tbody>
                            </table>

                            <div style="margin-top: 20px; background: #f9f9f9; padding: 15px; border-radius: 8px;">
                                <div style="display: flex; justify-content: space-between; margin: 8px 0;">
                                    <span>Subtotal:</span>
                                    <span>₹${subtotal.toFixed(2)}</span>
                                </div>
                                ${
                                    discountAmount > 0
                                        ? `<div style="display: flex; justify-content: space-between; margin: 8px 0; color: #4CAF50;">
                                    <span>Discount:</span>
                                    <span>-₹${discountAmount.toFixed(2)}</span>
                                </div>`
                                        : ""
                                }
                                ${
                                    taxAmount > 0
                                        ? `<div style="display: flex; justify-content: space-between; margin: 8px 0;">
                                    <span>Tax:</span>
                                    <span>₹${taxAmount.toFixed(2)}</span>
                                </div>`
                                        : ""
                                }
                                ${
                                    deliveryFee > 0
                                        ? `<div style="display: flex; justify-content: space-between; margin: 8px 0;">
                                    <span>Delivery Fee:</span>
                                    <span>₹${deliveryFee.toFixed(2)}</span>
                                </div>`
                                        : ""
                                }
                                <div style="display: flex; justify-content: space-between; margin-top: 15px; font-weight: bold; border-top: 1px solid #ddd; padding-top: 10px;">
                                    <span>Total Amount:</span>
                                    <span style="color: #E53935;">₹${total.toFixed(
                                        2
                                    )}</span>
                                </div>
                            </div>

                            <h3 style="color: #333;">Delivery Address</h3>
                            <p style="color: #666; line-height: 1.6;">
                                ${address.door_no} ${address.street}<br/>
                                ${
                                    address.landmark
                                        ? address.landmark + "<br/>"
                                        : ""
                                }
                                ${address.area}, ${address.city} - ${
                    address.pincode
                }<br/>
                                ${address.state}
                            </p>

                            <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />

                            <p style="color: #4CAF50; text-align: center; font-weight: 600;">
                                ✓ Your order is confirmed and being prepared
                            </p>
                            <p style="color: #777; text-align: center; font-size: 12px;">
                                You'll receive a notification when your order is out for delivery
                            </p>
                        </div>
                    </div>
                `;

                await sendEmail(
                    user.email,
                    `Order Confirmation - ${orderNumber}`,
                    confirmationHtml
                );
            } catch (emailError) {
                console.error("Customer confirmation email error:", emailError);
            }

            // Send receipt email
            try {
                const doorNo = address.door_no;
                const street = address.street;
                const area = address.area;
                const city = address.city;
                const state = address.state;
                const zipCode = address.pincode;

                const receiptHtml = `
<div style="font-family: 'Segoe UI', Arial; background: #f4f6fb; padding: 40px 20px;">
  <div style="max-width: 650px; margin: auto; background: #fff; padding: 35px; border-radius: 16px; box-shadow: 0 10px 30px rgba(0,0,0,0.08);">
    <div style="text-align: center; margin-bottom: 30px;">
      <h1 style="margin: 0; color: #E53935; font-size: 28px;">Yummly</h1>
      <p style="color: #777; margin-top: 5px;">Order Receipt</p>
    </div>

    <hr style="border: none; border-top: 1px solid #eee;" />

    <h2 style="color: #333; margin-top: 20px;">Thank you for your order!</h2>
    <p style="color: #666;">Your food has been delivered successfully.</p>

    <div style="background: #f9f9f9; padding: 15px; border-radius: 8px; margin: 20px 0;">
      <p style="margin: 5px 0;"><strong>Order #:</strong> ${orderNumber}</p>
      <p style="margin: 5px 0;"><strong>Restaurant:</strong> ${
          restaurant.name
      }</p>
      <p style="margin: 5px 0;"><strong>Delivered on:</strong> ${new Date().toLocaleDateString()}</p>
    </div>

    <h3 style="color: #333;">Order Items</h3>
    <table width="100%" cellpadding="10" cellspacing="0" style="border-collapse: collapse;">
      <thead style="background: #f0f0f0;">
        <tr>
          <th style="text-align: left;">Item</th>
          <th style="text-align: center;">Qty</th>
          <th style="text-align: right;">Price</th>
        </tr>
      </thead>
      <tbody>
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
      </tbody>
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

            // Send admin notification
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
                orderNumber,
                message: "Order placed successfully",
            });
        } catch (error) {
            console.error("Order creation error:", error);
            console.error("Order creation error details:", JSON.stringify({
                message: error.message,
                code: error.code,
                sqlMessage: error.sqlMessage,
                sqlState: error.sqlState
            }, null, 2));
            res.status(500).json({ 
                error: "Failed to create order", 
                details: error.message,
                code: error.code
            });
        }
    });

    // Get order by ID
    app.get("/orders/:orderId", async (req, res) => {
        try {
            const orderId = parseInt(req.params.orderId);
            const requesterId = parseInt(req.headers.userid);

            const [orders] = await getPool().query(
                `SELECT o.*, 
                        u.name as user_name, u.email as user_email, u.phone as user_phone,
                        r.name as restaurant_name,
                        dp.name as delivery_partner_name, dp.phone as delivery_partner_phone
                 FROM orders o
                 LEFT JOIN users u ON o.user_id = u.id
                 LEFT JOIN restaurants r ON o.restaurant_id = r.id
                 LEFT JOIN users dp ON o.delivery_partner_id = dp.id
                 WHERE o.id = ?`,
                [orderId]
            );

            if (!orders.length) {
                return res.status(404).json({ error: "Order not found" });
            }

            const order = orders[0];

            // Check authorization
            const [requester] = await getPool().query(
                "SELECT role FROM users WHERE id = ?",
                [requesterId]
            );

            const isAdmin = requester.length && requester[0].role === "admin";
            const isOwner = order.user_id === requesterId;
            const isDeliveryPartner = order.delivery_partner_id === requesterId;

            if (!isAdmin && !isOwner && !isDeliveryPartner) {
                return res.status(403).json({ error: "Unauthorized" });
            }

            // Get address details
            const [addresses] = await getPool().query(
                "SELECT * FROM addresses WHERE id = ?",
                [order.address_id]
            );

            if (addresses.length) {
                order.address = addresses[0];
            }

            // Get order items
            const [items] = await getPool().query(
                `SELECT oi.id, oi.menu_id, oi.name, oi.price, oi.qty 
                 FROM order_items oi 
                 WHERE oi.order_id = ?`,
                [orderId]
            );

            order.items = items;

            // Get order status logs
            const [statusLogs] = await getPool().query(
                "SELECT status, updated_at FROM order_status_logs WHERE order_id = ? ORDER BY updated_at ASC",
                [orderId]
            );

            order.status_logs = statusLogs;

            res.json(order);
        } catch (error) {
            console.error("Get order error:", error);
            res.status(500).json({ error: "Failed to fetch order" });
        }
    });

    // Get restaurant orders (for restaurant owners)
    app.get("/restaurant/orders", async (req, res) => {
        try {
            const requesterId = parseInt(req.headers.userid, 10);
            const status = req.query.status;
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 20;
            const offset = (page - 1) * limit;

            if (!requesterId) {
                return res.status(401).json({ error: "Unauthorized" });
            }

            const [userRows] = await getPool().query(
                "SELECT role FROM users WHERE id = ?",
                [requesterId]
            );

            if (!userRows.length) {
                return res.status(401).json({ error: "User not found" });
            }

            let restaurantId;
            if (userRows[0].role === "admin") {
                restaurantId = req.query.restaurantId ? parseInt(req.query.restaurantId) : null;
            } else {
                const [restaurantRows] = await getPool().query(
                    "SELECT id FROM restaurants WHERE owner_id = ? OR user_id = ? ORDER BY id ASC",
                    [requesterId, requesterId]
                );
                if (!restaurantRows.length) {
                    return res.status(404).json({ error: "Restaurant not found" });
                }
                restaurantId = restaurantRows[0].id;
            }

            let query = `
                SELECT o.id, o.order_number, o.user_id, o.total, o.status, 
                       o.payment_status, o.created_at, o.delivered_at,
                       u.name as customer_name, u.phone as customer_phone, u.email as customer_email,
                       a.door_no, a.street, a.area, a.city, a.pincode, a.landmark
                FROM orders o
                LEFT JOIN users u ON o.user_id = u.id
                LEFT JOIN addresses a ON o.address_id = a.id
                WHERE o.restaurant_id = ?
            `;

            const params = [restaurantId];

            if (status && status !== "all") {
                query += " AND o.status = ?";
                params.push(status);
            }

            query += " ORDER BY o.created_at DESC LIMIT ? OFFSET ?";
            params.push(limit, offset);

            const [orders] = await getPool().query(query, params);

            const [countResult] = await getPool().query(
                "SELECT COUNT(*) as count FROM orders WHERE restaurant_id = ?" + 
                (status && status !== "all" ? " AND status = ?" : ""),
                status && status !== "all" ? [restaurantId, status] : [restaurantId]
            );

            const ordersWithItems = await Promise.all(
                orders.map(async (order) => {
                    const [items] = await getPool().query(
                        "SELECT id, menu_id, name, price, qty FROM order_items WHERE order_id = ?",
                        [order.id]
                    );
                    order.items = items;
                    return order;
                })
            );

            res.json({
                orders: ordersWithItems,
                total: countResult[0].count,
                page,
                limit,
                totalPages: Math.ceil(countResult[0].count / limit),
            });
        } catch (error) {
            console.error("Get restaurant orders error:", error);
            res.status(500).json({ error: "Failed to fetch orders" });
        }
    });

    // Get user orders
    app.get("/user/:userId/orders", requireSelfOrAdmin, async (req, res) => {
        try {
            const userId = parseInt(req.params.userId);
            const status = req.query.status;
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;
            const offset = (page - 1) * limit;

            let query = `
                SELECT o.id, o.order_number, o.restaurant_id, o.total, o.status, 
                       o.payment_status, o.created_at, o.delivered_at,
                       r.name as restaurant_name, r.logo as restaurant_logo
                FROM orders o
                LEFT JOIN restaurants r ON o.restaurant_id = r.id
                WHERE o.user_id = ?
            `;

            const params = [userId];

            if (status && status !== "all") {
                query += " AND o.status = ?";
                params.push(status);
            }

            query += " ORDER BY o.created_at DESC LIMIT ? OFFSET ?";
            params.push(limit, offset);

            const [orders] = await getPool().query(query, params);

            // Get total count
            let countQuery =
                "SELECT COUNT(*) as count FROM orders WHERE user_id = ?";
            const countParams = [userId];

            if (status && status !== "all") {
                countQuery += " AND status = ?";
                countParams.push(status);
            }

            const [countResult] = await getPool().query(
                countQuery,
                countParams
            );

            res.json({
                orders,
                total: countResult[0].count,
                page,
                limit,
                totalPages: Math.ceil(countResult[0].count / limit),
            });
        } catch (error) {
            console.error("Get user orders error:", error);
            res.status(500).json({ error: "Failed to fetch orders" });
        }
    });

    // Update order status
    app.put("/orders/:orderId/status", async (req, res) => {
        try {
            const orderId = parseInt(req.params.orderId);
            const { status } = req.body;
            const requesterId = parseInt(req.headers.userid);

            if (!status) {
                return res.status(400).json({ error: "Status is required" });
            }

            // Get order and verify authorization
            const [orders] = await getPool().query(
                "SELECT o.*, u.role FROM orders o LEFT JOIN users u ON u.id = ? WHERE o.id = ?",
                [requesterId, orderId]
            );

            if (!orders.length) {
                return res.status(404).json({ error: "Order not found" });
            }

            const order = orders[0];
            const [requester] = await getPool().query(
                "SELECT role FROM users WHERE id = ?",
                [requesterId]
            );

            const isAdmin = requester.length && requester[0].role === "admin";
            const isDeliveryPartner = order.delivery_partner_id === requesterId;

            if (!isAdmin && !isDeliveryPartner) {
                return res.status(403).json({ error: "Unauthorized" });
            }

            // Update order status
            const updateFields = { status };
            if (status === "delivered") {
                updateFields.delivered_at = new Date();
            }

            await getPool().query(
                "UPDATE orders SET status = ?, delivered_at = ? WHERE id = ?",
                [status, updateFields.delivered_at || null, orderId]
            );

            // Log status change
            await logOrderStatus(orderId, status);

            res.json({ ok: true });
        } catch (error) {
            console.error("Update order status error:", error);
            res.status(500).json({ error: "Failed to update order status" });
        }
    });

    // Update payment status
    app.put("/orders/:orderId/payment-status", async (req, res) => {
        try {
            const orderId = parseInt(req.params.orderId);
            const { paymentStatus } = req.body;
            const requesterId = parseInt(req.headers.userid);

            if (!paymentStatus) {
                return res
                    .status(400)
                    .json({ error: "Payment status is required" });
            }

            // Verify authorization
            const [orders] = await getPool().query(
                "SELECT user_id FROM orders WHERE id = ?",
                [orderId]
            );

            if (!orders.length) {
                return res.status(404).json({ error: "Order not found" });
            }

            const [requester] = await getPool().query(
                "SELECT role FROM users WHERE id = ?",
                [requesterId]
            );

            const isAdmin = requester.length && requester[0].role === "admin";
            const isOwner = orders[0].user_id === requesterId;

            if (!isAdmin && !isOwner) {
                return res.status(403).json({ error: "Unauthorized" });
            }

            await getPool().query(
                "UPDATE orders SET payment_status = ?, updated_at = NOW() WHERE id = ?",
                [paymentStatus, orderId]
            );

            res.json({ ok: true });
        } catch (error) {
            console.error("Update payment status error:", error);
            res.status(500).json({ error: "Failed to update payment status" });
        }
    });

    // Cancel order
    app.put("/orders/:orderId/cancel", requireSelfOrAdmin, async (req, res) => {
        try {
            const orderId = parseInt(req.params.orderId);
            const requesterId = parseInt(req.headers.userid);

            const [orders] = await getPool().query(
                "SELECT user_id, status FROM orders WHERE id = ?",
                [orderId]
            );

            if (!orders.length) {
                return res.status(404).json({ error: "Order not found" });
            }

            if (orders[0].user_id !== requesterId) {
                return res.status(403).json({ error: "Unauthorized" });
            }

            const currentStatus = orders[0].status.toLowerCase();
            if (
                ["delivered", "cancelled", "picked_up"].includes(currentStatus)
            ) {
                return res
                    .status(400)
                    .json({ error: "Order cannot be cancelled at this stage" });
            }

            await getPool().query(
                "UPDATE orders SET status = 'cancelled', updated_at = NOW() WHERE id = ?",
                [orderId]
            );

            await logOrderStatus(orderId, "cancelled");

            res.json({ ok: true });
        } catch (error) {
            console.error("Cancel order error:", error);
            res.status(500).json({ error: "Failed to cancel order" });
        }
    });

    app.put("/restaurant/orders/:id/status", async (req, res) => {
        try {
            const orderId = parseInt(req.params.id, 10);
            const { status } = req.body;
            const requesterId = parseInt(req.headers.userid, 10);

            if (!requesterId) {
                return res.status(401).json({ error: "Unauthorized" });
            }

            if (!status) {
                return res.status(400).json({ error: "Status is required" });
            }

            const normalizedStatus = normalizeOrderStatus(status);
            const [orderRows] = await getPool().query(
                "SELECT restaurant_id, status FROM orders WHERE id = ?",
                [orderId]
            );

            if (!orderRows.length) {
                return res.status(404).json({ error: "Order not found" });
            }

            if (
                !canRestaurantTransition(orderRows[0].status, normalizedStatus)
            ) {
                return res.status(400).json({
                    error: `Invalid restaurant status transition from ${normalizeOrderStatus(
                        orderRows[0].status
                    )} to ${normalizedStatus}`,
                });
            }

            const restaurantId = orderRows[0].restaurant_id;
            const [userRows] = await getPool().query(
                "SELECT role FROM users WHERE id = ?",
                [requesterId]
            );

            if (!userRows.length) {
                return res.status(401).json({ error: "Unauthorized" });
            }

            const requesterRole = userRows[0].role;
            if (requesterRole !== "admin") {
                const [restaurantRows] = await getPool().query(
                    "SELECT owner_id, user_id FROM restaurants WHERE id = ?",
                    [restaurantId]
                );

                if (
                    !restaurantRows.length ||
                    (Number(restaurantRows[0].owner_id) !== requesterId &&
                        Number(restaurantRows[0].user_id) !== requesterId)
                ) {
                    return res.status(403).json({ error: "Forbidden" });
                }
            }

            await getPool().query(
                `UPDATE orders
                 SET status = ?,
                      delivered_at = CASE WHEN ? = 'delivered' THEN NOW() ELSE delivered_at END
              WHERE id = ?`,
                [normalizedStatus, normalizedStatus, orderId]
            );

            await logOrderStatus(orderId, normalizedStatus);

            res.json({ success: true });
        } catch (err) {
            console.error("Restaurant order status error:", err);
            res.status(500).json({ error: "Failed to update status" });
        }
    });

    app.get("/orders/:id", async (req, res) => {
        try {
            const id = parseInt(req.params.id);
            const requesterId = parseInt(req.headers.userid, 10);

            const [rows] = await getPool().query(
                `
                SELECT o.id, o.user_id as userId, o.total, o.status, o.created_at, o.delivered_at,
                       COALESCE(a.door_no, o.door_no) as door_no,
                       COALESCE(a.street, o.street) as street,
                       COALESCE(a.area, o.area) as area,
                       COALESCE(a.city, o.city) as city,
                       COALESCE(a.state, o.state) as state,
                       COALESCE(a.pincode, o.zip_code) as zip_code,
                       o.phone, o.notes,
                       db.id as delivery_partner_id,
                       db.name as delivery_partner_name,
                       db.phone as delivery_partner_phone,
                       db.email as delivery_partner_email
                FROM orders o
                LEFT JOIN addresses a ON o.address_id = a.id
                LEFT JOIN users db ON o.delivery_partner_id = db.id
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
                order.delivery_partner_id &&
                Number(order.delivery_partner_id) === requesterId;

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
}

module.exports = registerOrderRoutes;

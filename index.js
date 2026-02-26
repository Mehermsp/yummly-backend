const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, ".env") });

const { Resend } = require("resend");
const resend = new Resend(process.env.RESEND_API_KEY);

const app = express();
app.use(cors());
app.use(bodyParser.json());
// Configure via env variables or defaults
const DB_HOST = process.env.DB_HOST;
const DB_USER = process.env.DB_USER;
const DB_PASS = process.env.DB_PASS;
const DB_NAME = process.env.DB_NAME;
const PORT = process.env.PORT || 8000;

let pool;
async function initDb() {
    const config = {
        host: DB_HOST,
        port: process.env.DB_PORT, // 🔥 ADD THIS,
        user: DB_USER,
        password: DB_PASS,
        database: DB_NAME,
        waitForConnections: true,
        connectionLimit: 10,
        connectTimeout: 10000, // 10s
    };

    // enable SSL for Aiven/MySQL if required (Render -> Aiven over public Internet)
    if (process.env.DB_SSL === "true") {
        config.ssl = {
            // rejectUnauthorized can be toggled by env for testing
            rejectUnauthorized: process.env.DB_SSL_REJECT !== "false",
        };
        console.log("🔐 SSL enabled for DB connection");
    }

    pool = await mysql.createPool(config);
}

// Email transporter (configure with your email service)
// ✅ Simple Gmail App Password transporter

// In-memory OTP store (in production, use Redis or database)

// --- Health check ---
app.get("/ping", (req, res) => {
    res.json({
        ok: true,
        ts: new Date().toISOString(),
        version: process.env.COMMIT_HASH || "dev",
    });
});

// --- Detailed health check (test database connection) ---
app.get("/health", async (req, res) => {
    try {
        const [result] = await pool.query("SELECT 1 as alive");
        res.json({
            ok: true,
            server: "running",
            database: result[0].alive ? "connected" : "failed",
            timestamp: new Date().toISOString(),
        });
    } catch (err) {
        console.error("Health check database error:", err.message);
        res.status(503).json({
            ok: false,
            server: "running",
            database: "disconnected",
            error: err.message,
            timestamp: new Date().toISOString(),
        });
    }
});

// --- Diagnostics Endpoint (for debugging) ---
app.get("/diagnostics", async (req, res) => {
    try {
        const [otps] = await pool.query(
            "SELECT email, type, expires_at, reset_token FROM otp_codes ORDER BY id DESC LIMIT 10"
        );

        res.json({
            server: "running",
            timestamp: new Date().toISOString(),
            emailService: "Resend",
            resendKey: process.env.RESEND_API_KEY ? "configured" : "missing",
            database: {
                host: process.env.DB_HOST || "not set",
                port: process.env.DB_PORT || "not set",
                ssl: process.env.DB_SSL || "false",
            },
            otp_codes: {
                count: otps.length,
                recent: otps,
            },
        });
    } catch (err) {
        res.status(500).json({
            error: "Diagnostics failed",
            details: err.message,
        });
    }
});

// --- Send Registration OTP ---
app.post("/auth/send-registration-otp", async (req, res) => {
    try {
        const { name, email, password } = req.body;
        if (!name || !email || !password)
            return res.status(400).json({ error: "All fields required" });

        const emailLower = email.trim().toLowerCase();

        const [exists] = await pool.query(
            "SELECT id FROM users WHERE LOWER(email)=?",
            [emailLower]
        );

        if (exists.length)
            return res.status(400).json({ error: "Email already exists" });

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expires = new Date(Date.now() + 5 * 60 * 1000);

        await pool.query(
            "INSERT INTO otp_codes (email, otp, type, expires_at) VALUES (?,?,?,?)",
            [emailLower, otp, "registration", expires]
        );

        await resend.emails.send({
            from: "Yummly <onboarding@resend.dev>",
            to: emailLower,
            subject: "Yummly Registration OTP",
            html: `
                <h2>Welcome to Yummly 🍽️</h2>
                <p>Your registration OTP is:</p>
                <h1>${otp}</h1>
                <p>This OTP expires in 5 minutes.</p>
            `,
        });

        res.json({ ok: true, message: "OTP sent successfully" });
    } catch (err) {
        console.error("Registration OTP Error:", err);
        res.status(500).json({ error: "Failed to send OTP" });
    }
});

// --- Register ---
app.post("/auth/register", async (req, res) => {
    try {
        const { email, otp } = req.body;
        const emailLower = email.trim().toLowerCase();

        const [rows] = await pool.query(
            "SELECT * FROM otp_codes WHERE email=? AND otp=? AND type='registration' ORDER BY id DESC LIMIT 1",
            [emailLower, otp]
        );

        if (!rows.length || new Date(rows[0].expires_at) < new Date())
            return res.status(400).json({ error: "Invalid or expired OTP" });

        const hash = await bcrypt.hash(req.body.password, 8);

        const [result] = await pool.query(
            "INSERT INTO users (name,email,password,role) VALUES (?,?,?,?)",
            [req.body.name, emailLower, hash, "user"]
        );

        await pool.query("DELETE FROM otp_codes WHERE email=?", [emailLower]);

        res.json({
            user: {
                id: result.insertId,
                name: req.body.name,
                email: emailLower,
                role: "user",
            },
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Registration failed" });
    }
});

// --- Login ---
app.post("/auth/login", async (req, res) => {
    try {
        const { email, password } = req.body;
        console.log("🔐 Login attempt for:", email);

        console.log("🔗 Executing database query...");
        const [rows] = await pool.query(
            "SELECT id,name,email,role,password FROM users WHERE LOWER(email)=LOWER(?)",
            [email]
        );

        console.log("✅ Query completed, found users:", rows.length);
        const user = rows[0];
        if (!user) {
            console.log("❌ No user found for:", email);
            return res.status(400).json({ error: "Invalid credentials" });
        }

        const ok = await bcrypt.compare(password, user.password);
        if (!ok) {
            console.log("❌ Password mismatch for:", email);
            return res.status(400).json({ error: "Invalid credentials" });
        }

        delete user.password;
        console.log("✅ Login successful for:", email);
        res.json({ user });
    } catch (err) {
        console.error("❌ Login error:", err.message);
        console.error("Stack:", err.stack);
        res.status(500).json({
            error: "Server error",
            details: err.message,
        });
    }
});

// --- Forgot Password ---
app.post("/auth/forgot-password", async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: "Email required" });

        const emailLower = email.trim().toLowerCase();

        const [users] = await pool.query(
            "SELECT id FROM users WHERE LOWER(email)=?",
            [emailLower]
        );

        if (!users.length)
            return res.status(400).json({ error: "Account not found" });

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expires = new Date(Date.now() + 5 * 60 * 1000);

        await pool.query(
            "INSERT INTO otp_codes (email, otp, type, user_id, expires_at) VALUES (?,?,?,?,?)",
            [emailLower, otp, "reset", users[0].id, expires]
        );

        await resend.emails.send({
            from: "Yummly <onboarding@resend.dev>",
            to: emailLower,
            subject: "Yummly Password Reset OTP",
            html: `
                <h2>Password Reset 🔐</h2>
                <p>Your OTP is:</p>
                <h1>${otp}</h1>
                <p>This OTP expires in 5 minutes.</p>
            `,
        });

        res.json({ ok: true, message: "OTP sent successfully" });
    } catch (err) {
        console.error("Forgot Password OTP Error:", err);
        res.status(500).json({ error: "Failed to send OTP" });
    }
});
//test mail
app.get("/test-email", async (req, res) => {
    try {
        await resend.emails.send({
            from: "Yummly <onboarding@resend.dev>",
            to: "yummlydelivers@gmail.com",
            subject: "Resend Test",
            html: "<h2>It works 🚀</h2>",
        });

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Verify OTP ---
app.post("/auth/verify-otp", async (req, res) => {
    try {
        const { email, otp } = req.body;
        const emailLower = email.trim().toLowerCase();

        const [rows] = await pool.query(
            "SELECT * FROM otp_codes WHERE email=? AND otp=? AND type='reset' ORDER BY id DESC LIMIT 1",
            [emailLower, otp]
        );

        if (!rows.length || new Date(rows[0].expires_at) < new Date())
            return res.status(400).json({ error: "Invalid or expired OTP" });

        const resetToken = Math.random().toString(36).substring(2);
        const resetExpires = new Date(Date.now() + 10 * 60 * 1000);

        await pool.query(
            "UPDATE otp_codes SET reset_token=?, reset_expires=? WHERE id=?",
            [resetToken, resetExpires, rows[0].id]
        );

        res.json({ ok: true, resetToken });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "OTP verification failed" });
    }
});

// --- Reset Password ---
app.post("/auth/reset-password", async (req, res) => {
    try {
        const { email, resetToken, newPassword } = req.body;
        const emailLower = email.trim().toLowerCase();

        const [rows] = await pool.query(
            "SELECT * FROM otp_codes WHERE email=? AND reset_token=? ORDER BY id DESC LIMIT 1",
            [emailLower, resetToken]
        );

        if (!rows.length || new Date(rows[0].reset_expires) < new Date())
            return res.status(400).json({ error: "Invalid or expired token" });

        const hash = await bcrypt.hash(newPassword, 8);

        await pool.query("UPDATE users SET password=? WHERE id=?", [
            hash,
            rows[0].user_id,
        ]);

        await pool.query("DELETE FROM otp_codes WHERE email=?", [emailLower]);

        res.json({ ok: true, message: "Password reset successfully" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Reset failed" });
    }
});

// --- Get Menu ---
app.get("/menu", async (req, res) => {
    const [rows] = await pool.query(
        "SELECT id, name, description, price, image, category, season, rating, discount, popularity FROM menu"
    );
    res.json(rows);
});

// --- Create Order ---
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

        const [userRows] = await pool.query(
            "SELECT name,email FROM users WHERE id = ?",
            [userId]
        );

        if (!userRows.length) {
            return res.status(400).json({ error: "User not found" });
        }

        const user = userRows[0];
        if (!doorNo || !street || !city || !zipCode || !phone) {
            return res.status(400).json({ error: "Complete address required" });
        }

        const [r] = await pool.query(
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
            await pool.query(
                "INSERT INTO order_items (order_id, menu_id, name, price, qty) VALUES (?,?,?,?,?)",
                [orderId, it.id, it.name, it.price, it.qty]
            );
        }

        // 🔥 CREATE RECEIPT HTML
        const itemRows = items
            .map(
                (it) =>
                    `<tr>
                        <td>${it.name}</td>
                        <td>${it.qty}</td>
                        <td>₹${it.price}</td>
                        <td>₹${it.price * it.qty}</td>
                    </tr>`
            )
            .join("");

        const receiptHtml = `
<h2>🍽️ Yummly Order Receipt</h2>

<p><strong>Order ID:</strong> ${orderId}</p>
<p><strong>Transaction ID:</strong> ${paymentId || "COD"}</p>
<p><strong>Payment Method:</strong> ${paymentMethod.toUpperCase()}</p>

<hr/>

<h3>👤 Customer Details</h3>
<p><strong>Name:</strong> ${user.name}</p>
<p><strong>Phone:</strong> ${phone || "Not provided"}</p>
<h3>🏠 Delivery Address</h3>
<p>
<strong>Door No:</strong> ${doorNo || "-"} <br/>
<strong>Street:</strong> ${street || "-"} <br/>
<strong>Area:</strong> ${area || "-"} <br/>
<strong>City:</strong> ${city || "-"} <br/>
<strong>State:</strong> ${state || "-"} <br/>
<strong>ZIP Code:</strong> ${zipCode || "-"}
</p>

<p><strong>Phone:</strong> ${phone || "Not provided"}</p>

<hr/>

<h3>📝 Delivery Instructions</h3>
<p>${notes || "No special instructions provided."}</p>

<hr/>

<h3>🛵 Delivery Partner Instructions</h3>
<ul>
<li>Confirm customer phone before arrival</li>
<li>Handle food carefully</li>
<li>Mark delivered only after handover</li>
<li>Follow safety protocols</li>
</ul>

<hr/>

<h3>🛒 Ordered Items</h3>
<table border="1" cellpadding="6" cellspacing="0">
<tr>
<th>Item</th>
<th>Qty</th>
<th>Price</th>
<th>Total</th>
</tr>
${itemRows}
</table>

<h3>Total Paid: ₹${total}</h3>

<br/>
<p>Thank you for ordering with Yummly ❤️</p>
<p>Your food is being prepared!</p>
`;

        // 🔥 SEND EMAIL
        // 🔥 SEND EMAIL (safe mode)
        try {
            await resend.emails.send({
                from: "Yummly <onboarding@resend.dev>",
                to: user.email,
                subject: `Yummly Receipt - Order #${orderId}`,
                html: receiptHtml,
            });
            console.log("✅ Receipt email sent");
        } catch (emailErr) {
            console.error("⚠️ Email failed but order saved:", emailErr.message);
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

// --- Get Order Details ---
app.get("/orders/:id", async (req, res) => {
    try {
        const id = parseInt(req.params.id);

        const [rows] = await pool.query(
            `
            SELECT id, user_id as userId, total, status, created_at, delivered_at,
       door_no, street, area, city, state, zip_code,
       phone, notes
            FROM orders
            WHERE id = ?
            `,
            [id]
        );

        if (!rows.length) {
            return res.status(404).json({ error: "Order not found" });
        }

        const order = rows[0];

        const [items] = await pool.query(
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

// --- Save or update cart ---
app.post("/cart", async (req, res) => {
    const { userId, items } = req.body;
    if (!userId) return res.status(400).json({ error: "Missing userId" });

    await pool.query("DELETE FROM carts WHERE user_id = ?", [userId]);
    if (items && items.length) {
        const promises = items.map((it) =>
            pool.query(
                "INSERT INTO carts (user_id, menu_id, name, price, qty) VALUES (?,?,?,?,?)",
                [userId, it.id, it.name, it.price, it.qty]
            )
        );
        await Promise.all(promises);
    }
    res.json({ ok: true });
});

// --- Get cart ---
app.get("/cart/:userId", async (req, res) => {
    const userId = req.params.userId;
    const [rows] = await pool.query(
        "SELECT menu_id as id,name,price,qty FROM carts WHERE user_id = ?",
        [userId]
    );
    res.json(rows);
});

// --- Get user orders ---
app.get("/user/:userId/orders", async (req, res) => {
    try {
        const userId = parseInt(req.params.userId);
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 5;
        const status = req.query.status;

        const offset = (page - 1) * limit;

        let query = `
            SELECT id, total, status, created_at, delivered_at
            FROM orders
            WHERE user_id = ?
        `;

        const params = [userId];

        if (status && status !== "all") {
            query += " AND status = ?";
            params.push(status);
        }

        query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
        params.push(limit, offset);

        const [rows] = await pool.query(query, params);

        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch orders" });
    }
});

// cancel order
app.put("/orders/:id/cancel", async (req, res) => {
    try {
        const id = parseInt(req.params.id);

        const [rows] = await pool.query(
            "SELECT status FROM orders WHERE id = ?",
            [id]
        );

        if (!rows.length) {
            return res.status(404).json({ error: "Order not found" });
        }

        const currentStatus = rows[0].status.toLowerCase().trim();

        // ❌ Block only after pickup or delivery
        if (
            currentStatus === "picked_up" ||
            currentStatus === "delivered" ||
            currentStatus === "cancelled"
        ) {
            return res.status(400).json({
                error: "Order can no longer be cancelled",
            });
        }

        await pool.query(
            "UPDATE orders SET status = 'cancelled' WHERE id = ?",
            [id]
        );

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Cancel failed" });
    }
});
const isAdmin = async (req, res, next) => {
    const userId = req.headers.userid;

    if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    const [rows] = await pool.query("SELECT role FROM users WHERE id = ?", [
        userId,
    ]);

    if (!rows.length || rows[0].role !== "admin") {
        return res.status(403).json({ error: "Admin access required" });
    }

    next();
};
//get all orders for admin
app.get("/admin/orders", isAdmin, async (req, res) => {
    try {
        const { startDate, endDate } = req.query;

        let query = `
            SELECT o.*, u.name, u.email
            FROM orders o
            JOIN users u ON o.user_id = u.id
        `;

        const params = [];

        if (startDate && endDate) {
            query += ` WHERE DATE(o.created_at) BETWEEN ? AND ?`;
            params.push(startDate, endDate);
        }

        query += ` ORDER BY o.created_at DESC`;

        const [orders] = await pool.query(query, params);

        for (const order of orders) {
            const [items] = await pool.query(
                `SELECT menu_id as id, name, price, qty
                 FROM order_items
                 WHERE order_id = ?`,
                [order.id]
            );

            order.items = items;
        }

        res.json(orders);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch admin orders" });
    }
});
//update order status for admin
app.put("/admin/orders/:id/status", async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { status } = req.body;

        const [rows] = await pool.query(
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

        await pool.query("UPDATE orders SET status = ? WHERE id = ?", [
            status,
            id,
        ]);

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Failed to update status" });
    }
});
// --- Get user profile ---
app.get("/user/:userId", async (req, res) => {
    const userId = parseInt(req.params.userId);
    const [rows] = await pool.query(
        "SELECT id,name,email,phone,role FROM users WHERE id = ?",
        [userId]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    res.json({ user: rows[0] });
});

// --- Update user profile ---
app.post("/user/:userId/profile", async (req, res) => {
    const userId = parseInt(req.params.userId);
    const { name, phone, email } = req.body;

    // Ensure email uniqueness
    if (email) {
        const [existing] = await pool.query(
            "SELECT id FROM users WHERE email = ? AND id != ?",
            [email, userId]
        );
        if (existing.length) {
            return res.status(400).json({ error: "Email already in use" });
        }
    }

    const updates = [];
    const params = [];

    if (typeof name !== "undefined") {
        updates.push("name = ?");
        params.push(name || "");
    }
    if (typeof phone !== "undefined") {
        updates.push("phone = ?");
        params.push(phone || "");
    }
    if (typeof email !== "undefined") {
        updates.push("email = ?");
        params.push(email || "");
    }

    if (updates.length) {
        const sql = `UPDATE users SET ${updates.join(", ")} WHERE id = ?`;
        params.push(userId);
        await pool.query(sql, params);
    }

    const [rows] = await pool.query(
        "SELECT id,name,email,phone FROM users WHERE id = ?",
        [userId]
    );
    res.json({ user: rows[0] });
});

// --- Start server ---
async function start() {
    try {
        await initDb();
        app.listen(PORT, () => console.log("✅ Server started on port", PORT));
    } catch (e) {
        console.error("❌ Failed to start server", e.message);
        process.exit(1);
    }
}

//assign delivery partner to order
app.put("/admin/orders/:id/assign", isAdmin, async (req, res) => {
    try {
        const orderId = parseInt(req.params.id);
        const { deliveryBoyId } = req.body;

        const [rows] = await pool.query(
            "SELECT status FROM orders WHERE id = ?",
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

        await pool.query(
            `
            UPDATE orders 
            SET delivery_boy_id = ?, 
                status = 'accepted' 
            WHERE id = ?
            `,
            [deliveryBoyId, orderId]
        );

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Assignment failed" });
    }
});
//get delivery boy orders
app.get("/delivery/orders", async (req, res) => {
    const userId = req.headers.userid;

    const [orders] = await pool.query(
        `
        SELECT * FROM orders
        WHERE delivery_boy_id = ?
        ORDER BY created_at DESC
    `,
        [userId]
    );

    for (const order of orders) {
        const [items] = await pool.query(
            "SELECT menu_id as id, name, price, qty FROM order_items WHERE order_id = ?",
            [order.id]
        );
        order.items = items;
    }

    res.json(orders);
});
//delivery boy update status
app.put("/delivery/orders/:id/status", async (req, res) => {
    try {
        const orderId = parseInt(req.params.id);
        const userId = req.headers.userid;
        const { status, deliveryNotes, estimatedDeliveryTime } = req.body;

        const [rows] = await pool.query(
            `
            SELECT o.delivery_boy_id, o.status, 
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

        if (order.delivery_boy_id != userId) {
            return res.status(403).json({
                error: "Not authorized for this order",
            });
        }

        await pool.query(
            `
            UPDATE orders 
            SET status = ?, 
                delivery_notes = ?,
                delivered_at = ${
                    status === "delivered" ? "NOW()" : "delivered_at"
                }
            WHERE id = ?
            `,
            [status, deliveryNotes || "", orderId]
        );

        /* =============================
           SAFE EMAIL SECTION
        ============================== */

        try {
            if (status === "picked_up") {
                await resend.emails.send({
                    from: "Yummly <onboarding@resend.dev>",
                    to: order.email,
                    subject: `Your Order is Out for Delivery 🚚`,
                    html: `
<div style="font-family: Arial; padding:20px;">
    <h2 style="color:#E53935;">Yummly Delivery Update 🚚</h2>
    <p>Hello <b>${order.name}</b>,</p>

    <p>Your order <strong>YM${String(orderId).padStart(5, "0")}</strong> 
    is now <span style="color:#4CAF50; font-weight:bold;">
    Out for Delivery</span>.</p>

    ${
        estimatedDeliveryTime
            ? `<p><strong>Estimated Delivery Time:</strong> ${estimatedDeliveryTime}</p>`
            : ""
    }

    <p>Please keep your phone reachable.</p>
    <hr/>
    <p style="color:#666;">Thank you for choosing Yummly ❤️</p>
</div>
`,
                });
            }

            if (status === "delivered") {
                await resend.emails.send({
                    from: "Yummly <onboarding@resend.dev>",
                    to: order.email,
                    subject: `Your Order has been Delivered! ✅`,
                    html: `
<div style="font-family: Arial; padding:20px;">
    <h2 style="color:#4CAF50;">Yummly Order Delivered! ✅</h2>
    <p>Hello <b>${order.name}</b>,</p>

    <p>Your order <strong>YM${String(orderId).padStart(5, "0")}</strong> 
    has been successfully delivered.</p>

    <p><strong>Delivered At:</strong> ${new Date().toLocaleString("en-IN")}</p>

    <hr/>
    <p style="color:#666;">Thank you for choosing Yummly ❤️</p>
</div>
`,
                });
            }

            console.log("✅ Delivery email sent successfully");
        } catch (emailErr) {
            console.error(
                "⚠️ Delivery email failed but status updated:",
                emailErr.message
            );
        }

        res.json({ success: true });
    } catch (err) {
        console.error("Delivery status error:", err);
        res.status(500).json({ error: "Status update failed" });
    }
});
//delivery boy update status for admin
app.get("/admin/delivery-stats", isAdmin, async (req, res) => {
    const [stats] = await pool.query(`
        SELECT u.id, u.name,
        SUM(CASE WHEN o.status IN ('accepted','preparing','picked_up') THEN 1 ELSE 0 END) AS active_orders,
        SUM(CASE WHEN o.status = 'delivered' THEN 1 ELSE 0 END) AS completed_orders
        FROM users u
        LEFT JOIN orders o ON u.id = o.delivery_boy_id
        WHERE u.role = 'delivery'
        GROUP BY u.id
    `);

    res.json(stats);
});
//get all delivery boys
// --- Get All Delivery Boys ---
app.get("/admin/delivery-boys", isAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT 
                u.id,
                u.name,
                u.email,
                u.phone,
                COUNT(CASE WHEN o.status IN ('accepted','preparing','picked_up') THEN 1 END) AS active_orders,
                COUNT(CASE WHEN o.status = 'delivered' THEN 1 END) AS completed_orders
            FROM users u
            LEFT JOIN orders o ON u.id = o.delivery_boy_id
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
app.use("/uploads", express.static("uploads"));
start();

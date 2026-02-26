const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const nodemailer = require("nodemailer");
const { google } = require("googleapis");

const app = express();
app.use(cors());
app.use(bodyParser.json());
const path = require("path");
// Load from .env if it exists (local dev), otherwise use process.env (Render)
require("dotenv").config({ path: path.join(__dirname, ".env") });

// Configure via env variables or defaults
const DB_HOST = process.env.DB_HOST;
const DB_USER = process.env.DB_USER;
const DB_PASS = process.env.DB_PASS;
const DB_NAME = process.env.DB_NAME;
const PORT = process.env.PORT || 8000;

let pool;
async function initDb() {
    pool = await mysql.createPool({
        host: DB_HOST,
        user: DB_USER,
        password: DB_PASS,
        database: DB_NAME,
        waitForConnections: true,
        connectionLimit: 10,
    });
}

// Email transporter (configure with your email service)
const OAuth2 = google.auth.OAuth2;

const oauth2Client = new OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    "https://developers.google.com/oauthplayground" // redirect URL
);

oauth2Client.setCredentials({
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
});

async function createTransporter() {
    const accessTokenResponse = await oauth2Client.getAccessToken();
    const accessToken =
        (accessTokenResponse && accessTokenResponse.token) ||
        accessTokenResponse;

    if (!accessToken) {
        throw new Error(
            "Failed to obtain access token for Gmail API. Check GOOGLE_REFRESH_TOKEN and client credentials."
        );
    }

    return nodemailer.createTransport({
        service: "gmail",
        auth: {
            type: "OAuth2",
            user: process.env.EMAIL_USER || "yummlydelivers@gmail.com",
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            refreshToken: process.env.GOOGLE_REFRESH_TOKEN,
            accessToken: accessToken,
        },
    });
}

// In-memory OTP store (in production, use Redis or database)
const otpStore = new Map();

// --- Health check ---
app.get("/ping", (req, res) => res.json({ ok: true }));

// --- Send Registration OTP ---
app.post("/auth/send-registration-otp", async (req, res) => {
    try {
        const { name, email, password } = req.body;
        if (!name || !email || !password) {
            return res.status(400).json({ error: "All fields are required" });
        }

        const emailLower = email.trim().toLowerCase();

        // Check if email already exists
        const [rows] = await pool.query(
            "SELECT id FROM users WHERE LOWER(email) = ?",
            [emailLower]
        );
        if (rows.length) {
            return res.status(400).json({ error: "Email already exists" });
        }

        // Generate OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();

        // Store registration data with OTP
        otpStore.set(emailLower, {
            otp,
            expires: Date.now() + 5 * 60 * 1000, // 5 minutes
            registrationData: { name, email: emailLower, password },
        });

        // Send OTP email
        const transporter = await createTransporter();
        await transporter.sendMail({
            from: "yummlydelivers@gmail.com",
            to: emailLower,
            subject: "Yummly Registration OTP",
            text: `Your OTP for registration is ${otp}. It will expire in 5 minutes.`,
        });

        res.json({ ok: true, message: "OTP sent to your email" });
    } catch (err) {
        console.error("Send registration OTP error:", err);
        res.status(500).json({ error: "Server error" });
    }
});

// --- Register ---
app.post("/auth/register", async (req, res) => {
    try {
        const { email, otp } = req.body;
        if (!email || !otp) {
            return res
                .status(400)
                .json({ error: "Email and OTP are required" });
        }

        const emailLower = email.trim().toLowerCase();
        const stored = otpStore.get(emailLower);

        if (!stored || stored.otp !== otp || Date.now() > stored.expires) {
            return res.status(400).json({ error: "Invalid or expired OTP" });
        }

        if (!stored.registrationData) {
            return res
                .status(400)
                .json({ error: "No registration data found" });
        }

        const { name, password } = stored.registrationData;

        // Create the user
        const hash = await bcrypt.hash(password, 8);
        const [resu] = await pool.query(
            "INSERT INTO users (name,email,password,role) VALUES (?,?,?,?)",
            [name, emailLower, hash, "user"]
        );

        const user = {
            id: resu.insertId,
            name,
            email: emailLower,
            role: "user",
        };

        // Clean up OTP store
        otpStore.delete(emailLower);

        res.json({ user });
    } catch (err) {
        console.error("Register error:", err);
        res.status(500).json({ error: "Server error" });
    }
});

// --- Login ---
app.post("/auth/login", async (req, res) => {
    try {
        const { email, password } = req.body;
        const [rows] = await pool.query(
            "SELECT id,name,email,role,password FROM users WHERE LOWER(email)=LOWER(?)",
            [email]
        );
        const user = rows[0];
        if (!user)
            return res.status(400).json({ error: "Invalid credentials" });

        const ok = await bcrypt.compare(password, user.password);
        if (!ok) return res.status(400).json({ error: "Invalid credentials" });

        delete user.password;
        res.json({ user });
    } catch (err) {
        console.error("Login error:", err);
        res.status(500).json({ error: "Server error" });
    }
});

// --- Forgot Password ---
app.post("/auth/forgot-password", async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ error: "Email is required" });
        }

        const emailLower = email.trim().toLowerCase();

        const [rows] = await pool.query(
            "SELECT id, name FROM users WHERE LOWER(email) = ?",
            [emailLower]
        );

        if (rows.length === 0) {
            return res.status(400).json({ error: "Account not found" });
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();

        otpStore.set(emailLower, {
            otp,
            expires: Date.now() + 5 * 60 * 1000,
            userId: rows[0].id,
        });
        const transporter = await createTransporter();
        await transporter.sendMail({
            from: "yummlydelivers@gmail.com",
            to: emailLower,
            subject: "Yummly Password Reset OTP",
            text: `Your OTP is ${otp}`,
        });

        res.json({ ok: true, message: "OTP sent to your email" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
});

// --- Verify OTP ---
app.post("/auth/verify-otp", async (req, res) => {
    try {
        const { email, otp } = req.body;
        if (!email || !otp) {
            return res
                .status(400)
                .json({ error: "Email and OTP are required" });
        }

        const emailLower = email.trim().toLowerCase();
        const stored = otpStore.get(emailLower);
        if (!stored || stored.otp !== otp || Date.now() > stored.expires) {
            return res.status(400).json({ error: "Invalid or expired OTP" });
        }

        // OTP verified, generate a reset token (simple approach)
        const resetToken = Math.random().toString(36).substring(2);
        stored.resetToken = resetToken;
        stored.resetExpires = Date.now() + 10 * 60 * 1000; // 10 minutes for reset

        otpStore.set(emailLower, stored);

        res.json({ ok: true, resetToken });
    } catch (err) {
        console.error("Verify OTP error:", err);
        res.status(500).json({ error: "Server error" });
    }
});

// --- Reset Password ---
app.post("/auth/reset-password", async (req, res) => {
    try {
        const { email, resetToken, newPassword } = req.body;
        if (!email || !resetToken || !newPassword) {
            return res.status(400).json({ error: "All fields are required" });
        }

        const emailLower = email.trim().toLowerCase();
        const stored = otpStore.get(emailLower);
        if (
            !stored ||
            stored.resetToken !== resetToken ||
            Date.now() > stored.resetExpires
        ) {
            return res
                .status(400)
                .json({ error: "Invalid or expired reset token" });
        }

        // Hash new password
        const hash = await bcrypt.hash(newPassword, 8);

        // Update password
        await pool.query("UPDATE users SET password = ? WHERE id = ?", [
            hash,
            stored.userId,
        ]);

        // Clear OTP store
        otpStore.delete(emailLower);
        res.json({ ok: true, message: "Password reset successfully" });
    } catch (err) {
        console.error("Reset password error:", err);
        res.status(500).json({ error: "Failed to reset password" });
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
        const transporter = await createTransporter();
        await transporter.sendMail({
            from: "yummlydelivers@gmail.com",
            to: user.email,
            subject: `Yummly Receipt - Order #${orderId}`,
            html: receiptHtml,
        });

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
        // Log database connection info (mask password)
        console.log("🗄️  Database Config:");
        console.log(`   Host: ${DB_HOST}`);
        console.log(`   User: ${DB_USER}`);
        console.log(`   Database: ${DB_NAME}`);

        // Warn if Gmail OAuth environment variables are missing
        const requiredEnv = [
            "GOOGLE_CLIENT_ID",
            "GOOGLE_CLIENT_SECRET",
            "GOOGLE_REFRESH_TOKEN",
            "EMAIL_USER",
        ];
        const missing = requiredEnv.filter((k) => !process.env[k]);
        if (missing.length) {
            console.warn(
                "⚠️ Missing environment variables for Gmail OAuth:",
                missing.join(", "),
                "\nEmails using Gmail API will fail until these are set."
            );
        } else {
            console.log("✅ All Gmail OAuth variables set");
        }

        await initDb();
        app.listen(PORT, () => console.log("✅ Server started on port", PORT));
    } catch (e) {
        console.error("❌ Failed to start server", e.message);
        console.error("Full error:", e);
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

        // create transporter once for this request
        const transporter = await createTransporter();

        // 🔥 SEND EMAIL IF OUT FOR DELIVERY
        if (status === "picked_up") {
            await transporter.sendMail({
                from: process.env.EMAIL_USER || "yummlydelivers@gmail.com",
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

        // 🔥 SEND EMAIL IF DELIVERED
        if (status === "delivered") {
            await transporter.sendMail({
                from: process.env.EMAIL_USER || "yummlydelivers@gmail.com",
                to: order.email,
                subject: `Your Order has been Delivered! ✅`,
                html: `
<div style="font-family: Arial; padding:20px;">
    <h2 style="color:#4CAF50;">Yummly Order Delivered! ✅</h2>
    <p>Hello <b>${order.name}</b>,</p>

    <p>Great news! Your order <strong>YM${String(orderId).padStart(
        5,
        "0"
    )}</strong> 
    has been <span style="color:#4CAF50; font-weight:bold;">
    Successfully Delivered</span>.</p>

    <p><strong>Delivered At:</strong> ${new Date().toLocaleString("en-IN")}</p>

    <p>We hope you enjoyed your meal! Your feedback is valuable to us.</p>

    <hr/>

    <p style="color:#666;">Thank you for choosing Yummly ❤️</p>
</div>
`,
            });
        }

        res.json({ success: true });
    } catch (err) {
        console.error(err);
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

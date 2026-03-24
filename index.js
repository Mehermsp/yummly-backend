const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, ".env") });

const axios = require("axios");

async function sendEmail(to, subject, htmlContent) {
    try {
        await axios.post(
            "https://api.brevo.com/v3/smtp/email",
            {
                sender: {
                    name: "Yummly",
                    email: "yummlydelivers@gmail.com",
                },
                to: [{ email: to }],
                subject: subject,
                htmlContent: htmlContent,
            },
            {
                headers: {
                    "api-key": process.env.BREVO_API_KEY,
                    "Content-Type": "application/json",
                },
            }
        );

        console.log("✅ Email sent to:", to);
    } catch (err) {
        console.error("❌ Brevo error:", err.response?.data || err.message);
        throw err;
    }
}

const formatDeliveryPartnerHtml = (partner) => `
    <div style="margin-top:20px; padding:16px; background:#fff4f4; border-radius:12px;">
      <h3 style="margin:0 0 10px; color:#E53935;">Delivery Partner Details</h3>
      <p style="margin:4px 0;"><strong>Name:</strong> ${partner.name}</p>
      <p style="margin:4px 0;"><strong>Phone:</strong> ${partner.phone || "Not available"}</p>
    </div>
`;

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
let availabilityColumnReady = false;
let mealTypeColumnReady = false;

async function ensureAvailabilityColumn() {
    if (availabilityColumnReady) {
        return;
    }

    const [availabilityColumn] = await pool.query(
        `
        SELECT COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = ?
        AND TABLE_NAME = 'users'
        AND COLUMN_NAME = 'is_available'
    `,
        [DB_NAME]
    );

    if (!availabilityColumn.length) {
        await pool.query(
            "ALTER TABLE users ADD COLUMN is_available TINYINT(1) NOT NULL DEFAULT 1"
        );
        console.log("Added users.is_available column");
    }

    availabilityColumnReady = true;
}

async function ensureMealTypeColumn() {
    if (mealTypeColumnReady) {
        return;
    }

    const [mealTypeColumn] = await pool.query(
        `
        SELECT COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = ?
        AND TABLE_NAME = 'menu'
        AND COLUMN_NAME = 'meal_type'
    `,
        [DB_NAME]
    );

    if (!mealTypeColumn.length) {
        await pool.query(
            "ALTER TABLE menu ADD COLUMN meal_type VARCHAR(30) NOT NULL DEFAULT 'Lunch' AFTER category"
        );
        console.log("Added menu.meal_type column");

        await pool.query(`
            UPDATE menu
            SET meal_type = CASE
                WHEN LOWER(name) REGEXP 'dosa|idli|uttapam|vada|sambhar|sambar|chai|coffee|lassi|sandwich'
                    OR category = 'South Indian'
                THEN 'Breakfast'
                WHEN LOWER(name) REGEXP 'samosa|roll|fries|65|tikka|vada pav|spring|brownie|jamun|jalebi|kulfi|rasmalai|ice cream|soda|lemonade'
                    OR category IN ('Street Food', 'Street', 'Starters', 'Dessert', 'Drinks')
                THEN 'Snacks'
                WHEN LOWER(name) REGEXP 'pizza|noodles|fried rice|chicken|fish|mutton|prawn|chettinad|tandoori|butter chicken'
                THEN 'Dinner'
                ELSE 'Lunch'
            END
        `);
    }

    mealTypeColumnReady = true;
}

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
    await pool.query(`
        CREATE TABLE IF NOT EXISTS wishlists (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            menu_id INT,
            name VARCHAR(255),
            price DECIMAL(10,2),
            image VARCHAR(1024),
            description TEXT,
            category VARCHAR(50),
            discount INT DEFAULT 0,
            KEY idx_user_id (user_id),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (menu_id) REFERENCES menu(id) ON DELETE SET NULL
        )
    `);

    await ensureAvailabilityColumn();
    await ensureMealTypeColumn();
}

// Email transporter (configure with your email service)

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
            emailService: "Brevo",
            brevoKey: process.env.BREVO_API_KEY ? "configured" : "missing",
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
            `INSERT INTO otp_codes (email, otp, type, expires_at, temp_name, temp_password)
   VALUES (?,?,?,?,?,?)`,
            [emailLower, otp, "registration", expires, name, password]
        );

       await sendEmail(
           emailLower,
           "Verify Your Yummly Account",
           `
  <div style="font-family: 'Segoe UI', Arial; background:#f4f6fb; padding:40px 20px;">
    <div style="max-width:520px; margin:auto; background:#ffffff; padding:35px; border-radius:16px; box-shadow:0 10px 30px rgba(0,0,0,0.08);">
      
      <div style="text-align:center;">
        <h1 style="margin:0; color:#E53935;">🍽️ Yummly</h1>
        <p style="color:#777; margin-top:6px;">Delicious food delivered fast</p>
      </div>

      <hr style="margin:25px 0; border:none; border-top:1px solid #eee;" />

      <h2 style="color:#333;">Verify Your Account</h2>

      <p style="color:#555; line-height:1.6;">
        Welcome to Yummly! Use the OTP below to verify your account.
      </p>

      <div style="text-align:center; margin:35px 0;">
        <div style="display:inline-block; padding:18px 35px; 
            font-size:34px; letter-spacing:8px; 
            font-weight:bold; 
            color:#E53935; 
            background:#fff3f3; 
            border-radius:12px;">
          ${otp}
        </div>
      </div>

      <p style="font-size:14px; color:#777;">
        This OTP is valid for 5 minutes.
      </p>

      <hr style="margin:25px 0; border:none; border-top:1px solid #eee;" />

      <p style="font-size:13px; color:#999;">
        If you did not request this, please ignore this email.
      </p>

      <p style="font-size:12px; color:#bbb; text-align:center; margin-top:20px;">
        © ${new Date().getFullYear()} Yummly. All rights reserved.
      </p>

    </div>
  </div>
  `
       );

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
            `SELECT * FROM otp_codes 
             WHERE email=? AND otp=? AND type='registration' 
             ORDER BY id DESC LIMIT 1`,
            [emailLower, otp]
        );

        if (!rows.length || new Date(rows[0].expires_at) < new Date()) {
            return res.status(400).json({ error: "Invalid or expired OTP" });
        }

        const tempName = rows[0].temp_name;
        const tempPassword = rows[0].temp_password;

        const hash = await bcrypt.hash(tempPassword, 8);

        const [result] = await pool.query(
            "INSERT INTO users (name,email,password,role) VALUES (?,?,?,?)",
            [tempName, emailLower, hash, "user"]
        );

        await pool.query("DELETE FROM otp_codes WHERE email=?", [emailLower]);

        res.json({
            user: {
                id: result.insertId,
                name: tempName,
                email: emailLower,
                role: "user",
            },
        });
    } catch (err) {
        console.error("Registration error:", err);
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

       await sendEmail(
           emailLower,
           "Reset Your Yummly Password",
           `
  <div style="font-family:'Segoe UI', Arial; background:#f4f6fb; padding:40px 20px;">
    <div style="max-width:520px; margin:auto; background:#ffffff; padding:35px; border-radius:16px; box-shadow:0 10px 30px rgba(0,0,0,0.08);">

      <div style="text-align:center;">
        <h1 style="margin:0; color:#4CAF50;">🔐 Password Reset</h1>
      </div>

      <hr style="margin:25px 0; border:none; border-top:1px solid #eee;" />

      <p style="color:#555; line-height:1.6;">
        We received a request to reset your Yummly password.
      </p>

      <div style="text-align:center; margin:35px 0;">
        <div style="display:inline-block; padding:18px 35px; 
            font-size:34px; letter-spacing:8px; 
            font-weight:bold; 
            color:#4CAF50; 
            background:#e8f5e9; 
            border-radius:12px;">
          ${otp}
        </div>
      </div>

      <p style="font-size:14px; color:#777;">
        This OTP will expire in 5 minutes.
      </p>

      <p style="font-size:13px; color:#999;">
        If you didn’t request this reset, your account is still secure.
      </p>

      <p style="font-size:12px; color:#bbb; text-align:center; margin-top:20px;">
        © ${new Date().getFullYear()} Yummly
      </p>

    </div>
  </div>
  `
       );

        res.json({ ok: true, message: "OTP sent successfully" });
    } catch (err) {
        console.error("Forgot Password OTP Error:", err);
        res.status(500).json({ error: "Failed to send OTP" });
    }
});
//test mail
app.get("/test-email", async (req, res) => {
    try {
        await sendEmail(
            "yummlydelivers@gmail.com",
            "Brevo Test",
            "<h2>Brevo is working 🚀</h2>"
        );

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
    await ensureMealTypeColumn();
    const [rows] = await pool.query(
        "SELECT id, name, description, price, image, category, meal_type, season, rating, discount, popularity FROM menu"
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
<div style="font-family:'Segoe UI', Arial; background:#f4f6fb; padding:40px 20px;">
  <div style="max-width:650px; margin:auto; background:#ffffff; padding:35px; border-radius:16px; box-shadow:0 10px 30px rgba(0,0,0,0.08);">

    <div style="text-align:center;">
      <h1 style="margin:0; color:#E53935;">🍽️ Yummly</h1>
      <p style="color:#777;">Order Receipt</p>
    </div>

    <hr style="margin:25px 0; border:none; border-top:1px solid #eee;" />

    <p><strong>Order ID:</strong> YM${String(orderId).padStart(5, "0")}</p>
    <p><strong>Payment Method:</strong> ${paymentMethod.toUpperCase()}</p>
    <p><strong>Total Paid:</strong> ₹${total}</p>

    <h3 style="margin-top:25px;">🛒 Ordered Items</h3>

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
          <td align="right">₹${it.price * it.qty}</td>
        </tr>
      `
          )
          .join("")}
    </table>

    <h3 style="margin-top:25px;">🏠 Delivery Address</h3>
    <p style="color:#555;">
      ${doorNo}, ${street}, ${area || ""}<br/>
      ${city}, ${state} - ${zipCode}
    </p>

    <hr style="margin:30px 0;" />

    <p style="text-align:center; color:#4CAF50; font-weight:600;">
      Your food is being prepared 👨‍🍳
    </p>

    <p style="font-size:12px; color:#bbb; text-align:center;">
      © ${new Date().getFullYear()} Yummly
    </p>

  </div>
</div>
`;

        // 🔥 SEND EMAIL
        // 🔥 SEND EMAIL (safe mode)
        try {
            await sendEmail(
                user.email,
                `Yummly Receipt - Order #${orderId}`,
                receiptHtml
            );
            console.log("✅ Receipt email sent");
        } catch (emailErr) {
            console.error("⚠️ Email failed but order saved:", emailErr.message);
        }
        // 🔥 SEND ADMIN NOTIFICATION
        try {
            const [admins] = await pool.query(
                "SELECT email, name FROM users WHERE role = 'admin'"
            );

            const adminHtml = `
    <div style="font-family:'Segoe UI', Arial; background:#f4f6fb; padding:40px 20px;">
      <div style="max-width:600px; margin:auto; background:#fff; padding:35px; border-radius:16px; box-shadow:0 10px 30px rgba(0,0,0,0.08);">

        <h2 style="color:#E53935;">🛎️ New Order Received!</h2>

        <p>A new order has been placed on Yummly.</p>

        <hr style="margin:20px 0;" />

        <p><strong>Order ID:</strong> YM${String(orderId).padStart(5, "0")}</p>
        <p><strong>Customer:</strong> ${user.name}</p>
        <p><strong>Total Amount:</strong> ₹${total}</p>
        <p><strong>Payment:</strong> ${paymentMethod.toUpperCase()}</p>

        <hr style="margin:20px 0;" />

        <h3>📍 Delivery Address</h3>
        <p style="color:#555;">
          ${doorNo}, ${street}, ${area || ""}<br/>
          ${city}, ${state} - ${zipCode}
        </p>

        <hr style="margin:20px 0;" />

        <p style="color:#FF9800; font-weight:600;">
          Please assign a delivery partner as soon as possible.
        </p>

        <p style="font-size:12px; color:#bbb; text-align:center;">
          © ${new Date().getFullYear()} Yummly
        </p>

      </div>
    </div>
    `;

            await Promise.all(
                admins.map((admin) =>
                    sendEmail(
                        admin.email,
                        `🛎️ New Order - YM${String(orderId).padStart(5, "0")}`,
                        adminHtml
                    )
                )
            );

            console.log("✅ Admin notification sent");
        } catch (adminEmailErr) {
            console.error("⚠️ Admin email failed:", adminEmailErr.message);
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

// --- Save or update wishlist ---
app.post("/wishlist", async (req, res) => {
    const { userId, items } = req.body;
    if (!userId) return res.status(400).json({ error: "Missing userId" });

    await pool.query("DELETE FROM wishlists WHERE user_id = ?", [userId]);
    if (items && items.length) {
        const promises = items.map((it) =>
            pool.query(
                `INSERT INTO wishlists
                (user_id, menu_id, name, price, image, description, category, discount)
                VALUES (?,?,?,?,?,?,?,?)`,
                [
                    userId,
                    it.id,
                    it.name,
                    it.price,
                    it.image || null,
                    it.description || null,
                    it.category || null,
                    it.discount || 0,
                ]
            )
        );
        await Promise.all(promises);
    }
    res.json({ ok: true });
});

// --- Get wishlist ---
app.get("/wishlist/:userId", async (req, res) => {
    const userId = req.params.userId;
    const [rows] = await pool.query(
        `SELECT menu_id as id, name, price, image, description, category, discount
         FROM wishlists WHERE user_id = ?`,
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
            SELECT o.*, u.name, u.email,
                   db.name as delivery_boy_name,
                   db.phone as delivery_boy_phone,
                   db.email as delivery_boy_email
            FROM orders o
            JOIN users u ON o.user_id = u.id
            LEFT JOIN users db ON o.delivery_boy_id = db.id
        `;

        const params = [];

        if (startDate && endDate) {
            query += ` WHERE DATE(o.created_at) BETWEEN ? AND ?`;
            params.push(startDate, endDate);
        }

        query += ` ORDER BY o.created_at DESC`;

        const [orders] = await pool.query(query, params);

        if (!orders.length) {
            return res.json([]);
        }

        const orderIds = orders.map((order) => order.id);
        const [items] = await pool.query(
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
// --- Admin Revenue Summary ---
app.get("/admin/revenue-summary", isAdmin, async (req, res) => {
    try {
        const { startDate, endDate } = req.query;

        let dateFilter = "";
        const params = [];

        if (startDate && endDate) {
            dateFilter = "AND DATE(created_at) BETWEEN ? AND ?";
            params.push(startDate, endDate);
        }

        const [orders] = await pool.query(
            `
            SELECT id, total, delivery_boy_id
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

        const deliveryIncomePerOrder = 40; // fixed
        const totalDeliveryIncome =
            orders.length * deliveryIncomePerOrder;

        const preparationCost = totalRevenue * 0.6;

        const profit =
            totalRevenue - totalDeliveryIncome - preparationCost;

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
    const normalizedPhone =
        typeof phone === "string" ? phone.trim() : phone;

    if (typeof phone !== "undefined" && !normalizedPhone) {
        return res.status(400).json({ error: "Phone number is required" });
    }

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
        params.push(normalizedPhone);
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
        "SELECT id,name,email,phone,role FROM users WHERE id = ?",
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
        await ensureAvailabilityColumn();
        const orderId = parseInt(req.params.id);
        const { deliveryBoyId } = req.body;

        const [rows] = await pool.query(
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

        const [deliveryRows] = await pool.query(
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

        await pool.query(
            `
            UPDATE orders 
            SET delivery_boy_id = ?, 
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
      Order total: ₹${order.total}
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
app.get("/delivery/availability", async (req, res) => {
    try {
        await ensureAvailabilityColumn();
        const userId = req.headers.userid;

        const [rows] = await pool.query(
            `SELECT is_available
             FROM users
             WHERE id = ?
             AND LOWER(TRIM(role)) = 'delivery'`,
            [userId]
        );

        if (!rows.length) {
            return res.status(404).json({ error: "Delivery boy not found" });
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

        const [result] = await pool.query(
            `UPDATE users
             SET is_available = ?
             WHERE id = ?
             AND LOWER(TRIM(role)) = 'delivery'`,
            [isAvailable ? 1 : 0, userId]
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
                await sendEmail(
                    order.email,
                    "Your Order is Out for Delivery 🚚",
                    `
  <div style="font-family:'Segoe UI', Arial; background:#f4f6fb; padding:40px 20px;">
    <div style="max-width:520px; margin:auto; background:#fff; padding:35px; border-radius:16px; box-shadow:0 10px 30px rgba(0,0,0,0.08);">
      <h2 style="color:#FF9800;">🚚 Out for Delivery!</h2>
      <p>Your Yummly order is on the way.</p>
      <p>Please keep your phone available for delivery updates.</p>
      <p style="color:#777;">Enjoy your meal! 😋</p>
    </div>
  </div>
  `
                );
            }

            if (status === "delivered") {
                await sendEmail(
                    order.email,
                    "Your Order has been Delivered! ✅",
                    `
  <div style="font-family:'Segoe UI', Arial; background:#f4f6fb; padding:40px 20px;">
    <div style="max-width:520px; margin:auto; background:#fff; padding:35px; border-radius:16px; box-shadow:0 10px 30px rgba(0,0,0,0.08);">
      <h2 style="color:#4CAF50;">✅ Delivered Successfully</h2>
      <p>Your order has been delivered.</p>
      <p>We hope you enjoy your meal ❤️</p>
      <p style="color:#777;">Thank you for choosing Yummly.</p>
    </div>
  </div>
  `
                );
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
    await ensureAvailabilityColumn();
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
// --- Delivery Boy Income ---
app.get("/delivery/income", async (req, res) => {
    try {
        const userId = req.headers.userid;

        const [orders] = await pool.query(
            `
            SELECT id, total, created_at
            FROM orders
            WHERE delivery_boy_id = ?
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
//get all delivery boys
// --- Get All Delivery Boys ---
app.get("/admin/delivery-boys", isAdmin, async (req, res) => {
    try {
        await ensureAvailabilityColumn();
        const [rows] = await pool.query(`
            SELECT 
                u.id,
                u.name,
                u.email,
                u.phone,
                u.is_available,
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
app.put("/admin/delivery-boys/:id/availability", isAdmin, async (req, res) => {
    try {
        await ensureAvailabilityColumn();
        const deliveryBoyId = parseInt(req.params.id);
        const { isAvailable } = req.body;

        const [result] = await pool.query(
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
app.use("/uploads", express.static("uploads"));
start();

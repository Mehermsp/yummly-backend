const bcrypt = require("bcryptjs");

const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PASSWORD_POLICY_REGEX =
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[^\s]{8,128}$/;

function normalizeOtp(value) {
    return String(value || "").replace(/\D/g, "").slice(0, 6);
}

function normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
}

async function createSession(req, user) {
    if (!req.session) return;
    req.session.userId = user.id;
    req.session.userRole = user.role;
    await new Promise((resolve, reject) => {
        req.session.save((err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

function registerAuthRoutes(app, { getPool, sendEmail }) {
    app.post("/auth/send-login-otp", async (req, res) => {
        try {
            const { identifier } = req.body;
            if (!identifier)
                return res
                    .status(400)
                    .json({ error: "Email or phone is required" });

            const rawIdentifier = String(identifier).trim();
            if (rawIdentifier.length < 3 || rawIdentifier.length > 120) {
                return res.status(400).json({ error: "Invalid identifier" });
            }
            const isEmail = EMAIL_REGEX.test(rawIdentifier);
            const normalizedIdentifier = isEmail
                ? normalizeEmail(rawIdentifier)
                : rawIdentifier;

            const [users] = await getPool().query(
                `SELECT id, name, email, phone, role FROM users
                 WHERE phone = ? OR LOWER(email) = LOWER(?)`,
                [rawIdentifier, normalizedIdentifier]
            );

            if (!users.length) {
                return res.status(404).json({ error: "User not found" });
            }

            const user = users[0];
            const otp = Math.floor(100000 + Math.random() * 900000).toString();
            const expires = new Date(Date.now() + 5 * 60 * 1000);

            await getPool().query(
                isEmail
                    ? "DELETE FROM otp_codes WHERE email = ? AND type = 'login'"
                    : "DELETE FROM otp_codes WHERE phone = ? AND type = 'login'",
                [normalizedIdentifier]
            );

            await getPool().query(
                "INSERT INTO otp_codes (email, phone, otp, type, user_id, expires_at) VALUES (?,?,?,?,?,?)",
                [
                    isEmail ? normalizedIdentifier : null,
                    !isEmail ? normalizedIdentifier : null,
                    otp,
                    "login",
                    user.id,
                    expires,
                ]
            );

            if (isEmail) {
                await sendEmail(
                    normalizedIdentifier,
                    "Your TastieKit login code",
                    `
      <div style="font-family: 'Segoe UI', Arial; background:#f4f6fb; padding:40px 20px;">
        <div style="max-width:520px; margin:auto; background:#ffffff; padding:35px; border-radius:16px; box-shadow:0 10px 30px rgba(0,0,0,0.08);">
          <div style="text-align:center;">
            <h1 style="margin:0; color:#E53935;">TastieKit</h1>
            <p style="color:#777; margin-top:6px;">Use the code below to sign in.</p>
          </div>
          <hr style="margin:25px 0; border:none; border-top:1px solid #eee;" />
          <h2 style="color:#333;">Sign in to your account</h2>
          <p style="color:#555; line-height:1.6;">
            Use the one-time login code below to continue.
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
            This code is valid for 5 minutes.
          </p>
          <hr style="margin:25px 0; border:none; border-top:1px solid #eee;" />
          <p style="font-size:13px; color:#999;">
            If you did not request this, please ignore this email.
          </p>
        </div>
      </div>
      `
                );

                return res.json({
                    ok: true,
                    message: "OTP sent to your email address",
                });
            }

            console.log(`Login OTP for ${normalizedIdentifier}: ${otp}`);
            const payload = { ok: true, message: "OTP sent successfully" };
            if (process.env.NODE_ENV !== "production") {
                payload.otp = otp;
            }
            res.json(payload);
        } catch (err) {
            console.error("Login OTP Error:", err);
            res.status(500).json({ error: "Failed to send OTP" });
        }
    });

    app.post("/auth/verify-login-otp", async (req, res) => {
        try {
            const { identifier, otp } = req.body;
            if (!identifier || !otp)
                return res
                    .status(400)
                    .json({ error: "Email/phone and OTP are required" });

            const rawIdentifier = String(identifier).trim();
            const normalizedOtp = normalizeOtp(otp);
            if (normalizedOtp.length !== 6) {
                return res.status(400).json({ error: "Invalid OTP format" });
            }
            const isEmail = EMAIL_REGEX.test(rawIdentifier);
            const normalizedIdentifier = isEmail
                ? normalizeEmail(rawIdentifier)
                : rawIdentifier;
            const query = isEmail
                ? `SELECT * FROM otp_codes
                 WHERE email = ?
                 AND otp = ?
                 AND type = 'login'
                 AND expires_at > NOW()
                 ORDER BY id DESC LIMIT 1`
                : `SELECT * FROM otp_codes
                 WHERE phone = ?
                 AND otp = ?
                 AND type = 'login'
                 AND expires_at > NOW()
                 ORDER BY id DESC LIMIT 1`;
            const [rows] = await getPool().query(query, [
                normalizedIdentifier,
                normalizedOtp,
            ]);

            if (!rows.length) {
                return res
                    .status(400)
                    .json({ error: "Invalid or expired OTP" });
            }

            const [users] = await getPool().query(
                "SELECT id,name,email,phone,role FROM users WHERE id = ?",
                [rows[0].user_id]
            );

            if (!users.length) {
                return res.status(404).json({ error: "User not found" });
            }

            const user = users[0];

            await getPool().query("DELETE FROM otp_codes WHERE id = ?", [
                rows[0].id,
            ]);

            await createSession(req, user);

            let restaurant = null;
            if (user.role === "restaurant_partner") {
                // 🔍 Check application status first
                const [apps] = await getPool().query(
                    "SELECT status FROM restaurant_applications WHERE owner_id = ? ORDER BY id DESC LIMIT 1",
                    [user.id]
                );

                if (apps.length && apps[0].status === "pending") {
                    return res.status(403).json({
                        error: "Your application is still under review",
                    });
                }

                // 🔍 Check approved restaurant
                const [restaurants] = await getPool().query(
                    "SELECT * FROM restaurants WHERE owner_id = ? OR user_id = ? ORDER BY id ASC LIMIT 1",
                    [user.id, user.id]
                );

                if (!restaurants.length) {
                    return res.status(403).json({
                        error: "Your restaurant is not approved yet",
                    });
                }

                restaurant = restaurants[0];
            }

            res.json({ user, restaurant });
        } catch (err) {
            console.error("Verify login OTP error:", err);
            res.status(500).json({ error: "Failed to verify OTP" });
        }
    });

    app.post("/auth/register-restaurant", async (req, res) => {
        const conn = await getPool().getConnection();

        try {
            const {
                ownerName,
                phone,
                email,
                password,
                confirmPassword,
                name,
                address,
                city,
                area,
                pincode,
                landmark,
                cuisines,
                openTime,
                closeTime,
                daysOpen,
                fssai,
                gst,
                pan,
                logo,
            } = req.body;

            if (!ownerName || !phone || !name || !password) {
                return res
                    .status(400)
                    .json({ error: "Required fields missing" });
            }
            if (!PASSWORD_POLICY_REGEX.test(password)) {
                return res.status(400).json({
                    error: "Password must be 8+ chars with uppercase, lowercase and number",
                });
            }
            if (password !== confirmPassword) {
                return res
                    .status(400)
                    .json({ error: "Passwords do not match" });
            }

            const normalizedPhone = phone.trim();
            const normalizedEmail = email?.trim().toLowerCase() || null;
            if (normalizedEmail && !EMAIL_REGEX.test(normalizedEmail)) {
                return res.status(400).json({ error: "Invalid email format" });
            }

            const [existing] = await conn.query(
                "SELECT id FROM users WHERE phone = ? OR email = ?",
                [normalizedPhone, normalizedEmail]
            );

            if (existing.length) {
                return res.status(400).json({ error: "User already exists" });
            }

            const hash = await bcrypt.hash(password, 10);

            await conn.beginTransaction();

            // 👤 create user
            const [userResult] = await conn.query(
                "INSERT INTO users (name, email, phone, password, role) VALUES (?,?,?,?,?)",
                [
                    ownerName,
                    normalizedEmail,
                    normalizedPhone,
                    hash,
                    "restaurant_partner",
                ]
            );

            const userId = userResult.insertId;

            // Check if user already has a pending application
            const [existingApp] = await conn.query(
                "SELECT id FROM restaurant_applications WHERE owner_id = ? AND status = 'pending'",
                [userId]
            );

            if (existingApp.length) {
                await conn.rollback();
                return res.status(400).json({
                    error: "You already have a pending application",
                });
            }

            // 📝 create application
            await conn.query(
                `INSERT INTO restaurant_applications (
    owner_id, owner_name, email, phone,
    restaurant_name, address, city, pincode, landmark,
    cuisines, open_time, close_time, days_open,
    fssai, gst, pan, logo, status
  )
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                [
                    userId,
                    ownerName,
                    normalizedEmail,
                    normalizedPhone,
                    name, // frontend → restaurant_name
                    address || null,
                    city || null,
                    pincode || null,
                    landmark || null,
                    JSON.stringify(cuisines || []),
                    openTime ? `${openTime}:00` : null,
                    closeTime ? `${closeTime}:00` : null,
                    JSON.stringify(daysOpen || []),
                    fssai || null,
                    gst || null,
                    pan || null,
                    logo || null,
                    "pending",
                ]
            );
            await conn.commit();
            await createSession(req, {
                id: userId,
                role: "restaurant_partner",
            });

            res.json({
                message: "Application submitted. Wait for admin approval.",
                user: {
                    id: userId,
                    name: ownerName,
                    email: normalizedEmail,
                    phone: normalizedPhone,
                    role: "restaurant_partner",
                },
            });
        } catch (err) {
            await conn.rollback();
            console.error(err);
            res.status(500).json({ error: "Registration failed" });
        } finally {
            conn.release();
        }
    });
    app.get("/auth/application-status", async (req, res) => {
        try {
            const userId = req.headers.userid || req.session?.userId;

            if (!userId) {
                return res.status(401).json({ error: "Not authenticated" });
            }

            const [apps] = await getPool().query(
                `SELECT status, created_at 
             FROM restaurant_applications 
             WHERE owner_id = ? 
             ORDER BY id DESC LIMIT 1`,
                [userId]
            );

            if (!apps.length) {
                return res.json({ status: "none" });
            }

            res.json(apps[0]);
        } catch (err) {
            res.status(500).json({ error: "Failed to fetch status" });
        }
    });

    app.post("/auth/send-registration-otp", async (req, res) => {
        try {
            const { name, email, password } = req.body;
            if (!name || !email || !password)
                return res.status(400).json({ error: "All fields required" });
            if (!EMAIL_REGEX.test(normalizeEmail(email))) {
                return res.status(400).json({ error: "Invalid email format" });
            }
            if (!PASSWORD_POLICY_REGEX.test(password)) {
                return res.status(400).json({
                    error: "Password must be 8+ chars with uppercase, lowercase and number",
                });
            }

            const emailLower = normalizeEmail(email);

            const [exists] = await getPool().query(
                "SELECT id FROM users WHERE LOWER(email)=?",
                [emailLower]
            );

            if (exists.length)
                return res.status(400).json({ error: "Email already exists" });

            const otp = Math.floor(100000 + Math.random() * 900000).toString();
            const expires = new Date(Date.now() + 5 * 60 * 1000);

            await getPool().query(
                "DELETE FROM otp_codes WHERE email = ? AND type = 'registration'",
                [emailLower]
            );

            await getPool().query(
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
        <h1 style="margin:0; color:#E53935;">Yummly</h1>
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
        Copyright ${new Date().getFullYear()} Yummly. All rights reserved.
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

    app.post("/auth/register", async (req, res) => {
        try {
            const { email, otp } = req.body;
            if (!email || !otp) {
                return res.status(400).json({ error: "Email and OTP are required" });
            }
            const emailLower = normalizeEmail(email);
            const normalizedOtp = normalizeOtp(otp);
            if (!EMAIL_REGEX.test(emailLower)) {
                return res.status(400).json({ error: "Invalid email format" });
            }
            if (normalizedOtp.length !== 6) {
                return res.status(400).json({ error: "Invalid OTP format" });
            }

            const [rows] = await getPool().query(
                `SELECT * FROM otp_codes 
             WHERE email=? AND otp=? AND type='registration' AND expires_at > NOW()
              ORDER BY id DESC LIMIT 1`,
                [emailLower, normalizedOtp]
            );

            if (!rows.length) {
                return res
                    .status(400)
                    .json({ error: "Invalid or expired OTP" });
            }

            const tempName = rows[0].temp_name;
            const tempPassword = rows[0].temp_password;

            const hash = await bcrypt.hash(tempPassword, 8);

            const [result] = await getPool().query(
                "INSERT INTO users (name,email,password,role) VALUES (?,?,?,?)",
                [tempName, emailLower, hash, "customer"]
            );

            await createSession(req, { id: result.insertId, role: "customer" });
            await getPool().query("DELETE FROM otp_codes WHERE email=?", [
                emailLower,
            ]);

            res.json({
                user: {
                    id: result.insertId,
                    name: tempName,
                    email: emailLower,
                    role: "customer",
                },
            });
        } catch (err) {
            console.error("Registration error:", err);
            res.status(500).json({ error: "Registration failed" });
        }
    });

    app.post("/auth/login", async (req, res) => {
        try {
            const { email, password } = req.body;
            if (!email || !password) {
                return res
                    .status(400)
                    .json({ error: "Email and password are required" });
            }
            if (!EMAIL_REGEX.test(normalizeEmail(email))) {
                return res.status(400).json({ error: "Invalid email format" });
            }
            console.log("Login attempt for:", email);

            console.log("Executing database query...");
            const [rows] = await getPool().query(
                "SELECT id,name,email,phone,role,password FROM users WHERE LOWER(email)=LOWER(?)",
                [email]
            );

            console.log("Query completed, found users:", rows.length);
            const user = rows[0];
            if (!user) {
                console.log("No user found for:", email);
                return res.status(404).json({ error: "User not found" });
            }

            const ok = await bcrypt.compare(password, user.password);
            if (!ok) {
                console.log("Password mismatch for:", email);
                return res.status(400).json({ error: "Invalid credentials" });
            }

            delete user.password;
            await createSession(req, user);

            let restaurant = null;

            if (user.role === "restaurant_partner") {
                // 🔍 Check application status first
                const [apps] = await getPool().query(
                    "SELECT status FROM restaurant_applications WHERE owner_id = ? ORDER BY id DESC LIMIT 1",
                    [user.id]
                );

                if (apps.length && apps[0].status === "pending") {
                    return res.status(403).json({
                        error: "Your application is still under review",
                    });
                }

                // 🔍 Check approved restaurant
                const [restaurants] = await getPool().query(
                    "SELECT * FROM restaurants WHERE owner_id = ? OR user_id = ? ORDER BY id ASC LIMIT 1",
                    [user.id, user.id]
                );

                if (!restaurants.length) {
                    return res.status(403).json({
                        error: "Your restaurant is not approved yet",
                    });
                }

                restaurant = restaurants[0];
            }

            console.log("Login successful for:", email);
            res.json({ user, restaurant });
        } catch (err) {
            console.error("Login error:", err.message);
            console.error("Stack:", err.stack);
            res.status(500).json({ error: "Server error" });
        }
    });

    app.post("/auth/send-reset-otp", async (req, res) => {
        try {
            const { email } = req.body;
            if (!email)
                return res.status(400).json({ error: "Email required" });
            if (!EMAIL_REGEX.test(normalizeEmail(email))) {
                return res.status(400).json({ error: "Invalid email format" });
            }

            const emailLower = normalizeEmail(email);

            const [users] = await getPool().query(
                "SELECT id FROM users WHERE LOWER(email)=?",
                [emailLower]
            );

            if (!users.length)
                return res.status(400).json({ error: "Account not found" });

            const otp = Math.floor(100000 + Math.random() * 900000).toString();
            const expires = new Date(Date.now() + 5 * 60 * 1000);

            await getPool().query(
                "DELETE FROM otp_codes WHERE email = ? AND type = 'reset'",
                [emailLower]
            );

            await getPool().query(
                "INSERT INTO otp_codes (email, otp, type, user_id, expires_at) VALUES (?,?,?,?,?)",
                [emailLower, otp, "reset", users[0].id, expires]
            );

            await sendEmail(
                emailLower,
                "Reset Your TastieKit Password",
                `
  <div style="font-family:'Segoe UI', Arial; background:#f4f6fb; padding:40px 20px;">
    <div style="max-width:520px; margin:auto; background:#ffffff; padding:35px; border-radius:16px; box-shadow:0 10px 30px rgba(0,0,0,0.08);">

      <div style="text-align:center;">
        <h1 style="margin:0; color:#4CAF50;">Password Reset</h1>
      </div>

      <hr style="margin:25px 0; border:none; border-top:1px solid #eee;" />

      <p style="color:#555; line-height:1.6;">
        We received a request to reset your TastieKit password.
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
        If you didn't request this reset, your account is still secure.
      </p>

      <p style="font-size:12px; color:#bbb; text-align:center; margin-top:20px;">
        Copyright ${new Date().getFullYear()} TastieKit
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

    app.post("/auth/verify-reset-otp", async (req, res) => {
        try {
            const { email, otp } = req.body;
            const emailLower = normalizeEmail(email);
            const normalizedOtp = normalizeOtp(otp);
            if (normalizedOtp.length !== 6) {
                return res.status(400).json({ error: "Invalid OTP format" });
            }

            const [rows] = await getPool().query(
                `SELECT * FROM otp_codes WHERE email=? AND otp=? AND type='reset' AND expires_at > NOW() ORDER BY id DESC LIMIT 1`,
                [emailLower, normalizedOtp]
            );

            if (!rows.length) {
                return res
                    .status(400)
                    .json({ error: "Invalid or expired OTP" });
            }

            res.json({
                ok: true,
                message: "OTP verified",
                userId: rows[0].user_id,
            });
        } catch (err) {
            console.error("Verify reset OTP error:", err);
            res.status(500).json({ error: "Verification failed" });
        }
    });

    app.post("/auth/reset-password-otp", async (req, res) => {
        try {
            const { email, otp, newPassword } = req.body;
            const emailLower = normalizeEmail(email);
            const normalizedOtp = normalizeOtp(otp);

            if (!PASSWORD_POLICY_REGEX.test(newPassword || "")) {
                return res.status(400).json({
                    error: "Password must be 8+ chars with uppercase, lowercase and number",
                });
            }
            if (normalizedOtp.length !== 6) {
                return res.status(400).json({ error: "Invalid OTP format" });
            }

            const [rows] = await getPool().query(
                `SELECT * FROM otp_codes WHERE email=? AND otp=? AND type='reset' AND expires_at > NOW() ORDER BY id DESC LIMIT 1`,
                [emailLower, normalizedOtp]
            );

            if (!rows.length) {
                return res
                    .status(400)
                    .json({ error: "Invalid or expired OTP" });
            }

            const hash = await bcrypt.hash(newPassword, 10);

            await getPool().query(
                "UPDATE users SET password = ? WHERE id = ?",
                [hash, rows[0].user_id]
            );

            await getPool().query("DELETE FROM otp_codes WHERE email = ?", [
                emailLower,
            ]);

            res.json({ ok: true, message: "Password reset successful" });
        } catch (err) {
            console.error("Reset password error:", err);
            res.status(500).json({ error: "Reset failed" });
        }
    });

    app.post("/auth/logout", async (req, res) => {
        if (req.session) {
            req.session.destroy();
        }
        res.json({ ok: true, message: "Logged out successfully" });
    });

    app.get("/auth/me", async (req, res) => {
        try {
            const userId = req.headers.userid || req.session?.userId;
            if (!userId) {
                return res.status(401).json({ error: "Not authenticated" });
            }

            const [users] = await getPool().query(
                "SELECT id, name, email, phone, role FROM users WHERE id = ?",
                [userId]
            );

            if (!users.length) {
                return res.status(401).json({ error: "User not found" });
            }

            const user = users[0];
            let restaurant = null;
            if (user.role === "restaurant_partner") {
                const [restaurants] = await getPool().query(
                    "SELECT * FROM restaurants WHERE owner_id = ? OR user_id = ? ORDER BY id ASC LIMIT 1",
                    [user.id, user.id]
                );
                restaurant = restaurants[0] || null;
            }

            res.json({ user, restaurant });
        } catch (err) {
            console.error("Auth me error:", err);
            res.status(500).json({ error: "Server error" });
        }
    });

    app.get("/auth/test-email", async (req, res) => {
        try {
            if (process.env.NODE_ENV === "production") {
                return res.status(404).json({ error: "Not found" });
            }
            await sendEmail(
                "yummlydelivers@gmail.com",
                "Brevo Test",
                "<h2>Brevo is working</h2>"
            );

            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    app.post("/auth/verify-otp", async (req, res) => {
        try {
            const { email, otp } = req.body;
            const emailLower = normalizeEmail(email);
            const normalizedOtp = normalizeOtp(otp);
            if (normalizedOtp.length !== 6) {
                return res.status(400).json({ error: "Invalid OTP format" });
            }

            const [rows] = await getPool().query(
                "SELECT * FROM otp_codes WHERE email=? AND otp=? AND type='reset' AND expires_at > NOW() ORDER BY id DESC LIMIT 1",
                [emailLower, normalizedOtp]
            );

            if (!rows.length)
                return res
                    .status(400)
                    .json({ error: "Invalid or expired OTP" });

            const resetToken = Math.random().toString(36).substring(2);
            const resetExpires = new Date(Date.now() + 10 * 60 * 1000);

            await getPool().query(
                "UPDATE otp_codes SET reset_token=?, reset_expires=? WHERE id=?",
                [resetToken, resetExpires, rows[0].id]
            );

            res.json({ ok: true, resetToken });
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: "OTP verification failed" });
        }
    });

    app.post("/auth/reset-password", async (req, res) => {
        try {
            const { email, resetToken, newPassword } = req.body;
            if (!PASSWORD_POLICY_REGEX.test(newPassword || "")) {
                return res.status(400).json({
                    error: "Password must be 8+ chars with uppercase, lowercase and number",
                });
            }
            const emailLower = normalizeEmail(email);

            const [rows] = await getPool().query(
                "SELECT * FROM otp_codes WHERE email=? AND reset_token=? ORDER BY id DESC LIMIT 1",
                [emailLower, resetToken]
            );

            if (!rows.length || new Date(rows[0].reset_expires) < new Date())
                return res
                    .status(400)
                    .json({ error: "Invalid or expired token" });

            const hash = await bcrypt.hash(newPassword, 8);

            await getPool().query("UPDATE users SET password=? WHERE id=?", [
                hash,
                rows[0].user_id,
            ]);

            await getPool().query("DELETE FROM otp_codes WHERE email=?", [
                emailLower,
            ]);

            res.json({ ok: true, message: "Password reset successfully" });
        } catch (err) {
            console.error("Reset failed error:", err);
            res.status(500).json({ error: "Reset failed" });
        }
    });

    app.get("/test-email", async (req, res) => {
        try {
            if (process.env.NODE_ENV === "production") {
                return res.status(404).json({ error: "Not found" });
            }
            await sendEmail(
                "tastiekit@gmail.com",
                "Brevo Test",
                "<h2>Brevo is working</h2>"
            );

            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
}

module.exports = registerAuthRoutes;

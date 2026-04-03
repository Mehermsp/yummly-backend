const bcrypt = require("bcryptjs");

function registerAuthRoutes(app, { getPool, sendEmail }) {
    app.post("/auth/send-registration-otp", async (req, res) => {
        try {
            const { name, email, password } = req.body;
            if (!name || !email || !password)
                return res.status(400).json({ error: "All fields required" });

            const emailLower = email.trim().toLowerCase();

            const [exists] = await getPool().query(
                "SELECT id FROM users WHERE LOWER(email)=?",
                [emailLower]
            );

            if (exists.length)
                return res.status(400).json({ error: "Email already exists" });

            const otp = Math.floor(100000 + Math.random() * 900000).toString();
            const expires = new Date(Date.now() + 5 * 60 * 1000);

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
            const emailLower = email.trim().toLowerCase();

            const [rows] = await getPool().query(
                `SELECT * FROM otp_codes 
             WHERE email=? AND otp=? AND type='registration' 
             ORDER BY id DESC LIMIT 1`,
                [emailLower, otp]
            );

            if (!rows.length || new Date(rows[0].expires_at) < new Date()) {
                return res
                    .status(400)
                    .json({ error: "Invalid or expired OTP" });
            }

            const tempName = rows[0].temp_name;
            const tempPassword = rows[0].temp_password;

            const hash = await bcrypt.hash(tempPassword, 8);

            const [result] = await getPool().query(
                "INSERT INTO users (name,email,password,role) VALUES (?,?,?,?)",
                [tempName, emailLower, hash, "user"]
            );

            await getPool().query("DELETE FROM otp_codes WHERE email=?", [
                emailLower,
            ]);

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

    app.post("/auth/login", async (req, res) => {
        try {
            const { email, password } = req.body;
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
            console.log("Login successful for:", email);
            res.json({ user });
        } catch (err) {
            console.error("Login error:", err.message);
            console.error("Stack:", err.stack);
            res.status(500).json({
                error: "Server error",
                details: err.message,
            });
        }
    });

    app.post("/auth/forgot-password", async (req, res) => {
        try {
            const { email } = req.body;
            if (!email)
                return res.status(400).json({ error: "Email required" });

            const emailLower = email.trim().toLowerCase();

            const [users] = await getPool().query(
                "SELECT id FROM users WHERE LOWER(email)=?",
                [emailLower]
            );

            if (!users.length)
                return res.status(400).json({ error: "Account not found" });

            const otp = Math.floor(100000 + Math.random() * 900000).toString();
            const expires = new Date(Date.now() + 5 * 60 * 1000);

            await getPool().query(
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
        <h1 style="margin:0; color:#4CAF50;">Password Reset</h1>
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
        If you didn't request this reset, your account is still secure.
      </p>

      <p style="font-size:12px; color:#bbb; text-align:center; margin-top:20px;">
        Copyright ${new Date().getFullYear()} Yummly
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

    app.get("/test-email", async (req, res) => {
        try {
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
            const emailLower = email.trim().toLowerCase();

            const [rows] = await getPool().query(
                "SELECT * FROM otp_codes WHERE email=? AND otp=? AND type='reset' ORDER BY id DESC LIMIT 1",
                [emailLower, otp]
            );

            if (!rows.length || new Date(rows[0].expires_at) < new Date())
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
            const emailLower = email.trim().toLowerCase();

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
            console.error(err);
            res.status(500).json({ error: "Reset failed" });
        }
    });
}

module.exports = registerAuthRoutes;

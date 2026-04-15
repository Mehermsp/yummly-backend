function registerSystemRoutes(app, { getPool }) {
    app.get("/ping", (req, res) => {
        res.json({
            ok: true,
            ts: new Date().toISOString(),
            version: process.env.COMMIT_HASH || "dev",
        });
    });

    app.get("/health", async (req, res) => {
        try {
            const [result] = await getPool().query("SELECT 1 as alive");
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

    app.get("/diagnostics", async (req, res) => {
        try {
            const [otps] = await getPool().query(
                "SELECT email, type, expires_at, reset_token FROM otp_codes ORDER BY id DESC LIMIT 10"
            );

            res.json({
                server: "running",
                timestamp: new Date().toISOString(),
                emailService: "Brevo",
                brevoKey: process.env.BREVO_API_KEY ? "configured" : "missing",
                emailFrom: process.env.EMAIL_FROM || "missing",
                emailFromName: process.env.EMAIL_FROM_NAME || "TastieKit",
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
}

module.exports = registerSystemRoutes;

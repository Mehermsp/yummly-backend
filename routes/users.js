function parseAddresses(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            console.error("Failed to parse addresses:", error);
            return [];
        }
    }
    if (typeof value === "object") {
        return Array.isArray(value.addresses) ? value.addresses : [value];
    }
    return [];
}

function registerUserRoutes(app, { getPool, requireSelfOrAdmin }) {
    app.get("/user/:userId", requireSelfOrAdmin, async (req, res) => {
        const userId = parseInt(req.params.userId);

        const [rows] = await getPool().query(
            "SELECT id,name,email,phone,role,addresses FROM users WHERE id = ?",
            [userId]
        );

        if (!rows.length) return res.status(404).json({ error: "Not found" });

        const user = rows[0];
        user.addresses = parseAddresses(user.addresses);

        res.json({ user });
    });

    app.post("/user/:userId/profile", requireSelfOrAdmin, async (req, res) => {
        const userId = parseInt(req.params.userId);
        const { name, phone, email, addresses } = req.body;
        const normalizedPhone =
            typeof phone === "string" ? phone.trim() : phone;

        if (typeof phone !== "undefined" && !normalizedPhone) {
            return res.status(400).json({ error: "Phone number is required" });
        }

        if (email) {
            const [existing] = await getPool().query(
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
        if (typeof addresses !== "undefined") {
            updates.push("addresses = ?");
            params.push(JSON.stringify(addresses || []));
        }

        if (updates.length) {
            const sql = `UPDATE users SET ${updates.join(", ")} WHERE id = ?`;
            params.push(userId);
            await getPool().query(sql, params);
        }

        const [rows] = await getPool().query(
            "SELECT id,name,email,phone,role FROM users WHERE id = ?",
            [userId]
        );
        res.json({ user: rows[0] });
    });
}

module.exports = registerUserRoutes;

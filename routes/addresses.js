function registerAddressRoutes(app, { getPool, requireSelfOrAdmin }) {
    // Get all addresses for a user
    app.get("/user/:userId/addresses", requireSelfOrAdmin, async (req, res) => {
        try {
            const userId = parseInt(req.params.userId);
            if (isNaN(userId)) {
                return res.status(400).json({ error: "Invalid userId" });
            }

            const [rows] = await getPool().query(
                `SELECT id, label, door_no, street, landmark, area, city, state, pincode, 
                        latitude, longitude, is_default, created_at 
                 FROM addresses 
                 WHERE user_id = ? 
                 ORDER BY is_default DESC, created_at DESC`,
                [userId]
            );

            res.json(Array.isArray(rows) ? rows : []);
        } catch (error) {
            console.error("Get addresses error:", error.message);
            res.status(500).json({
                error: "Failed to fetch addresses",
                details: error.message,
            });
        }
    });

    // Get default address for a user
    app.get(
        "/user/:userId/addresses/default",
        requireSelfOrAdmin,
        async (req, res) => {
            try {
                const userId = parseInt(req.params.userId);

                const [rows] = await getPool().query(
                    `SELECT id, label, door_no, street, landmark, area, city, state, pincode, 
                        latitude, longitude, is_default, created_at 
                 FROM addresses 
                 WHERE user_id = ? AND is_default = 1 
                 LIMIT 1`,
                    [userId]
                );

                if (!rows.length) {
                    return res
                        .status(404)
                        .json({ error: "No default address found" });
                }

                res.json(rows[0]);
            } catch (error) {
                console.error("Get default address error:", error);
                res.status(500).json({
                    error: "Failed to fetch default address",
                });
            }
        }
    );

    // Create new address
    app.post(
        "/user/:userId/addresses",
        requireSelfOrAdmin,
        async (req, res) => {
            try {
                const userId = parseInt(req.params.userId);
                const {
                    label,
                    door_no,
                    street,
                    landmark,
                    area,
                    city,
                    state,
                    pincode,
                    latitude,
                    longitude,
                    is_default,
                } = req.body;

                if (!door_no || !street || !city || !state || !pincode) {
                    return res
                        .status(400)
                        .json({ error: "Required fields missing" });
                }

                // If this is default, remove default flag from other addresses
                if (is_default) {
                    await getPool().query(
                        "UPDATE addresses SET is_default = 0 WHERE user_id = ?",
                        [userId]
                    );
                }

                const [result] = await getPool().query(
                    `INSERT INTO addresses 
                 (user_id, label, door_no, street, landmark, area, city, state, pincode, latitude, longitude, is_default) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        userId,
                        label || "Home",
                        door_no,
                        street,
                        landmark,
                        area,
                        city,
                        state,
                        pincode,
                        latitude || null,
                        longitude || null,
                        is_default ? 1 : 0,
                    ]
                );

                const [rows] = await getPool().query(
                    "SELECT id, label, door_no, street, landmark, area, city, state, pincode, latitude, longitude, is_default, created_at FROM addresses WHERE id = ?",
                    [result.insertId]
                );

                res.json(rows[0]);
            } catch (error) {
                console.error("Create address error:", error);
                res.status(500).json({ error: "Failed to create address" });
            }
        }
    );

    // Update address
    app.put(
        "/user/:userId/addresses/:addressId",
        requireSelfOrAdmin,
        async (req, res) => {
            try {
                const userId = parseInt(req.params.userId);
                const addressId = parseInt(req.params.addressId);
                const {
                    label,
                    door_no,
                    street,
                    landmark,
                    area,
                    city,
                    state,
                    pincode,
                    latitude,
                    longitude,
                    is_default,
                } = req.body;

                // Verify address belongs to user
                const [existing] = await getPool().query(
                    "SELECT user_id FROM addresses WHERE id = ?",
                    [addressId]
                );

                if (!existing.length || existing[0].user_id !== userId) {
                    return res.status(403).json({ error: "Unauthorized" });
                }

                // If this is default, remove default flag from other addresses
                if (is_default) {
                    await getPool().query(
                        "UPDATE addresses SET is_default = 0 WHERE user_id = ? AND id != ?",
                        [userId, addressId]
                    );
                }

                const updates = [];
                const params = [];

                const fields = {
                    label,
                    door_no,
                    street,
                    landmark,
                    area,
                    city,
                    state,
                    pincode,
                    latitude,
                    longitude,
                    is_default,
                };

                for (const [key, value] of Object.entries(fields)) {
                    if (value !== undefined) {
                        updates.push(`${key} = ?`);
                        params.push(value);
                    }
                }

                if (!updates.length) {
                    return res
                        .status(400)
                        .json({ error: "No fields to update" });
                }

                params.push(addressId);

                await getPool().query(
                    `UPDATE addresses SET ${updates.join(", ")} WHERE id = ?`,
                    params
                );

                const [rows] = await getPool().query(
                    "SELECT id, label, door_no, street, landmark, area, city, state, pincode, latitude, longitude, is_default, created_at FROM addresses WHERE id = ?",
                    [addressId]
                );

                res.json(rows[0]);
            } catch (error) {
                console.error("Update address error:", error);
                res.status(500).json({ error: "Failed to update address" });
            }
        }
    );

    // Delete address
    app.delete(
        "/user/:userId/addresses/:addressId",
        requireSelfOrAdmin,
        async (req, res) => {
            try {
                const userId = parseInt(req.params.userId);
                const addressId = parseInt(req.params.addressId);

                // Verify address belongs to user
                const [existing] = await getPool().query(
                    "SELECT user_id FROM addresses WHERE id = ?",
                    [addressId]
                );

                if (!existing.length || existing[0].user_id !== userId) {
                    return res.status(403).json({ error: "Unauthorized" });
                }

                await getPool().query("DELETE FROM addresses WHERE id = ?", [
                    addressId,
                ]);

                res.json({ ok: true });
            } catch (error) {
                console.error("Delete address error:", error);
                res.status(500).json({ error: "Failed to delete address" });
            }
        }
    );

    // Set address as default
    app.put(
        "/user/:userId/addresses/:addressId/default",
        requireSelfOrAdmin,
        async (req, res) => {
            try {
                const userId = parseInt(req.params.userId);
                const addressId = parseInt(req.params.addressId);

                // Verify address belongs to user
                const [existing] = await getPool().query(
                    "SELECT user_id FROM addresses WHERE id = ?",
                    [addressId]
                );

                if (!existing.length || existing[0].user_id !== userId) {
                    return res.status(403).json({ error: "Unauthorized" });
                }

                // Remove default from all other addresses
                await getPool().query(
                    "UPDATE addresses SET is_default = 0 WHERE user_id = ? AND id != ?",
                    [userId, addressId]
                );

                // Set this address as default
                await getPool().query(
                    "UPDATE addresses SET is_default = 1 WHERE id = ?",
                    [addressId]
                );

                const [rows] = await getPool().query(
                    "SELECT id, label, door_no, street, landmark, area, city, state, pincode, latitude, longitude, is_default, created_at FROM addresses WHERE id = ?",
                    [addressId]
                );

                res.json(rows[0]);
            } catch (error) {
                console.error("Set default address error:", error);
                res.status(500).json({
                    error: "Failed to set default address",
                });
            }
        }
    );
}

module.exports = registerAddressRoutes;

function registerCartRoutes(app, { getPool }) {
    app.post("/cart", async (req, res) => {
        const { userId, items } = req.body;
        if (!userId) return res.status(400).json({ error: "Missing userId" });

        await getPool().query("DELETE FROM carts WHERE user_id = ?", [userId]);
        if (items && items.length) {
            const promises = items.map((it) =>
                getPool().query(
                    "INSERT INTO carts (user_id, menu_id, name, price, qty) VALUES (?,?,?,?,?)",
                    [userId, it.id || it.menu_id, it.name, it.price, it.qty]
                )
            );
            await Promise.all(promises);
        }
        res.json({ ok: true });
    });

    app.get("/cart/:userId", async (req, res) => {
        const userId = req.params.userId;
        const [rows] = await getPool().query(
            `SELECT c.menu_id as id, c.name, c.price, c.qty,
                    m.restaurant_id,
                    r.name as restaurant_name
             FROM carts c
             LEFT JOIN menu_items m ON c.menu_id = m.id
             LEFT JOIN restaurants r ON m.restaurant_id = r.id
             WHERE c.user_id = ?`,
            [userId]
        );
        res.json(
            rows.map((row) => ({
                id: row.id,
                name: row.name,
                price: row.price,
                qty: row.qty,
                restaurant_id: row.restaurant_id || null,
                restaurant_name: row.restaurant_name || null,
            }))
        );
    });
}

module.exports = registerCartRoutes;

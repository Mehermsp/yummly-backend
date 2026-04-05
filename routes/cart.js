function registerCartRoutes(app, { getPool }) {
    app.post("/cart", async (req, res) => {
        const { userId, items } = req.body;
        if (!userId) return res.status(400).json({ error: "Missing userId" });

        await getPool().query("DELETE FROM carts WHERE user_id = ?", [userId]);
        if (items && items.length) {
            const promises = items.map((it) =>
                getPool().query(
                    "INSERT INTO carts (user_id, menu_id, name, price, qty) VALUES (?,?,?,?,?)",
                    [userId, it.id, it.name, it.price, it.qty]
                )
            );
            await Promise.all(promises);
        }
        res.json({ ok: true });
    });

    app.get("/cart/:userId", async (req, res) => {
        const userId = req.params.userId;
        const [rows] = await getPool().query(
            "SELECT menu_id as id, name, price, qty FROM carts WHERE user_id = ?",
            [userId]
        );
        res.json(rows);
    });
}

module.exports = registerCartRoutes;

function registerWishlistRoutes(app, { getPool }) {
    app.post("/wishlist", async (req, res) => {
        const { userId, items } = req.body;
        if (!userId) return res.status(400).json({ error: "Missing userId" });

        await getPool().query("DELETE FROM wishlists WHERE user_id = ?", [userId]);
        if (items && items.length) {
            const promises = items.map((it) =>
                getPool().query(
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

    app.get("/wishlist/:userId", async (req, res) => {
        const userId = req.params.userId;
        const [rows] = await getPool().query(
            `SELECT menu_id as id, name, price, image, description, category, discount
             FROM wishlists WHERE user_id = ?`,
            [userId]
        );
        res.json(rows);
    });
}

module.exports = registerWishlistRoutes;

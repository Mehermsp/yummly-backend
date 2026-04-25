function registerWishlistRoutes(app, { getPool }) {
    app.post("/wishlist", async (req, res) => {
        const { userId, items } = req.body;
        if (!userId) return res.status(400).json({ error: "Missing userId" });

        await getPool().query("DELETE FROM wishlists WHERE user_id = ?", [userId]);
        if (items && items.length) {
            const promises = items.map((it) =>
                getPool().query(
                    `INSERT INTO wishlists (user_id, menu_id) VALUES (?,?)`,
                    [userId, it.id || it.menu_id]
                )
            );
            await Promise.all(promises);
        }
        res.json({ ok: true });
    });

    app.get("/wishlist/:userId", async (req, res) => {
        const userId = req.params.userId;
        const [rows] = await getPool().query(
            `SELECT m.id, m.name, m.price, m.image_url as image, m.description, m.category, m.discount_price
             FROM wishlists w
             JOIN menu_items m ON w.menu_id = m.id
             WHERE w.user_id = ?`,
            [userId]
        );
        res.json(rows.map(row => ({
            ...row,
            discount: row.price - (row.discount_price || row.price)
        })));
    });
}

module.exports = registerWishlistRoutes;

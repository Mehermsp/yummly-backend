function registerMenuRoutes(app, { getPool, ensureMealTypeColumn }) {
    app.get("/menu", async (req, res) => {
        await ensureMealTypeColumn();
        const [rows] = await getPool().query(
            "SELECT id, name, description, price, image, category, meal_type, season, rating, discount, popularity, restaurant_id FROM menu ORDER BY popularity DESC"
        );
        res.json(rows);
    });

    app.get("/restaurants", async (req, res) => {
        try {
            const [rows] = await getPool().query(
                "SELECT * FROM restaurants ORDER BY rating DESC, id ASC"
            );
            res.json(rows);
        } catch (error) {
            res.status(500).json({
                error: "Failed to fetch restaurants",
                details: error.message,
            });
        }
    });

    app.get("/restaurants/:id", async (req, res) => {
        try {
            const { id } = req.params;
            const [restaurants] = await getPool().query(
                "SELECT * FROM restaurants WHERE id = ?",
                [id]
            );
            if (restaurants.length === 0) {
                return res.status(404).json({ error: "Restaurant not found" });
            }
            const restaurant = restaurants[0];

            const [rows] = await getPool().query(
                "SELECT id, name, description, price, image, category, meal_type, season, rating, discount, popularity FROM menu WHERE restaurant_id = ? ORDER BY popularity DESC",
                [id]
            );
            res.json({
                ...restaurant,
                menu: rows,
            });
        } catch (error) {
            res.status(500).json({
                error: "Failed to fetch restaurant",
                details: error.message,
            });
        }
    });

    app.get("/restaurants/:id/menu", async (req, res) => {
        try {
            const { id } = req.params;
            const [rows] = await getPool().query(
                "SELECT id, name, description, price, image, category, meal_type, season, rating, discount, popularity FROM menu WHERE restaurant_id = ? ORDER BY popularity DESC",
                [id]
            );
            res.json(rows);
        } catch (error) {
            res.status(500).json({
                error: "Failed to fetch restaurant menu",
                details: error.message,
            });
        }
    });
}

module.exports = registerMenuRoutes;

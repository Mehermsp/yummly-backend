function registerMenuRoutes(app, { getPool, ensureMealTypeColumn }) {
    app.get("/menu", async (req, res) => {
        try {
            const [rows] = await getPool().query(
                `SELECT m.id, m.name, m.description, m.price, m.image, m.category, 
                        m.meal_type, m.season, m.rating, m.discount, m.popularity,
                        m.restaurant_id, r.name as restaurant_name
                 FROM menu m
                 LEFT JOIN restaurants r ON m.restaurant_id = r.id
                 WHERE m.available = 1
                 ORDER BY m.popularity DESC`
            );
            res.json(rows);
        } catch (err) {
            console.error("Menu fetch error:", err);
            res.status(500).json({ error: "Failed to fetch menu" });
        }
    });
}

module.exports = registerMenuRoutes;

module.exports = registerMenuRoutes;

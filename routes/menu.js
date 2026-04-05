function registerMenuRoutes(app, { getPool, ensureMealTypeColumn }) {
    app.get("/menu", async (req, res) => {
        try {
            const [rows] = await getPool().query(
                `SELECT mi.id, mi.name, mi.description, mi.price, mi.image, mi.category, 
                        mi.meal_type, mi.season, mi.rating, mi.discount, mi.popularity,
                        mi.restaurant_id, r.name as restaurant_name,
                        mi.available, mi.food_type
                 FROM menu_items mi
                 LEFT JOIN restaurants r ON mi.restaurant_id = r.id
                 WHERE mi.available = 1 AND r.status = 'approved'
                 ORDER BY mi.popularity DESC`
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

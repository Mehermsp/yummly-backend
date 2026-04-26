function createGetRestaurant(getPool) {
    return async function getRestaurant(req, res, next) {
        const userId = req.headers.userid;
        
        if (!userId) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        try {
            const [restaurants] = await getPool().query(
                "SELECT * FROM restaurants WHERE owner_id = ? OR user_id = ? ORDER BY id ASC",
                [userId, userId]
            );

            if (!restaurants.length) {
                return res.status(404).json({ 
                    error: "Restaurant not found", 
                    code: "NO_RESTAURANT",
                    message: "Please complete your restaurant registration first."
                });
            }

            req.restaurant = restaurants[0];
            next();
        } catch (err) {
            console.error("Get restaurant error:", err);
            res.status(500).json({ error: "Server error" });
        }
    };
}

module.exports = createGetRestaurant;

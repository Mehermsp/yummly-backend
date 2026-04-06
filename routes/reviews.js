function registerReviewRoutes(app, { getPool, requireSelfOrAdmin }) {
    // Middleware to ensure only customers can create/modify reviews
    const requireCustomer = async (req, res, next) => {
        const requesterId = parseInt(req.headers.userid, 10);

        if (!requesterId) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        const [users] = await getPool().query("SELECT role FROM users WHERE id = ?", [requesterId]);

        if (!users.length) {
            return res.status(401).json({ error: "User not found" });
        }

        if (users[0].role !== 'customer') {
            return res.status(403).json({ error: "Only customers can create or modify reviews" });
        }

        next();
    };

    // Submit review for an order (restaurant & delivery feedback)
    app.post("/orders/:orderId/review", requireCustomer, async (req, res) => {
        try {
            const orderId = parseInt(req.params.orderId);
            const { rating, comment, delivery_rating, delivery_comment, restaurant_id, menu_item_reviews } = req.body;
            const requesterId = parseInt(req.headers.userid);

            // Verify the order belongs to the user
            const [orders] = await getPool().query(
                "SELECT user_id FROM orders WHERE id = ?",
                [orderId]
            );

            if (!orders.length) {
                return res.status(404).json({ error: "Order not found" });
            }

            if (orders[0].user_id !== requesterId) {
                return res.status(403).json({ error: "Unauthorized - order doesn't belong to user" });
            }

            // Check if review already exists
            const [existing] = await getPool().query(
                "SELECT id FROM reviews WHERE order_id = ? AND user_id = ?",
                [orderId, requesterId]
            );

            if (existing.length) {
                return res.status(400).json({ error: "Review already exists for this order" });
            }

            // Create main order review
            const [result] = await getPool().query(
                `INSERT INTO reviews (user_id, restaurant_id, order_id, rating, comment, delivery_rating, delivery_comment)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [requesterId, restaurant_id, orderId, rating, comment, delivery_rating, delivery_comment]
            );

            // Handle individual menu item reviews if provided
            const reviewIds = [result.insertId];

            if (menu_item_reviews && Array.isArray(menu_item_reviews)) {
                for (const itemReview of menu_item_reviews) {
                    const [itemResult] = await getPool().query(
                        `INSERT INTO reviews (user_id, restaurant_id, menu_item_id, order_id, rating, comment)
                         VALUES (?, ?, ?, ?, ?, ?)`,
                        [requesterId, restaurant_id, itemReview.menu_item_id, orderId, itemReview.rating, itemReview.comment]
                    );
                    reviewIds.push(itemResult.insertId);
                }
            }

            // Update restaurant rating (if restaurant_id provided)
            if (restaurant_id && rating) {
                await updateRestaurantRating(restaurant_id);
            }

            res.json({
                success: true,
                review_id: result.insertId,
                message: "Review submitted successfully"
            });

        } catch (error) {
            console.error("Create review error:", error);
            res.status(500).json({ error: "Failed to create review" });
        }
    });

    // Submit review for a menu item (food item review)
    app.post("/menu/:menuItemId/review", requireCustomer, async (req, res) => {
        try {
            const menuItemId = parseInt(req.params.menuItemId);
            const { rating, comment, restaurant_id, order_id } = req.body;
            const requesterId = parseInt(req.headers.userid);

            if (!rating) {
                return res.status(400).json({ error: "Rating is required" });
            }

            // Create review for menu item
            const [result] = await getPool().query(
                `INSERT INTO reviews (user_id, restaurant_id, menu_item_id, order_id, rating, comment)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [requesterId, restaurant_id, menuItemId, order_id || null, rating, comment || null]
            );

            // Update menu item rating
            await updateMenuItemRating(menuItemId);

            // Update restaurant rating
            if (restaurant_id) {
                await updateRestaurantRating(restaurant_id);
            }

            res.json({
                success: true,
                review_id: result.insertId,
                message: "Review submitted successfully"
            });

        } catch (error) {
            console.error("Create menu item review error:", error);
            res.status(500).json({ error: "Failed to create review" });
        }
    });

    // Get reviews for a restaurant (public)
    app.get("/restaurants/:restaurantId/reviews", async (req, res) => {
        try {
            const restaurantId = parseInt(req.params.restaurantId);
            const limit = parseInt(req.query.limit) || 20;
            const offset = parseInt(req.query.offset) || 0;

            const [rows] = await getPool().query(
                `SELECT r.id, r.user_id, r.rating, r.comment, r.delivery_rating, r.delivery_comment, r.created_at,
                        u.name as user_name
                 FROM reviews r
                 JOIN users u ON u.id = r.user_id
                 WHERE r.restaurant_id = ? AND r.menu_item_id IS NULL
                 ORDER BY r.created_at DESC
                 LIMIT ? OFFSET ?`,
                [restaurantId, limit, offset]
            );

            const [countResult] = await getPool().query(
                "SELECT COUNT(*) as count FROM reviews WHERE restaurant_id = ? AND menu_item_id IS NULL",
                [restaurantId]
            );

            res.json({
                reviews: rows,
                total: countResult[0].count,
                limit,
                offset,
            });

        } catch (error) {
            console.error("Get restaurant reviews error:", error);
            res.status(500).json({ error: "Failed to fetch reviews" });
        }
    });

    // Get reviews for a menu item (public)
    app.get("/menu/:menuItemId/reviews", async (req, res) => {
        try {
            const menuItemId = parseInt(req.params.menuItemId);
            const limit = parseInt(req.query.limit) || 20;
            const offset = parseInt(req.query.offset) || 0;

            const [rows] = await getPool().query(
                `SELECT r.id, r.user_id, r.rating, r.comment, r.created_at,
                        u.name as user_name
                 FROM reviews r
                 JOIN users u ON u.id = r.user_id
                 WHERE r.menu_item_id = ?
                 ORDER BY r.created_at DESC
                 LIMIT ? OFFSET ?`,
                [menuItemId, limit, offset]
            );

            const [countResult] = await getPool().query(
                "SELECT COUNT(*) as count FROM reviews WHERE menu_item_id = ?",
                [menuItemId]
            );

            const [avgResult] = await getPool().query(
                "SELECT AVG(rating) as avg_rating, COUNT(*) as review_count FROM reviews WHERE menu_item_id = ? AND rating IS NOT NULL",
                [menuItemId]
            );

            res.json({
                reviews: rows,
                total: countResult[0].count,
                averageRating: avgResult[0].avg_rating || 0,
                reviewCount: avgResult[0].review_count || 0,
                limit,
                offset,
            });

        } catch (error) {
            console.error("Get menu item reviews error:", error);
            res.status(500).json({ error: "Failed to fetch reviews" });
        }
    });

    // Get reviews for a specific order
    app.get("/orders/:orderId/review", requireSelfOrAdmin, async (req, res) => {
        try {
            const orderId = parseInt(req.params.orderId);
            const requesterId = parseInt(req.headers.userid);

            // Verify user owns the order
            const [orders] = await getPool().query(
                "SELECT user_id FROM orders WHERE id = ?",
                [orderId]
            );

            if (!orders.length) {
                return res.status(404).json({ error: "Order not found" });
            }

            if (orders[0].user_id !== requesterId) {
                return res.status(403).json({ error: "Unauthorized" });
            }

            const [rows] = await getPool().query(
                `SELECT r.id, r.user_id, r.restaurant_id, r.rating, r.comment, r.delivery_rating, r.delivery_comment, r.created_at,
                        u.name as user_name
                 FROM reviews r
                 JOIN users u ON u.id = r.user_id
                 WHERE r.order_id = ?`,
                [orderId]
            );

            if (!rows.length) {
                return res.json(null);
            }

            res.json(rows[0]);

        } catch (error) {
            console.error("Get order review error:", error);
            res.status(500).json({ error: "Failed to fetch review" });
        }
    });

    // Get user's reviews
    app.get("/user/:userId/reviews", requireSelfOrAdmin, async (req, res) => {
        try {
            const userId = parseInt(req.params.userId);

            const [rows] = await getPool().query(
                `SELECT r.id, r.restaurant_id, r.menu_item_id, r.order_id, r.rating, r.comment,
                        r.delivery_rating, r.delivery_comment, r.created_at
                 FROM reviews r
                 WHERE r.user_id = ?
                 ORDER BY r.created_at DESC`,
                [userId]
            );

            res.json(rows);

        } catch (error) {
            console.error("Get user reviews error:", error);
            res.status(500).json({ error: "Failed to fetch reviews" });
        }
    });

    // Update review
    app.put("/reviews/:reviewId", requireCustomer, async (req, res) => {
        try {
            const reviewId = parseInt(req.params.reviewId);
            const requesterId = parseInt(req.headers.userid);
            const { rating, comment, delivery_rating, delivery_comment } = req.body;

            // Get review and verify ownership
            const [reviews] = await getPool().query(
                "SELECT user_id, restaurant_id, menu_item_id FROM reviews WHERE id = ?",
                [reviewId]
            );

            if (!reviews.length) {
                return res.status(404).json({ error: "Review not found" });
            }

            const review = reviews[0];

            if (review.user_id !== requesterId) {
                return res.status(403).json({ error: "Unauthorized - can only update own reviews" });
            }

            const updates = [];
            const params = [];

            if (rating !== undefined) {
                updates.push("rating = ?");
                params.push(rating);
            }
            if (comment !== undefined) {
                updates.push("comment = ?");
                params.push(comment);
            }
            if (delivery_rating !== undefined) {
                updates.push("delivery_rating = ?");
                params.push(delivery_rating);
            }
            if (delivery_comment !== undefined) {
                updates.push("delivery_comment = ?");
                params.push(delivery_comment);
            }

            if (!updates.length) {
                return res.status(400).json({ error: "No fields to update" });
            }

            params.push(reviewId);

            await getPool().query(
                `UPDATE reviews SET ${updates.join(", ")}, updated_at = NOW() WHERE id = ?`,
                params
            );

            // Update ratings if changed
            if (rating !== undefined && review.restaurant_id) {
                await updateRestaurantRating(review.restaurant_id);
            }
            if (rating !== undefined && review.menu_item_id) {
                await updateMenuItemRating(review.menu_item_id);
            }

            const [rows] = await getPool().query(
                "SELECT id, user_id, restaurant_id, menu_item_id, order_id, rating, comment, delivery_rating, delivery_comment, created_at, updated_at FROM reviews WHERE id = ?",
                [reviewId]
            );

            res.json(rows[0]);

        } catch (error) {
            console.error("Update review error:", error);
            res.status(500).json({ error: "Failed to update review" });
        }
    });

    // Helper function to update restaurant rating
    async function updateRestaurantRating(restaurantId) {
        try {
            // Note: Since this is the app server, we don't have direct access to restaurant data
            // This would need to be synced with the restaurant server
            console.log(`Restaurant rating update requested for restaurant ${restaurantId}`);
        } catch (error) {
            console.error("Update restaurant rating error:", error);
        }
    }

    // Helper function to update menu item rating
    async function updateMenuItemRating(menuItemId) {
        try {
            // Note: Since this is the app server, we don't have direct access to menu data
            // This would need to be synced with the restaurant server
            console.log(`Menu item rating update requested for item ${menuItemId}`);
        } catch (error) {
            console.error("Update menu item rating error:", error);
        }
    }
}

module.exports = registerReviewRoutes;
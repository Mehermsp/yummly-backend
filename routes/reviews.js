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

    // Middleware to ensure only restaurant owners can view their reviews
    const requireRestaurantOwner = async (req, res, next) => {
        const requesterId = parseInt(req.headers.userid, 10);

        if (!requesterId) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        const [users] = await getPool().query("SELECT role FROM users WHERE id = ?", [requesterId]);

        if (!users.length) {
            return res.status(401).json({ error: "User not found" });
        }

        if (
            users[0].role === "restaurant_partner" ||
            users[0].role === "restaurant"
        ) {
            next();
        } else if (users[0].role === "admin") {
            // Allow admins
            next();
        } else {
            return res.status(403).json({ error: "Only restaurant owners can access this endpoint" });
        }
    };
    // Order-level reviews are deprecated. Reviews are only for food items.
    app.post(
        "/orders/:orderId/review",
        requireCustomer,
        async (req, res) => {
            res.status(410).json({
                error: "Order-level reviews are no longer supported",
                detail: "Submit food-item reviews using POST /menu/:menuItemId/review with { rating, comment, order_id }.",
            });
        }
    );

    // Add review for a menu item (food item review) - Only customers
    app.post(
        "/menu/:menuItemId/review",
        requireCustomer,
        async (req, res) => {
            try {
                const menuItemId = parseInt(req.params.menuItemId);
                const { rating, comment, order_id } = req.body;
                const requesterId = parseInt(req.headers.userid);

                if (!rating) {
                    return res.status(400).json({ error: "Rating is required" });
                }
                if (!order_id) {
                    return res.status(400).json({
                        error: "order_id is required",
                        detail: "Food-item reviews must be tied to a delivered order.",
                    });
                }

                // Get menu item and restaurant
                const [menuItems] = await getPool().query(
                    "SELECT id, restaurant_id FROM menu_items WHERE id = ?",
                    [menuItemId]
                );

                if (!menuItems.length) {
                    return res.status(404).json({ error: "Menu item not found" });
                }

                const menuItem = menuItems[0];

                // Verify user owns the order and that this menu item was part of the order.
                const [orders] = await getPool().query(
                    "SELECT id, user_id, restaurant_id, status FROM orders WHERE id = ?",
                    [order_id]
                );
                if (!orders.length) {
                    return res.status(404).json({ error: "Order not found" });
                }
                if (orders[0].user_id !== requesterId) {
                    return res.status(403).json({ error: "Unauthorized" });
                }
                if (
                    String(orders[0].status || "").toLowerCase().trim() !==
                    "delivered"
                ) {
                    return res.status(400).json({
                        error: "Order not delivered",
                        detail: "You can only review items after delivery.",
                    });
                }
                const [orderItems] = await getPool().query(
                    "SELECT id FROM order_items WHERE order_id = ? AND menu_id = ? LIMIT 1",
                    [order_id, menuItemId]
                );
                if (!orderItems.length) {
                    return res.status(400).json({
                        error: "Item not found in this order",
                    });
                }

                // Prevent duplicate review for same item in same order by same user.
                const [existingItemReview] = await getPool().query(
                    "SELECT id FROM reviews WHERE order_id = ? AND user_id = ? AND menu_item_id = ? LIMIT 1",
                    [order_id, requesterId, menuItemId]
                );
                if (existingItemReview.length) {
                    return res.status(400).json({
                        error: "Review already exists for this item",
                    });
                }

                // Create review for menu item
                // First check if menu_item_id column exists, if not, use restaurant review
                let insertQuery, insertParams;
                try {
                    await getPool().query("SELECT menu_item_id FROM reviews LIMIT 1");
                    // Column exists, use it
                    insertQuery = `INSERT INTO reviews
                        (order_id, user_id, restaurant_id, menu_item_id, rating, comment)
                        VALUES (?, ?, ?, ?, ?, ?)`;
                    insertParams = [
                        order_id,
                        requesterId,
                        menuItem.restaurant_id,
                        menuItemId,
                        rating,
                        comment || null,
                    ];
                } catch (e) {
                    return res.status(500).json({
                        error: "Database not ready for item reviews",
                        detail: "Missing reviews.menu_item_id column.",
                    });
                }

                const [result] = await getPool().query(insertQuery, insertParams);

                // Update menu item rating
                await updateMenuItemRating(menuItemId);

                // Update restaurant rating
                await updateRestaurantRating(menuItem.restaurant_id);

                const [rows] = await getPool().query(
                    "SELECT id, order_id, user_id, restaurant_id, rating, comment, created_at FROM reviews WHERE id = ?",
                    [result.insertId]
                );

                res.json(rows[0]);
            } catch (error) {
                console.error("Create menu item review error:", error);
                res.status(500).json({ error: "Failed to create review" });
            }
        }
    );

    // Get reviews for a menu item (public - anyone can read)
    app.get("/menu/:menuItemId/reviews", async (req, res) => {
        try {
            const menuItemId = parseInt(req.params.menuItemId);
            const limit = parseInt(req.query.limit) || 20;
            const offset = parseInt(req.query.offset) || 0;



            // Check if menu_item_id column exists
            let whereClause, countWhereClause, avgWhereClause;
            try {
                await getPool().query("SELECT menu_item_id FROM reviews LIMIT 1");
                // Column exists, filter by menu_item_id
                whereClause = "r.menu_item_id = ?";
                countWhereClause = "menu_item_id = ?";
                avgWhereClause = "menu_item_id = ? AND rating IS NOT NULL";
            } catch (e) {
                // Column doesn't exist, filter by restaurant_id
                whereClause = "r.restaurant_id = (SELECT restaurant_id FROM menu_items WHERE id = ?)";
                countWhereClause = "restaurant_id = (SELECT restaurant_id FROM menu_items WHERE id = ?)";
                avgWhereClause = "restaurant_id = (SELECT restaurant_id FROM menu_items WHERE id = ?) AND rating IS NOT NULL";
            }

            const [rows] = await getPool().query(
                `SELECT r.id, r.order_id, r.user_id, r.rating, r.comment, r.created_at,
                        u.name as user_name, u.profile_image
                 FROM reviews r
                 JOIN users u ON u.id = r.user_id
                 WHERE ${whereClause}
                 ORDER BY r.created_at DESC
                 LIMIT ? OFFSET ?`,
                [menuItemId, limit, offset]
            );
            res.setHeader("Cache-Control", "public, max-age=60");

            const [countResult] = await getPool().query(
                `SELECT COUNT(*) as count FROM reviews WHERE ${countWhereClause}`,
                [menuItemId]
            );

            const [avgResult] = await getPool().query(
                `SELECT AVG(rating) as avg_rating, COUNT(*) as review_count FROM reviews WHERE ${avgWhereClause}`,
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

    // Get reviews for restaurant's menu items (for restaurant owners)
    app.get("/restaurant/reviews", requireRestaurantOwner, async (req, res) => {
        try {
            const requesterId = parseInt(req.headers.userid);
            const limit = parseInt(req.query.limit) || 20;
            const offset = parseInt(req.query.offset) || 0;

            // Get restaurant owned by this user
            const [restaurants] = await getPool().query(
                "SELECT id FROM restaurants WHERE (owner_id = ? OR user_id = ?) AND is_approved = 1 ORDER BY id ASC LIMIT 1",
                [requesterId, requesterId]
            );

            if (!restaurants.length) {
                return res.status(404).json({ error: "Restaurant not found" });
            }

            const restaurantId = restaurants[0].id;

            // Get all food-item reviews for this restaurant
            let whereClause = "r.restaurant_id = ? AND r.menu_item_id IS NOT NULL";
            let params = [restaurantId, limit, offset];

            // Check if menu_item_id column exists for filtering
            try {
                await getPool().query("SELECT menu_item_id FROM reviews LIMIT 1");
                // Column exists and is required for food-item reviews
            } catch (e) {
                return res.status(500).json({
                    error: "Database not ready for item reviews",
                    detail: "Missing reviews.menu_item_id column.",
                });
            }

            const [rows] = await getPool().query(
                `SELECT r.id, r.order_id, r.user_id, r.menu_item_id, r.rating, r.comment, r.created_at,
                        u.name as user_name, u.profile_image,
                        m.name as menu_item_name
                 FROM reviews r
                 JOIN users u ON u.id = r.user_id
                 LEFT JOIN menu_items m ON m.id = r.menu_item_id
                 WHERE ${whereClause}
                 ORDER BY r.created_at DESC
                 LIMIT ? OFFSET ?`,
                params
            );

            const [countResult] = await getPool().query(
                `SELECT COUNT(*) as count FROM reviews WHERE ${whereClause}`,
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

    // Get reviews for an order
    app.get("/orders/:orderId/review", async (req, res) => {
        res.status(410).json({
            error: "Order-level reviews are no longer supported",
            detail: "Only food-item reviews are supported.",
        });
    });

    // Get reviews for a restaurant (public - anyone can read)
    app.get("/restaurants/:restaurantId/reviews", async (req, res) => {
        try {
            const restaurantId = parseInt(req.params.restaurantId);
            const limit = parseInt(req.query.limit) || 20;
            const offset = parseInt(req.query.offset) || 0;

            const [rows] = await getPool().query(
                `SELECT r.id, r.order_id, r.user_id, r.menu_item_id, r.rating, r.comment, r.created_at,
                        u.name as user_name, u.profile_image
                 FROM reviews r
                 JOIN users u ON u.id = r.user_id
                 WHERE r.restaurant_id = ? AND r.menu_item_id IS NOT NULL
                 ORDER BY r.created_at DESC
                 LIMIT ? OFFSET ?`,
                [restaurantId, limit, offset]
            );

            const [countResult] = await getPool().query(
                "SELECT COUNT(*) as count FROM reviews WHERE restaurant_id = ? AND menu_item_id IS NOT NULL",
                [restaurantId]
            );
            res.setHeader("Cache-Control", "public, max-age=60");

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

    // Get reviews by a user
    app.get("/user/:userId/reviews", requireSelfOrAdmin, async (req, res) => {
        try {
            const userId = parseInt(req.params.userId);

            const [rows] = await getPool().query(
                `SELECT id, order_id, restaurant_id, menu_item_id, rating, comment, created_at 
                 FROM reviews 
                 WHERE user_id = ? AND menu_item_id IS NOT NULL
                 ORDER BY created_at DESC`,
                [userId]
            );

            res.json(rows);
        } catch (error) {
            console.error("Get user reviews error:", error);
            res.status(500).json({ error: "Failed to fetch reviews" });
        }
    });

    // Update review - Only customers who own the review
    app.put("/reviews/:reviewId", requireCustomer, async (req, res) => {
        try {
            const reviewId = parseInt(req.params.reviewId);
            const requesterId = parseInt(req.headers.userid);
            const { rating, comment } = req.body;

            // Get review
            const [reviews] = await getPool().query(
                "SELECT user_id, restaurant_id, menu_item_id FROM reviews WHERE id = ?",
                [reviewId]
            );

            if (!reviews.length) {
                return res.status(404).json({ error: "Review not found" });
            }

            const review = reviews[0];

            if (!review.menu_item_id) {
                return res.status(410).json({
                    error: "Only food-item reviews can be updated",
                });
            }

            // Verify user is review owner
            if (review.user_id !== requesterId) {
                return res.status(403).json({ error: "Unauthorized" });
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
            if (!updates.length) {
                return res.status(400).json({ error: "No fields to update" });
            }

            params.push(reviewId);

            await getPool().query(
                `UPDATE reviews SET ${updates.join(", ")} WHERE id = ?`,
                params
            );

            // Update restaurant rating
            await updateRestaurantRating(review.restaurant_id);
            await updateMenuItemRating(review.menu_item_id);

            const [rows] = await getPool().query(
                "SELECT id, order_id, user_id, restaurant_id, menu_item_id, rating, comment, created_at FROM reviews WHERE id = ?",
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
            const [result] = await getPool().query(
                `SELECT AVG(rating) as avg_rating, COUNT(*) as review_count 
                 FROM reviews 
                 WHERE restaurant_id = ? AND rating IS NOT NULL`,
                [restaurantId]
            );

            if (result.length && result[0].avg_rating) {
                const avgRating = Math.round(result[0].avg_rating * 10) / 10;
                await getPool().query(
                    "UPDATE restaurants SET rating = ? WHERE id = ?",
                    [avgRating, restaurantId]
                );
            }
        } catch (error) {
            console.error("Update restaurant rating error:", error);
        }
    }

    // Helper function to update menu item rating
    async function updateMenuItemRating(menuItemId) {
        try {
            // Check if menu_item_id column exists
            try {
                await getPool().query("SELECT menu_item_id FROM reviews LIMIT 1");
                // Column exists, update menu item rating
                const [result] = await getPool().query(
                    `SELECT AVG(rating) as avg_rating, COUNT(*) as review_count
                     FROM reviews
                     WHERE menu_item_id = ? AND rating IS NOT NULL`,
                    [menuItemId]
                );

                if (result.length && result[0].avg_rating) {
                    const avgRating = Math.round(result[0].avg_rating * 10) / 10;
                    await getPool().query(
                        "UPDATE menu_items SET rating = ? WHERE id = ?",
                        [avgRating, menuItemId]
                    );
                }
            } catch (e) {
                // Column doesn't exist, just update restaurant rating
                const [menuItem] = await getPool().query(
                    "SELECT restaurant_id FROM menu_items WHERE id = ?",
                    [menuItemId]
                );

                if (menuItem.length) {
                    await updateRestaurantRating(menuItem[0].restaurant_id);
                }
            }
        } catch (error) {
            console.error("Update menu item rating error:", error);
        }
    }
}

module.exports = registerReviewRoutes;

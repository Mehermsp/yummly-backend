const multer = require("multer");
const { uploadImage, deleteImage } = require("../utils/cloudinary.js");

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 4 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        if (file?.mimetype?.startsWith("image/")) {
            return cb(null, true);
        }
        cb(new Error("Only image files are allowed"));
    },
});

function registerMenuRoutes(app, { getPool, notifications }) {
    const requireRestaurantPartner = require("../middleware/isRestaurantPartner");
    const getRestaurant = require("../middleware/getRestaurant");
    app.get("/menu", async (req, res) => {
        try {
            const [rows] = await getPool().query(
                `SELECT m.id,
                        m.name,
                        m.description,
                        m.price,
                        m.image,
                        m.category,
                        m.meal_type,
                        m.season,
                        m.rating,
                        m.discount,
                        m.popularity,
                        m.restaurant_id,
                        r.name AS restaurant_name
                 FROM menu_items m
                 JOIN restaurants r ON r.id = m.restaurant_id
                 WHERE (COALESCE(m.available, 0) = 1 OR COALESCE(m.is_available, 0) = 1)
                   AND r.is_approved = 1
                 ORDER BY m.popularity DESC`
            );
            res.setHeader("Cache-Control", "public, max-age=60");
            res.json(rows);
        } catch (error) {
            console.error("Get menu error:", error);
            res.status(500).json({ error: "Failed to fetch menu" });
        }
    });

    app.get("/restaurants", async (req, res) => {
        try {
            const [rows] = await getPool().query(
                "SELECT * FROM restaurants WHERE is_approved = 1 ORDER BY rating DESC, id ASC"
            );
            res.setHeader("Cache-Control", "public, max-age=60");
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
                "SELECT * FROM restaurants WHERE id = ? AND is_approved = 1",
                [id]
            );
            if (restaurants.length === 0) {
                return res.status(404).json({ error: "Restaurant not found" });
            }
            const restaurant = restaurants[0];

            const [rows] = await getPool().query(
                "SELECT id, name, description, price, image, category, meal_type, season, rating, discount, popularity FROM menu_items WHERE restaurant_id = ? AND (COALESCE(available, 0) = 1 OR COALESCE(is_available, 0) = 1) ORDER BY popularity DESC",
                [id]
            );
            res.setHeader("Cache-Control", "public, max-age=60");
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
            const requesterId = parseInt(req.headers.userid, 10);
            const [restaurants] = await getPool().query(
                "SELECT id, owner_id, user_id, is_approved FROM restaurants WHERE id = ?",
                [id]
            );
            if (!restaurants.length) {
                return res.status(404).json({ error: "Restaurant not found" });
            }

            const restaurant = restaurants[0];
            const ownsRestaurant =
                requesterId &&
                (Number(restaurant.owner_id) === requesterId ||
                    Number(restaurant.user_id) === requesterId);

            if (!restaurant.is_approved && !ownsRestaurant) {
                return res
                    .status(403)
                    .json({ error: "Restaurant not approved" });
            }

            // Return ALL menu items (including unavailable) for restaurant management
            const [rows] = await getPool().query(
                "SELECT id, name, description, price, image, category, meal_type, cuisine_type, season, rating, discount, popularity, is_available, preparation_time_mins, restaurant_id, vendor_id, available, food_type FROM menu_items WHERE restaurant_id = ? ORDER BY popularity DESC, id DESC",
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

    app.post(
        "/restaurants/:id/menu",
        requireRestaurantPartner(getPool),
        getRestaurant(getPool),
        async (req, res) => {
            try {
                const restaurantId = parseInt(req.params.id, 10);

                if (req.restaurant.id !== restaurantId) {
                    return res
                        .status(403)
                        .json({ error: "You don't own this restaurant" });
                }
                const {
                    name,
                    description,
                    price,
                    image,
                    category,
                    meal_type,
                    cuisine_type,
                    season,
                    rating,
                    discount,
                    popularity,
                    is_available,
                    preparation_time_mins,
                    vendor_id,
                    available,
                    food_type,
                } = req.body;

                if (!name || price == null) {
                    return res.status(400).json({
                        error: "Menu item name and price are required",
                    });
                }

                const [result] = await getPool().query(
                    `INSERT INTO menu_items
                 (name, description, price, image, image_public_id, category, meal_type, cuisine_type, season, rating, discount, popularity, is_available, preparation_time_mins, restaurant_id, vendor_id, available, food_type)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,

                    [
                        name,
                        description || null,
                        Number(price),
                        image || null,
                        null, // image_public_id
                        category || "Uncategorized",
                        meal_type || "Lunch",
                        cuisine_type || null,
                        season || "All",
                        Number(rating) || 4.0,
                        Number(discount) || 0,
                        Number(popularity) || 0,
                        is_available !== undefined ? (is_available ? 1 : 0) : 1,
                        Number(preparation_time_mins) || 15,
                        restaurantId,
                        vendor_id || null,
                        available !== undefined ? (available ? 1 : 0) : 1,
                        food_type || "Veg",
                    ]
                );

                const [rows] = await getPool().query(
                    "SELECT id, name, description, price, image, category, meal_type, cuisine_type, season, rating, discount, popularity, is_available, preparation_time_mins, restaurant_id, vendor_id, available, food_type FROM menu_items WHERE id = ?",
                    [result.insertId]
                );

                const createdItem = rows[0];

                // Notify users about new menu item
                const [restaurant] = await getPool().query(
                    "SELECT name FROM restaurants WHERE id = ?",
                    [restaurantId]
                );
                const [allUsers] = await getPool().query(
                    "SELECT id FROM users WHERE role = 'customer'"
                );
                if (notifications?.sendNotification) {
                    allUsers.forEach((user) => {
                        notifications.sendNotification(
                            user.id,
                            "New Menu Item",
                            `New item "${createdItem.name}" added at ${restaurant[0].name}`,
                            "menu_new",
                            {
                                restaurantId,
                                menuId: result.insertId,
                                menuName: createdItem.name,
                            }
                        );
                    });
                }

                res.json(createdItem);
            } catch (error) {
                console.error("Create menu item error:", error);
                res.status(500).json({ error: "Failed to create menu item" });
            }
        }
    );

    app.put(
        "/restaurants/:restaurantId/menu/:menuId",
        requireRestaurantPartner(getPool),
        getRestaurant(getPool),
        async (req, res) => {
            try {
                const restaurantId = parseInt(req.params.restaurantId, 10);
                const menuId = parseInt(req.params.menuId, 10);

                if (req.restaurant.id !== restaurantId) {
                    return res
                        .status(403)
                        .json({ error: "You don't own this restaurant" });
                }

                const updates = [];
                const params = [];
                const allowed = [
                    "name",
                    "description",
                    "price",
                    "image",
                    "category",
                    "meal_type",
                    "cuisine_type",
                    "season",
                    "rating",
                    "discount",
                    "popularity",
                    "is_available",
                    "preparation_time_mins",
                    "available",
                    "food_type",
                ];

                for (const key of allowed) {
                    if (req.body[key] !== undefined) {
                        updates.push(`${key} = ?`);
                        let value = req.body[key];

                        if (key === "available" || key === "is_available") {
                            value =
                                value === true || value === 1 || value === "1"
                                    ? 1
                                    : 0;
                        }

                        params.push(value);
                    }
                }

                if (!updates.length) {
                    return res
                        .status(400)
                        .json({ error: "No fields to update" });
                }

                params.push(restaurantId, menuId);

                await getPool().query(
                    `UPDATE menu_items SET ${updates.join(
                        ", "
                    )} WHERE restaurant_id = ? AND id = ?`,
                    params
                );

                const [rows] = await getPool().query(
                    "SELECT id, name, description, price, image, category, meal_type, cuisine_type, season, rating, discount, popularity, is_available, preparation_time_mins, restaurant_id, vendor_id, available, food_type FROM menu_items WHERE id = ?",
                    [menuId]
                );

                if (!rows.length) {
                    return res
                        .status(404)
                        .json({ error: "Menu item not found" });
                }

                res.json(rows[0]);
            } catch (error) {
                console.error("Update menu item error:", error);
                res.status(500).json({ error: "Failed to update menu item" });
            }
        }
    );

    app.delete(
        "/restaurants/:restaurantId/menu/:menuId",
        requireRestaurantPartner(getPool),
        getRestaurant(getPool),
        async (req, res) => {
            try {
                const restaurantId = parseInt(req.params.restaurantId, 10);
                const menuId = parseInt(req.params.menuId, 10);

                if (req.restaurant.id !== restaurantId) {
                    return res
                        .status(403)
                        .json({ error: "You don't own this restaurant" });
                }

                const [result] = await getPool().query(
                    "DELETE FROM menu_items WHERE restaurant_id = ? AND id = ?",
                    [restaurantId, menuId]
                );

                if (!result.affectedRows) {
                    return res
                        .status(404)
                        .json({ error: "Menu item not found" });
                }

                res.json({ ok: true });
            } catch (error) {
                console.error("Delete menu item error:", error);
                res.status(500).json({ error: "Failed to delete menu item" });
            }
        }
    );

    app.post(
        "/upload/image",
        requireRestaurantPartner(getPool),
        getRestaurant(getPool),
        upload.single("image"),
        async (req, res) => {
            try {
                if (!req.file) {
                    return res.status(400).json({ error: "No file uploaded" });
                }

                const rawPreset = String(
                    req.body.preset || req.query.preset || "menu_item"
                )
                    .trim()
                    .toLowerCase();
                const preset =
                    rawPreset === "restaurant" ? "general" : rawPreset;
                const allowedPresets = new Set([
                    "menu_item",
                    "restaurant_logo",
                    "restaurant_cover",
                    "general",
                ]);
                if (!allowedPresets.has(preset)) {
                    return res
                        .status(400)
                        .json({ error: "Invalid upload preset" });
                }
                const result = await uploadImage(
                    req.file.buffer,
                    preset,
                    req.file.originalname
                );

                res.json({
                    url: result.url,
                    publicId: result.publicId,
                    width: result.width,
                    height: result.height,
                });
            } catch (err) {
                if (err?.code === "LIMIT_FILE_SIZE") {
                    return res
                        .status(400)
                        .json({ error: "Image must be smaller than 4MB" });
                }
                if (String(err?.message || "").includes("Only image files")) {
                    return res.status(400).json({ error: err.message });
                }
                console.error(err);
                res.status(500).json({ error: "Upload error" });
            }
        }
    );

    app.delete(
        "/upload/image",
        requireRestaurantPartner(getPool),
        getRestaurant(getPool),
        async (req, res) => {
            try {
                const { publicId } = req.body;
                if (!publicId) {
                    return res
                        .status(400)
                        .json({ error: "Public ID required" });
                }

                await deleteImage(publicId);
                res.json({ success: true });
            } catch (err) {
                console.error(err);
                res.status(500).json({ error: "Delete error" });
            }
        }
    );
}

module.exports = registerMenuRoutes;

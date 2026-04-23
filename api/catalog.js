const express = require("express");
const { asyncHandler, parseJsonList, query, queryOne, sendOk } = require("./shared");

function mapRestaurant(row) {
    return {
        id: row.id,
        name: row.name,
        description: row.description,
        email: row.email,
        phone: row.phone,
        logo: row.logo,
        coverImage: row.cover_image,
        imageUrl: row.image_url,
        city: row.city,
        area: row.area,
        address: row.address,
        pincode: row.pincode,
        landmark: row.landmark,
        cuisines: parseJsonList(row.cuisines),
        openTime: row.open_time,
        closeTime: row.close_time,
        daysOpen: parseJsonList(row.days_open),
        rating: Number(row.rating || 0),
        isOpen: Boolean(row.is_open),
        status: row.status,
        totalOrders: Number(row.total_orders || 0),
    };
}

function mapMenuItem(row) {
    return {
        id: row.id,
        restaurantId: row.restaurant_id,
        name: row.name,
        description: row.description,
        price: Number(row.price || 0),
        image: row.image,
        category: row.category,
        mealType: row.meal_type,
        cuisineType: row.cuisine_type,
        foodType: row.food_type,
        season: row.season,
        rating: Number(row.rating || 0),
        discount: Number(row.discount || 0),
        popularity: Number(row.popularity || 0),
        preparationTimeMins: Number(row.preparation_time_mins || 0),
        available: Boolean(row.available) && Boolean(row.is_available),
        createdAt: row.created_at,
    };
}

module.exports = function registerCatalogRoutes(getPool) {
    const router = express.Router();

    router.get(
        "/restaurants",
        asyncHandler(async (req, res) => {
            const { city, search } = req.query;
            const conditions = ["is_active = 1", "is_approved = 1"];
            const params = [];

            if (city) {
                conditions.push("city = ?");
                params.push(city);
            }
            if (search) {
                conditions.push("(name LIKE ? OR area LIKE ? OR cuisines LIKE ?)");
                params.push(`%${search}%`, `%${search}%`, `%${search}%`);
            }

            const restaurants = await query(
                getPool(),
                `SELECT *
                 FROM restaurants
                 WHERE ${conditions.join(" AND ")}
                 ORDER BY is_open DESC, rating DESC, total_orders DESC, created_at DESC`,
                params
            );

            return sendOk(res, restaurants.map(mapRestaurant));
        })
    );

    router.get(
        "/restaurants/:restaurantId",
        asyncHandler(async (req, res) => {
            const restaurant = await queryOne(
                getPool(),
                "SELECT * FROM restaurants WHERE id = ?",
                [req.params.restaurantId]
            );
            if (!restaurant) {
                return res.status(404).json({ success: false, error: "Restaurant not found" });
            }

            const menuItems = await query(
                getPool(),
                `SELECT *
                 FROM menu_items
                 WHERE restaurant_id = ? AND available = 1 AND is_available = 1
                 ORDER BY popularity DESC, created_at DESC`,
                [req.params.restaurantId]
            );

            return sendOk(res, {
                restaurant: mapRestaurant(restaurant),
                menuItems: menuItems.map(mapMenuItem),
            });
        })
    );

    router.get(
        "/restaurants/:restaurantId/menu",
        asyncHandler(async (req, res) => {
            const menuItems = await query(
                getPool(),
                `SELECT *
                 FROM menu_items
                 WHERE restaurant_id = ?
                 ORDER BY category ASC, popularity DESC, created_at DESC`,
                [req.params.restaurantId]
            );
            return sendOk(res, menuItems.map(mapMenuItem));
        })
    );

    router.get(
        "/home",
        asyncHandler(async (_req, res) => {
            const [restaurants, popularItems] = await Promise.all([
                query(
                    getPool(),
                    `SELECT *
                     FROM restaurants
                     WHERE is_active = 1 AND is_approved = 1
                     ORDER BY rating DESC, total_orders DESC
                     LIMIT 8`
                ),
                query(
                    getPool(),
                    `SELECT mi.*, r.name AS restaurant_name
                     FROM menu_items mi
                     INNER JOIN restaurants r ON r.id = mi.restaurant_id
                     WHERE mi.available = 1 AND mi.is_available = 1 AND r.is_approved = 1
                     ORDER BY mi.popularity DESC, mi.rating DESC
                     LIMIT 8`
                ),
            ]);

            return sendOk(res, {
                restaurants: restaurants.map(mapRestaurant),
                popularItems: popularItems.map((item) => ({
                    ...mapMenuItem(item),
                    restaurantName: item.restaurant_name,
                })),
            });
        })
    );

    return router;
};

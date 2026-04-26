const express = require("express");
const {
    asyncHandler,
    HttpError,
    normalizeBoolean,
    parseJsonList,
    query,
    queryOne,
    sendOk,
    toNumber,
} = require("./shared");
const { ORDER_STATUS_FLOW } = require("./constants");

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
        fssai: row.fssai,
        gst: row.gst,
        pan: row.pan,
        status: row.status,
        isApproved: Boolean(row.is_approved),
        isOpen: Boolean(row.is_open),
        isActive: Boolean(row.is_active),
        totalOrders: Number(row.total_orders || 0),
        totalRevenue: Number(row.total_revenue || 0),
        platformFeePercent: Number(row.platform_fee_percent || 0),
        payoutNotes: row.payout_notes,
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
        available: Boolean(row.available),
        isAvailable: Boolean(row.is_available),
        createdAt: row.created_at,
    };
}

async function getOwnedRestaurant(pool, ownerId) {
    return queryOne(pool, "SELECT * FROM restaurants WHERE owner_id = ? OR user_id = ? LIMIT 1", [
        ownerId,
        ownerId,
    ]);
}

module.exports = function registerRestaurantRoutes(getPool) {
    const router = express.Router();

    router.get(
        "/dashboard",
        asyncHandler(async (req, res) => {
            const restaurant = await getOwnedRestaurant(getPool(), req.user.id);
            const application = await queryOne(
                getPool(),
                `SELECT *
                 FROM restaurant_applications
                 WHERE owner_id = ?
                 ORDER BY created_at DESC
                 LIMIT 1`,
                [req.user.id]
            );

            if (!restaurant) {
                return sendOk(res, {
                    hasRestaurant: false,
                    application: application
                        ? {
                              id: application.id,
                              status: application.status,
                              restaurantName: application.restaurant_name,
                              reviewNotes: application.review_notes,
                              updatedAt: application.updated_at,
                          }
                        : null,
                });
            }

            const [menuItems, activeOrders, completedOrders] = await Promise.all([
                query(
                    getPool(),
                    "SELECT * FROM menu_items WHERE restaurant_id = ? ORDER BY created_at DESC",
                    [restaurant.id]
                ),
                query(
                    getPool(),
                    `SELECT id, total, status, created_at
                     FROM orders
                     WHERE restaurant_id = ? AND status NOT IN ('delivered', 'cancelled')
                     ORDER BY created_at DESC`,
                    [restaurant.id]
                ),
                query(
                    getPool(),
                    `SELECT id, total, status, delivered_at, created_at
                     FROM orders
                     WHERE restaurant_id = ? AND status = 'delivered'
                     ORDER BY delivered_at DESC
                     LIMIT 30`,
                    [restaurant.id]
                ),
            ]);

            return sendOk(res, {
                hasRestaurant: true,
                restaurant: mapRestaurant(restaurant),
                metrics: {
                    menuCount: menuItems.length,
                    activeOrders: activeOrders.length,
                    completedOrders: completedOrders.length,
                    grossRevenue: completedOrders.reduce(
                        (sum, order) => sum + Number(order.total || 0),
                        0
                    ),
                },
                application: application
                    ? {
                          id: application.id,
                          status: application.status,
                          reviewNotes: application.review_notes,
                          updatedAt: application.updated_at,
                      }
                    : null,
            });
        })
    );

    router.get(
        "/profile",
        asyncHandler(async (req, res) => {
            const restaurant = await getOwnedRestaurant(getPool(), req.user.id);
            if (!restaurant) {
                throw new HttpError(404, "Restaurant profile not found");
            }
            return sendOk(res, mapRestaurant(restaurant));
        })
    );

    router.put(
        "/profile",
        asyncHandler(async (req, res) => {
            const restaurant = await getOwnedRestaurant(getPool(), req.user.id);
            if (!restaurant) {
                throw new HttpError(404, "Restaurant profile not found");
            }

            const payload = req.body || {};
            await getPool().query(
                `UPDATE restaurants
                 SET name = ?, description = ?, email = ?, phone = ?, city = ?, area = ?, address = ?,
                     pincode = ?, landmark = ?, cuisines = ?, open_time = ?, close_time = ?, days_open = ?,
                     is_open = ?, is_active = ?, updated_at = NOW()
                 WHERE id = ?`,
                [
                    payload.name || restaurant.name,
                    payload.description || restaurant.description,
                    payload.email || restaurant.email,
                    payload.phone || restaurant.phone,
                    payload.city || restaurant.city,
                    payload.area || restaurant.area,
                    payload.address || restaurant.address,
                    payload.pincode || restaurant.pincode,
                    payload.landmark || restaurant.landmark,
                    JSON.stringify(payload.cuisines || parseJsonList(restaurant.cuisines)),
                    payload.openTime || restaurant.open_time,
                    payload.closeTime || restaurant.close_time,
                    JSON.stringify(payload.daysOpen || parseJsonList(restaurant.days_open)),
                    normalizeBoolean(payload.isOpen, Boolean(restaurant.is_open)) ? 1 : 0,
                    normalizeBoolean(payload.isActive, Boolean(restaurant.is_active)) ? 1 : 0,
                    restaurant.id,
                ]
            );

            const updated = await queryOne(getPool(), "SELECT * FROM restaurants WHERE id = ?", [
                restaurant.id,
            ]);
            return sendOk(res, mapRestaurant(updated));
        })
    );

    router.post(
        "/application",
        asyncHandler(async (req, res) => {
            const payload = req.body || {};
            if (!payload.restaurantName || !payload.city || !payload.address) {
                throw new HttpError(400, "Restaurant name, city, and address are required");
            }

            const existingPending = await queryOne(
                getPool(),
                `SELECT id
                 FROM restaurant_applications
                 WHERE owner_id = ? AND status = 'pending'
                 ORDER BY created_at DESC
                 LIMIT 1`,
                [req.user.id]
            );
            if (existingPending) {
                throw new HttpError(409, "You already have a pending application");
            }

            const [result] = await getPool().query(
                `INSERT INTO restaurant_applications
                (owner_id, owner_name, email, phone, restaurant_name, address, city, pincode, landmark,
                 cuisines, open_time, close_time, days_open, fssai, gst, pan, logo, status)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
                [
                    req.user.id,
                    payload.ownerName || req.user.name,
                    payload.email || req.user.email,
                    payload.phone || req.user.phone,
                    payload.restaurantName,
                    payload.address,
                    payload.city,
                    payload.pincode || null,
                    payload.landmark || null,
                    JSON.stringify(payload.cuisines || []),
                    payload.openTime || null,
                    payload.closeTime || null,
                    JSON.stringify(payload.daysOpen || []),
                    payload.fssai || null,
                    payload.gst || null,
                    payload.pan || null,
                    payload.logo || null,
                ]
            );

            const application = await queryOne(
                getPool(),
                "SELECT * FROM restaurant_applications WHERE id = ?",
                [result.insertId]
            );
            return sendOk(res, application);
        })
    );

    router.get(
        "/menu",
        asyncHandler(async (req, res) => {
            const restaurant = await getOwnedRestaurant(getPool(), req.user.id);
            if (!restaurant) {
                throw new HttpError(404, "Restaurant profile not found");
            }
            const rows = await query(
                getPool(),
                "SELECT * FROM menu_items WHERE restaurant_id = ? ORDER BY created_at DESC",
                [restaurant.id]
            );
            return sendOk(res, rows.map(mapMenuItem));
        })
    );

    router.post(
        "/menu",
        asyncHandler(async (req, res) => {
            const restaurant = await getOwnedRestaurant(getPool(), req.user.id);
            if (!restaurant) {
                throw new HttpError(404, "Restaurant profile not found");
            }

            const payload = req.body || {};
            if (!payload.name || payload.price == null) {
                throw new HttpError(400, "Menu item name and price are required");
            }

            const [result] = await getPool().query(
                `INSERT INTO menu_items
                (restaurant_id, vendor_id, name, description, price, image, category, meal_type, cuisine_type,
                 food_type, season, discount, popularity, preparation_time_mins, available, is_available)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    restaurant.id,
                    null,
                    payload.name,
                    payload.description || null,
                    payload.price,
                    payload.image || null,
                    payload.category || "Main Course",
                    payload.mealType || "Any",
                    payload.cuisineType || null,
                    payload.foodType || "veg",
                    payload.season || "All",
                    toNumber(payload.discount, 0),
                    toNumber(payload.popularity, 0),
                    toNumber(payload.preparationTimeMins, 30),
                    normalizeBoolean(payload.available, true) ? 1 : 0,
                    normalizeBoolean(payload.isAvailable, true) ? 1 : 0,
                ]
            );

            const item = await queryOne(getPool(), "SELECT * FROM menu_items WHERE id = ?", [
                result.insertId,
            ]);
            return sendOk(res, mapMenuItem(item));
        })
    );

    router.put(
        "/menu/:itemId",
        asyncHandler(async (req, res) => {
            const restaurant = await getOwnedRestaurant(getPool(), req.user.id);
            if (!restaurant) {
                throw new HttpError(404, "Restaurant profile not found");
            }

            const item = await queryOne(
                getPool(),
                "SELECT * FROM menu_items WHERE id = ? AND restaurant_id = ?",
                [req.params.itemId, restaurant.id]
            );
            if (!item) {
                throw new HttpError(404, "Menu item not found");
            }

            const payload = req.body || {};
            await getPool().query(
                `UPDATE menu_items
                 SET name = ?, description = ?, price = ?, image = ?, category = ?, meal_type = ?, cuisine_type = ?,
                     food_type = ?, season = ?, discount = ?, popularity = ?, preparation_time_mins = ?,
                     available = ?, is_available = ?
                 WHERE id = ? AND restaurant_id = ?`,
                [
                    payload.name || item.name,
                    payload.description ?? item.description,
                    payload.price ?? item.price,
                    payload.image ?? item.image,
                    payload.category || item.category,
                    payload.mealType || item.meal_type,
                    payload.cuisineType || item.cuisine_type,
                    payload.foodType || item.food_type,
                    payload.season || item.season,
                    payload.discount ?? item.discount,
                    payload.popularity ?? item.popularity,
                    payload.preparationTimeMins ?? item.preparation_time_mins,
                    normalizeBoolean(payload.available, Boolean(item.available)) ? 1 : 0,
                    normalizeBoolean(payload.isAvailable, Boolean(item.is_available)) ? 1 : 0,
                    req.params.itemId,
                    restaurant.id,
                ]
            );

            const updated = await queryOne(getPool(), "SELECT * FROM menu_items WHERE id = ?", [
                req.params.itemId,
            ]);
            return sendOk(res, mapMenuItem(updated));
        })
    );

    router.delete(
        "/menu/:itemId",
        asyncHandler(async (req, res) => {
            const restaurant = await getOwnedRestaurant(getPool(), req.user.id);
            if (!restaurant) {
                throw new HttpError(404, "Restaurant profile not found");
            }
            await getPool().query(
                "DELETE FROM menu_items WHERE id = ? AND restaurant_id = ?",
                [req.params.itemId, restaurant.id]
            );
            return sendOk(res, { deleted: true });
        })
    );

    router.get(
        "/orders",
        asyncHandler(async (req, res) => {
            const restaurant = await getOwnedRestaurant(getPool(), req.user.id);
            if (!restaurant) {
                throw new HttpError(404, "Restaurant profile not found");
            }

            const orders = await query(
                getPool(),
                `SELECT o.*, u.name AS customer_name, u.phone AS customer_phone
                 FROM orders o
                 INNER JOIN users u ON u.id = o.user_id
                 WHERE o.restaurant_id = ?
                 ORDER BY o.created_at DESC`,
                [restaurant.id]
            );

            const items = await query(
                getPool(),
                `SELECT oi.*
                 FROM order_items oi
                 INNER JOIN orders o ON o.id = oi.order_id
                 WHERE o.restaurant_id = ?`,
                [restaurant.id]
            );

            return sendOk(
                res,
                orders.map((order) => ({
                    id: order.id,
                    orderNumber: order.order_number,
                    status: order.status,
                    paymentMethod: order.payment_method,
                    paymentStatus: order.payment_status,
                    total: Number(order.total || 0),
                    subtotal: Number(order.subtotal || 0),
                    deliveryFee: Number(order.delivery_fee || 0),
                    taxAmount: Number(order.tax_amount || 0),
                    discountAmount: Number(order.discount_amount || 0),
                    customerName: order.customer_name,
                    customerPhone: order.customer_phone,
                    notes: order.notes,
                    deliveryNotes: order.delivery_notes,
                    address: {
                        doorNo: order.door_no,
                        street: order.street,
                        area: order.area,
                        city: order.city,
                        state: order.state,
                        pincode: order.zip_code || order.pincode,
                    },
                    createdAt: order.created_at,
                    items: items
                        .filter((item) => item.order_id === order.id)
                        .map((item) => ({
                            id: item.id,
                            menuId: item.menu_id,
                            name: item.name,
                            price: Number(item.price || 0),
                            qty: Number(item.qty || 0),
                        })),
                }))
            );
        })
    );

    router.patch(
        "/orders/:orderId/status",
        asyncHandler(async (req, res) => {
            const restaurant = await getOwnedRestaurant(getPool(), req.user.id);
            if (!restaurant) {
                throw new HttpError(404, "Restaurant profile not found");
            }

            const { status } = req.body || {};
            if (!ORDER_STATUS_FLOW.includes(status)) {
                throw new HttpError(400, "Invalid order status");
            }

            const order = await queryOne(
                getPool(),
                "SELECT * FROM orders WHERE id = ? AND restaurant_id = ?",
                [req.params.orderId, restaurant.id]
            );
            if (!order) {
                throw new HttpError(404, "Order not found");
            }

            await getPool().query(
                `UPDATE orders
                 SET status = ?, updated_at = NOW(),
                     delivered_at = CASE WHEN ? = 'delivered' THEN NOW() ELSE delivered_at END,
                     actual_delivery_time = CASE WHEN ? = 'delivered' THEN NOW() ELSE actual_delivery_time END
                 WHERE id = ?`,
                [status, status, status, req.params.orderId]
            );
            await getPool().query(
                "INSERT INTO order_status_logs (order_id, status) VALUES (?, ?)",
                [req.params.orderId, status]
            );

            if (status === "delivered") {
                await getPool().query(
                    `UPDATE restaurants
                     SET total_revenue = COALESCE(total_revenue, 0) + ?
                     WHERE id = ?`,
                    [Number(order.total || 0), restaurant.id]
                );
            }

            return sendOk(res, { updated: true });
        })
    );

    return router;
};

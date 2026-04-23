const express = require("express");
const {
    asyncHandler,
    generateOrderNumber,
    HttpError,
    normalizeBoolean,
    query,
    queryOne,
    sendOk,
    toNumber,
    withTransaction,
} = require("./shared");

function mapAddress(row) {
    return {
        id: row.id,
        userId: row.user_id,
        label: row.label,
        doorNo: row.door_no,
        street: row.street,
        area: row.area,
        city: row.city,
        state: row.state,
        pincode: row.pincode,
        landmark: row.landmark,
        latitude: row.latitude,
        longitude: row.longitude,
        isDefault: Boolean(row.is_default),
        createdAt: row.created_at,
    };
}

async function fetchOrderDetails(pool, orderId) {
    const order = await queryOne(
        pool,
        `SELECT o.*, r.name AS restaurant_name, r.logo, a.label AS address_label
         FROM orders o
         INNER JOIN restaurants r ON r.id = o.restaurant_id
         LEFT JOIN addresses a ON a.id = o.address_id
         WHERE o.id = ?`,
        [orderId]
    );
    if (!order) return null;

    const [items, logs] = await Promise.all([
        query(
            pool,
            `SELECT id, order_id, menu_id, name, price, qty
             FROM order_items
             WHERE order_id = ?`,
            [orderId]
        ),
        query(
            pool,
            `SELECT id, status, updated_at
             FROM order_status_logs
             WHERE order_id = ?
             ORDER BY updated_at DESC`,
            [orderId]
        ),
    ]);

    return {
        id: order.id,
        orderNumber: order.order_number,
        userId: order.user_id,
        restaurantId: order.restaurant_id,
        restaurantName: order.restaurant_name,
        restaurantLogo: order.logo,
        status: order.status,
        paymentMethod: order.payment_method,
        paymentStatus: order.payment_status,
        subtotal: Number(order.subtotal || 0),
        discountAmount: Number(order.discount_amount || 0),
        deliveryFee: Number(order.delivery_fee || 0),
        taxAmount: Number(order.tax_amount || 0),
        total: Number(order.total || 0),
        notes: order.notes,
        deliveryNotes: order.delivery_notes,
        estimatedDeliveryTime: order.estimated_delivery_time,
        actualDeliveryTime: order.actual_delivery_time,
        deliveredAt: order.delivered_at,
        createdAt: order.created_at,
        updatedAt: order.updated_at,
        address: {
            id: order.address_id,
            label: order.address_label,
            doorNo: order.door_no,
            street: order.street,
            area: order.area,
            city: order.city,
            state: order.state,
            pincode: order.zip_code || order.pincode,
        },
        items: items.map((item) => ({
            id: item.id,
            menuId: item.menu_id,
            name: item.name,
            price: Number(item.price || 0),
            qty: Number(item.qty || 0),
        })),
        timeline: logs.map((log) => ({
            id: log.id,
            status: log.status,
            updatedAt: log.updated_at,
        })),
    };
}

module.exports = function registerCustomerRoutes(getPool) {
    const router = express.Router();

    router.get(
        "/bootstrap",
        asyncHandler(async (req, res) => {
            const [addresses, cartItems, wishlistItems, orders, notifications] =
                await Promise.all([
                    query(
                        getPool(),
                        "SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, created_at DESC",
                        [req.user.id]
                    ),
                    query(getPool(), "SELECT * FROM carts WHERE user_id = ? ORDER BY id DESC", [
                        req.user.id,
                    ]),
                    query(
                        getPool(),
                        "SELECT * FROM wishlists WHERE user_id = ? ORDER BY id DESC",
                        [req.user.id]
                    ),
                    query(
                        getPool(),
                        "SELECT id FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 10",
                        [req.user.id]
                    ),
                    query(
                        getPool(),
                        "SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 10",
                        [req.user.id]
                    ),
                ]);

            const orderDetails = await Promise.all(
                orders.map((order) => fetchOrderDetails(getPool(), order.id))
            );

            return sendOk(res, {
                profile: req.user,
                addresses: addresses.map(mapAddress),
                cart: cartItems.map((item) => ({
                    id: item.id,
                    menuId: item.menu_id,
                    name: item.name,
                    price: Number(item.price || 0),
                    qty: Number(item.qty || 0),
                })),
                wishlist: wishlistItems.map((item) => ({
                    id: item.id,
                    menuId: item.menu_id,
                    name: item.name,
                    price: Number(item.price || 0),
                    image: item.image,
                    description: item.description,
                    category: item.category,
                    discount: Number(item.discount || 0),
                })),
                orders: orderDetails.filter(Boolean),
                notifications: notifications.map((notification) => ({
                    id: notification.id,
                    title: notification.title,
                    message: notification.message,
                    type: notification.type,
                    data: notification.data,
                    isRead: Boolean(notification.is_read),
                    createdAt: notification.created_at,
                    readAt: notification.read_at,
                })),
            });
        })
    );

    router.get(
        "/addresses",
        asyncHandler(async (req, res) => {
            const rows = await query(
                getPool(),
                "SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, created_at DESC",
                [req.user.id]
            );
            return sendOk(res, rows.map(mapAddress));
        })
    );

    router.post(
        "/addresses",
        asyncHandler(async (req, res) => {
            const payload = req.body || {};
            if (!payload.label || !payload.doorNo || !payload.city) {
                throw new HttpError(400, "Address label, door number, and city are required");
            }

            if (normalizeBoolean(payload.isDefault)) {
                await getPool().query("UPDATE addresses SET is_default = 0 WHERE user_id = ?", [
                    req.user.id,
                ]);
            }

            const [result] = await getPool().query(
                `INSERT INTO addresses
                (user_id, label, door_no, street, area, city, state, pincode, landmark, latitude, longitude, is_default)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    req.user.id,
                    payload.label,
                    payload.doorNo,
                    payload.street || null,
                    payload.area || null,
                    payload.city,
                    payload.state || null,
                    payload.pincode || null,
                    payload.landmark || null,
                    payload.latitude || null,
                    payload.longitude || null,
                    normalizeBoolean(payload.isDefault) ? 1 : 0,
                ]
            );

            const address = await queryOne(getPool(), "SELECT * FROM addresses WHERE id = ?", [
                result.insertId,
            ]);
            return sendOk(res, mapAddress(address));
        })
    );

    router.put(
        "/addresses/:addressId",
        asyncHandler(async (req, res) => {
            const existing = await queryOne(
                getPool(),
                "SELECT * FROM addresses WHERE id = ? AND user_id = ?",
                [req.params.addressId, req.user.id]
            );
            if (!existing) {
                throw new HttpError(404, "Address not found");
            }

            const payload = { ...existing, ...req.body };
            if (normalizeBoolean(payload.isDefault || payload.is_default)) {
                await getPool().query("UPDATE addresses SET is_default = 0 WHERE user_id = ?", [
                    req.user.id,
                ]);
            }

            await getPool().query(
                `UPDATE addresses
                 SET label = ?, door_no = ?, street = ?, area = ?, city = ?, state = ?, pincode = ?,
                     landmark = ?, latitude = ?, longitude = ?, is_default = ?
                 WHERE id = ? AND user_id = ?`,
                [
                    payload.label,
                    payload.doorNo || payload.door_no,
                    payload.street,
                    payload.area,
                    payload.city,
                    payload.state,
                    payload.pincode,
                    payload.landmark,
                    payload.latitude,
                    payload.longitude,
                    normalizeBoolean(payload.isDefault || payload.is_default) ? 1 : 0,
                    req.params.addressId,
                    req.user.id,
                ]
            );

            const address = await queryOne(getPool(), "SELECT * FROM addresses WHERE id = ?", [
                req.params.addressId,
            ]);
            return sendOk(res, mapAddress(address));
        })
    );

    router.delete(
        "/addresses/:addressId",
        asyncHandler(async (req, res) => {
            await getPool().query("DELETE FROM addresses WHERE id = ? AND user_id = ?", [
                req.params.addressId,
                req.user.id,
            ]);
            return sendOk(res, { deleted: true });
        })
    );

    router.get(
        "/cart",
        asyncHandler(async (req, res) => {
            const rows = await query(
                getPool(),
                "SELECT * FROM carts WHERE user_id = ? ORDER BY id DESC",
                [req.user.id]
            );
            return sendOk(
                res,
                rows.map((item) => ({
                    id: item.id,
                    menuId: item.menu_id,
                    name: item.name,
                    price: Number(item.price || 0),
                    qty: Number(item.qty || 0),
                }))
            );
        })
    );

    router.post(
        "/cart/items",
        asyncHandler(async (req, res) => {
            const { menuId, qty = 1 } = req.body || {};
            const menuItem = await queryOne(getPool(), "SELECT * FROM menu_items WHERE id = ?", [
                menuId,
            ]);
            if (!menuItem) {
                throw new HttpError(404, "Menu item not found");
            }

            const existing = await queryOne(
                getPool(),
                "SELECT * FROM carts WHERE user_id = ? AND menu_id = ?",
                [req.user.id, menuId]
            );

            if (existing) {
                await getPool().query("UPDATE carts SET qty = qty + ? WHERE id = ?", [
                    toNumber(qty, 1),
                    existing.id,
                ]);
            } else {
                await getPool().query(
                    `INSERT INTO carts (user_id, menu_id, name, price, qty)
                     VALUES (?, ?, ?, ?, ?)`,
                    [req.user.id, menuId, menuItem.name, menuItem.price, toNumber(qty, 1)]
                );
            }

            return sendOk(res, { updated: true });
        })
    );

    router.patch(
        "/cart/items/:cartItemId",
        asyncHandler(async (req, res) => {
            const qty = Math.max(1, toNumber(req.body?.qty, 1));
            await getPool().query("UPDATE carts SET qty = ? WHERE id = ? AND user_id = ?", [
                qty,
                req.params.cartItemId,
                req.user.id,
            ]);
            return sendOk(res, { updated: true });
        })
    );

    router.delete(
        "/cart/items/:cartItemId",
        asyncHandler(async (req, res) => {
            await getPool().query("DELETE FROM carts WHERE id = ? AND user_id = ?", [
                req.params.cartItemId,
                req.user.id,
            ]);
            return sendOk(res, { deleted: true });
        })
    );

    router.get(
        "/wishlist",
        asyncHandler(async (req, res) => {
            const rows = await query(
                getPool(),
                "SELECT * FROM wishlists WHERE user_id = ? ORDER BY id DESC",
                [req.user.id]
            );
            return sendOk(
                res,
                rows.map((item) => ({
                    id: item.id,
                    menuId: item.menu_id,
                    name: item.name,
                    price: Number(item.price || 0),
                    image: item.image,
                    description: item.description,
                    category: item.category,
                    discount: Number(item.discount || 0),
                }))
            );
        })
    );

    router.post(
        "/wishlist",
        asyncHandler(async (req, res) => {
            const { menuId } = req.body || {};
            const menuItem = await queryOne(getPool(), "SELECT * FROM menu_items WHERE id = ?", [
                menuId,
            ]);
            if (!menuItem) {
                throw new HttpError(404, "Menu item not found");
            }

            const existing = await queryOne(
                getPool(),
                "SELECT id FROM wishlists WHERE user_id = ? AND menu_id = ?",
                [req.user.id, menuId]
            );
            if (!existing) {
                await getPool().query(
                    `INSERT INTO wishlists (user_id, menu_id, name, price, image, description, category, discount)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        req.user.id,
                        menuId,
                        menuItem.name,
                        menuItem.price,
                        menuItem.image,
                        menuItem.description,
                        menuItem.category,
                        menuItem.discount,
                    ]
                );
            }

            return sendOk(res, { saved: true });
        })
    );

    router.delete(
        "/wishlist/:wishlistId",
        asyncHandler(async (req, res) => {
            await getPool().query("DELETE FROM wishlists WHERE id = ? AND user_id = ?", [
                req.params.wishlistId,
                req.user.id,
            ]);
            return sendOk(res, { deleted: true });
        })
    );

    router.get(
        "/orders",
        asyncHandler(async (req, res) => {
            const rows = await query(
                getPool(),
                "SELECT id FROM orders WHERE user_id = ? ORDER BY created_at DESC",
                [req.user.id]
            );
            const orders = await Promise.all(
                rows.map((row) => fetchOrderDetails(getPool(), row.id))
            );
            return sendOk(res, orders.filter(Boolean));
        })
    );

    router.get(
        "/orders/:orderId",
        asyncHandler(async (req, res) => {
            const order = await fetchOrderDetails(getPool(), req.params.orderId);
            if (!order || order.userId !== req.user.id) {
                throw new HttpError(404, "Order not found");
            }
            return sendOk(res, order);
        })
    );

    router.post(
        "/orders",
        asyncHandler(async (req, res) => {
            const { restaurantId, addressId, paymentMethod, notes, deliveryNotes, phone } =
                req.body || {};
            if (!restaurantId || !addressId || !paymentMethod) {
                throw new HttpError(400, "Restaurant, address, and payment method are required");
            }

            const [restaurant, address, cartItems] = await Promise.all([
                queryOne(getPool(), "SELECT * FROM restaurants WHERE id = ?", [restaurantId]),
                queryOne(
                    getPool(),
                    "SELECT * FROM addresses WHERE id = ? AND user_id = ?",
                    [addressId, req.user.id]
                ),
                query(getPool(), "SELECT * FROM carts WHERE user_id = ?", [req.user.id]),
            ]);

            if (!restaurant) throw new HttpError(404, "Restaurant not found");
            if (!address) throw new HttpError(404, "Address not found");
            if (!cartItems.length) throw new HttpError(400, "Cart is empty");

            const crossRestaurantItems = await query(
                getPool(),
                `SELECT c.id
                 FROM carts c
                 INNER JOIN menu_items mi ON mi.id = c.menu_id
                 WHERE c.user_id = ? AND mi.restaurant_id <> ?`,
                [req.user.id, restaurantId]
            );
            if (crossRestaurantItems.length) {
                throw new HttpError(
                    400,
                    "Your cart contains items from another restaurant. Clear the cart before checkout."
                );
            }

            const subtotal = cartItems.reduce(
                (sum, item) => sum + Number(item.price || 0) * Number(item.qty || 0),
                0
            );
            const discountAmount = subtotal > 500 ? subtotal * 0.05 : 0;
            const deliveryFee = 35;
            const taxAmount = subtotal * 0.05;
            const total = subtotal - discountAmount + deliveryFee + taxAmount;

            const orderId = await withTransaction(getPool(), async (connection) => {
                const [orderResult] = await connection.query(
                    `INSERT INTO orders
                    (order_number, user_id, restaurant_id, address_id, payment_method, payment_status,
                     status, subtotal, discount_amount, delivery_fee, tax_amount, total, notes,
                     delivery_notes, phone, door_no, street, area, city, state, zip_code,
                     estimated_delivery_time)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 45 MINUTE))`,
                    [
                        generateOrderNumber(),
                        req.user.id,
                        restaurantId,
                        addressId,
                        paymentMethod,
                        paymentMethod === "cod" ? "pending" : "paid",
                        "placed",
                        subtotal,
                        discountAmount,
                        deliveryFee,
                        taxAmount,
                        total,
                        notes || null,
                        deliveryNotes || null,
                        phone || req.user.phone || null,
                        address.door_no,
                        address.street,
                        address.area,
                        address.city,
                        address.state,
                        address.pincode,
                    ]
                );

                for (const item of cartItems) {
                    await connection.query(
                        `INSERT INTO order_items (order_id, menu_id, name, price, qty)
                         VALUES (?, ?, ?, ?, ?)`,
                        [orderResult.insertId, item.menu_id, item.name, item.price, item.qty]
                    );
                }

                await connection.query(
                    "INSERT INTO order_status_logs (order_id, status) VALUES (?, ?)",
                    [orderResult.insertId, "placed"]
                );
                await connection.query("DELETE FROM carts WHERE user_id = ?", [req.user.id]);
                await connection.query(
                    `UPDATE restaurants
                     SET total_orders = COALESCE(total_orders, 0) + 1
                     WHERE id = ?`,
                    [restaurantId]
                );

                return orderResult.insertId;
            });

            const order = await fetchOrderDetails(getPool(), orderId);
            return sendOk(res, order);
        })
    );

    router.post(
        "/orders/:orderId/review",
        asyncHandler(async (req, res) => {
            const order = await queryOne(
                getPool(),
                "SELECT id, restaurant_id, user_id FROM orders WHERE id = ?",
                [req.params.orderId]
            );
            if (!order || order.user_id !== req.user.id) {
                throw new HttpError(404, "Order not found");
            }

            const { rating, comment, deliveryRating, deliveryComment, menuItemId } = req.body || {};
            await getPool().query(
                `INSERT INTO reviews (order_id, user_id, restaurant_id, menu_item_id, rating, comment, delivery_rating, delivery_comment)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    order.id,
                    req.user.id,
                    order.restaurant_id,
                    menuItemId || null,
                    rating || null,
                    comment || null,
                    deliveryRating || null,
                    deliveryComment || null,
                ]
            );
            return sendOk(res, { created: true });
        })
    );

    router.get(
        "/notifications",
        asyncHandler(async (req, res) => {
            const notifications = await query(
                getPool(),
                "SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC",
                [req.user.id]
            );
            return sendOk(
                res,
                notifications.map((notification) => ({
                    id: notification.id,
                    title: notification.title,
                    message: notification.message,
                    type: notification.type,
                    data: notification.data,
                    isRead: Boolean(notification.is_read),
                    createdAt: notification.created_at,
                    readAt: notification.read_at,
                }))
            );
        })
    );

    router.post(
        "/notifications/:notificationId/read",
        asyncHandler(async (req, res) => {
            await getPool().query(
                `UPDATE notifications
                 SET is_read = 1, read_at = NOW()
                 WHERE id = ? AND user_id = ?`,
                [req.params.notificationId, req.user.id]
            );
            return sendOk(res, { updated: true });
        })
    );

    return router;
};

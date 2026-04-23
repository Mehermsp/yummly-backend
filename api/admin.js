const express = require("express");
const {
    asyncHandler,
    buildPagination,
    HttpError,
    normalizeBoolean,
    parseJsonList,
    query,
    queryOne,
    sendOk,
    toNumber,
    withTransaction,
} = require("./shared");

function mapRestaurant(row) {
    return {
        id: row.id,
        ownerId: row.owner_id,
        name: row.name,
        email: row.email,
        phone: row.phone,
        city: row.city,
        area: row.area,
        status: row.status,
        isApproved: Boolean(row.is_approved),
        isOpen: Boolean(row.is_open),
        isActive: Boolean(row.is_active),
        cuisines: parseJsonList(row.cuisines),
        totalOrders: Number(row.total_orders || 0),
        totalRevenue: Number(row.total_revenue || 0),
        platformFeePercent: Number(row.platform_fee_percent || 0),
        payoutNotes: row.payout_notes,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

module.exports = function registerAdminRoutes(getPool) {
    const router = express.Router();

    router.get(
        "/dashboard",
        asyncHandler(async (_req, res) => {
            const [users, restaurants, applications, orders, deliveryPartners] =
                await Promise.all([
                    query(getPool(), "SELECT role FROM users"),
                    query(getPool(), "SELECT * FROM restaurants"),
                    query(getPool(), "SELECT status FROM restaurant_applications"),
                    query(getPool(), "SELECT status, total FROM orders"),
                    query(
                        getPool(),
                        "SELECT id, name, email, phone, is_available, delivery_fee_per_order FROM users WHERE role = 'delivery_partner'"
                    ),
                ]);

            const totalRevenue = orders
                .filter((order) => order.status === "delivered")
                .reduce((sum, order) => sum + Number(order.total || 0), 0);

            return sendOk(res, {
                metrics: {
                    customers: users.filter((user) => user.role === "customer").length,
                    restaurants: restaurants.length,
                    approvedRestaurants: restaurants.filter((row) => row.is_approved).length,
                    pendingApplications: applications.filter((row) => row.status === "pending")
                        .length,
                    activeOrders: orders.filter(
                        (order) => !["delivered", "cancelled"].includes(order.status)
                    ).length,
                    totalRevenue,
                    onlineDeliveryPartners: deliveryPartners.filter(
                        (partner) => partner.is_available
                    ).length,
                },
                deliveryPartners: deliveryPartners.map((partner) => ({
                    id: partner.id,
                    name: partner.name,
                    email: partner.email,
                    phone: partner.phone,
                    isAvailable: Boolean(partner.is_available),
                    deliveryFeePerOrder: Number(partner.delivery_fee_per_order || 0),
                })),
            });
        })
    );

    router.get(
        "/applications",
        asyncHandler(async (req, res) => {
            const { page, limit, offset } = buildPagination(req);
            const rows = await query(
                getPool(),
                `SELECT ra.*, u.email AS owner_email, u.phone AS owner_phone
                 FROM restaurant_applications ra
                 INNER JOIN users u ON u.id = ra.owner_id
                 ORDER BY ra.created_at DESC
                 LIMIT ? OFFSET ?`,
                [limit, offset]
            );
            return sendOk(
                res,
                rows.map((row) => ({
                    id: row.id,
                    ownerId: row.owner_id,
                    ownerName: row.owner_name,
                    ownerEmail: row.owner_email,
                    ownerPhone: row.owner_phone,
                    restaurantName: row.restaurant_name,
                    address: row.address,
                    city: row.city,
                    pincode: row.pincode,
                    landmark: row.landmark,
                    cuisines: parseJsonList(row.cuisines),
                    openTime: row.open_time,
                    closeTime: row.close_time,
                    daysOpen: parseJsonList(row.days_open),
                    fssai: row.fssai,
                    gst: row.gst,
                    pan: row.pan,
                    logo: row.logo,
                    status: row.status,
                    reviewNotes: row.review_notes,
                    reviewedBy: row.reviewed_by,
                    reviewedAt: row.reviewed_at,
                    createdAt: row.created_at,
                    updatedAt: row.updated_at,
                })),
                { page, limit }
            );
        })
    );

    router.post(
        "/applications/:applicationId/review",
        asyncHandler(async (req, res) => {
            const application = await queryOne(
                getPool(),
                "SELECT * FROM restaurant_applications WHERE id = ?",
                [req.params.applicationId]
            );
            if (!application) {
                throw new HttpError(404, "Application not found");
            }

            const { decision, reviewNotes, platformFeePercent } = req.body || {};
            if (!["approved", "rejected"].includes(decision)) {
                throw new HttpError(400, "Decision must be approved or rejected");
            }

            const result = await withTransaction(getPool(), async (connection) => {
                await connection.query(
                    `UPDATE restaurant_applications
                     SET status = ?, review_notes = ?, reviewed_by = ?, reviewed_at = NOW(), updated_at = NOW()
                     WHERE id = ?`,
                    [decision, reviewNotes || null, req.user.id, application.id]
                );

                let restaurantId = null;
                if (decision === "approved") {
                    const existingRestaurant = await queryOne(
                        connection,
                        "SELECT id FROM restaurants WHERE owner_id = ? LIMIT 1",
                        [application.owner_id]
                    );

                    if (existingRestaurant) {
                        restaurantId = existingRestaurant.id;
                        await connection.query(
                            `UPDATE restaurants
                             SET name = ?, email = ?, phone = ?, address = ?, city = ?, pincode = ?, landmark = ?,
                                 cuisines = ?, open_time = ?, close_time = ?, days_open = ?, fssai = ?, gst = ?, pan = ?,
                                 status = 'approved', is_approved = 1, is_active = 1, platform_fee_percent = ?, updated_at = NOW()
                             WHERE id = ?`,
                            [
                                application.restaurant_name,
                                application.email,
                                application.phone,
                                application.address,
                                application.city,
                                application.pincode,
                                application.landmark,
                                application.cuisines,
                                application.open_time,
                                application.close_time,
                                application.days_open,
                                application.fssai,
                                application.gst,
                                application.pan,
                                toNumber(platformFeePercent, 18),
                                restaurantId,
                            ]
                        );
                    } else {
                        const [restaurantResult] = await connection.query(
                            `INSERT INTO restaurants
                            (owner_id, user_id, name, email, phone, address, city, pincode, landmark,
                             cuisines, open_time, close_time, days_open, fssai, gst, pan, logo, status,
                             is_approved, is_active, platform_fee_percent)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', 1, 1, ?)`,
                            [
                                application.owner_id,
                                application.owner_id,
                                application.restaurant_name,
                                application.email,
                                application.phone,
                                application.address,
                                application.city,
                                application.pincode,
                                application.landmark,
                                application.cuisines,
                                application.open_time,
                                application.close_time,
                                application.days_open,
                                application.fssai,
                                application.gst,
                                application.pan,
                                application.logo,
                                toNumber(platformFeePercent, 18),
                            ]
                        );
                        restaurantId = restaurantResult.insertId;
                    }
                }

                await connection.query(
                    `INSERT INTO admin_activity_log (admin_id, action, entity_type, entity_id, details)
                     VALUES (?, ?, 'restaurant_application', ?, ?)`,
                    [
                        req.user.id,
                        `application_${decision}`,
                        application.id,
                        JSON.stringify({ reviewNotes, platformFeePercent, restaurantId }),
                    ]
                );

                return { restaurantId };
            });

            return sendOk(res, { reviewed: true, ...result });
        })
    );

    router.get(
        "/restaurants",
        asyncHandler(async (_req, res) => {
            const rows = await query(getPool(), "SELECT * FROM restaurants ORDER BY updated_at DESC");
            return sendOk(res, rows.map(mapRestaurant));
        })
    );

    router.put(
        "/restaurants/:restaurantId",
        asyncHandler(async (req, res) => {
            const restaurant = await queryOne(
                getPool(),
                "SELECT * FROM restaurants WHERE id = ?",
                [req.params.restaurantId]
            );
            if (!restaurant) {
                throw new HttpError(404, "Restaurant not found");
            }

            const payload = req.body || {};
            await getPool().query(
                `UPDATE restaurants
                 SET status = ?, is_approved = ?, is_open = ?, is_active = ?, platform_fee_percent = ?,
                     payout_notes = ?, updated_at = NOW()
                 WHERE id = ?`,
                [
                    payload.status || restaurant.status,
                    normalizeBoolean(payload.isApproved, Boolean(restaurant.is_approved)) ? 1 : 0,
                    normalizeBoolean(payload.isOpen, Boolean(restaurant.is_open)) ? 1 : 0,
                    normalizeBoolean(payload.isActive, Boolean(restaurant.is_active)) ? 1 : 0,
                    payload.platformFeePercent ?? restaurant.platform_fee_percent,
                    payload.payoutNotes ?? restaurant.payout_notes,
                    restaurant.id,
                ]
            );
            const updated = await queryOne(getPool(), "SELECT * FROM restaurants WHERE id = ?", [
                restaurant.id,
            ]);
            return sendOk(res, mapRestaurant(updated));
        })
    );

    router.get(
        "/restaurants/:restaurantId/menu",
        asyncHandler(async (req, res) => {
            const rows = await query(
                getPool(),
                "SELECT * FROM menu_items WHERE restaurant_id = ? ORDER BY created_at DESC",
                [req.params.restaurantId]
            );
            return sendOk(
                res,
                rows.map((item) => ({
                    id: item.id,
                    restaurantId: item.restaurant_id,
                    name: item.name,
                    price: Number(item.price || 0),
                    category: item.category,
                    available: Boolean(item.available),
                    isAvailable: Boolean(item.is_available),
                    popularity: Number(item.popularity || 0),
                    rating: Number(item.rating || 0),
                    discount: Number(item.discount || 0),
                    preparationTimeMins: Number(item.preparation_time_mins || 0),
                }))
            );
        })
    );

    router.put(
        "/restaurants/:restaurantId/menu/:itemId",
        asyncHandler(async (req, res) => {
            const item = await queryOne(
                getPool(),
                "SELECT * FROM menu_items WHERE id = ? AND restaurant_id = ?",
                [req.params.itemId, req.params.restaurantId]
            );
            if (!item) throw new HttpError(404, "Menu item not found");

            const payload = req.body || {};
            await getPool().query(
                `UPDATE menu_items
                 SET available = ?, is_available = ?, discount = ?, popularity = ?
                 WHERE id = ? AND restaurant_id = ?`,
                [
                    normalizeBoolean(payload.available, Boolean(item.available)) ? 1 : 0,
                    normalizeBoolean(payload.isAvailable, Boolean(item.is_available)) ? 1 : 0,
                    payload.discount ?? item.discount,
                    payload.popularity ?? item.popularity,
                    item.id,
                    req.params.restaurantId,
                ]
            );
            await getPool().query(
                `INSERT INTO admin_activity_log (admin_id, action, entity_type, entity_id, details)
                 VALUES (?, 'menu_item_updated', 'menu_item', ?, ?)`,
                [req.user.id, item.id, JSON.stringify(payload)]
            );
            return sendOk(res, { updated: true });
        })
    );

    router.get(
        "/orders",
        asyncHandler(async (_req, res) => {
            const rows = await query(
                getPool(),
                `SELECT o.*, u.name AS customer_name, r.name AS restaurant_name, dp.name AS delivery_partner_name
                 FROM orders o
                 INNER JOIN users u ON u.id = o.user_id
                 INNER JOIN restaurants r ON r.id = o.restaurant_id
                 LEFT JOIN users dp ON dp.id = o.delivery_partner_id
                 ORDER BY o.created_at DESC`
            );
            return sendOk(
                res,
                rows.map((row) => ({
                    id: row.id,
                    orderNumber: row.order_number,
                    customerName: row.customer_name,
                    restaurantName: row.restaurant_name,
                    deliveryPartnerId: row.delivery_partner_id,
                    deliveryPartnerName: row.delivery_partner_name,
                    status: row.status,
                    paymentStatus: row.payment_status,
                    total: Number(row.total || 0),
                    createdAt: row.created_at,
                    updatedAt: row.updated_at,
                }))
            );
        })
    );

    router.post(
        "/orders/:orderId/assign-delivery",
        asyncHandler(async (req, res) => {
            const order = await queryOne(getPool(), "SELECT * FROM orders WHERE id = ?", [
                req.params.orderId,
            ]);
            if (!order) throw new HttpError(404, "Order not found");

            const { deliveryPartnerId } = req.body || {};
            const partner = await queryOne(
                getPool(),
                "SELECT * FROM users WHERE id = ? AND role = 'delivery_partner'",
                [deliveryPartnerId]
            );
            if (!partner) throw new HttpError(404, "Delivery partner not found");

            await withTransaction(getPool(), async (connection) => {
                await connection.query(
                    "UPDATE orders SET delivery_partner_id = ?, updated_at = NOW() WHERE id = ?",
                    [deliveryPartnerId, order.id]
                );
                await connection.query(
                    `INSERT INTO delivery_assignments
                    (order_id, delivery_partner_id, status, assigned_at)
                     VALUES (?, ?, 'assigned', NOW())`,
                    [order.id, deliveryPartnerId]
                );
                await connection.query(
                    "INSERT INTO notifications (user_id, title, message, type, data) VALUES (?, ?, ?, ?, ?)",
                    [
                        deliveryPartnerId,
                        "New delivery assigned",
                        `Order ${order.order_number || order.id} is ready for pickup workflow.`,
                        "delivery_assignment",
                        JSON.stringify({ orderId: order.id }),
                    ]
                );
            });

            return sendOk(res, { assigned: true });
        })
    );

    router.get(
        "/delivery-partners",
        asyncHandler(async (_req, res) => {
            const rows = await query(
                getPool(),
                "SELECT id, name, email, phone, is_available, delivery_fee_per_order, created_at FROM users WHERE role = 'delivery_partner' ORDER BY is_available DESC, created_at DESC"
            );
            return sendOk(
                res,
                rows.map((row) => ({
                    id: row.id,
                    name: row.name,
                    email: row.email,
                    phone: row.phone,
                    isAvailable: Boolean(row.is_available),
                    deliveryFeePerOrder: Number(row.delivery_fee_per_order || 0),
                    createdAt: row.created_at,
                }))
            );
        })
    );

    router.put(
        "/delivery-partners/:deliveryPartnerId",
        asyncHandler(async (req, res) => {
            const partner = await queryOne(
                getPool(),
                "SELECT * FROM users WHERE id = ? AND role = 'delivery_partner'",
                [req.params.deliveryPartnerId]
            );
            if (!partner) throw new HttpError(404, "Delivery partner not found");

            const payload = req.body || {};
            await getPool().query(
                `UPDATE users
                 SET is_available = ?, delivery_fee_per_order = ?
                 WHERE id = ?`,
                [
                    normalizeBoolean(payload.isAvailable, Boolean(partner.is_available)) ? 1 : 0,
                    payload.deliveryFeePerOrder ?? partner.delivery_fee_per_order,
                    partner.id,
                ]
            );

            return sendOk(res, { updated: true });
        })
    );

    router.post(
        "/notifications/broadcast",
        asyncHandler(async (req, res) => {
            const { title, message, type = "admin_broadcast", role, userIds = [] } = req.body || {};
            if (!title || !message) {
                throw new HttpError(400, "Notification title and message are required");
            }

            let recipients = [];
            if (Array.isArray(userIds) && userIds.length) {
                recipients = userIds;
            } else if (role) {
                const rows = await query(getPool(), "SELECT id FROM users WHERE role = ?", [role]);
                recipients = rows.map((row) => row.id);
            } else {
                throw new HttpError(400, "Provide a target role or explicit userIds");
            }

            await Promise.all(
                recipients.map((userId) =>
                    getPool().query(
                        `INSERT INTO notifications (user_id, title, message, type, data)
                         VALUES (?, ?, ?, ?, ?)`,
                        [userId, title, message, type, JSON.stringify({ sentByAdminId: req.user.id })]
                    )
                )
            );

            return sendOk(res, { delivered: recipients.length });
        })
    );

    return router;
};

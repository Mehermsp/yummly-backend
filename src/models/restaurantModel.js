import { getOne, query } from "../config/db.js";

export const listApprovedRestaurants = async ({ limit, offset, search }) => {
    const filters = ["r.is_active = 1"];
    const params = [];

    if (search) {
        filters.push("(r.name LIKE ? OR r.city LIKE ?)");
        params.push(`%${search}%`, `%${search}%`);
    }

    const whereClause = filters.join(" AND ");
    const items = await query(
        `
        SELECT
            r.id,
            r.name,
            r.description,
            r.city,
            r.state,
            r.logo_url,
            r.cover_image_url,
            r.rating,
            r.total_orders,
            r.cuisines,
            r.is_open
        FROM restaurants r
        WHERE ${whereClause}
        ORDER BY r.is_open DESC, r.rating DESC, r.created_at DESC
        LIMIT ? OFFSET ?
        `,
        [...params, limit, offset]
    );
    const [{ total }] = await query(
        `SELECT COUNT(*) AS total FROM restaurants r WHERE ${whereClause}`,
        params
    );

    return { items, total };
};

export const getRestaurantById = async (restaurantId) =>
    getOne(
        `
        SELECT
            r.*,
            u.name AS owner_name,
            u.phone AS owner_phone
        FROM restaurants r
        INNER JOIN users u ON u.id = r.owner_id
        WHERE r.id = ? AND r.is_active = 1
        LIMIT 1
        `,
        [restaurantId]
    );

export const getRestaurantMenu = async (restaurantId) =>
    query(
        `
        SELECT
            id,
            restaurant_id,
            name,
            description,
            price,
            discount_percent AS discount,
            category,
            cuisine_type,
            meal_type,
            food_type,
            preparation_time_mins,
            is_available,
            image_url AS image,
            rating,
            popularity
        FROM menu_items
        WHERE restaurant_id = ? AND is_deleted = 0
        ORDER BY category ASC, name ASC
        `,
        [restaurantId]
    );

export const createRestaurantApplication = async (payload) => {
    const result = await query(
        `
        INSERT INTO restaurant_applications (
            owner_id,
            restaurant_name,
            email,
            phone,
            address,
            city,
            state,
            pincode,
            landmark,
            cuisines,
            open_time,
            close_time,
            days_open,
            fssai_number,
            gst_number,
            pan_number
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
            payload.ownerId,
            payload.restaurantName,
            payload.email,
            payload.phone,
            payload.address,
            payload.city,
            payload.state || null,
            payload.pincode,
            payload.landmark || null,
            JSON.stringify(payload.cuisines || []),
            payload.openTime,
            payload.closeTime,
            JSON.stringify(payload.daysOpen || []),
            payload.fssaiNumber || null,
            payload.gstNumber || null,
            payload.panNumber || null,
        ]
    );

    return result.insertId;
};

export const getActiveApplicationByOwner = async (ownerId) =>
    getOne(
        `
        SELECT *
        FROM restaurant_applications
        WHERE owner_id = ?
        ORDER BY id DESC
        LIMIT 1
        `,
        [ownerId]
    );

export const getRestaurantByOwnerId = async (ownerId) =>
    getOne(
        `
        SELECT *
        FROM restaurants
        WHERE owner_id = ?
        LIMIT 1
        `,
        [ownerId]
    );

export const createMenuItem = async (restaurantId, payload) => {
    const result = await query(
        `
        INSERT INTO menu_items (
            restaurant_id,
            name,
            description,
            price,
            discount_percent,
            category,
            cuisine_type,
            meal_type,
            food_type,
            preparation_time_mins,
            image_url
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
            restaurantId,
            payload.name,
            payload.description || null,
            payload.price,
            payload.discountPercent || 0,
            payload.category || null,
            payload.cuisineType || null,
            payload.mealType || "lunch",
            payload.foodType || "vegetarian",
            payload.preparationTimeMins || 20,
            payload.imageUrl || null,
        ]
    );

    return result.insertId;
};

export const updateMenuItem = async (restaurantId, itemId, payload) =>
    query(
        `
        UPDATE menu_items
        SET
            name = ?,
            description = ?,
            price = ?,
            discount_percent = ?,
            category = ?,
            cuisine_type = ?,
            meal_type = ?,
            food_type = ?,
            preparation_time_mins = ?,
            image_url = ?,
            is_available = ?
        WHERE id = ? AND restaurant_id = ?
        `,
        [
            payload.name,
            payload.description || null,
            payload.price,
            payload.discountPercent || 0,
            payload.category || null,
            payload.cuisineType || null,
            payload.mealType || "lunch",
            payload.foodType || "vegetarian",
            payload.preparationTimeMins || 20,
            payload.imageUrl || null,
            payload.isAvailable ? 1 : 0,
            itemId,
            restaurantId,
        ]
    );

export const deleteMenuItem = async (restaurantId, itemId) =>
    query(
        `
        UPDATE menu_items
        SET is_deleted = 1, is_available = 0
        WHERE id = ? AND restaurant_id = ?
        `,
        [itemId, restaurantId]
    );

export const getRestaurantDashboard = async (restaurantId) => {
    const metrics = await getOne(
        `
        SELECT
            COUNT(*) AS total_orders,
            COALESCE(SUM(CASE WHEN status = 'delivered' THEN total ELSE 0 END), 0) AS delivered_revenue,
            COALESCE(SUM(CASE WHEN status IN ('placed', 'confirmed', 'preparing', 'ready_for_pickup', 'out_for_delivery') THEN 1 ELSE 0 END), 0) AS active_orders
        FROM orders
        WHERE restaurant_id = ?
        `,
        [restaurantId]
    );

    const recentOrders = await query(
        `
        SELECT id, order_number, status, total, created_at
        FROM orders
        WHERE restaurant_id = ?
        ORDER BY created_at DESC
        LIMIT 10
        `,
        [restaurantId]
    );

    return { metrics, recentOrders };
};

export const listRestaurantOrders = async (restaurantId, status) =>
    query(
        `
        SELECT
            o.id,
            o.order_number,
            o.status,
            o.total,
            o.payment_status,
            o.created_at,
            o.customer_notes,
            c.name AS customer_name,
            c.phone AS customer_phone,
            a.street,
            a.area,
            a.city,
            a.pincode
        FROM orders o
        INNER JOIN users c ON c.id = o.customer_id
        LEFT JOIN addresses a ON a.id = o.delivery_address_id
        WHERE o.restaurant_id = ?
          AND (? IS NULL OR o.status = ?)
        ORDER BY o.created_at DESC
        `,
        [restaurantId, status || null, status || null]
    );

export const listApplications = async (status) =>
    query(
        `
        SELECT
            ra.*,
            u.name AS owner_name,
            u.phone AS owner_phone
        FROM restaurant_applications ra
        INNER JOIN users u ON u.id = ra.owner_id
        WHERE (? IS NULL OR ra.status = ?)
        ORDER BY ra.created_at DESC
        `,
        [status || null, status || null]
    );

import { getOne, query } from "../config/db.js";

const buildMenuFilters = ({ includeUnavailable = true, category, search }) => {
    const filters = ["mi.restaurant_id = ?"];
    const params = [];

    if (!includeUnavailable) {
        filters.push("COALESCE(mi.is_available, 1) = 1");
        filters.push("COALESCE(mi.is_deleted, 0) = 0");
    }

    if (category) {
        filters.push("mi.category = ?");
        params.push(category);
    }

    if (search) {
        filters.push(
            "(mi.name LIKE ? OR mi.description LIKE ? OR mi.category LIKE ?)"
        );
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    return {
        whereClause: filters.join(" AND "),
        params,
    };
};

export const listApprovedRestaurants = async ({
    limit = 10,
    offset = 0,
    search,
    city,
    sort = "rating",
}) => {
    const filters = ["r.is_active = 1"];
    const params = [];

    if (search) {
        filters.push(
            "(r.name LIKE ? OR r.city LIKE ? OR r.landmark LIKE ? OR CAST(r.cuisines AS CHAR) LIKE ?)"
        );
        params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (city) {
        filters.push("r.city = ?");
        params.push(city);
    }

    const sortClause =
        sort === "newest"
            ? "r.created_at DESC"
            : sort === "orders"
            ? "r.total_orders DESC, r.rating DESC"
            : "r.rating DESC, r.total_orders DESC, r.created_at DESC";

    const whereClause = filters.join(" AND ");

    const items = await query(
        `
        SELECT
            r.id,
            r.name,
            r.description,
            r.city,
            r.state,
            r.landmark AS area,
            r.address,
            r.pincode,
            r.logo,
            r.cover_image,
            COALESCE(r.cover_image, r.logo) AS image_url,
            r.rating,
            r.total_orders,
            r.cuisines,
            r.is_open,
            r.open_time,
            r.close_time
        FROM restaurants r
        WHERE ${whereClause}
        ORDER BY r.is_open DESC, ${sortClause}
        LIMIT ? OFFSET ?
        `,
        [...params, String(limit), String(offset)] // ← String() is important
    );

    const [{ total }] = await query(
        `SELECT COUNT(*) AS total FROM restaurants r WHERE ${whereClause}`,
        params
    );

    return { items, total: Number(total) };
};

export const getRestaurantById = async (restaurantId) =>
    getOne(
        `
        SELECT
            r.*,
            r.landmark AS area,
            r.cover_image,                    -- corrected
            COALESCE(r.cover_image, r.logo) AS image_url,
            u.name AS owner_name,
            u.phone AS owner_phone
        FROM restaurants r
        INNER JOIN users u ON u.id = r.owner_id
        WHERE r.id = ?
        LIMIT 1
        `,
        [restaurantId]
    );

export const getRestaurantMenu = async (
    restaurantId,
    { includeUnavailable = true, category, search } = {}
) => {
    const { whereClause, params } = buildMenuFilters({
        includeUnavailable,
        category,
        search,
    });

    return query(
        `
        SELECT
            mi.id,
            mi.restaurant_id,
            mi.name,
            mi.description,
            mi.price,
            mi.discount,                    -- Changed from discount_percent
            mi.category,
            mi.cuisine_type,
            mi.meal_type,
            mi.food_type,
            mi.preparation_time_mins,
            mi.is_available,
            mi.image,                       -- Changed from image_url
            mi.rating,
            mi.popularity
        FROM menu_items mi
        WHERE ${whereClause}
        ORDER BY
            CASE WHEN mi.category IS NULL OR mi.category = '' THEN 1 ELSE 0 END,
            mi.category ASC,
            mi.popularity DESC,
            mi.name ASC
        `,
        [restaurantId, ...params]
    );
};

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
            payload.restaurantName || payload.restaurant_name,
            payload.email,
            payload.phone,
            payload.address,
            payload.city,
            payload.state || null,
            payload.pincode,
            payload.landmark || null,
            JSON.stringify(payload.cuisines || []),
            payload.openTime || payload.open_time,
            payload.closeTime || payload.close_time,
            JSON.stringify(payload.daysOpen || payload.days_open || []),
            payload.fssaiNumber || payload.fssai || payload.fssai_number || null,
            payload.gstNumber || payload.gst || payload.gst_number || null,
            payload.panNumber || payload.pan || payload.pan_number || null,
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
        SELECT
            r.*,
            r.landmark AS area,
            r.cover_image,
            COALESCE(r.cover_image, r.logo) AS image_url
        FROM restaurants r
        WHERE r.owner_id = ?
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
            image_url,
            is_available
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
            restaurantId,
            payload.name,
            payload.description || null,
            payload.price,
            payload.discountPercent ??
                payload.discount_percent ??
                payload.discount ??
                0,
            payload.category || null,
            payload.cuisineType || payload.cuisine_type || null,
            payload.mealType || payload.meal_type || "lunch",
            payload.foodType || payload.food_type || "vegetarian",
            payload.preparationTimeMins || payload.preparation_time_mins || 20,
            payload.imageUrl || payload.image || null,
            payload.isAvailable === false || Number(payload.is_available) === 0
                ? 0
                : 1,
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
            discount = ?,
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
            payload.discountPercent ??
                payload.discount_percent ??
                payload.discount ??
                0,
            payload.category || null,
            payload.cuisineType || payload.cuisine_type || null,
            payload.mealType || payload.meal_type || "lunch",
            payload.foodType || payload.food_type || "vegetarian",
            payload.preparationTimeMins || payload.preparation_time_mins || 20,
            payload.imageUrl || payload.image || null,
            payload.isAvailable === false || Number(payload.is_available) === 0
                ? 0
                : 1,
            itemId,
            restaurantId,
        ]
    );

export const deleteMenuItem = async (restaurantId, itemId) =>
    query(
        `
        UPDATE menu_items
        SET is_available = 0, is_deleted = 1
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
        SELECT
            id,
            order_number,
            status,
            total,
            created_at
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
            a.door_no,
            a.street,
            a.area,
            a.city,
            a.state,
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

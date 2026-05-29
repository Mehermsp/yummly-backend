import { getOne, query } from "../config/db.js";

const buildMenuFilters = ({ includeUnavailable = true, category, search }) => {
    const filters = ["mi.restaurant_id = ?"];
    const params = [];

    if (!includeUnavailable) {
        filters.push("COALESCE(mi.is_available, 1) = 1");
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
            COALESCE(r.delivery_enabled, 1) AS delivery_enabled,
            COALESCE(r.is_busy, 0) AS is_busy,
            COALESCE(r.peak_hour_available, 1) AS peak_hour_available,
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
            mi.discount,
            mi.category,
            mi.cuisine_type,
            mi.meal_type,
            mi.food_type,
            mi.preparation_time_mins,
            mi.is_available,
            mi.image AS image_url,          
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
            owner_id, owner_name, restaurant_name, email, phone,
            address, city, pincode, landmark, cuisines,
            open_time, close_time, days_open,
            fssai, gst, pan, logo, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NOW())
        `,
        [
            payload.ownerId,
            payload.ownerName,
            payload.restaurantName,
            payload.email,
            payload.phone,
            payload.address,
            payload.city,
            payload.pincode,
            payload.landmark || null,
            JSON.stringify(payload.cuisines || []),
            payload.openTime,
            payload.closeTime,
            JSON.stringify(payload.daysOpen || []),
            payload.fssai || null,
            payload.gst || null,
            payload.pan || null,
            payload.logo || null,
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
        WHERE r.owner_id = ? OR r.user_id = ?
        LIMIT 1
        `,
        [ownerId, ownerId]
    );

export const updateRestaurantProfileByOwnerId = async (
    ownerId,
    payload = {}
) => {
    const fields = [];
    const values = [];

    const assign = (column, value) => {
        if (value === undefined) return;
        fields.push(`${column} = ?`);
        values.push(value);
    };

    assign("name", payload.name);
    assign("description", payload.description);
    assign("city", payload.city);
    assign("area", payload.area);
    assign("address", payload.address);
    assign("pincode", payload.pincode);
    assign("landmark", payload.landmark);
    assign("open_time", payload.open_time);
    assign("close_time", payload.close_time);
    assign("logo", payload.logo);
    assign("cover_image", payload.cover_image);

    if (payload.cuisines !== undefined) {
        assign("cuisines", JSON.stringify(payload.cuisines || []));
    }
    if (payload.days_open !== undefined) {
        assign("days_open", JSON.stringify(payload.days_open || []));
    }

    if (!fields.length) return;

    assign("updated_at", new Date());

    await query(
        `UPDATE restaurants SET ${fields.join(
            ", "
        )} WHERE owner_id = ? OR user_id = ?`,
        [...values, ownerId, ownerId]
    );
};

export const updateRestaurantOperationsByOwnerId = async (
    ownerId,
    payload = {}
) => {
    const fields = [];
    const values = [];

    const assign = (column, value) => {
        if (value === undefined) return;
        fields.push(`${column} = ?`);
        values.push(value);
    };

    const assignBoolean = (column, value) => {
        if (value === undefined) return;
        assign(column, value ? 1 : 0);
    };

    assignBoolean("is_open", payload.isOpen ?? payload.is_open);
    assignBoolean("is_busy", payload.isBusy ?? payload.is_busy);
    assignBoolean(
        "delivery_enabled",
        payload.deliveryEnabled ?? payload.delivery_enabled
    );
    assignBoolean(
        "peak_hour_available",
        payload.peakHourAvailable ?? payload.peak_hour_available
    );

    const radius = payload.deliveryRadiusKm ?? payload.delivery_radius_km;
    if (radius !== undefined) {
        const safeRadius = Number(radius);
        assign(
            "delivery_radius_km",
            Number.isFinite(safeRadius) && safeRadius > 0 ? safeRadius : null
        );
    }

    assign(
        "operations_note",
        payload.operationsNote ?? payload.operations_note
    );

    if (!fields.length) return;

    await query(
        `
        UPDATE restaurants
        SET ${fields.join(", ")}, updated_at = NOW()
        WHERE owner_id = ? OR user_id = ?
        `,
        [...values, ownerId, ownerId]
    );
};

export const createMenuItem = async (restaurantId, payload) => {
    const mealTypeRaw = String(
        payload.mealType || payload.meal_type || "Lunch"
    ).toLowerCase();
    const mealType =
        mealTypeRaw === "breakfast"
            ? "Breakfast"
            : mealTypeRaw === "dinner"
            ? "Dinner"
            : "Lunch";

    const foodTypeRaw = String(
        payload.foodType || payload.food_type || "Veg"
    ).toLowerCase();
    const foodType =
        foodTypeRaw === "non-veg" ||
        foodTypeRaw === "non_veg" ||
        foodTypeRaw === "nonveg" ||
        foodTypeRaw === "non veg"
            ? "Non-Veg"
            : "Veg";

    const result = await query(
        `
        INSERT INTO menu_items (
            restaurant_id,
            name,
            description,
            price,
            discount,
            category,
            cuisine_type,
            meal_type,
            food_type,
            preparation_time_mins,
            image,
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
            mealType,
            foodType,
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
            image = ?,
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
            (() => {
                const mealTypeRaw = String(
                    payload.mealType || payload.meal_type || "Lunch"
                ).toLowerCase();
                return mealTypeRaw === "breakfast"
                    ? "Breakfast"
                    : mealTypeRaw === "dinner"
                    ? "Dinner"
                    : "Lunch";
            })(),
            (() => {
                const foodTypeRaw = String(
                    payload.foodType || payload.food_type || "Veg"
                ).toLowerCase();
                return foodTypeRaw === "non-veg" ||
                    foodTypeRaw === "non_veg" ||
                    foodTypeRaw === "nonveg" ||
                    foodTypeRaw === "non veg"
                    ? "Non-Veg"
                    : "Veg";
            })(),
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
        DELETE FROM menu_items
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
COALESCE(SUM(CASE WHEN status IN ('placed', 'confirmed', 'preparing', 'ready', 'ready_for_pickup', 'on_the_way', 'out_for_delivery') THEN 1 ELSE 0 END), 0) AS active_orders
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

export const getRestaurantAnalytics = async ({
    restaurantId,
    days = 30,
} = {}) => {
    const safeDays = Math.min(Math.max(Number(days) || 30, 7), 365);

    const [summary] = await query(
        `
        SELECT
            COUNT(*) AS total_orders,
            COUNT(CASE WHEN status = 'delivered' THEN 1 END) AS delivered_orders,
            COUNT(CASE WHEN status = 'cancelled' THEN 1 END) AS cancelled_orders,
            COALESCE(SUM(CASE WHEN status = 'delivered' THEN total ELSE 0 END), 0) AS delivered_revenue,
            COALESCE(AVG(CASE WHEN status = 'delivered' THEN total END), 0) AS average_order_value,
            COUNT(DISTINCT user_id) AS unique_customers,
            COUNT(*) - COUNT(DISTINCT user_id) AS repeat_order_count
        FROM orders
        WHERE restaurant_id = ?
          AND created_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ? DAY)
        `,
        [restaurantId, safeDays]
    );

    const dailyRevenue = await query(
        `
        SELECT
            DATE(created_at) AS date,
            COUNT(*) AS orders,
            COALESCE(SUM(CASE WHEN status = 'delivered' THEN total ELSE 0 END), 0) AS revenue
        FROM orders
        WHERE restaurant_id = ?
          AND created_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ? DAY)
        GROUP BY DATE(created_at)
        ORDER BY date ASC
        `,
        [restaurantId, safeDays]
    );

    const weeklyRevenue = await query(
        `
        SELECT
            YEARWEEK(created_at, 1) AS week,
            MIN(DATE(created_at)) AS week_start,
            COUNT(*) AS orders,
            COALESCE(SUM(CASE WHEN status = 'delivered' THEN total ELSE 0 END), 0) AS revenue
        FROM orders
        WHERE restaurant_id = ?
          AND created_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ? DAY)
        GROUP BY YEARWEEK(created_at, 1)
        ORDER BY week_start ASC
        `,
        [restaurantId, safeDays]
    );

    const monthlyRevenue = await query(
        `
        SELECT
            DATE_FORMAT(created_at, '%Y-%m') AS month,
            COUNT(*) AS orders,
            COALESCE(SUM(CASE WHEN status = 'delivered' THEN total ELSE 0 END), 0) AS revenue
        FROM orders
        WHERE restaurant_id = ?
          AND created_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ? DAY)
        GROUP BY DATE_FORMAT(created_at, '%Y-%m')
        ORDER BY month ASC
        `,
        [restaurantId, safeDays]
    );

    const peakHours = await query(
        `
        SELECT
            HOUR(created_at) AS hour,
            COUNT(*) AS orders,
            COALESCE(SUM(CASE WHEN status = 'delivered' THEN total ELSE 0 END), 0) AS revenue
        FROM orders
        WHERE restaurant_id = ?
          AND created_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ? DAY)
        GROUP BY HOUR(created_at)
        ORDER BY orders DESC, hour ASC
        `,
        [restaurantId, safeDays]
    );

    const itemPerformance = await query(
        `
        SELECT
            mi.id,
            mi.name,
            mi.category,
            COUNT(DISTINCT oi.order_id) AS order_count,
            COALESCE(SUM(COALESCE(oi.qty, oi.quantity, 0)), 0) AS quantity_sold,
            COALESCE(SUM(oi.subtotal), 0) AS revenue,
            COALESCE(mi.is_available, 1) AS is_available
        FROM menu_items mi
        LEFT JOIN order_items oi ON oi.menu_id = mi.id
        LEFT JOIN orders o ON o.id = oi.order_id
            AND o.restaurant_id = mi.restaurant_id
            AND o.created_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ? DAY)
        WHERE mi.restaurant_id = ?
        GROUP BY mi.id, mi.name, mi.category, mi.is_available
        ORDER BY quantity_sold DESC, revenue DESC
        `,
        [safeDays, restaurantId]
    );

    const cancellationAnalytics = await query(
        `
        SELECT
            status,
            COUNT(*) AS orders,
            ROUND((COUNT(*) * 100.0) / NULLIF((
                SELECT COUNT(*)
                FROM orders
                WHERE restaurant_id = ?
                  AND created_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ? DAY)
            ), 0), 2) AS percentage
        FROM orders
        WHERE restaurant_id = ?
          AND status IN ('cancelled', 'refunded')
          AND created_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ? DAY)
        GROUP BY status
        `,
        [restaurantId, safeDays, restaurantId, safeDays]
    );

    let refundAnalytics = [];
    try {
        refundAnalytics = await query(
            `
            SELECT
                rr.status,
                COUNT(*) AS refunds,
                COALESCE(SUM(rr.amount), 0) AS amount
            FROM refund_requests rr
            INNER JOIN orders o ON o.id = rr.order_id
            WHERE o.restaurant_id = ?
              AND rr.requested_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ? DAY)
            GROUP BY rr.status
            ORDER BY amount DESC
            `,
            [restaurantId, safeDays]
        );
    } catch {
        refundAnalytics = [];
    }

    const categoryTrends = await query(
        `
        SELECT
            COALESCE(mi.category, 'uncategorized') AS category,
            COUNT(DISTINCT oi.order_id) AS orders,
            COALESCE(SUM(COALESCE(oi.qty, oi.quantity, 0)), 0) AS quantity_sold,
            COALESCE(SUM(oi.subtotal), 0) AS revenue
        FROM menu_items mi
        LEFT JOIN order_items oi ON oi.menu_id = mi.id
        LEFT JOIN orders o ON o.id = oi.order_id
            AND o.restaurant_id = mi.restaurant_id
            AND o.created_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ? DAY)
        WHERE mi.restaurant_id = ?
        GROUP BY COALESCE(mi.category, 'uncategorized')
        ORDER BY revenue DESC
        `,
        [safeDays, restaurantId]
    );

    return {
        period_days: safeDays,
        summary: {
            total_orders: Number(summary?.total_orders || 0),
            delivered_orders: Number(summary?.delivered_orders || 0),
            cancelled_orders: Number(summary?.cancelled_orders || 0),
            delivered_revenue: Number(summary?.delivered_revenue || 0),
            average_order_value: Number(summary?.average_order_value || 0),
            unique_customers: Number(summary?.unique_customers || 0),
            repeat_order_count: Number(summary?.repeat_order_count || 0),
            cancellation_rate:
                Number(summary?.total_orders || 0) > 0
                    ? Number(
                          (
                              (Number(summary?.cancelled_orders || 0) /
                                  Number(summary?.total_orders || 1)) *
                              100
                          ).toFixed(2)
                      )
                    : 0,
        },
        daily_revenue: dailyRevenue,
        weekly_revenue: weeklyRevenue,
        monthly_revenue: monthlyRevenue,
        peak_hours: peakHours,
        best_selling_items: itemPerformance.slice(0, 10),
        worst_performing_items: itemPerformance.slice(-10).reverse(),
        item_conversion: itemPerformance,
        cancellation_analytics: cancellationAnalytics,
        refund_analytics: refundAnalytics,
        category_trends: categoryTrends,
    };
};

export const listRestaurantOrders = async (restaurantId, status) => {
    return query(
        `
        SELECT
            o.id,
            o.order_number,
            o.status,
            o.total,
            o.payment_status,
            o.created_at,
            o.notes AS customer_notes,
            c.name AS customer_name,
            c.phone AS customer_phone,
            o.door_no,
            o.street,
            o.area,
            o.city,
            o.state,
            o.zip_code AS pincode,
            (
                SELECT COALESCE(SUM(oi.qty), 0)
                FROM order_items oi
                WHERE oi.order_id = o.id
            ) AS item_count
        FROM orders o
        INNER JOIN users c ON c.id = o.user_id
        WHERE o.restaurant_id = ?
          AND (? IS NULL OR o.status = ?)
        ORDER BY o.created_at DESC
        `,
        [restaurantId, status || null, status || null]
    );
};

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

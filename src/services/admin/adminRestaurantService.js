import { query, withTransaction } from "../../config/db.js";
import {
    createNotification,
    emitRealtimeEvent,
    notifyAdmins,
} from "../notificationService.js";

const isUnknownColumnError = (error) =>
    error?.code === "ER_BAD_FIELD_ERROR" ||
    String(error?.message || "")
        .toLowerCase()
        .includes("unknown column");

let restaurantApplicationColumnNamesPromise;

const getRestaurantApplicationColumnNames = async () => {
    if (!restaurantApplicationColumnNamesPromise) {
        restaurantApplicationColumnNamesPromise = query(
            "SHOW COLUMNS FROM restaurant_applications"
        ).then((rows) => new Set(rows.map((row) => row.Field)));
    }

    return restaurantApplicationColumnNamesPromise;
};

const getRestaurantApplicationLegalColumns = async () => {
    const columns = await getRestaurantApplicationColumnNames();

    return {
        fssai: columns.has("fssai") ? "fssai" : "fssai_number",
        gst: columns.has("gst") ? "gst" : "gst_number",
        pan: columns.has("pan") ? "pan" : "pan_number",
    };
};

// ==============================
// APPLICATIONS
// ==============================

export const getApplications = async (limit) => {
    const legalColumns = await getRestaurantApplicationLegalColumns();
    let sql = `
        SELECT 
            id,
            owner_id as user_id,
            owner_name,
            email,
            phone,
            restaurant_name,
            address,
            city,
            pincode,
            NULL as state,
            cuisines as cuisine_type,
            open_time as opening_time,
            close_time as closing_time,
            ${legalColumns.fssai} as license_number,
            ${legalColumns.gst} as gst_number,
            ${legalColumns.pan} as pan_number,
            status,
            review_notes as rejection_reason,
            created_at,
            updated_at
        FROM restaurant_applications
        ORDER BY created_at DESC
    `;

    if (limit) {
        sql += ` LIMIT ${parseInt(limit)}`;
    }

    try {
        return await query(sql);
    } catch (error) {
        if (!isUnknownColumnError(error)) {
            throw error;
        }

        let fallbackSql = `
            SELECT 
                id,
                owner_id as user_id,
                owner_name,
                email,
                phone,
                restaurant_name,
                address,
                city,
                pincode,
                NULL as state,
                cuisines as cuisine_type,
                open_time as opening_time,
                close_time as closing_time,
                fssai as license_number,
                gst as gst_number,
                pan as pan_number,
                status,
                review_notes as rejection_reason,
                created_at,
                updated_at
            FROM restaurant_applications
            ORDER BY created_at DESC
        `;

        if (limit) {
            fallbackSql += ` LIMIT ${parseInt(limit)}`;
        }

        return await query(fallbackSql);
    }
};

export const getApplicationById = async (id) => {
    const legalColumns = await getRestaurantApplicationLegalColumns();
    try {
        const applications = await query(
            `
            SELECT 
                id,
                owner_id as user_id,
                owner_name,
                email,
                phone,
                restaurant_name,
                address,
                city,
                pincode,
                NULL as state,
                landmark,
                cuisines as cuisine_type,
                open_time as opening_time,
                close_time as closing_time,
                days_open,
                ${legalColumns.fssai} as license_number,
                ${legalColumns.gst} as gst_number,
                ${legalColumns.pan} as pan_number,
                logo,
                status,
                review_notes as rejection_reason,
                reviewed_by,
                reviewed_at,
                created_at,
                updated_at
            FROM restaurant_applications 
            WHERE id = ?
            `,
            [id]
        );

        return applications[0] || null;
    } catch (error) {
        if (!isUnknownColumnError(error)) {
            throw error;
        }

        const applications = await query(
            `
            SELECT 
                id,
                owner_id as user_id,
                owner_name,
                email,
                phone,
                restaurant_name,
                address,
                city,
                pincode,
                NULL as state,
                landmark,
                cuisines as cuisine_type,
                open_time as opening_time,
                close_time as closing_time,
                days_open,
                fssai as license_number,
                gst as gst_number,
                pan as pan_number,
                logo,
                status,
                review_notes as rejection_reason,
                reviewed_by,
                reviewed_at,
                created_at,
                updated_at
            FROM restaurant_applications 
            WHERE id = ?
            `,
            [id]
        );

        return applications[0] || null;
    }
};

export const approveApplication = async ({ applicationId, reviewedBy }) => {
    const result = await withTransaction(async (connection) => {
        const [applications] = await connection.execute(
            `
            SELECT *
            FROM restaurant_applications
            WHERE id = ?
            `,
            [applicationId]
        );

        if (!applications.length) {
            throw new Error("Application not found");
        }

        const app = applications[0];

        await connection.execute(
            `
            UPDATE restaurant_applications
            SET status = 'approved',
                reviewed_by = ?,
                reviewed_at = NOW()
            WHERE id = ?
            `,
            [reviewedBy, applicationId]
        );

        try {
            const [restaurantResult] = await connection.execute(
                `
                INSERT INTO restaurants (
                    user_id,
                    owner_id,
                    name,
                    email,
                    phone,
                    description,
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
                    pan_number,
                    logo,
                    is_active,
                    is_approved,
                    status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 'approved')
                `,
                [
                    app.owner_id,
                    app.owner_id,
                    app.restaurant_name,
                    app.email,
                    app.phone,
                    "",
                    app.address,
                    app.city,
                    "",
                    app.pincode,
                    app.landmark || "",
                    app.cuisines || "[]",
                    app.open_time,
                    app.close_time,
                    app.days_open || "[]",
                    app.fssai_number || app.fssai || null,
                    app.gst_number || app.gst || null,
                    app.pan_number || app.pan || null,
                    app.logo || "",
                ]
            );
        } catch (error) {
            if (!isUnknownColumnError(error)) {
                throw error;
            }

            const [restaurantResult] = await connection.execute(
                `
                INSERT INTO restaurants (
                    user_id,
                    owner_id,
                    name,
                    email,
                    phone,
                    description,
                    address,
                    city,
                    state,
                    pincode,
                    landmark,
                    cuisines,
                    open_time,
                    close_time,
                    days_open,
                    fssai,
                    gst,
                    pan,
                    logo,
                    is_active,
                    is_approved,
                    status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 'approved')
                `,
                [
                    app.owner_id,
                    app.owner_id,
                    app.restaurant_name,
                    app.email,
                    app.phone,
                    "",
                    app.address,
                    app.city,
                    "",
                    app.pincode,
                    app.landmark || "",
                    app.cuisines || "[]",
                    app.open_time,
                    app.close_time,
                    app.days_open || "[]",
                    app.fssai_number || app.fssai || null,
                    app.gst_number || app.gst || null,
                    app.pan_number || app.pan || null,
                    app.logo || "",
                ]
            );
        }

        return {
            success: true,
            message: "Application approved and restaurant created successfully",
            ownerId: app.owner_id,
            restaurantName: app.restaurant_name,
            restaurantId: restaurantResult?.insertId || null,
        };
    });

    if (result.ownerId) {
        await createNotification({
            userId: result.ownerId,
            title: "Restaurant approved",
            message: `${result.restaurantName || "Your restaurant"} is approved and live.`,
            type: "restaurant_approval",
            data: {
                applicationId,
                restaurantId: result.restaurantId,
                status: "approved",
            },
        });
    }
    await notifyAdmins({
        title: "Restaurant application approved",
        message: `${result.restaurantName || "Restaurant"} was approved.`,
        type: "restaurant_application",
        data: { applicationId, restaurantId: result.restaurantId },
    });
    emitRealtimeEvent({
        room: "admin:restaurants",
        eventName: "restaurant:application-reviewed",
        payload: result,
    });

    return result;
};

export const rejectApplication = async ({
    applicationId,
    rejectionReason,
    reviewedBy,
}) => {
    const application = await getApplicationById(applicationId);

    await query(
        `
        UPDATE restaurant_applications
        SET status = 'rejected',
            review_notes = ?,
            reviewed_by = ?,
            reviewed_at = NOW()
        WHERE id = ?
        `,
        [rejectionReason, reviewedBy, applicationId]
    );

    const result = {
        success: true,
        message: "Application rejected successfully",
    };

    if (application?.user_id || application?.owner_id) {
        await createNotification({
            userId: application.user_id || application.owner_id,
            title: "Restaurant application rejected",
            message:
                rejectionReason ||
                "Your restaurant application needs changes before approval.",
            type: "restaurant_approval",
            data: { applicationId, status: "rejected" },
        });
    }
    emitRealtimeEvent({
        room: "admin:restaurants",
        eventName: "restaurant:application-reviewed",
        payload: { applicationId, status: "rejected" },
    });

    return result;
};

// ==============================
// RESTAURANTS
// ==============================

export const getRestaurants = async () => {
    try {
        const restaurants = await query(`
            SELECT 
                r.*,
                u.name as owner_name,
                u.email as owner_email,
                u.phone as owner_phone
            FROM restaurants r
            LEFT JOIN users u ON r.user_id = u.id
            ORDER BY r.created_at DESC
        `);

        return restaurants.map((r) => ({
            ...r,
            status: r.is_active ? "active" : "inactive",
        }));
    } catch (error) {
        console.warn(error.message);

        return await query(`
            SELECT *
            FROM restaurants
            ORDER BY created_at DESC
        `);
    }
};

export const getRestaurantById = async (id) => {
    const restaurants = await query(
        `
        SELECT 
            r.*,
            u.name as owner_name,
            u.email as owner_email,
            u.phone as owner_phone
        FROM restaurants r
        LEFT JOIN users u ON r.user_id = u.id
        WHERE r.id = ?
        `,
        [id]
    );

    return restaurants[0] || null;
};

export const updateRestaurantStatus = async (id, status) => {
    const isActive = status === "active" ? 1 : 0;

    await query(
        `
        UPDATE restaurants
        SET is_active = ?
        WHERE id = ?
        `,
        [isActive, id]
    );

    const restaurant = await getRestaurantById(id);

    if (restaurant?.owner_id || restaurant?.user_id) {
        await createNotification({
            userId: restaurant.owner_id || restaurant.user_id,
            title:
                status === "active"
                    ? "Restaurant activated"
                    : "Restaurant status changed",
            message: `${restaurant.name || "Your restaurant"} is now ${status}.`,
            type: status === "suspended" ? "restaurant_suspension" : "restaurant_status",
            data: { restaurantId: id, status },
        });
    }
    emitRealtimeEvent({
        room: `restaurant:${id}`,
        eventName: "restaurant:operations-updated",
        payload: { restaurantId: id, status, isActive },
    });
    emitRealtimeEvent({
        room: "admin:restaurants",
        eventName: "restaurant:operations-updated",
        payload: { restaurantId: id, status, isActive },
    });

    return {
        success: true,
        message: "Restaurant status updated successfully",
    };
};

export const updateRestaurant = async (id, data) => {
    const fields = Object.keys(data)
        .map((key) => `${key} = ?`)
        .join(", ");

    const values = Object.values(data);

    await query(
        `
        UPDATE restaurants
        SET ${fields}
        WHERE id = ?
        `,
        [...values, id]
    );

    return {
        success: true,
        message: "Restaurant updated successfully",
    };
};

// ==============================
// MENU
// ==============================

export const getRestaurantMenu = async (restaurantId) => {
    return await query(
        `
        SELECT
            id,
            name,
            description,
            price,
            image,
            category,
            meal_type,
            cuisine_type,
            food_type,
            rating,
            discount,
            popularity,
            is_available,
            available,
            preparation_time_mins,
            created_at
        FROM menu_items
        WHERE restaurant_id = ?
        ORDER BY is_available DESC,
                 popularity DESC,
                 created_at DESC
        `,
        [restaurantId]
    );
};

// ==============================
// ANALYTICS
// ==============================

export const getRestaurantAnalytics = async (restaurantId) => {
    const totalOrders = await query(
        `
        SELECT COUNT(*) as total
        FROM orders
        WHERE restaurant_id = ?
        `,
        [restaurantId]
    );

    const totalRevenue = await query(
        `
        SELECT COALESCE(SUM(total), 0) as total
        FROM orders
        WHERE restaurant_id = ?
        AND status = 'delivered'
        `,
        [restaurantId]
    );

    const avgOrderValue = await query(
        `
        SELECT AVG(total) as average
        FROM orders
        WHERE restaurant_id = ?
        AND status = 'delivered'
        `,
        [restaurantId]
    );

    const totalCustomers = await query(
        `
        SELECT COUNT(DISTINCT user_id) as total
        FROM orders
        WHERE restaurant_id = ?
        `,
        [restaurantId]
    );

    const platformFee = await query(
        `
        SELECT COALESCE(
            SUM(
                o.total *
                (COALESCE(r.platform_fee_percent, 0) / 100)
            ),
            0
        ) as total
        FROM orders o
        JOIN restaurants r
            ON o.restaurant_id = r.id
        WHERE o.restaurant_id = ?
        AND o.status = 'delivered'
        `,
        [restaurantId]
    );

    const ordersByStatus = await query(
        `
        SELECT status, COUNT(*) as count
        FROM orders
        WHERE restaurant_id = ?
        GROUP BY status
        `,
        [restaurantId]
    );

    const dailyRevenue = await query(
        `
        SELECT 
            DATE(created_at) as date,
            SUM(total) as revenue,
            COUNT(*) as orders
        FROM orders
        WHERE restaurant_id = ?
        AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
        GROUP BY DATE(created_at)
        ORDER BY date DESC
        `,
        [restaurantId]
    );

    const topMenuItems = await query(
        `
        SELECT 
            mi.id,
            mi.name,
            COUNT(oi.id) as order_count,
            SUM(oi.qty) as total_qty
        FROM order_items oi
        JOIN menu_items mi
            ON oi.menu_id = mi.id
        WHERE mi.restaurant_id = ?
        GROUP BY mi.id
        ORDER BY order_count DESC
        LIMIT 10
        `,
        [restaurantId]
    );

    return {
        total_orders: Number(totalOrders[0]?.total || 0),

        total_revenue: Number(totalRevenue[0]?.total || 0),

        average_order_value: Number(avgOrderValue[0]?.average || 0),

        total_customers: Number(totalCustomers[0]?.total || 0),

        platform_earnings: Number(platformFee[0]?.total || 0),

        orders_by_status: ordersByStatus,

        daily_revenue: dailyRevenue,

        top_menu_items: topMenuItems,
    };
};

import { query } from "../../config/db.js";

// Get Delivery Partners
export const getDeliveryPartners = async (showAll = false) => {
    const availabilityFilter = showAll ? "" : "AND u.is_available = 1";

    const partners = await query(`
        SELECT 
            u.id,
            u.name,
            u.email,
            u.phone,
            u.profile_image,
            u.is_available,
            u.role,
            u.created_at,

            (
                SELECT COUNT(*)
                FROM orders
                WHERE delivery_partner_id = u.id
                AND status = 'delivered'
            ) as total_deliveries,

            (
                SELECT AVG(rv.delivery_rating)
                FROM orders od
                LEFT JOIN reviews rv ON rv.order_id = od.id
                WHERE od.delivery_partner_id = u.id
                AND rv.delivery_rating IS NOT NULL
            ) as rating,

            (
                SELECT COUNT(*)
                FROM delivery_assignments
                WHERE delivery_partner_id = u.id
                AND status = 'assigned'
            ) as pending_assignments,

            (
                SELECT COALESCE(SUM(delivery_fee), 0)
                FROM orders
                WHERE delivery_partner_id = u.id
                AND status = 'delivered'
            ) as total_earnings,

            u.delivery_fee_per_order

        FROM users u
        WHERE u.role = 'delivery_partner'
        ${availabilityFilter}

        ORDER BY u.is_available DESC, u.created_at DESC
    `);

    return partners.map((p) => ({
        ...p,

        status: p.is_available
            ? p.pending_assignments > 0
                ? "busy"
                : "active"
            : "inactive",

        vehicle_type: "bike",

        total_deliveries: Number(p.total_deliveries || 0),

        rating: p.rating ? Number(p.rating).toFixed(1) : "N/A",

        pending_assignments: Number(p.pending_assignments || 0),

        total_earnings: Number(p.total_earnings || 0),
    }));
};

// Get Delivery Partner By ID
export const getDeliveryPartnerById = async (id) => {
    const partners = await query(
        `
        SELECT 
            u.id,
            u.name,
            u.email,
            u.phone,
            u.profile_image,
            u.is_available,
            u.role,
            u.created_at,
            u.delivery_fee_per_order,

            (
                SELECT COUNT(*)
                FROM orders
                WHERE delivery_partner_id = u.id
                AND status = 'delivered'
            ) as total_deliveries,

            (
                SELECT AVG(rv.delivery_rating)
                FROM orders od
                LEFT JOIN reviews rv ON rv.order_id = od.id
                WHERE od.delivery_partner_id = u.id
                AND rv.delivery_rating IS NOT NULL
            ) as rating,

            (
                SELECT COUNT(*)
                FROM delivery_assignments
                WHERE delivery_partner_id = u.id
                AND status = 'assigned'
            ) as pending_assignments,

            (
                SELECT COALESCE(SUM(delivery_fee), 0)
                FROM orders
                WHERE delivery_partner_id = u.id
                AND status = 'delivered'
            ) as total_earnings

        FROM users u
        WHERE u.id = ?
        AND u.role = 'delivery_partner'
        `,
        [id]
    );

    if (!partners.length) {
        return null;
    }

    const partner = partners[0];

    partner.status = partner.is_available
        ? partner.pending_assignments > 0
            ? "busy"
            : "active"
        : "inactive";

    partner.rating = partner.rating ? Number(partner.rating).toFixed(1) : "N/A";

    partner.total_earnings = Number(partner.total_earnings || 0);

    const recentOrders = await query(
        `
        SELECT 
            o.id,
            o.order_number,
            o.total,
            o.status,
            o.city,
            o.area,
            o.created_at,
            o.delivered_at
        FROM orders o
        WHERE o.delivery_partner_id = ?
        ORDER BY o.created_at DESC
        LIMIT 5
        `,
        [id]
    );

    const assignmentHistory = await query(
        `
        SELECT 
            da.order_id,
            da.assigned_at,
            da.accepted_at,
            da.pickup_time,
            da.delivery_time,
            da.status
        FROM delivery_assignments da
        WHERE da.delivery_partner_id = ?
        ORDER BY da.assigned_at DESC
        LIMIT 5
        `,
        [id]
    );

    partner.recent_orders = recentOrders;
    partner.delivery_history = assignmentHistory;

    return partner;
};

// Update Delivery Partner Status
export const updateDeliveryPartnerStatus = async (id, status) => {
    const allowedStatuses = ["active", "inactive", "busy", "suspended"];

    if (!allowedStatuses.includes(status)) {
        throw new Error(
            `Invalid status. Allowed values: ${allowedStatuses.join(", ")}`
        );
    }

    const isAvailable = status === "active" ? 1 : 0;

    await query(
        `
        UPDATE users
        SET is_available = ?
        WHERE id = ?
        AND role = 'delivery_partner'
        `,
        [isAvailable, id]
    );

    return {
        success: true,
        message: "Delivery partner status updated successfully",
    };
};

// Update Delivery Partner
export const updateDeliveryPartner = async (id, data) => {
    const fields = Object.keys(data)
        .map((key) => `${key} = ?`)
        .join(", ");

    const values = Object.values(data);

    await query(
        `
        UPDATE users
        SET ${fields}
        WHERE id = ?
        `,
        [...values, id]
    );

    return {
        success: true,
        message: "Delivery partner updated successfully",
    };
};

// Delivery Analytics
export const getDeliveryPartnerAnalytics = async (deliveryPartnerId) => {
    const totalDeliveries = await query(
        `
        SELECT COUNT(*) as total
        FROM orders
        WHERE delivery_partner_id = ?
        AND status = 'delivered'
        `,
        [deliveryPartnerId]
    );

    const totalEarnings = await query(
        `
        SELECT COALESCE(SUM(delivery_fee), 0) as total
        FROM orders
        WHERE delivery_partner_id = ?
        AND status = 'delivered'
        `,
        [deliveryPartnerId]
    );

    const avgRating = await query(
        `
        SELECT AVG(rv.delivery_rating) as rating
        FROM orders od
        LEFT JOIN reviews rv
        ON rv.order_id = od.id
        WHERE od.delivery_partner_id = ?
        AND rv.delivery_rating IS NOT NULL
        `,
        [deliveryPartnerId]
    );

    const statusCounts = await query(
        `
        SELECT 
            SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) as completed,
            SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled,
            SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected
        FROM orders
        WHERE delivery_partner_id = ?
        `,
        [deliveryPartnerId]
    );

    const dailyDeliveries = await query(
        `
        SELECT 
            DATE(delivered_at) as date,
            COUNT(*) as deliveries,
            SUM(delivery_fee) as earnings
        FROM orders
        WHERE delivery_partner_id = ?
        AND delivered_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
        GROUP BY DATE(delivered_at)
        ORDER BY date DESC
        `,
        [deliveryPartnerId]
    );

    return {
        total_deliveries: Number(totalDeliveries[0]?.total || 0),

        total_earnings: Number(totalEarnings[0]?.total || 0),

        average_rating: avgRating[0]?.rating
            ? Number(avgRating[0].rating).toFixed(1)
            : "N/A",

        completed: Number(statusCounts[0]?.completed || 0),

        cancelled: Number(statusCounts[0]?.cancelled || 0),

        rejected: Number(statusCounts[0]?.rejected || 0),

        daily_deliveries: dailyDeliveries,
    };
};

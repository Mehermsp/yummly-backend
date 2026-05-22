import { query, withTransaction } from "../config/db.js";

export const getOverviewMetrics = async () => {
    const [counts] = await query(
        `
        SELECT
            (SELECT COUNT(*) FROM users) AS total_users,
            (SELECT COUNT(*) FROM restaurants WHERE is_active = 1) AS active_restaurants,
            (SELECT COUNT(*) FROM orders) AS total_orders,
            (SELECT COUNT(*) FROM restaurant_applications WHERE status = 'pending') AS pending_applications
        `
    );

    const recentOrders = await query(
        `
        SELECT order_number, status, total, created_at
        FROM orders
        ORDER BY created_at DESC
        LIMIT 10
        `
    );

    return { counts, recentOrders };
};

export const approveRestaurantApplication = async ({
    applicationId,
    adminId,
    notes,
}) =>
    withTransaction(async (connection) => {
        const [applications] = await connection.execute(
            `
            SELECT *
            FROM restaurant_applications
            WHERE id = ? AND status = 'pending'
            LIMIT 1
            `,
            [applicationId]
        );

        if (!applications.length) {
            throw new Error(
                "Restaurant application not found or already reviewed"
            );
        }

        const application = applications[0];
        const [restaurantResult] = await connection.execute(
            `
            INSERT INTO restaurants (
                owner_id,
                user_id,
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
                cover_image,
                is_active,
                is_open
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 1, 1)
            `,
            [
                application.owner_id,
                application.owner_id,
                application.restaurant_name,
                application.email,
                application.phone,
                null,
                application.address,
                application.city,
                application.state || null,
                application.pincode,
                application.landmark || null,
                application.cuisines,
                application.open_time,
                application.close_time,
                application.days_open,
                application.fssai_number || application.fssai || null,
                application.gst_number || application.gst || null,
                application.pan_number || application.pan || null,
            ]
        );

        // Keep user as restaurant partner after approval.
        await connection.execute(
            `
            UPDATE users
            SET role = 'restaurant_partner'
            WHERE id = ?
            `,
            [application.owner_id]
        );

        await connection.execute(
            `
            UPDATE restaurant_applications
            SET status = 'approved',
                reviewed_by = ?,
                reviewed_at = CURRENT_TIMESTAMP,
                review_notes = ?
            WHERE id = ?
            `,
            [adminId, notes || null, applicationId]
        );

        await connection.execute(
            `
            INSERT INTO admin_activity_log (
                admin_id,
                action,
                entity_type,
                entity_id,
                details
            ) VALUES (?, 'approve_restaurant_application', 'restaurant_application', ?, ?)
            `,
            [
                adminId,
                applicationId,
                JSON.stringify({
                    message: `Approved restaurant application ${application.restaurant_name}`,
                }),
            ]
        );
    });

export const rejectRestaurantApplication = async ({
    applicationId,
    adminId,
    reason,
}) =>
    query(
        `
        UPDATE restaurant_applications
        SET status = 'rejected',
            review_notes = ?,
            reviewed_by = ?,
            reviewed_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'pending'
        `,
        [reason || "Application rejected", adminId, applicationId]
    );

export const listAdminActivityLogs = async () =>
    query(
        `
        SELECT
            l.*,
            u.name AS admin_name
        FROM admin_activity_log l
        INNER JOIN users u ON u.id = l.admin_id
        ORDER BY l.created_at DESC
        LIMIT 100
        `
    );

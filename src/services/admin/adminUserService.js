import { query } from "../../config/db.js";

// ==============================
// USERS
// ==============================

export const getUsers = async ({ role, search, status }) => {
    let sql = `
        SELECT
            id,
            name,
            email,
            phone,
            role,
            is_active,
            is_available,
            created_at
        FROM users
        WHERE 1 = 1
    `;

    const params = [];

    // Filter by role
    if (role) {
        sql += ` AND role = ?`;
        params.push(role);
    }

    // Search by name/email/phone
    if (search) {
        sql += `
            AND (
                name LIKE ?
                OR email LIKE ?
                OR phone LIKE ?
            )
        `;

        const searchTerm = `%${search}%`;

        params.push(searchTerm, searchTerm, searchTerm);
    }

    // Active / inactive filter
    if (status === "active") {
        sql += ` AND is_active = 1`;
    }

    if (status === "inactive") {
        sql += ` AND is_active = 0`;
    }

    sql += `
        ORDER BY created_at DESC
    `;

    return await query(sql, params);
};

export const getUserById = async (userId) => {
    const users = await query(
        `
        SELECT
            id,
            name,
            email,
            phone,
            role,
            profile_image,
            is_active,
            is_available,
            created_at,
            updated_at
        FROM users
        WHERE id = ?
        LIMIT 1
        `,
        [userId]
    );

    return users[0] || null;
};

export const updateUserStatus = async (userId, isActive) => {
    await query(
        `
        UPDATE users
        SET is_active = ?
        WHERE id = ?
        `,
        [isActive ? 1 : 0, userId]
    );

    return {
        success: true,
        message: `User ${isActive ? "activated" : "deactivated"} successfully`,
    };
};

export const updateUserRole = async (userId, role) => {
    await query(
        `
        UPDATE users
        SET role = ?
        WHERE id = ?
        `,
        [role, userId]
    );

    return {
        success: true,
        message: "User role updated successfully",
    };
};

export const deleteUser = async (userId) => {
    await query(
        `
        DELETE FROM users
        WHERE id = ?
        `,
        [userId]
    );

    return {
        success: true,
        message: "User deleted successfully",
    };
};

// ==============================
// DELIVERY PARTNERS
// ==============================

export const getDeliveryPartners = async () => {
    return await query(`
            SELECT
                id,
                name,
                email,
                phone,
                role,
                is_available,
                is_active,
                created_at
            FROM users
            WHERE role = 'delivery_partner'
            ORDER BY is_available DESC,
                     created_at DESC
        `);
};

export const getDeliveryPartnerById = async (partnerId) => {
    const partners = await query(
        `
            SELECT
                u.id,
                u.name,
                u.email,
                u.phone,
                u.is_available,
                u.is_active,
                u.created_at,

                COUNT(o.id) AS total_orders,

                COALESCE(
                    SUM(
                        CASE
                            WHEN o.status = 'delivered'
                            THEN o.delivery_fee
                            ELSE 0
                        END
                    ),
                    0
                ) AS total_earnings

            FROM users u

            LEFT JOIN orders o
                ON o.delivery_partner_id = u.id

            WHERE u.id = ?
              AND u.role = 'delivery_partner'

            GROUP BY u.id
            `,
        [partnerId]
    );

    return partners[0] || null;
};

export const updateDeliveryPartnerStatus = async (partnerId, isAvailable) => {
    await query(
        `
            UPDATE users
            SET is_available = ?
            WHERE id = ?
              AND role = 'delivery_partner'
            `,
        [isAvailable ? 1 : 0, partnerId]
    );

    return {
        success: true,
        message: "Delivery partner status updated successfully",
    };
};

export const getDeliveryPartnerAnalytics = async () => {
    const analytics = await query(`
            SELECT
                COUNT(*) AS total_partners,

                SUM(
                    CASE
                        WHEN is_available = 1
                        THEN 1
                        ELSE 0
                    END
                ) AS online_partners

            FROM users
            WHERE role = 'delivery_partner'
        `);

    return (
        analytics[0] || {
            total_partners: 0,
            online_partners: 0,
        }
    );
};

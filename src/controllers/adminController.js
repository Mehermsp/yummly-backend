import { query, withTransaction } from "../config/db.js";

// Get Dashboard Statistics
export const getStatistics = async (req, res) => {
    try {
        // Count active restaurants (is_approved = 1 OR is_active = 1)
        const [restaurants] = await query(
            "SELECT COUNT(*) as total FROM restaurants WHERE is_approved = 1 OR is_active = 1"
        );

        // Count pending applications
        const [applications] = await query(
            "SELECT COUNT(*) as total FROM restaurant_applications WHERE status = 'pending'"
        );

        // Count all orders
        const [orders] = await query("SELECT COUNT(*) as total FROM orders");

        // Count active delivery partners (users with role 'delivery_partner' that are available)
        const [partners] = await query(
            "SELECT COUNT(*) as total FROM users WHERE role = 'delivery_partner' AND is_available = 1"
        );

        // Get revenue (sum of all delivered orders)
        const [revenue] = await query(`
            SELECT COALESCE(SUM(total), 0) as total 
            FROM orders 
            WHERE status = 'delivered'
        `);

        // Orders today
        const [ordersToday] = await query(`
            SELECT COUNT(*) as total FROM orders 
            WHERE DATE(created_at) = CURDATE()
        `);

        res.json({
            total_restaurants: parseInt(restaurants[0]?.total) || 0,
            pending_applications: parseInt(applications[0]?.total) || 0,
            total_orders: parseInt(orders[0]?.total) || 0,
            total_revenue: parseFloat(revenue[0]?.total) || 0,
            active_delivery_partners: parseInt(partners[0]?.total) || 0,
            orders_today: parseInt(ordersToday[0]?.total) || 0,
        });
    } catch (error) {
        console.error("Error fetching statistics:", error);
        res.status(500).json({ error: "Failed to fetch statistics" });
    }
};

// Get Restaurant Applications
export const getApplications = async (req, res) => {
    try {
        const { limit } = req.query;
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
fssai_number as license_number,
                gst_number as gst_number,
                pan_number as pan_number,
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

        const applications = await query(sql);
        res.json(applications);
    } catch (error) {
        console.error("Error fetching applications:", error);
        res.status(500).json({ error: "Failed to fetch applications" });
    }
};

// Get Application by ID
export const getApplicationById = async (req, res) => {
    try {
        const { id } = req.params;
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
fssai_number as license_number,
                gst_number as gst_number,
                pan_number as pan_number,
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

        if (applications.length === 0) {
            return res.status(404).json({ error: "Application not found" });
        }

        res.json(applications[0]);
    } catch (error) {
        console.error("Error fetching application:", error);
        res.status(500).json({ error: "Failed to fetch application" });
    }
};

// Approve Application
export const approveApplication = async (req, res) => {
    try {
        const { id } = req.params;

        // Get application details
        const applications = await query(
            "SELECT * FROM restaurant_applications WHERE id = ?",
            [id]
        );

        if (applications.length === 0) {
            return res.status(404).json({ error: "Application not found" });
        }

        const app = applications[0];
        const reviewedBy = req.user?.id || null;

        await withTransaction(async (connection) => {
            await connection.execute(
                `UPDATE restaurant_applications 
                SET status = 'approved', reviewed_by = ?, reviewed_at = NOW()
                WHERE id = ?`,
                [reviewedBy, id]
            );

            await connection.execute(
                `
                INSERT INTO restaurants (
                    user_id, owner_id, name, email, phone, 
                    description, address, city, state, pincode, landmark,
cuisines, open_time, close_time, days_open,
                    fssai_number, gst_number, pan_number, logo, is_active, is_approved, status
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
                    app.fssai_number,
                    app.gst_number,
                    app.pan_number,
                    app.logo || "",
                ]
            );
        });

        res.json({
            message: "Application approved and restaurant created successfully",
        });
    } catch (error) {
        console.error("Error approving application:", error);
        res.status(500).json({ error: "Failed to approve application" });
    }
};

// Reject Application
export const rejectApplication = async (req, res) => {
    try {
        const { id } = req.params;
        const { rejection_reason } = req.body;
        const reviewedBy = req.user?.id || null;

        await query(
            `
            UPDATE restaurant_applications 
            SET status = 'rejected', review_notes = ?, reviewed_by = ?, reviewed_at = NOW()
            WHERE id = ?
        `,
            [rejection_reason, reviewedBy, id]
        );

        res.json({ message: "Application rejected successfully" });
    } catch (error) {
        console.error("Error rejecting application:", error);
        res.status(500).json({ error: "Failed to reject application" });
    }
};

// Get Restaurants
export const getRestaurants = async (req, res) => {
    try {
        const restaurants = await query(`
            SELECT 
                r.id,
                r.name as restaurant_name,
                r.user_id,
                r.owner_id,
                r.email,
                r.phone,
                r.description,
                r.image_url,
                r.logo,
                r.cover_image,
                r.address,
                r.city,
                r.state,
                r.pincode,
                r.landmark,
                r.cuisines as cuisine_type,
                r.open_time as opening_time,
                r.close_time as closing_time,
                r.days_open,
r.fssai_number as license_number,
                r.gst_number as gst_number,
                r.pan_number as pan_number,
                r.rating,
                r.is_open,
                r.is_active,
                r.total_orders,
                r.total_revenue,
                r.platform_fee_percent,
                r.created_at,
                r.updated_at,
                u.name as owner_name,
                u.email as owner_email,
                u.phone as owner_phone
            FROM restaurants r
            LEFT JOIN users u ON r.user_id = u.id
            ORDER BY r.created_at DESC
`);

        // Map is_active to status for consistency
        const result = restaurants.map((r) => ({
            ...r,
            status: r.is_active ? "active" : "inactive",
        }));

        res.json(result);
    } catch (error) {
        console.error("Error fetching restaurants:", error);
        res.status(500).json({ error: "Failed to fetch restaurants" });
    }
};

// Get Restaurant by ID
export const getRestaurantById = async (req, res) => {
    try {
        const { id } = req.params;
        const restaurants = await query(
            `
            SELECT 
                r.id,
                r.name as restaurant_name,
                r.user_id,
                r.owner_id,
                r.email,
                r.phone,
                r.description,
                r.image_url,
                r.logo,
                r.cover_image,
                r.address,
                r.city,
                r.state,
                r.pincode,
                r.landmark,
                r.cuisines as cuisine_type,
                r.open_time as opening_time,
                r.close_time as closing_time,
                r.days_open,
r.fssai_number as license_number,
                r.gst_number as gst_number,
                r.pan_number as pan_number,
                r.rating,
                r.is_open,
                r.is_active,
                r.total_orders,
                r.total_revenue,
                r.created_at,
                r.updated_at,
                u.name as owner_name,
                u.email as owner_email,
                u.phone as owner_phone
            FROM restaurants r
            LEFT JOIN users u ON r.user_id = u.id
            WHERE r.id = ?
        `,
            [id]
        );

        if (restaurants.length === 0) {
            return res.status(404).json({ error: "Restaurant not found" });
        }

        res.json(restaurants[0]);
    } catch (error) {
        console.error("Error fetching restaurant:", error);
        res.status(500).json({ error: "Failed to fetch restaurant" });
    }
};

// Update Restaurant Status
export const updateRestaurantStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        const isActive = status === "active" ? 1 : 0;
        await query("UPDATE restaurants SET is_active = ? WHERE id = ?", [
            isActive,
            id,
        ]);
        res.json({ message: "Restaurant status updated successfully" });
    } catch (error) {
        console.error("Error updating restaurant status:", error);
        res.status(500).json({ error: "Failed to update restaurant status" });
    }
};

// Update Restaurant
export const updateRestaurant = async (req, res) => {
    try {
        const { id } = req.params;
        const data = req.body;

        const fields = Object.keys(data)
            .map((key) => `${key} = ?`)
            .join(", ");
        const values = Object.values(data);

        await query(`UPDATE restaurants SET ${fields} WHERE id = ?`, [
            ...values,
            id,
        ]);
        res.json({ message: "Restaurant updated successfully" });
    } catch (error) {
        console.error("Error updating restaurant:", error);
        res.status(500).json({ error: "Failed to update restaurant" });
    }
};

// Get Orders
export const getOrders = async (req, res) => {
    try {
        const { status, limit } = req.query;
        let sql = `
            SELECT 
                o.id,
                o.order_number,
                o.user_id,
                o.restaurant_id,
                o.total,
                o.total as total_amount,
                o.subtotal,
                o.discount_amount,
                o.delivery_fee,
                o.tax_amount,
                o.tax_amount as tax,
                o.status,
                o.payment_method,
                o.payment_status,
                o.payment_id,
                o.delivery_partner_id,
                o.address_id,
                o.delivery_notes,
                o.estimated_delivery_time,
                o.actual_delivery_time,
                o.created_at,
                o.updated_at,
                o.delivered_at,
                cu.name as customer_name,
                cu.phone as customer_phone,
                r.name as restaurant_name,
                r.phone as restaurant_phone,
                r.address as restaurant_address,
                dp.name as delivery_partner_name,
                dp.phone as delivery_partner_phone,
                o.door_no,
                o.street,
                o.area,
                o.city,
                o.state,
                o.zip_code as pincode,
                o.phone as delivery_phone
            FROM orders o
            LEFT JOIN users cu ON o.user_id = cu.id
            LEFT JOIN restaurants r ON o.restaurant_id = r.id
            LEFT JOIN users dp ON o.delivery_partner_id = dp.id
            WHERE 1=1
        `;

        const params = [];
        if (status && status !== "all") {
            sql += " AND o.status = ?";
            params.push(status);
        }

        sql += " ORDER BY o.created_at DESC";
        if (limit) {
            sql += ` LIMIT ${parseInt(limit)}`;
        }

        const orders = await query(sql, params);

        // Format delivery address
        const formattedOrders = orders.map((o) => ({
            ...o,
            delivery_address: [
                o.door_no,
                o.street,
                o.area,
                o.city,
                o.state,
                o.pincode,
            ]
                .filter(Boolean)
                .join(", "),
        }));

        res.json(formattedOrders);
    } catch (error) {
        console.error("Error fetching orders:", error);
        res.status(500).json({ error: "Failed to fetch orders" });
    }
};

// Get Order by ID
export const getOrderById = async (req, res) => {
    try {
        const { id } = req.params;
        const orders = await query(
            `
            SELECT 
                o.id,
                o.order_number,
                o.user_id,
                o.restaurant_id,
                o.total,
                o.total as total_amount,
                o.subtotal,
                o.discount_amount,
                o.delivery_fee,
                o.tax_amount,
                o.tax_amount as tax,
                o.status,
                o.payment_method,
                o.payment_status,
                o.payment_id,
                o.delivery_partner_id,
                o.delivery_notes,
                o.estimated_delivery_time,
                o.actual_delivery_time,
                o.created_at,
                o.updated_at,
                o.delivered_at,
                cu.name as customer_name,
                cu.phone as customer_phone,
                r.name as restaurant_name,
                r.phone as restaurant_phone,
                r.address as restaurant_address,
                dp.name as delivery_partner_name,
                dp.phone as delivery_partner_phone,
                o.door_no,
                o.street,
                o.area,
                o.city,
                o.state,
                o.zip_code as pincode,
                o.phone as delivery_phone
            FROM orders o
            LEFT JOIN users cu ON o.user_id = cu.id
            LEFT JOIN restaurants r ON o.restaurant_id = r.id
            LEFT JOIN users dp ON o.delivery_partner_id = dp.id
            WHERE o.id = ?
        `,
            [id]
        );

        if (orders.length === 0) {
            return res.status(404).json({ error: "Order not found" });
        }

        // Get order items
        const items = await query(
            "SELECT * FROM order_items WHERE order_id = ?",
            [id]
        );

        const order = orders[0];
        order.items = items;
        order.delivery_address = [
            order.door_no,
            order.street,
            order.area,
            order.city,
            order.state,
            order.pincode,
        ]
            .filter(Boolean)
            .join(", ");

        res.json(order);
    } catch (error) {
        console.error("Error fetching order:", error);
        res.status(500).json({ error: "Failed to fetch order" });
    }
};

// Update Order Status
export const updateOrderStatus = async (req, res) => {
    return res.status(403).json({
        error: "Admins cannot change order state directly. Please assign a delivery partner only.",
    });
};

// Assign Delivery Partner to Order
export const assignDeliveryPartner = async (req, res) => {
    try {
        const { id } = req.params;
        const { delivery_partner_id } = req.body;
        if (!delivery_partner_id) {
            return res
                .status(400)
                .json({ error: "delivery_partner_id is required" });
        }

        const orderRows = await query(
            "SELECT id, status, delivery_partner_id FROM orders WHERE id = ?",
            [id]
        );

        if (!orderRows.length) {
            return res.status(404).json({ error: "Order not found" });
        }

        const order = orderRows[0];
        if (["delivered", "cancelled"].includes(order.status)) {
            return res.status(400).json({
                error: "Cannot assign delivery for delivered or cancelled orders",
            });
        }
        if (order.status !== "ready_for_pickup") {
            return res.status(400).json({
                error: "Delivery assignment is allowed only when order is ready_for_pickup",
            });
        }

        const partnerRows = await query(
            `
            SELECT id, role, is_available
            FROM users
            WHERE id = ? AND role = 'delivery_partner'
        `,
            [delivery_partner_id]
        );

        if (!partnerRows.length) {
            return res
                .status(404)
                .json({ error: "Delivery partner not found" });
        }

        if (!partnerRows[0].is_available) {
            return res.status(400).json({
                error: "Selected delivery partner is not currently available",
            });
        }

        await withTransaction(async (connection) => {
            await connection.execute(
                "UPDATE orders SET delivery_partner_id = ?, updated_at = NOW() WHERE id = ?",
                [delivery_partner_id, id]
            );

            const [existingAssignments] = await connection.execute(
                "SELECT id FROM delivery_assignments WHERE order_id = ? ORDER BY assigned_at DESC LIMIT 1",
                [id]
            );

            if (existingAssignments.length > 0) {
                await connection.execute(
                    `UPDATE delivery_assignments
                    SET delivery_partner_id = ?, status = 'assigned', assigned_at = NOW(), accepted_at = NULL, rejected_at = NULL, rejection_reason = NULL
                    WHERE id = ?`,
                    [delivery_partner_id, existingAssignments[0].id]
                );
            } else {
                await connection.execute(
                    `
                    INSERT INTO delivery_assignments (
                        order_id, delivery_partner_id, status, assigned_at
                    ) VALUES (?, ?, 'assigned', NOW())
                `,
                    [id, delivery_partner_id]
                );
            }

            await connection.execute(
                "UPDATE users SET is_available = 0 WHERE id = ? AND role = 'delivery_partner'",
                [delivery_partner_id]
            );

            if (
                order.delivery_partner_id &&
                Number(order.delivery_partner_id) !==
                    Number(delivery_partner_id)
            ) {
                const [oldPendingRows] = await connection.execute(
                    `
                    SELECT COUNT(*) AS pending_count
                    FROM delivery_assignments
                    WHERE delivery_partner_id = ?
                    AND status IN ('assigned', 'accepted')
                `,
                    [order.delivery_partner_id]
                );

                if ((oldPendingRows[0]?.pending_count || 0) === 0) {
                    await connection.execute(
                        "UPDATE users SET is_available = 1 WHERE id = ? AND role = 'delivery_partner'",
                        [order.delivery_partner_id]
                    );
                }
            }
        });

        res.json({ message: "Delivery partner assigned successfully" });
    } catch (error) {
        console.error("Error assigning delivery partner:", error);
        res.status(500).json({ error: "Failed to assign delivery partner" });
    }
};

// Get Delivery Partners
export const getDeliveryPartners = async (req, res) => {
    try {
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
                (SELECT COUNT(*) FROM orders WHERE delivery_partner_id = u.id AND status = 'delivered') as total_deliveries,
                (SELECT COUNT(*) FROM orders WHERE delivery_partner_id = u.id AND status = 'delivered') as completed_orders,
                (
                    SELECT AVG(rv.delivery_rating)
                    FROM orders od
                    LEFT JOIN reviews rv ON rv.order_id = od.id
                    WHERE od.delivery_partner_id = u.id
                    AND rv.delivery_rating IS NOT NULL
                ) as rating,
                (SELECT COUNT(*) FROM delivery_assignments WHERE delivery_partner_id = u.id AND status = 'assigned') as pending_assignments,
                (SELECT COALESCE(SUM(delivery_fee), 0) FROM orders WHERE delivery_partner_id = u.id AND status = 'delivered') as total_earnings,
                u.delivery_fee_per_order
            FROM users u
            WHERE u.role = 'delivery_partner'
            ORDER BY u.created_at DESC
        `);

        // Map availability/load to status
        const result = partners.map((p) => ({
            ...p,
            status: p.is_available
                ? p.pending_assignments > 0
                    ? "busy"
                    : "active"
                : "inactive",
            vehicle_type: "bike",
            total_deliveries: p.total_deliveries || 0,
            completed_orders: p.completed_orders || 0,
            rating: p.rating ? parseFloat(p.rating).toFixed(1) : "N/A",
            pending_assignments: p.pending_assignments || 0,
            total_earnings: parseFloat(p.total_earnings) || 0,
        }));

        res.json(result);
    } catch (error) {
        console.error("Error fetching delivery partners:", error);
        res.status(500).json({ error: "Failed to fetch delivery partners" });
    }
};

// Get Delivery Partner by ID
export const getDeliveryPartnerById = async (req, res) => {
    try {
        const { id } = req.params;
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
                (SELECT COUNT(*) FROM orders WHERE delivery_partner_id = u.id AND status = 'delivered') as total_deliveries,
                (SELECT COUNT(*) FROM orders WHERE delivery_partner_id = u.id AND status = 'delivered') as completed_orders,
                (
                    SELECT AVG(rv.delivery_rating)
                    FROM orders od
                    LEFT JOIN reviews rv ON rv.order_id = od.id
                    WHERE od.delivery_partner_id = u.id
                    AND rv.delivery_rating IS NOT NULL
                ) as rating,
                (SELECT COUNT(*) FROM delivery_assignments WHERE delivery_partner_id = u.id AND status = 'assigned') as pending_assignments,
                (SELECT COALESCE(SUM(delivery_fee), 0) FROM orders WHERE delivery_partner_id = u.id AND status = 'delivered') as total_earnings
            FROM users u
            WHERE u.id = ? AND u.role = 'delivery_partner'
        `,
            [id]
        );

        if (partners.length === 0) {
            return res
                .status(404)
                .json({ error: "Delivery partner not found" });
        }

        const partner = partners[0];
        partner.status = partner.is_available
            ? partner.pending_assignments > 0
                ? "busy"
                : "active"
            : "inactive";
        partner.total_deliveries = partner.total_deliveries || 0;
        partner.completed_orders = partner.completed_orders || 0;
        partner.rating = partner.rating
            ? parseFloat(partner.rating).toFixed(1)
            : "N/A";
        partner.total_earnings = parseFloat(partner.total_earnings) || 0;

        res.json(partner);
    } catch (error) {
        console.error("Error fetching delivery partner:", error);
        res.status(500).json({ error: "Failed to fetch delivery partner" });
    }
};

// Update Delivery Partner Status
export const updateDeliveryPartnerStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const allowedStatuses = ["active", "inactive", "busy", "suspended"];

        if (!allowedStatuses.includes(status)) {
            return res.status(400).json({
                error: `Invalid status. Allowed values: ${allowedStatuses.join(
                    ", "
                )}`,
            });
        }

        const isAvailable = status === "active" ? 1 : 0;
        await query(
            "UPDATE users SET is_available = ? WHERE id = ? AND role = 'delivery_partner'",
            [isAvailable, id]
        );
        res.json({ message: "Delivery partner status updated successfully" });
    } catch (error) {
        console.error("Error updating delivery partner status:", error);
        res.status(500).json({
            error: "Failed to update delivery partner status",
        });
    }
};

// Update Delivery Partner
export const updateDeliveryPartner = async (req, res) => {
    try {
        const { id } = req.params;
        const data = req.body;

        const fields = Object.keys(data)
            .map((key) => `${key} = ?`)
            .join(", ");
        const values = Object.values(data);

        await query(`UPDATE users SET ${fields} WHERE id = ?`, [...values, id]);
        res.json({ message: "Delivery partner updated successfully" });
    } catch (error) {
        console.error("Error updating delivery partner:", error);
        res.status(500).json({ error: "Failed to update delivery partner" });
    }
};

// Settings - General
export const getGeneralSettings = async (req, res) => {
    try {
        const settings = await query(
            "SELECT * FROM admin_settings WHERE setting_key LIKE 'general_%'"
        );
        const result = {};
        settings.forEach((s) => {
            result[s.setting_key.replace("general_", "")] = s.setting_value;
        });
        res.json(result);
    } catch (error) {
        console.error("Error fetching general settings:", error);
        res.json({
            platform_name: "TastieKit",
            support_email: "support@tastiekit.com",
            support_phone: "+91 9876543210",
            currency: "INR",
            timezone: "Asia/Kolkata",
        });
    }
};

export const updateGeneralSettings = async (req, res) => {
    try {
        const settings = req.body;

        for (const [key, value] of Object.entries(settings)) {
            await query(
                `
                INSERT INTO admin_settings (setting_key, setting_value) 
                VALUES ('general_${key}', ?)
                ON DUPLICATE KEY UPDATE setting_value = ?
            `,
                [value, value]
            );
        }

        res.json({ message: "General settings updated successfully" });
    } catch (error) {
        console.error("Error updating general settings:", error);
        res.status(500).json({ error: "Failed to update general settings" });
    }
};

// Settings - Notifications
export const getNotificationSettings = async (req, res) => {
    try {
        const settings = await query(
            "SELECT * FROM admin_settings WHERE setting_key LIKE 'notification_%'"
        );
        const result = {};
        settings.forEach((s) => {
            result[s.setting_key.replace("notification_", "")] =
                s.setting_value === "true";
        });
        res.json(result);
    } catch (error) {
        console.error("Error fetching notification settings:", error);
        res.json({
            email_notifications: true,
            sms_notifications: false,
            push_notifications: true,
            new_order_alert: true,
            new_application_alert: true,
            low_stock_alert: false,
        });
    }
};

export const updateNotificationSettings = async (req, res) => {
    try {
        const settings = req.body;

        for (const [key, value] of Object.entries(settings)) {
            await query(
                `
                INSERT INTO admin_settings (setting_key, setting_value) 
                VALUES ('notification_${key}', ?)
                ON DUPLICATE KEY UPDATE setting_value = ?
            `,
                [value.toString(), value.toString()]
            );
        }

        res.json({ message: "Notification settings updated successfully" });
    } catch (error) {
        console.error("Error updating notification settings:", error);
        res.status(500).json({
            error: "Failed to update notification settings",
        });
    }
};

// Settings - Security
export const getSecuritySettings = async (req, res) => {
    try {
        const settings = await query(
            "SELECT * FROM admin_settings WHERE setting_key LIKE 'security_%'"
        );
        const result = {};
        settings.forEach((s) => {
            const key = s.setting_key.replace("security_", "");
            result[key] =
                key === "two_factor_auth"
                    ? s.setting_value === "true"
                    : parseInt(s.setting_value);
        });
        res.json(result);
    } catch (error) {
        console.error("Error fetching security settings:", error);
        res.json({
            two_factor_auth: false,
            session_timeout: 30,
            password_expiry_days: 90,
            max_login_attempts: 5,
        });
    }
};

export const updateSecuritySettings = async (req, res) => {
    try {
        const settings = req.body;

        for (const [key, value] of Object.entries(settings)) {
            await query(
                `
                INSERT INTO admin_settings (setting_key, setting_value) 
                VALUES ('security_${key}', ?)
                ON DUPLICATE KEY UPDATE setting_value = ?
            `,
                [value.toString(), value.toString()]
            );
        }

        res.json({ message: "Security settings updated successfully" });
    } catch (error) {
        console.error("Error updating security settings:", error);
        res.status(500).json({ error: "Failed to update security settings" });
    }
};

// Settings - Restaurant Commission
export const getRestaurantCommission = async (req, res) => {
    try {
        const settings = await query(
            "SELECT * FROM admin_settings WHERE setting_key LIKE 'commission_%'"
        );
        const result = {
            percentage: 15,
            fixed_fee: 0,
            min_order_amount: 100,
            max_commission: 500,
        };
        settings.forEach((s) => {
            const key = s.setting_key.replace("commission_", "");
            result[key] = parseFloat(s.setting_value);
        });
        res.json(result);
    } catch (error) {
        console.error("Error fetching commission settings:", error);
        res.json({
            percentage: 15,
            fixed_fee: 0,
            min_order_amount: 100,
            max_commission: 500,
        });
    }
};

export const updateRestaurantCommission = async (req, res) => {
    try {
        const settings = req.body;

        for (const [key, value] of Object.entries(settings)) {
            await query(
                `
                INSERT INTO admin_settings (setting_key, setting_value) 
                VALUES ('commission_${key}', ?)
                ON DUPLICATE KEY UPDATE setting_value = ?
            `,
                [value.toString(), value.toString()]
            );
        }

        res.json({ message: "Commission settings updated successfully" });
    } catch (error) {
        console.error("Error updating commission settings:", error);
        res.status(500).json({ error: "Failed to update commission settings" });
    }
};

// Settings - Delivery
export const getDeliverySettings = async (req, res) => {
    try {
        const settings = await query(
            "SELECT * FROM admin_settings WHERE setting_key LIKE 'delivery_%'"
        );
        const result = {
            base_delivery_fee: 30,
            per_km_rate: 10,
            min_delivery_fee: 25,
            max_delivery_fee: 100,
            peak_hour_multiplier: 1.5,
            peak_hours: "12:00-14:00,19:00-22:00",
        };
        settings.forEach((s) => {
            const key = s.setting_key.replace("delivery_", "");
            result[key] =
                key === "peak_hours"
                    ? s.setting_value
                    : parseFloat(s.setting_value);
        });
        res.json(result);
    } catch (error) {
        console.error("Error fetching delivery settings:", error);
        res.json({
            base_delivery_fee: 30,
            per_km_rate: 10,
            min_delivery_fee: 25,
            max_delivery_fee: 100,
            peak_hour_multiplier: 1.5,
            peak_hours: "12:00-14:00,19:00-22:00",
        });
    }
};

export const updateDeliverySettings = async (req, res) => {
    try {
        const settings = req.body;

        for (const [key, value] of Object.entries(settings)) {
            await query(
                `
                INSERT INTO admin_settings (setting_key, setting_value) 
                VALUES ('delivery_${key}', ?)
                ON DUPLICATE KEY UPDATE setting_value = ?
            `,
                [value.toString(), value.toString()]
            );
        }

        res.json({ message: "Delivery settings updated successfully" });
    } catch (error) {
        console.error("Error updating delivery settings:", error);
        res.status(500).json({ error: "Failed to update delivery settings" });
    }
};

// Get Overview Dashboard
export const getOverview = async (req, res) => {
    try {
        // Get statistics
        const [restaurants] = await query(
            "SELECT COUNT(*) as total FROM restaurants WHERE is_active = 1"
        );
        const [pendingApps] = await query(
            "SELECT COUNT(*) as total FROM restaurant_applications WHERE status = 'pending'"
        );
        const [totalOrders] = await query(
            "SELECT COUNT(*) as total FROM orders"
        );
        const [totalRevenue] = await query(
            "SELECT COALESCE(SUM(total), 0) as total FROM orders WHERE status = 'delivered'"
        );
        const [deliveryPartners] = await query(
            "SELECT COUNT(*) as total FROM users WHERE role = 'delivery_partner' AND is_available = 1"
        );
        const [ordersToday] = await query(
            "SELECT COUNT(*) as total FROM orders WHERE DATE(created_at) = CURDATE()"
        );

        res.json({
            total_restaurants: parseInt(restaurants[0]?.total) || 0,
            pending_applications: parseInt(pendingApps[0]?.total) || 0,
            total_orders: parseInt(totalOrders[0]?.total) || 0,
            total_revenue: parseFloat(totalRevenue[0]?.total) || 0,
            active_delivery_partners: parseInt(deliveryPartners[0]?.total) || 0,
            orders_today: parseInt(ordersToday[0]?.total) || 0,
        });
    } catch (error) {
        console.error("Error fetching overview:", error);
        res.status(500).json({ error: "Failed to fetch overview" });
    }
};

// Get Ready for Pickup Orders
export const getReadyForPickupOrders = async (req, res) => {
    try {
        const orders = await query(`
            SELECT 
                o.id,
                o.order_number,
                o.user_id,
                o.restaurant_id,
                o.total,
                o.total as total_amount,
                o.status,
                o.created_at,
                cu.name as customer_name,
                cu.phone as customer_phone,
                r.name as restaurant_name,
                o.door_no,
                o.street,
                o.area,
                o.city,
                o.state,
                o.zip_code as pincode
            FROM orders o
            LEFT JOIN users cu ON o.user_id = cu.id
            LEFT JOIN restaurants r ON o.restaurant_id = r.id
            WHERE o.status = 'ready_for_pickup'
            ORDER BY o.created_at DESC
        `);

        const enrichedOrders = orders.map((o) => ({
            ...o,
            delivery_address: [
                o.door_no,
                o.street,
                o.area,
                o.city,
                o.state,
                o.pincode,
            ]
                .filter(Boolean)
                .join(", "),
        }));

        res.json(enrichedOrders);
    } catch (error) {
        console.error("Error fetching ready for pickup orders:", error);
        res.status(500).json({
            error: "Failed to fetch ready for pickup orders",
        });
    }
};

// Get Admin Activity Logs
export const getLogs = async (req, res) => {
    try {
        const { limit = 50 } = req.query;
        const logs = await query(
            `
            SELECT 
                id,
                admin_id,
                action,
                entity_type,
                entity_id,
                details,
                created_at,
                u.name as admin_name
            FROM admin_activity_log
            LEFT JOIN users u ON admin_id = u.id
            ORDER BY created_at DESC
            LIMIT ?
        `,
            [parseInt(limit)]
        );
        res.json(logs);
    } catch (error) {
        console.error("Error fetching logs:", error);
        res.status(500).json({ error: "Failed to fetch logs" });
    }
};

// Get All Users
export const getUsers = async (req, res) => {
    try {
        const { role, limit } = req.query;
        let sql = `
            SELECT 
                id,
                name,
                email,
                phone,
                role,
                created_at,
                is_available,
                profile_image
            FROM users
            WHERE 1=1
        `;
        const params = [];

        if (role) {
            sql += " AND role = ?";
            params.push(role);
        }

        sql += " ORDER BY created_at DESC";
        if (limit) {
            sql += ` LIMIT ${parseInt(limit)}`;
        }

        const users = await query(sql, params);
        res.json(users);
    } catch (error) {
        console.error("Error fetching users:", error);
        res.status(500).json({ error: "Failed to fetch users" });
    }
};

// Assign Order to Delivery Partner (alias for assignDeliveryPartner)
export const assignOrderToPartner = async (req, res) => {
    return assignDeliveryPartner(req, res);
};

// Get Restaurant Analytics
export const getRestaurantAnalytics = async (req, res) => {
    try {
        const { restaurant_id } = req.query;

        if (!restaurant_id) {
            return res.status(400).json({ error: "restaurant_id is required" });
        }

        // Total orders
        const [totalOrders] = await query(
            "SELECT COUNT(*) as total FROM orders WHERE restaurant_id = ?",
            [restaurant_id]
        );

        // Total revenue
        const [totalRevenue] = await query(
            "SELECT COALESCE(SUM(total), 0) as total FROM orders WHERE restaurant_id = ? AND status = 'delivered'",
            [restaurant_id]
        );

        // Average order value
        const [avgOrderValue] = await query(
            "SELECT AVG(total) as average FROM orders WHERE restaurant_id = ? AND status = 'delivered'",
            [restaurant_id]
        );
        const [totalCustomers] = await query(
            "SELECT COUNT(DISTINCT user_id) as total FROM orders WHERE restaurant_id = ?",
            [restaurant_id]
        );
        const [platformFee] = await query(
            `
            SELECT COALESCE(SUM(o.total * (COALESCE(r.platform_fee_percent, 0) / 100)), 0) as total
            FROM orders o
            JOIN restaurants r ON o.restaurant_id = r.id
            WHERE o.restaurant_id = ? AND o.status = 'delivered'
        `,
            [restaurant_id]
        );

        // Orders by status
        const ordersByStatus = await query(
            `
            SELECT status, COUNT(*) as count FROM orders 
            WHERE restaurant_id = ? 
            GROUP BY status
        `,
            [restaurant_id]
        );

        // Daily revenue (last 7 days)
        const dailyRevenue = await query(
            `
            SELECT DATE(created_at) as date, SUM(total) as revenue, COUNT(*) as orders
            FROM orders 
            WHERE restaurant_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
            GROUP BY DATE(created_at)
            ORDER BY date DESC
        `,
            [restaurant_id]
        );

        // Top menu items
        const topMenuItems = await query(
            `
            SELECT mi.id, mi.name, COUNT(oi.id) as order_count, SUM(oi.qty) as total_qty
            FROM order_items oi
            JOIN menu_items mi ON oi.menu_id = mi.id
            WHERE mi.restaurant_id = ?
            GROUP BY mi.id
            ORDER BY order_count DESC
            LIMIT 10
        `,
            [restaurant_id]
        );

        res.json({
            total_orders: parseInt(totalOrders[0]?.total) || 0,
            total_revenue: parseFloat(totalRevenue[0]?.total) || 0,
            average_order_value: parseFloat(avgOrderValue[0]?.average) || 0,
            total_customers: parseInt(totalCustomers[0]?.total) || 0,
            platform_earnings: parseFloat(platformFee[0]?.total) || 0,
            orders_by_status: ordersByStatus,
            daily_revenue: dailyRevenue,
            top_menu_items: topMenuItems,
        });
    } catch (error) {
        console.error("Error fetching restaurant analytics:", error);
        res.status(500).json({ error: "Failed to fetch restaurant analytics" });
    }
};

// Get Delivery Partner Analytics
export const getDeliveryPartnerAnalytics = async (req, res) => {
    try {
        const { delivery_partner_id } = req.query;

        if (!delivery_partner_id) {
            return res
                .status(400)
                .json({ error: "delivery_partner_id is required" });
        }

        // Total deliveries
        const [totalDeliveries] = await query(
            "SELECT COUNT(*) as total FROM orders WHERE delivery_partner_id = ? AND status = 'delivered'",
            [delivery_partner_id]
        );

        // Total earnings
        const [totalEarnings] = await query(
            "SELECT COALESCE(SUM(delivery_fee), 0) as total FROM orders WHERE delivery_partner_id = ? AND status = 'delivered'",
            [delivery_partner_id]
        );

        // Average rating
        const [avgRating] = await query(
            `
            SELECT AVG(rv.delivery_rating) as rating
            FROM orders od
            LEFT JOIN reviews rv ON rv.order_id = od.id
            WHERE od.delivery_partner_id = ? AND rv.delivery_rating IS NOT NULL
        `,
            [delivery_partner_id]
        );

        // Completed vs Cancelled
        const statusCounts = await query(
            `
            SELECT 
                SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) as completed,
                SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled,
                SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected
            FROM orders 
            WHERE delivery_partner_id = ?
        `,
            [delivery_partner_id]
        );

        // Daily deliveries (last 7 days)
        const dailyDeliveries = await query(
            `
            SELECT DATE(delivered_at) as date, COUNT(*) as deliveries, SUM(delivery_fee) as earnings
            FROM orders 
            WHERE delivery_partner_id = ? AND delivered_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
            GROUP BY DATE(delivered_at)
            ORDER BY date DESC
        `,
            [delivery_partner_id]
        );

        res.json({
            total_deliveries: parseInt(totalDeliveries[0]?.total) || 0,
            total_earnings: parseFloat(totalEarnings[0]?.total) || 0,
            average_rating: avgRating[0]?.rating
                ? parseFloat(avgRating[0].rating).toFixed(1)
                : "N/A",
            completed: parseInt(statusCounts[0]?.completed) || 0,
            cancelled: parseInt(statusCounts[0]?.cancelled) || 0,
            rejected: parseInt(statusCounts[0]?.rejected) || 0,
            daily_deliveries: dailyDeliveries,
        });
    } catch (error) {
        console.error("Error fetching delivery partner analytics:", error);
        res.status(500).json({
            error: "Failed to fetch delivery partner analytics",
        });
    }
};

// Get Restaurant Menu by Restaurant ID
export const getRestaurantMenu = async (req, res) => {
    try {
        const { id } = req.params;
        const items = await query(
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
            ORDER BY is_available DESC, popularity DESC, created_at DESC
        `,
            [id]
        );

        res.json(items);
    } catch (error) {
        console.error("Error fetching restaurant menu:", error);
        res.status(500).json({ error: "Failed to fetch restaurant menu" });
    }
};

export default {
    getStatistics,
    getApplications,
    getApplicationById,
    approveApplication,
    rejectApplication,
    getRestaurants,
    getRestaurantById,
    getRestaurantMenu,
    updateRestaurantStatus,
    updateRestaurant,
    getOrders,
    getOrderById,
    updateOrderStatus,
    assignDeliveryPartner,
    assignOrderToPartner,
    getDeliveryPartners,
    getDeliveryPartnerById,
    updateDeliveryPartnerStatus,
    updateDeliveryPartner,
    getGeneralSettings,
    updateGeneralSettings,
    getNotificationSettings,
    updateNotificationSettings,
    getSecuritySettings,
    updateSecuritySettings,
    getRestaurantCommission,
    updateRestaurantCommission,
    getDeliverySettings,
    updateDeliverySettings,
    getOverview,
    getReadyForPickupOrders,
    getLogs,
    getUsers,
    getRestaurantAnalytics,
    getDeliveryPartnerAnalytics,
};

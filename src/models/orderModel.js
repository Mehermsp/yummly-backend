import { getOne, query, withTransaction } from "../config/db.js";
import { ORDER_STATUS } from "../constants/index.js";

export const listCustomerOrders = async (customerId) =>
    query(
        `
        SELECT
            o.id,
            o.order_number,
            o.status,
            o.total,
            o.payment_method,
            o.payment_status,
            o.created_at,
            r.name AS restaurant_name,
            r.image_url AS restaurant_image
        FROM orders o
        INNER JOIN restaurants r ON r.id = o.restaurant_id
        WHERE o.customer_id = ?
        ORDER BY o.created_at DESC
        `,
        [customerId]
    );

export const getOrderById = async (orderId) =>
    getOne(
        `
        SELECT
            o.*,
            r.name AS restaurant_name,
            r.image_url AS restaurant_image,
            r.phone AS restaurant_phone,
            c.name AS customer_name,
            c.phone AS customer_phone,
            d.name AS delivery_partner_name,
            d.phone AS delivery_partner_phone,
            a.door_no, a.street, a.area, a.city, a.state, a.pincode, a.landmark
        FROM orders o
        INNER JOIN restaurants r ON r.id = o.restaurant_id
        INNER JOIN users c ON c.id = o.customer_id
        LEFT JOIN addresses a ON a.id = o.delivery_address_id
        LEFT JOIN users d ON d.id = o.delivery_partner_id
        WHERE o.id = ?
        LIMIT 1
        `,
        [orderId]
    );

export const getOrderItems = async (orderId) =>
    query(
        `
        SELECT id, menu_item_id AS menu_id, name, price, quantity AS qty
        FROM order_items
        WHERE order_id = ?
        ORDER BY id ASC
        `,
        [orderId]
    );

export const getOrderStatusLogs = async (orderId) =>
    query(
        `
        SELECT old_status, new_status, changed_by, changed_by_role, notes, created_at
        FROM order_status_logs
        WHERE order_id = ?
        ORDER BY id ASC
        `,
        [orderId]
    );

export const createOrder = async ({
    customerId,
    addressId,
    paymentMethod,
    customerNotes,
}) =>
    withTransaction(async (connection) => {
        // Get cart items with menu details
        const [cartItems] = await connection.execute(
            `
            SELECT
                ci.id,
                ci.user_id,
                ci.menu_item_id AS menu_id,
                ci.quantity AS qty,
                ci.unit_price AS item_price,
                mi.name,
                mi.restaurant_id,
                mi.description,
                mi.discount_percent AS discount
            FROM cart_items ci
            INNER JOIN menu_items mi ON mi.id = ci.menu_item_id
            WHERE ci.user_id = ?
            ORDER BY ci.id ASC
            `,
            [customerId]
        );

        if (!cartItems.length) {
            throw new Error("Cart is empty");
        }

        const restaurantId = cartItems[0].restaurant_id;
        if (cartItems.some((item) => item.restaurant_id !== restaurantId)) {
            throw new Error("Cart must contain items from only one restaurant");
        }

        const subtotal = cartItems.reduce(
            (sum, item) => sum + Number(item.item_price * item.qty),
            0
        );
        const itemDiscount = cartItems.reduce(
            (sum, item) =>
                sum +
                (Number(item.item_price) *
                    Number(item.qty) *
                    Number(item.discount || 0)) /
                    100,
            0
        );
        const taxAmount = Number((subtotal * 0.05).toFixed(2)); // 5% tax
        const deliveryFee = subtotal >= 400 ? 0 : 40; // Default delivery fee
        const total = Number(
            (subtotal - itemDiscount + deliveryFee + taxAmount).toFixed(2)
        );
        const orderNumber = `TK${Date.now()}`;

        // Create order
        const [orderResult] = await connection.execute(
            `
            INSERT INTO orders (
                order_number,
                customer_id,
                restaurant_id,
                delivery_address_id,
                status,
                subtotal,
                item_discount,
                delivery_fee,
                tax_amount,
                total,
                payment_method,
                payment_status,
                customer_notes,
                phone
            ) VALUES (?, ?, ?, ?, 'placed', ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
            `,
            [
                orderNumber,
                customerId,
                restaurantId,
                addressId,
                subtotal,
                itemDiscount,
                deliveryFee,
                taxAmount,
                total,
                paymentMethod || "cash",
                customerNotes || null,
                null,
            ]
        );

        const orderId = orderResult.insertId;

        // Create order items
        for (const item of cartItems) {
            await connection.execute(
                `
                INSERT INTO order_items (
                    order_id,
                    menu_item_id,
                    name,
                    price,
                    quantity,
                    discount_percent,
                    subtotal
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                `,
                [
                    orderId,
                    item.menu_id,
                    item.name,
                    item.item_price,
                    item.qty,
                    item.discount || 0,
                    Number((item.item_price * item.qty).toFixed(2)),
                ]
            );
        }

        // Clear cart
        await connection.execute(`DELETE FROM cart_items WHERE user_id = ?`, [
            customerId,
        ]);

        return orderId;
    });

export const updateOrderStatus = async ({
    orderId,
    currentStatus,
    nextStatus,
    actorId,
    actorRole,
    notes,
    deliveryPartnerId,
}) => {
    const statusTimestamps = {
        confirmed: "confirmed_at = CURRENT_TIMESTAMP",
        preparing: null,
        ready_for_pickup: "prepared_at = CURRENT_TIMESTAMP",
        out_for_delivery: "picked_up_at = CURRENT_TIMESTAMP",
        delivered:
            "delivered_at = CURRENT_TIMESTAMP, actual_delivery_time = CURRENT_TIMESTAMP",
        cancelled: "cancelled_at = CURRENT_TIMESTAMP",
    };

    const extraSet = statusTimestamps[nextStatus]
        ? `, ${statusTimestamps[nextStatus]}`
        : "";

    await query(
        `
        UPDATE orders
        SET status = ?, delivery_partner_id = COALESCE(?, delivery_partner_id) ${extraSet}
        WHERE id = ?
        `,
        [nextStatus, deliveryPartnerId || null, orderId]
    );

    await query(
        `
        INSERT INTO order_status_logs (
            order_id,
            old_status,
            new_status,
            changed_by,
            changed_by_role,
            notes
        ) VALUES (?, ?, ?, ?, ?, ?)
        `,
        [
            orderId,
            currentStatus || null,
            nextStatus,
            actorId,
            actorRole,
            notes || null,
        ]
    );
};

export const cancelOrder = async ({
    orderId,
    currentStatus,
    actorId,
    actorRole,
    notes,
}) => {
    await updateOrderStatus({
        orderId,
        currentStatus,
        nextStatus: ORDER_STATUS.CANCELLED,
        actorId,
        actorRole,
        notes,
    });
};

export const getDeliveryOpenOrders = async () =>
    query(
        `
        SELECT
            o.id,
            o.order_number,
            o.status,
            o.total,
            o.created_at,
            r.name AS restaurant_name,
            r.address AS restaurant_address,
            a.door_no, a.street, a.area, a.city, a.pincode
        FROM orders o
        INNER JOIN restaurants r ON r.id = o.restaurant_id
        LEFT JOIN addresses a ON a.id = o.delivery_address_id
        LEFT JOIN delivery_assignments da
            ON da.order_id = o.id AND da.status IN ('assigned', 'accepted', 'picked_up')
        WHERE o.status = 'ready_for_pickup' AND da.id IS NULL
        ORDER BY o.created_at ASC
        `
    );

export const createDeliveryAssignment = async ({
    orderId,
    deliveryPartnerId,
}) =>
    withTransaction(async (connection) => {
        const [existing] = await connection.execute(
            `
            SELECT id
            FROM delivery_assignments
            WHERE order_id = ? AND status IN ('assigned', 'accepted', 'picked_up')
            LIMIT 1
            `,
            [orderId]
        );

        if (existing.length) {
            throw new Error("Order already assigned");
        }

        await connection.execute(
            `
            INSERT INTO delivery_assignments (order_id, delivery_partner_id, status, accepted_at)
            VALUES (?, ?, 'accepted', CURRENT_TIMESTAMP)
            `,
            [orderId, deliveryPartnerId]
        );

        await connection.execute(
            `
            UPDATE orders
            SET delivery_partner_id = ?
            WHERE id = ?
            `,
            [deliveryPartnerId, orderId]
        );
    });

export const updateAssignmentStatus = async ({
    orderId,
    deliveryPartnerId,
    status,
    rejectionReason,
}) =>
    query(
        `
        UPDATE delivery_assignments
        SET
            status = ?,
            rejection_reason = ?,
            accepted_at = CASE WHEN ? = 'accepted' THEN CURRENT_TIMESTAMP ELSE accepted_at END,
            rejected_at = CASE WHEN ? = 'rejected' THEN CURRENT_TIMESTAMP ELSE rejected_at END,
            picked_up_at = CASE WHEN ? = 'picked_up' THEN CURRENT_TIMESTAMP ELSE picked_up_at END,
            delivered_at = CASE WHEN ? = 'delivered' THEN CURRENT_TIMESTAMP ELSE delivered_at END
        WHERE order_id = ? AND delivery_partner_id = ?
        `,
        [
            status,
            rejectionReason || null,
            status,
            status,
            status,
            status,
            orderId,
            deliveryPartnerId,
        ]
    );

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
            a.door_no, a.street, a.area, a.city, a.pincode
        FROM orders o
        INNER JOIN users c ON c.id = o.customer_id
        LEFT JOIN addresses a ON a.id = o.delivery_address_id
        WHERE o.restaurant_id = ?
          AND (? IS NULL OR o.status = ?)
        ORDER BY o.created_at DESC
        `,
        [restaurantId, status || null, status || null]
    );

export const listDeliveryAssignments = async (deliveryPartnerId) =>
    query(
        `
        SELECT
            da.order_id,
            da.status AS assignment_status,
            o.order_number,
            o.status AS order_status,
            o.total,
            o.created_at,
            o.phone AS customer_phone,
            o.customer_notes,
            r.name AS restaurant_name,
            r.phone AS restaurant_phone,
            r.address AS restaurant_address,
            c.name AS customer_name,
            c.phone AS customer_phone_raw,
            a.door_no, a.street, a.area, a.city, a.state, a.pincode, a.landmark
        FROM delivery_assignments da
        INNER JOIN orders o ON o.id = da.order_id
        INNER JOIN restaurants r ON r.id = o.restaurant_id
        INNER JOIN users c ON c.id = o.customer_id
        LEFT JOIN addresses a ON a.id = o.delivery_address_id
        WHERE da.delivery_partner_id = ?
        ORDER BY da.assigned_at DESC
        `,
        [deliveryPartnerId]
    );

export const adminAssignOrder = async ({ orderId, deliveryPartnerId, adminId }) =>
    withTransaction(async (connection) => {
        const [existing] = await connection.execute(
            `
            SELECT id FROM delivery_assignments
            WHERE order_id = ? AND status IN ('assigned', 'accepted', 'picked_up')
            LIMIT 1
            `,
            [orderId]
        );

        if (existing.length) {
            throw new Error("Order already assigned to a delivery partner");
        }

        await connection.execute(
            `
            INSERT INTO delivery_assignments (order_id, delivery_partner_id, status, assigned_at)
            VALUES (?, ?, 'assigned', CURRENT_TIMESTAMP)
            `,
            [orderId, deliveryPartnerId]
        );

        await connection.execute(
            `
            UPDATE orders
            SET delivery_partner_id = ?
            WHERE id = ?
            `,
            [deliveryPartnerId, orderId]
        );

        await connection.execute(
            `
            INSERT INTO admin_activity_logs (admin_id, action, entity_type, entity_id, description)
            VALUES (?, 'assign_order', 'order', ?, ?)
            `,
            [adminId, orderId, `Assigned order ${orderId} to delivery partner ${deliveryPartnerId}`]
        );
    });

export const getDeliveryPartnerStats = async (deliveryPartnerId) => {
    const today = new Date().toISOString().split("T")[0];
    const [stats] = await query(
        `
        SELECT
            COUNT(*) AS total_deliveries,
            COUNT(CASE WHEN DATE(delivered_at) = ? THEN 1 END) AS today_deliveries,
            COALESCE(SUM(CASE WHEN DATE(delivered_at) = ? THEN delivery_fee ELSE 0 END), 0) AS today_earnings,
            COALESCE(AVG(delivery_rating), 0) AS avg_rating
        FROM delivery_assignments da
        INNER JOIN orders o ON o.id = da.order_id
        WHERE da.delivery_partner_id = ? AND da.status = 'delivered'
        `,
        [today, today, deliveryPartnerId]
    );
    return stats;
};

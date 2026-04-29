import { getOne, query, withTransaction } from "../config/db.js";
import { ORDER_STATUS } from "../constants/index.js";

const orderSelect = `
    SELECT
        o.*,
        o.user_id AS customer_id,
        o.address_id,
        o.notes AS customer_notes,
        c.phone AS phone,
        r.name AS restaurant_name,
        r.cover_image AS restaurant_image,
        r.phone AS restaurant_phone,
        c.name AS customer_name,
        c.phone AS customer_phone,
        d.name AS delivery_partner_name,
        d.phone AS delivery_partner_phone,
        o.door_no,
        o.street,
        o.area,
        o.city,
        o.state,
        o.zip_code AS pincode
    FROM orders o
    INNER JOIN restaurants r ON r.id = o.restaurant_id
    INNER JOIN users c ON c.id = o.user_id
    LEFT JOIN users d ON d.id = o.delivery_partner_id
`;

const statusTimestampFragments = {
    confirmed: "confirmed_at = CURRENT_TIMESTAMP",
    preparing: "prepared_at = CURRENT_TIMESTAMP",
    ready_for_pickup: "prepared_at = CURRENT_TIMESTAMP",
    out_for_delivery: "picked_up_at = CURRENT_TIMESTAMP",
    delivered:
        "delivered_at = CURRENT_TIMESTAMP, actual_delivery_time = CURRENT_TIMESTAMP",
    cancelled: "cancelled_at = CURRENT_TIMESTAMP",
};

const summarizeCart = (cartItems) => {
    const subtotal = cartItems.reduce(
        (sum, item) =>
            sum + Number(item.unit_price || 0) * Number(item.quantity || 0),
        0
    );

    const itemDiscount = cartItems.reduce(
        (sum, item) =>
            sum +
            (Number(item.unit_price || 0) *
                Number(item.quantity || 0) *
                Number(item.discount || 0)) /
                100,
        0
    );

    const taxAmount = Number((subtotal * 0.05).toFixed(2));
    const deliveryFee = subtotal >= 400 ? 0 : 40;
    const total = Number(
        (subtotal - itemDiscount + deliveryFee + taxAmount).toFixed(2)
    );

    const prepMinutes = Math.max(
        20,
        ...cartItems.map((item) => Number(item.preparation_time_mins || 20))
    );

    return {
        subtotal,
        itemDiscount: Number(itemDiscount.toFixed(2)),
        taxAmount,
        deliveryFee,
        total,
        estimatedDeliveryMinutes: prepMinutes + 30,
    };
};

// ====================== CUSTOMER ======================
export const listCustomerOrders = async (customerId, status) =>
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
            r.cover_image AS restaurant_image
        FROM orders o
        INNER JOIN restaurants r ON r.id = o.restaurant_id
        WHERE o.user_id = ?
          AND (? IS NULL OR o.status = ?)
        ORDER BY o.created_at DESC
        `,
        [customerId, status || null, status || null]
    );

export const getOrderById = async (orderId) =>
    getOne(`${orderSelect} WHERE o.id = ? LIMIT 1`, [orderId]);

export const getOrderItems = async (orderId) =>
    query(
        `
        SELECT
            id,
            menu_id AS menu_item_id,
            name,
            price,
            qty AS quantity,
            -- Calculate subtotal here since the column is missing in the DB
            (price * qty) AS subtotal 
        FROM order_items
        WHERE order_id = ?
        ORDER BY id ASC
        `,
        [orderId]
    );

export const getOrderStatusLogs = async (orderId) =>
    query(
        `
        SELECT
            status,
            updated_at AS created_at
        FROM order_status_logs
        WHERE order_id = ?
        ORDER BY updated_at ASC
        `,
        [orderId]
    );

// ====================== CREATE ORDER (Fixed) ======================
export const createOrder = async ({
    customerId,
    addressId,
    paymentMethod,
    customerNotes,
}) =>
    withTransaction(async (connection) => {
        // Fetch cart items
        const [cartItems] = await connection.execute(
            `
            SELECT
                c.menu_id AS menu_item_id,
                c.qty AS quantity,
                c.price AS unit_price,
                c.name,
                mi.restaurant_id,
                COALESCE(mi.discount, 0) AS discount,
                COALESCE(mi.preparation_time_mins, 20) AS preparation_time_mins,
                COALESCE(mi.is_available, 1) AS is_available,
                r.is_active,
                r.is_open
            FROM carts c
            INNER JOIN menu_items mi ON mi.id = c.menu_id
            INNER JOIN restaurants r ON r.id = mi.restaurant_id
            WHERE c.user_id = ?
            ORDER BY c.id ASC
            `,
            [customerId]
        );

        if (!cartItems.length) throw new Error("Cart is empty");

        if (
            cartItems.some(
                (item) => !item.is_available || !item.is_active || !item.is_open
            )
        ) {
            throw new Error("One or more cart items are unavailable right now");
        }

        const restaurantId = cartItems[0].restaurant_id;

        // Fetch address for denormalization
        const [addressRows] = await connection.execute(
            `
            SELECT door_no, street, area, city, state, zip_code 
            FROM addresses 
            WHERE id = ? AND user_id = ? 
            LIMIT 1
            `,
            [addressId, customerId]
        );

        if (!addressRows.length)
            throw new Error("Address not found or does not belong to user");

        const address = addressRows[0];

        const {
            subtotal,
            itemDiscount,
            taxAmount,
            deliveryFee,
            total,
            estimatedDeliveryMinutes,
        } = summarizeCart(cartItems);

        const orderNumber = `TK${Date.now()}`;
        const estimatedDeliveryTime = new Date(
            Date.now() + estimatedDeliveryMinutes * 60 * 1000
        );

        // Insert Order
        const [orderResult] = await connection.execute(
            `
            INSERT INTO orders (
                order_number,
                user_id,
                restaurant_id,
                address_id,
                status,
                subtotal,
                discount_amount,
                delivery_fee,
                tax_amount,
                total,
                payment_method,
                payment_status,
                estimated_delivery_time,
                notes,
                door_no, street, area, city, state, zip_code
            ) VALUES (?, ?, ?, ?, 'placed', ?, ?, ?, ?, ?, ?, 'pending', ?, ?,
                      ?, ?, ?, ?, ?, ?)
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
                estimatedDeliveryTime,
                customerNotes || null,
                address.door_no || null,
                address.street || null,
                address.area || null,
                address.city || null,
                address.state || null,
                address.zip_code || null,
            ]
        );

        const orderId = orderResult.insertId;

        // Insert Order Items
        for (const item of cartItems) {
            const discount = Number(item.discount || 0);
            const lineSubtotal = Number(
                (
                    Number(item.unit_price) *
                    Number(item.quantity) *
                    (1 - discount / 100)
                ).toFixed(2)
            );

            await connection.execute(
                `
                INSERT INTO order_items 
                (order_id, menu_id, name, price, qty, discount, subtotal)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                `,
                [
                    orderId,
                    item.menu_item_id,
                    item.name,
                    item.unit_price,
                    item.quantity,
                    discount,
                    lineSubtotal,
                ]
            );
        }

        // Log initial status
        await connection.execute(
            `
            INSERT INTO order_status_logs (order_id, status, updated_at)
            VALUES (?, 'placed', CURRENT_TIMESTAMP)
            `,
            [orderId]
        );

        // Clear cart
        await connection.execute(`DELETE FROM carts WHERE user_id = ?`, [
            customerId,
        ]);

        return orderId;
    });

// ====================== STATUS MANAGEMENT ======================
export const updateOrderStatus = async ({
    orderId,
    currentStatus,
    nextStatus,
    actorId,
    actorRole,
    notes,
    deliveryPartnerId,
}) => {
    const statusTimestampFragment = statusTimestampFragments[nextStatus] || "";

    const paymentSet =
        nextStatus === ORDER_STATUS.DELIVERED
            ? `, payment_status = CASE WHEN payment_method = 'cash' THEN 'completed' ELSE payment_status END`
            : "";

    const deliveryPartnerSet =
        deliveryPartnerId !== undefined
            ? ", delivery_partner_id = COALESCE(?, delivery_partner_id)"
            : "";

    const sql = `
        UPDATE orders
        SET
            status = ?,
            delivery_notes = COALESCE(?, delivery_notes),
            updated_at = CURRENT_TIMESTAMP
            ${deliveryPartnerSet}
            ${statusTimestampFragment ? `, ${statusTimestampFragment}` : ""}
            ${paymentSet}
        WHERE id = ?
    `;

    const params = [nextStatus, notes || null];
    if (deliveryPartnerId !== undefined) params.push(deliveryPartnerId || null);
    params.push(orderId);

    await query(sql, params);

    await query(
        `
        INSERT INTO order_status_logs 
        (order_id, old_status, new_status, changed_by, changed_by_role, notes)
        VALUES (?, ?, ?, ?, ?, ?)
        `,
        [
            orderId,
            currentStatus || null,
            nextStatus,
            actorId || null,
            actorRole || "system",
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

// ====================== DELIVERY & RESTAURANT ======================
export const getDeliveryOpenOrders = async () =>
    query(
        `
        SELECT
            o.id,
            o.order_number,
            o.status,
            o.total,
            o.delivery_fee,
            o.created_at,
            r.name AS restaurant_name,
            r.address AS restaurant_address,
            o.door_no,
            o.street,
            o.area,
            o.city,
            o.state,
            o.zip_code AS pincode
        FROM orders o
        INNER JOIN restaurants r ON r.id = o.restaurant_id
        LEFT JOIN delivery_assignments da
            ON da.order_id = o.id
           AND da.status IN ('assigned', 'accepted', 'picked_up')
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
            o.notes AS customer_notes,
            c.name AS customer_name,
            c.phone AS customer_phone,
            o.door_no,
            o.street,
            o.area,
            o.city,
            o.zip_code AS pincode
        FROM orders o
        INNER JOIN users c ON c.id = o.user_id
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
            da.assigned_at,
            da.accepted_at,
            da.rejected_at,
            da.picked_up_at,
            da.delivered_at,
            o.order_number,
            o.status AS order_status,
            o.total,
            o.delivery_fee,
            o.created_at,
            o.notes AS customer_notes,
            r.name AS restaurant_name,
            r.phone AS restaurant_phone,
            o.door_no,
            o.street,
            o.area,
            o.city,
            o.state,
            o.zip_code AS pincode
        FROM delivery_assignments da
        INNER JOIN orders o ON o.id = da.order_id
        INNER JOIN restaurants r ON r.id = o.restaurant_id
        INNER JOIN users c ON c.id = o.user_id
        WHERE da.delivery_partner_id = ?
        ORDER BY da.assigned_at DESC
        `,
        [deliveryPartnerId]
    );

export const adminAssignOrder = async ({
    orderId,
    deliveryPartnerId,
    adminId,
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
            [
                adminId,
                orderId,
                `Assigned order ${orderId} to delivery partner ${deliveryPartnerId}`,
            ]
        );
    });

export const getDeliveryPartnerStats = async (deliveryPartnerId) => {
    const today = new Date().toISOString().split("T")[0];

    const rows = await query(
        `
        SELECT
            COUNT(*) AS total_deliveries,
            COUNT(CASE WHEN DATE(da.delivered_at) = ? THEN 1 END) AS today_deliveries,
            COALESCE(
                SUM(CASE WHEN DATE(da.delivered_at) = ? THEN o.delivery_fee ELSE 0 END),
                0
            ) AS today_earnings,
            COALESCE(AVG(u.delivery_rating), 0) AS avg_rating
        FROM delivery_assignments da
        INNER JOIN orders o ON o.id = da.order_id
        INNER JOIN users u ON u.id = da.delivery_partner_id
        WHERE da.delivery_partner_id = ? 
          AND da.status = 'delivered'
        `,
        [today, today, deliveryPartnerId]
    );

    return (
        rows[0] || {
            total_deliveries: 0,
            today_deliveries: 0,
            today_earnings: 0,
            avg_rating: 0,
        }
    );
};

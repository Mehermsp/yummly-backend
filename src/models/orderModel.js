import { getOne, query, withTransaction } from "../config/db.js";
import { ORDER_STATUS } from "../constants/index.js";

// Ensure this select fragment uses the exact column names from your 'orders' table
const orderSelect = `
    SELECT
        o.*,
        o.user_id AS customer_id,
        o.address_id,
        o.notes AS customer_notes,
        c.name AS customer_name,
        c.phone AS customer_phone,
        c.email AS customer_email,
        r.name AS restaurant_name,
        r.cover_image AS restaurant_image,
        r.phone AS restaurant_phone,
        r.email AS restaurant_email,
        d.name AS delivery_partner_name,
        d.phone AS delivery_partner_phone,
        o.door_no,
        o.street,
        o.area,
        o.city,
        o.state,
        o.zip_code
    FROM orders o
    INNER JOIN restaurants r ON r.id = o.restaurant_id
    INNER JOIN users c ON c.id = o.user_id
    LEFT JOIN users d ON d.id = o.delivery_partner_id
`;

const statusTimestampFragments = {
    placed: "",
    confirmed: "",
    preparing: "",
    prepared: "",
    ready: "",
    picked_up: "",
    on_the_way: "",
    delivered: "delivered_at = CURRENT_TIMESTAMP", // keep this (orders table has it)
    cancelled: "",
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

export const getCustomerCheckoutSummary = async (customerId) => {
    const cartItems = await query(
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

    if (!cartItems.length) {
        throw new Error("Cart is empty");
    }

    if (
        cartItems.some(
            (item) => !item.is_available || !item.is_active || !item.is_open
        )
    ) {
        throw new Error("One or more items are unavailable");
    }

    return summarizeCart(cartItems);
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

export const findOrderByPaymentReference = async (paymentReference) => {
    try {
        return await getOne(
            `SELECT id, order_number FROM orders WHERE payment_reference = ? LIMIT 1`,
            [paymentReference]
        );
    } catch {
        return null;
    }
};

const enrichOrderItemsWithImages = async (items) => {
    if (!items?.length) return [];

    const uniqueMenuIds = [
        ...new Set(
            items
                .map((item) => Number(item.menu_item_id || item.menu_id || 0))
                .filter((id) => Number.isFinite(id) && id > 0)
        ),
    ];

    if (!uniqueMenuIds.length) return items;

    const placeholders = uniqueMenuIds.map(() => "?").join(", ");
    const imageMap = new Map();

    const rows = await query(
        `
        SELECT id, image AS image_url
        FROM menu_items
        WHERE id IN (${placeholders})
        `,
        uniqueMenuIds
    );
    rows.forEach((row) => {
        imageMap.set(Number(row.id), row.image_url || null);
    });

    return items.map((item) => {
        const menuId = Number(item.menu_item_id || item.menu_id || 0);
        return {
            ...item,
            image_url: item.image_url || imageMap.get(menuId) || null,
        };
    });
};

export const getOrderItems = async (orderId) => {
    let rows;
    try {
        rows = await query(
            `
            SELECT
                id,
                menu_id AS menu_item_id,
                name,
                price,
                qty AS quantity,
                discount,
                subtotal
            FROM order_items
            WHERE order_id = ?
            ORDER BY id ASC
            `,
            [orderId]
        );
    } catch {
        // Compatibility fallback for schemas using menu_item_id/quantity/discount_percent.
        rows = await query(
            `
            SELECT
                id,
                menu_item_id,
                name,
                price,
                quantity,
                discount_percent AS discount,
                subtotal
            FROM order_items
            WHERE order_id = ?
            ORDER BY id ASC
            `,
            [orderId]
        );
    }

    return enrichOrderItemsWithImages(rows);
};

export const getOrderStatusLogs = async (orderId) =>
    query(
        `
        SELECT status, updated_at AS created_at
        FROM order_status_logs
        WHERE order_id = ?
        ORDER BY updated_at ASC
        `,
        [orderId]
    );

// ====================== CREATE ORDER (Fixed Columns) ======================
export const createOrder = async ({
    customerId,
    addressId,
    paymentMethod,
    customerNotes,
    paymentStatus = "pending",
    paymentReference = null,
}) =>
    withTransaction(async (connection) => {
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
            throw new Error("One or more items are unavailable");
        }

        const restaurantId = cartItems[0].restaurant_id;

        // Fetch address (using zip_code to match your schema)
        const [addressRows] = await connection.execute(
            `SELECT door_no, street, area, city, state, pincode FROM addresses WHERE id = ? AND user_id = ? LIMIT 1`,
            [addressId, customerId]
        );

        if (!addressRows.length) throw new Error("Address not found");
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

        let orderResult;
        try {
            [orderResult] = await connection.execute(
                `
                INSERT INTO orders (
                    order_number, user_id, restaurant_id, address_id, status,
                    subtotal, discount_amount, delivery_fee, tax_amount, total,
                    payment_method, payment_status, payment_reference,
                    estimated_delivery_time, notes, door_no, street, area, city,
                    state, zip_code
                ) VALUES (?, ?, ?, ?, 'placed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                    paymentMethod || "upi",
                    paymentStatus || "pending",
                    paymentReference || null,
                    estimatedDeliveryTime,
                    customerNotes || null,
                    address.door_no,
                    address.street,
                    address.area,
                    address.city,
                    address.state,
                    address.pincode,
                ]
            );
        } catch {
            [orderResult] = await connection.execute(
                `
                INSERT INTO orders (
                    order_number, user_id, restaurant_id, address_id, status,
                    subtotal, discount_amount, delivery_fee, tax_amount, total,
                    payment_method, payment_status, estimated_delivery_time, notes,
                    door_no, street, area, city, state, zip_code
                ) VALUES (?, ?, ?, ?, 'placed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                    paymentMethod || "upi",
                    paymentStatus || "pending",
                    estimatedDeliveryTime,
                    customerNotes || null,
                    address.door_no,
                    address.street,
                    address.area,
                    address.city,
                    address.state,
                    address.pincode,
                ]
            );
        }

        const orderId = orderResult.insertId;

        for (const item of cartItems) {
            const disc = Number(item.discount || 0);
            const lineSubtotal = Number(
                (
                    Number(item.unit_price) *
                    Number(item.quantity) *
                    (1 - disc / 100)
                ).toFixed(2)
            );

            await connection.execute(
                `INSERT INTO order_items (order_id, menu_id, name, price, qty, discount, subtotal) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    orderId,
                    item.menu_item_id,
                    item.name,
                    item.unit_price,
                    item.quantity,
                    disc,
                    lineSubtotal,
                ]
            );
        }

        await connection.execute(
            `INSERT INTO order_status_logs (order_id, status, updated_at) VALUES (?, 'placed', CURRENT_TIMESTAMP)`,
            [orderId]
        );
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

    const sqlPrimary = `
        UPDATE orders
        SET status = ?, delivery_notes = COALESCE(?, delivery_notes), updated_at = CURRENT_TIMESTAMP
            ${deliveryPartnerSet} ${
        statusTimestampFragment ? `, ${statusTimestampFragment}` : ""
    } ${paymentSet}
        WHERE id = ?
    `;
    const primaryParams = [nextStatus, notes || null];
    if (deliveryPartnerId !== undefined) {
        primaryParams.push(deliveryPartnerId || null);
    }
    primaryParams.push(orderId);

    const sqlFallback = `
        UPDATE orders
        SET status = ?, updated_at = CURRENT_TIMESTAMP
            ${
                deliveryPartnerId !== undefined
                    ? ", delivery_partner_id = COALESCE(?, delivery_partner_id)"
                    : ""
            }
            ${paymentSet}
        WHERE id = ?
    `;
    const fallbackParams = [nextStatus];
    if (deliveryPartnerId !== undefined) {
        fallbackParams.push(deliveryPartnerId || null);
    }
    fallbackParams.push(orderId);

    try {
        await query(sqlPrimary, primaryParams);
    } catch {
        // Legacy schemas may miss delivery_notes or timestamp columns.
        try {
            await query(sqlFallback, fallbackParams);
        } catch {
            // Last fallback for very old schemas that may not have updated_at.
            await query(`UPDATE orders SET status = ? WHERE id = ?`, [
                nextStatus,
                orderId,
            ]);
        }
    }
    await query(
        `INSERT INTO order_status_logs (order_id, status, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)`,
        [orderId, nextStatus]
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
export const getDeliveryOpenOrders = async (deliveryPartnerId = null) =>
    query(
        `
        SELECT o.id,
               COALESCE(o.order_number, '') AS order_number,
               COALESCE(o.status, '') AS status,
               COALESCE(o.total, 0) AS total,
               COALESCE(o.delivery_fee, 0) AS delivery_fee,
               o.created_at,
               COALESCE(r.name, '') AS restaurant_name,
               COALESCE(r.address, '') AS restaurant_address,
               COALESCE(r.cover_image, '') AS restaurant_image,
               COALESCE(r.phone, '') AS restaurant_phone,
               COALESCE(o.door_no, '') AS door_no,
               COALESCE(o.street, '') AS street,
               COALESCE(o.area, '') AS area,
               COALESCE(o.city, '') AS city,
               COALESCE(o.state, '') AS state,
               COALESCE(o.zip_code, '') AS zip_code,
               COALESCE(c.name, '') AS customer_name,
               COALESCE(c.phone, '') AS customer_phone
        FROM orders o
        INNER JOIN restaurants r ON r.id = o.restaurant_id
        LEFT JOIN users c ON c.id = o.user_id
        LEFT JOIN delivery_assignments da ON da.order_id = o.id AND da.status IN ('assigned', 'accepted', 'payment_confirmed', 'picked_up')
        LEFT JOIN delivery_assignments da_rejected ON da_rejected.order_id = o.id
            AND da_rejected.delivery_partner_id = ?
            AND da_rejected.status = 'rejected'
        WHERE o.status IN ('ready', 'ready_for_pickup', 'prepared')
          AND da.id IS NULL
          AND da_rejected.id IS NULL
        ORDER BY o.created_at ASC
        `,
        [deliveryPartnerId]
    );

export const claimReadyOrderAssignment = async ({ orderId, deliveryPartnerId }) =>
    withTransaction(async (connection) => {
        const [activeAssignments] = await connection.execute(
            `
            SELECT delivery_partner_id, status
            FROM delivery_assignments
            WHERE order_id = ? AND status IN ('assigned', 'accepted', 'payment_confirmed', 'picked_up')
            LIMIT 1
            FOR UPDATE
            `,
            [orderId]
        );

        if (
            activeAssignments.length &&
            Number(activeAssignments[0].delivery_partner_id) !==
                Number(deliveryPartnerId)
        ) {
            return { success: false, reason: "assigned_to_another_partner" };
        }

        await connection.execute(
            `
            INSERT INTO delivery_assignments (
                order_id,
                delivery_partner_id,
                status,
                assigned_at,
                accepted_at,
                rejection_reason,
                rejected_at
            ) VALUES (?, ?, 'accepted', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL, NULL)
            ON DUPLICATE KEY UPDATE
                status = 'accepted',
                accepted_at = CURRENT_TIMESTAMP,
                rejection_reason = NULL,
                rejected_at = NULL
            `,
            [orderId, deliveryPartnerId]
        );

        const [orderUpdate] = await connection.execute(
            `
            UPDATE orders
            SET delivery_partner_id = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND (delivery_partner_id IS NULL OR delivery_partner_id = ?)
            `,
            [deliveryPartnerId, orderId, deliveryPartnerId]
        );

        if (!orderUpdate.affectedRows) {
            return { success: false, reason: "assigned_to_another_partner" };
        }

        return { success: true };
    });

export const markOrderRejectedForPartner = async ({
    orderId,
    deliveryPartnerId,
    rejectionReason,
}) =>
    query(
        `
        INSERT INTO delivery_assignments (
            order_id,
            delivery_partner_id,
            status,
            assigned_at,
            rejection_reason,
            rejected_at
        ) VALUES (?, ?, 'rejected', CURRENT_TIMESTAMP, ?, CURRENT_TIMESTAMP)
        ON DUPLICATE KEY UPDATE
            status = 'rejected',
            rejection_reason = VALUES(rejection_reason),
            rejected_at = CURRENT_TIMESTAMP
        `,
        [orderId, deliveryPartnerId, rejectionReason || null]
    );

export const confirmOrderPaymentByDeliveryPartner = async ({
    orderId,
    deliveryPartnerId,
}) => {
    const candidateStatuses = ["completed", "paid", "confirmed", "success"];
    let lastError = null;

    for (const paymentStatus of candidateStatuses) {
        try {
            const result = await query(
                `
                UPDATE orders o
                INNER JOIN delivery_assignments da
                    ON da.order_id = o.id
                    AND da.delivery_partner_id = ?
                SET o.payment_status = ?,
                    o.updated_at = CURRENT_TIMESTAMP
                WHERE o.id = ?
                  AND o.payment_method = 'cash'
                  AND o.payment_status = 'pending'
                  AND da.status IN ('accepted', 'payment_confirmed', 'picked_up', 'delivered')
                `,
                [deliveryPartnerId, paymentStatus, orderId]
            );
            return { ...result, paymentStatus };
        } catch (error) {
            const message = String(error?.message || "").toLowerCase();
            if (message.includes("data truncated for column 'payment_status'")) {
                lastError = error;
                continue;
            }
            throw error;
        }
    }

    if (lastError) throw lastError;
    return { affectedRows: 0 };
};

export const createDeliveryAssignment = async ({
    orderId,
    deliveryPartnerId,
}) =>
    withTransaction(async (connection) => {
        const [existing] = await connection.execute(
            `SELECT id FROM delivery_assignments WHERE order_id = ? AND status IN ('assigned', 'accepted', 'payment_confirmed', 'picked_up') LIMIT 1`,
            [orderId]
        );
        if (existing.length) throw new Error("Order already assigned");

        await connection.execute(
            `INSERT INTO delivery_assignments (order_id, delivery_partner_id, status, accepted_at) VALUES (?, ?, 'accepted', CURRENT_TIMESTAMP)`,
            [orderId, deliveryPartnerId]
        );
        await connection.execute(
            `UPDATE orders SET delivery_partner_id = ? WHERE id = ?`,
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
        SET status = ?, rejection_reason = ?,
            accepted_at = CASE WHEN ? = 'accepted' THEN CURRENT_TIMESTAMP ELSE accepted_at END,
            rejected_at = CASE WHEN ? = 'rejected' THEN CURRENT_TIMESTAMP ELSE rejected_at END,
            pickup_time = CASE WHEN ? = 'picked_up' THEN CURRENT_TIMESTAMP ELSE pickup_time END,
            delivery_time = CASE WHEN ? = 'delivered' THEN CURRENT_TIMESTAMP ELSE delivery_time END
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

export const getAssignmentForOrderAndPartner = async (
    orderId,
    deliveryPartnerId
) =>
    getOne(
        `
        SELECT *
        FROM delivery_assignments
        WHERE order_id = ? AND delivery_partner_id = ?
        ORDER BY id DESC
        LIMIT 1
        `,
        [orderId, deliveryPartnerId]
    );

export const clearOrderDeliveryPartner = async (orderId, deliveryPartnerId) =>
    query(
        `
        UPDATE orders
        SET delivery_partner_id = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND delivery_partner_id = ?
        `,
        [orderId, deliveryPartnerId]
    );

export const listRestaurantOrders = async (restaurantId, status) =>
    query(
        `
        SELECT o.id, o.order_number, o.status, o.total, o.payment_status, o.created_at,
               o.notes AS customer_notes, c.name AS customer_name, c.phone AS customer_phone,
               o.door_no, o.street, o.area, o.city, o.zip_code
        FROM orders o
        INNER JOIN users c ON c.id = o.user_id
        WHERE o.restaurant_id = ? AND (? IS NULL OR o.status = ?)
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
            da.delivery_time,
            COALESCE(o.order_number, '') AS order_number, 
            COALESCE(o.status, '') AS order_status,
            COALESCE(o.subtotal, 0) AS subtotal,
            COALESCE(o.discount_amount, 0) AS discount_amount,
            COALESCE(o.delivery_fee, 0) AS delivery_fee,
            COALESCE(o.tax_amount, 0) AS tax_amount,
            COALESCE(o.total, 0) AS total, 
            COALESCE(o.payment_method, '') AS payment_method,
            COALESCE(o.payment_status, '') AS payment_status,
            o.created_at,
            COALESCE(o.notes, '') AS customer_notes,
            -- Restaurant details
            COALESCE(r.name, '') AS restaurant_name,
            COALESCE(r.address, '') AS restaurant_address,
            COALESCE(r.cover_image, '') AS restaurant_image,
            COALESCE(r.phone, '') AS restaurant_phone,
            COALESCE(r.email, '') AS restaurant_email,
            -- Customer details
            COALESCE(c.name, '') AS customer_name,
            COALESCE(c.phone, '') AS customer_phone,
            COALESCE(c.email, '') AS customer_email,
            -- Delivery address
            COALESCE(o.door_no, '') AS door_no,
            COALESCE(o.street, '') AS street,
            COALESCE(o.area, '') AS area,
            COALESCE(o.city, '') AS city,
            COALESCE(o.state, '') AS state,
            COALESCE(o.zip_code, '') AS zip_code,
            COALESCE(o.phone, '') AS delivery_phone
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
            `SELECT id FROM delivery_assignments WHERE order_id = ? AND status IN ('assigned', 'accepted', 'payment_confirmed', 'picked_up') LIMIT 1`,
            [orderId]
        );
        if (existing.length) throw new Error("Order already assigned");

        await connection.execute(
            `INSERT INTO delivery_assignments (order_id, delivery_partner_id, status, assigned_at) VALUES (?, ?, 'assigned', CURRENT_TIMESTAMP)`,
            [orderId, deliveryPartnerId]
        );
        await connection.execute(
            `UPDATE orders SET delivery_partner_id = ? WHERE id = ?`,
            [deliveryPartnerId, orderId]
        );
        await connection.execute(
            `INSERT INTO admin_activity_log (admin_id, action, entity_type, entity_id, details) VALUES (?, 'assign_order', 'order', ?, ?)`,
            [
                adminId,
                orderId,
                JSON.stringify({
                    message: `Assigned order ${orderId} to delivery partner ${deliveryPartnerId}`,
                    delivery_partner_id: deliveryPartnerId,
                }),
            ]
        );
    });

export const getDeliveryPartnerStats = async (deliveryPartnerId) => {
    const today = new Date().toISOString().split("T")[0];
    let rows;
    try {
        rows = await query(
            `
            SELECT COUNT(*) AS total_deliveries,
COUNT(CASE WHEN DATE(da.delivery_time) = ? THEN 1 END) AS today_deliveries,
                   COALESCE(SUM(CASE WHEN DATE(da.delivery_time) = ? THEN o.delivery_fee ELSE 0 END), 0) AS today_earnings,
                   COALESCE(AVG(rv.delivery_rating), 0) AS avg_rating
            FROM delivery_assignments da
            INNER JOIN orders o ON o.id = da.order_id
            LEFT JOIN reviews rv ON rv.order_id = da.order_id
            WHERE da.delivery_partner_id = ? AND da.status = 'delivered'
            `,
            [today, today, deliveryPartnerId]
        );
    } catch {
        // Compatibility with deployments still using delivery_time.
        rows = await query(
            `
            SELECT COUNT(*) AS total_deliveries,
                   COUNT(CASE WHEN DATE(da.delivery_time) = ? THEN 1 END) AS today_deliveries,
                   COALESCE(SUM(CASE WHEN DATE(da.delivery_time) = ? THEN o.delivery_fee ELSE 0 END), 0) AS today_earnings,
                   COALESCE(AVG(rv.delivery_rating), 0) AS avg_rating
            FROM delivery_assignments da
            INNER JOIN orders o ON o.id = da.order_id
            LEFT JOIN reviews rv ON rv.order_id = da.order_id
            WHERE da.delivery_partner_id = ? AND da.status = 'delivered'
            `,
            [today, today, deliveryPartnerId]
        );
    }
    return (
        rows[0] || {
            total_deliveries: 0,
            today_deliveries: 0,
            today_earnings: 0,
            avg_rating: 0,
        }
    );
};

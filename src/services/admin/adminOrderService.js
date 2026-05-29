import { query, withTransaction } from "../../config/db.js";
import {
    normalizeOrderStatusInput,
    withProductOrderStatus,
    withProductOrderStatusList,
} from "../../utils/orderStatus.js";
import { getOrderById as getLiveOrderById } from "../../models/orderModel.js";
import { notifyOrderStakeholders } from "../notificationService.js";

export const getOrders = async (filters = {}) => {
    const { status, limit } = filters;

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
        params.push(normalizeOrderStatusInput(status));
    }

    sql += " ORDER BY o.created_at DESC";

    if (limit) {
        sql += ` LIMIT ${parseInt(limit)}`;
    }

    const orders = await query(sql, params);

    return withProductOrderStatusList(orders).map((o) => ({
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
};

export const getOrderById = async (id) => {
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

    if (!orders.length) {
        return null;
    }

    const items = await query("SELECT * FROM order_items WHERE order_id = ?", [
        id,
    ]);

    const order = withProductOrderStatus(orders[0]);

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

    return order;
};

export const getReadyForPickupOrders = async () => {
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
        WHERE o.status IN ('ready', 'ready_for_pickup')
        ORDER BY o.created_at DESC
    `);

    return withProductOrderStatusList(orders).map((o) => ({
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
};

export const assignDeliveryPartner = async ({
    orderId,
    deliveryPartnerId,
    adminId,
}) => {
    const result = await withTransaction(async (connection) => {
        const [orderRows] = await connection.execute(
            `
            SELECT id, status, delivery_partner_id
            FROM orders
            WHERE id = ?
            `,
            [orderId]
        );

        if (!orderRows.length) {
            throw new Error("Order not found");
        }

        const order = withProductOrderStatus(orderRows[0]);
        const orderStatus = normalizeOrderStatusInput(order.status);

        if (["delivered", "cancelled"].includes(orderStatus)) {
            throw new Error(
                "Cannot assign delivery for delivered or cancelled orders"
            );
        }

        const allowedStatuses = [
            "ready",
            "ready_for_pickup",
            "prepared",
            "on_the_way",
            "out_for_delivery",
        ];

        if (!allowedStatuses.includes(orderStatus)) {
            throw new Error(
                `Delivery assignment not allowed for status: ${order.status}`
            );
        }

        const [partnerRows] = await connection.execute(
            `
            SELECT id, role, is_available
            FROM users
            WHERE id = ? AND role = 'delivery_partner'
            `,
            [deliveryPartnerId]
        );

        if (!partnerRows.length) {
            throw new Error("Delivery partner not found");
        }

        if (!partnerRows[0].is_available) {
            throw new Error("Delivery partner is offline");
        }

        await connection.execute(
            `
            UPDATE orders
            SET delivery_partner_id = ?,
                updated_at = NOW()
            WHERE id = ?
            `,
            [deliveryPartnerId, orderId]
        );

        const [existingAssignments] = await connection.execute(
            `
            SELECT id
            FROM delivery_assignments
            WHERE order_id = ?
            ORDER BY assigned_at DESC
            LIMIT 1
            `,
            [orderId]
        );

        if (existingAssignments.length > 0) {
            await connection.execute(
                `
                UPDATE delivery_assignments
                SET delivery_partner_id = ?,
                    status = 'assigned',
                    assigned_at = NOW(),
                    accepted_at = NULL,
                    rejected_at = NULL,
                    rejection_reason = NULL
                WHERE id = ?
                `,
                [deliveryPartnerId, existingAssignments[0].id]
            );
        } else {
            await connection.execute(
                `
                INSERT INTO delivery_assignments (
                    order_id,
                    delivery_partner_id,
                    status,
                    assigned_at
                )
                VALUES (?, ?, 'assigned', NOW())
                `,
                [orderId, deliveryPartnerId]
            );
        }

        await connection.execute(
            `
            INSERT INTO admin_activity_log (
                admin_id,
                action,
                entity_type,
                entity_id,
                details
            )
            VALUES (?, 'assign_delivery_partner', 'order', ?, ?)
            `,
            [adminId, orderId, JSON.stringify({ deliveryPartnerId })]
        );

        return {
            success: true,
            message: "Delivery partner assigned successfully",
        };
    });

    const order = await getLiveOrderById(orderId);
    await notifyOrderStakeholders({
        order,
        title: "Delivery partner assigned",
        message: `Delivery partner assigned for order ${
            order?.order_number || orderId
        }.`,
        type: "delivery_assignment",
        data: {
            assignmentStatus: "assigned",
            deliveryPartnerId,
            actorRole: "admin",
        },
    });

    return result;
};

import { getOne, query, withTransaction } from "../config/db.js";

const buildTicketNumber = () =>
    `TK-SUP-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`;

const buildRefundNumber = () =>
    `TK-REF-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`;

const normalizeLimit = (limit, fallback = 100, max = 500) => {
    const parsed = Number.parseInt(limit, 10);

    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }

    return Math.min(parsed, max);
};

export const createSupportTicket = async ({
    userId,
    role = "customer",
    orderId = null,
    restaurantId = null,
    deliveryPartnerId = null,
    category,
    subject,
    description,
    priority = "normal",
}) =>
    withTransaction(async (connection) => {
        const ticketNumber = buildTicketNumber();

        const [result] = await connection.execute(
            `
            INSERT INTO support_tickets (
                ticket_number,
                user_id,
                role,
                order_id,
                restaurant_id,
                delivery_partner_id,
                category,
                subject,
                description,
                priority,
                status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')
            `,
            [
                ticketNumber,
                userId,
                role,
                orderId,
                restaurantId,
                deliveryPartnerId,
                category,
                subject,
                description,
                priority,
            ]
        );

        await connection.execute(
            `
            INSERT INTO support_messages (
                ticket_id,
                sender_id,
                sender_role,
                message
            ) VALUES (?, ?, ?, ?)
            `,
            [result.insertId, userId, role, description]
        );

        return result.insertId;
    });

export const listSupportTicketsForUser = async (userId, status) =>
    query(
        `
        SELECT *
        FROM support_tickets
        WHERE user_id = ?
          AND (? IS NULL OR status = ?)
        ORDER BY updated_at DESC
        `,
        [userId, status || null, status || null]
    );

export const listSupportTicketsForAdmin = async ({
    status,
    priority,
    assignedAdminId,
    limit = 100,
} = {}) => {
    const safeLimit = normalizeLimit(limit);

    return query(
        `
        SELECT
            st.*,
            u.name AS user_name,
            u.phone AS user_phone,
            u.email AS user_email,
            a.name AS assigned_admin_name
        FROM support_tickets st
        LEFT JOIN users u ON u.id = st.user_id
        LEFT JOIN users a ON a.id = st.assigned_admin_id
        WHERE (? IS NULL OR st.status = ?)
          AND (? IS NULL OR st.priority = ?)
          AND (? IS NULL OR st.assigned_admin_id = ?)
        ORDER BY
            FIELD(st.priority, 'urgent', 'high', 'normal', 'low'),
            st.updated_at DESC
        LIMIT ${safeLimit}
        `,
        [
            status || null,
            status || null,
            priority || null,
            priority || null,
            assignedAdminId || null,
            assignedAdminId || null,
        ]
    );
};

export const getSupportTicketById = async (ticketId) =>
    getOne(`SELECT * FROM support_tickets WHERE id = ? LIMIT 1`, [ticketId]);

export const getSupportTicketWithMessages = async (ticketId) => {
    const ticket = await getOne(
        `
        SELECT
            st.*,
            u.name AS user_name,
            u.phone AS user_phone,
            a.name AS assigned_admin_name
        FROM support_tickets st
        LEFT JOIN users u ON u.id = st.user_id
        LEFT JOIN users a ON a.id = st.assigned_admin_id
        WHERE st.id = ?
        LIMIT 1
        `,
        [ticketId]
    );

    if (!ticket) return null;

    const messages = await query(
        `
        SELECT
            sm.*,
            u.name AS sender_name
        FROM support_messages sm
        LEFT JOIN users u ON u.id = sm.sender_id
        WHERE sm.ticket_id = ?
        ORDER BY sm.created_at ASC
        `,
        [ticketId]
    );

    return { ...ticket, messages };
};

export const addSupportMessage = async ({
    ticketId,
    senderId,
    senderRole,
    message,
    isInternal = false,
}) =>
    query(
        `
        INSERT INTO support_messages (
            ticket_id,
            sender_id,
            sender_role,
            message,
            is_internal
        ) VALUES (?, ?, ?, ?, ?)
        `,
        [ticketId, senderId, senderRole, message, isInternal ? 1 : 0]
    );

export const updateSupportTicket = async ({
    ticketId,
    status,
    priority,
    assignedAdminId,
    resolution,
}) => {
    const fields = [];
    const values = [];

    const assign = (column, value) => {
        if (value === undefined) return;
        fields.push(`${column} = ?`);
        values.push(value);
    };

    assign("status", status);
    assign("priority", priority);
    assign("assigned_admin_id", assignedAdminId);
    assign("resolution", resolution);

    if (status === "resolved") {
        fields.push("resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP)");
    }

    if (status === "closed") {
        fields.push("closed_at = COALESCE(closed_at, CURRENT_TIMESTAMP)");
    }

    if (!fields.length) return;

    await query(
        `
        UPDATE support_tickets
        SET ${fields.join(", ")}, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        `,
        [...values, ticketId]
    );
};

export const createRefundRequest = async ({
    orderId,
    customerId,
    supportTicketId = null,
    amount,
    reason,
    paymentReference = null,
}) => {
    const refundNumber = buildRefundNumber();

    const result = await query(
        `
        INSERT INTO refund_requests (
            refund_number,
            order_id,
            customer_id,
            support_ticket_id,
            amount,
            reason,
            payment_reference,
            status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'requested')
        `,
        [
            refundNumber,
            orderId,
            customerId,
            supportTicketId,
            amount,
            reason,
            paymentReference,
        ]
    );

    return result.insertId;
};

export const getRefundRequestById = async (refundId) =>
    getOne(`SELECT * FROM refund_requests WHERE id = ? LIMIT 1`, [refundId]);

export const getActiveRefundForOrder = async (orderId) =>
    getOne(
        `
        SELECT *
        FROM refund_requests
        WHERE order_id = ?
          AND status NOT IN ('rejected', 'processed', 'failed')
        ORDER BY requested_at DESC
        LIMIT 1
        `,
        [orderId]
    );

export const listRefundRequests = async ({
    customerId,
    status,
    limit = 100,
} = {}) => {
    const safeLimit = normalizeLimit(limit);

    return query(
        `
        SELECT
            rr.*,
            o.order_number,
            o.total AS order_total,
            u.name AS customer_name,
            u.phone AS customer_phone
        FROM refund_requests rr
        INNER JOIN orders o ON o.id = rr.order_id
        INNER JOIN users u ON u.id = rr.customer_id
        WHERE (? IS NULL OR rr.customer_id = ?)
          AND (? IS NULL OR rr.status = ?)
        ORDER BY rr.requested_at DESC
        LIMIT ${safeLimit}
        `,
        [
            customerId || null,
            customerId || null,
            status || null,
            status || null,
        ]
    );
};

export const updateRefundRequest = async ({
    refundId,
    status,
    adminId,
    adminNotes,
    gatewayRefundId,
}) => {
    const fields = ["status = ?"];
    const values = [status];

    if (adminId !== undefined) {
        fields.push("admin_id = ?");
        values.push(adminId);
    }

    if (adminNotes !== undefined) {
        fields.push("admin_notes = ?");
        values.push(adminNotes);
    }

    if (gatewayRefundId !== undefined) {
        fields.push("gateway_refund_id = ?");
        values.push(gatewayRefundId);
    }

    if (status === "processed") {
        fields.push("processed_at = CURRENT_TIMESTAMP");
    }

    await query(
        `
        UPDATE refund_requests
        SET ${fields.join(", ")}, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        `,
        [...values, refundId]
    );
};

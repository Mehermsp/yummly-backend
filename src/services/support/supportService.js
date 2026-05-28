import { getCartForUser, upsertCartItem } from "../../models/cartModel.js";
import { getOrderById, getOrderItems, updateOrderStatus } from "../../models/orderModel.js";
import {
    addSupportMessage,
    createRefundRequest,
    createSupportTicket,
    getActiveRefundForOrder,
    getRefundRequestById,
    getSupportTicketById,
    getSupportTicketWithMessages,
    listRefundRequests,
    listSupportTicketsForAdmin,
    listSupportTicketsForUser,
    updateRefundRequest,
    updateSupportTicket,
} from "../../models/supportModel.js";
import { AppError } from "../../utils/http.js";

const SUPPORT_CATEGORIES = new Set([
    "missing_item",
    "wrong_item",
    "delayed_delivery",
    "payment_issue",
    "refund_request",
    "food_quality",
    "delivery_issue",
    "account_issue",
    "other",
]);

const TICKET_STATUSES = new Set([
    "open",
    "in_progress",
    "waiting_on_customer",
    "resolved",
    "closed",
]);

const TICKET_PRIORITIES = new Set(["low", "normal", "high", "urgent"]);

const REFUND_STATUSES = new Set([
    "requested",
    "under_review",
    "approved",
    "rejected",
    "processing",
    "processed",
    "failed",
]);

const normalizeCategory = (value) => {
    const category = String(value || "other")
        .trim()
        .toLowerCase()
        .replace(/[-\s]+/g, "_");

    return SUPPORT_CATEGORIES.has(category) ? category : "other";
};

const normalizePriority = (value) => {
    const priority = String(value || "normal").trim().toLowerCase();

    return TICKET_PRIORITIES.has(priority) ? priority : "normal";
};

const ensureCustomerOwnsOrder = async (customerId, orderId) => {
    const order = await getOrderById(orderId);

    if (!order || Number(order.customer_id) !== Number(customerId)) {
        throw new AppError(404, "Order not found");
    }

    return order;
};

export const createCustomerTicket = async ({
    customerId,
    role = "customer",
    orderId,
    category,
    subject,
    description,
    priority,
}) => {
    if (!subject || !description) {
        throw new AppError(400, "Subject and description are required");
    }

    let order = null;
    if (orderId) {
        order = await ensureCustomerOwnsOrder(customerId, orderId);
    }

    const ticketId = await createSupportTicket({
        userId: customerId,
        role,
        orderId: order?.id || null,
        restaurantId: order?.restaurant_id || null,
        deliveryPartnerId: order?.delivery_partner_id || null,
        category: normalizeCategory(category),
        subject: String(subject).trim().slice(0, 160),
        description: String(description).trim(),
        priority: normalizePriority(priority),
    });

    return getSupportTicketWithMessages(ticketId);
};

export const listCustomerTickets = ({ customerId, status }) =>
    listSupportTicketsForUser(customerId, status);

export const getCustomerTicket = async ({ customerId, ticketId }) => {
    const ticket = await getSupportTicketWithMessages(ticketId);

    if (!ticket || Number(ticket.user_id) !== Number(customerId)) {
        throw new AppError(404, "Support ticket not found");
    }

    return {
        ...ticket,
        messages: ticket.messages.filter((message) => !message.is_internal),
    };
};

export const replyToCustomerTicket = async ({
    customerId,
    ticketId,
    message,
}) => {
    if (!message) {
        throw new AppError(400, "Message is required");
    }

    const ticket = await getSupportTicketById(ticketId);

    if (!ticket || Number(ticket.user_id) !== Number(customerId)) {
        throw new AppError(404, "Support ticket not found");
    }

    if (["resolved", "closed"].includes(ticket.status)) {
        throw new AppError(400, "Cannot reply to a resolved or closed ticket");
    }

    await addSupportMessage({
        ticketId,
        senderId: customerId,
        senderRole: "customer",
        message,
    });

    await updateSupportTicket({
        ticketId,
        status:
            ticket.status === "waiting_on_customer"
                ? "in_progress"
                : ticket.status,
    });

    return getCustomerTicket({ customerId, ticketId });
};

export const requestCustomerRefund = async ({
    customerId,
    orderId,
    reason,
    amount,
}) => {
    if (!reason) {
        throw new AppError(400, "Refund reason is required");
    }

    const order = await ensureCustomerOwnsOrder(customerId, orderId);

    if (!["delivered", "cancelled"].includes(order.status)) {
        throw new AppError(
            400,
            "Refunds can be requested only for delivered or cancelled orders"
        );
    }

    const activeRefund = await getActiveRefundForOrder(order.id);

    if (activeRefund) {
        throw new AppError(409, "A refund request is already active");
    }

    const safeAmount = Number(amount || order.total || 0);

    if (!Number.isFinite(safeAmount) || safeAmount <= 0) {
        throw new AppError(400, "Refund amount is invalid");
    }

    if (safeAmount > Number(order.total || 0)) {
        throw new AppError(400, "Refund amount cannot exceed order total");
    }

    const ticketId = await createSupportTicket({
        userId: customerId,
        role: "customer",
        orderId: order.id,
        restaurantId: order.restaurant_id,
        deliveryPartnerId: order.delivery_partner_id,
        category: "refund_request",
        subject: `Refund request for order ${order.order_number || order.id}`,
        description: reason,
        priority: "high",
    });

    const refundId = await createRefundRequest({
        orderId: order.id,
        customerId,
        supportTicketId: ticketId,
        amount: safeAmount,
        reason,
        paymentReference: order.payment_reference || order.payment_id || null,
    });

    return getRefundRequestById(refundId);
};

export const listCustomerRefunds = ({ customerId, status }) =>
    listRefundRequests({ customerId, status });

export const buildCustomerInvoice = async ({ customerId, orderId }) => {
    const order = await ensureCustomerOwnsOrder(customerId, orderId);
    const items = await getOrderItems(order.id);

    return {
        invoiceNumber: `INV-${order.order_number || order.id}`,
        issuedAt: new Date().toISOString(),
        order: {
            id: order.id,
            orderNumber: order.order_number,
            status: order.status,
            productStatus: order.product_status,
            placedAt: order.created_at,
            deliveredAt: order.delivered_at,
        },
        customer: {
            name: order.customer_name,
            phone: order.customer_phone,
            email: order.customer_email,
        },
        restaurant: {
            name: order.restaurant_name,
            phone: order.restaurant_phone,
            email: order.restaurant_email,
        },
        deliveryAddress: [
            order.door_no,
            order.street,
            order.area,
            order.city,
            order.state,
            order.zip_code,
        ]
            .filter(Boolean)
            .join(", "),
        items,
        totals: {
            subtotal: Number(order.subtotal || 0),
            discount: Number(order.discount_amount || 0),
            deliveryFee: Number(order.delivery_fee || 0),
            tax: Number(order.tax_amount || 0),
            total: Number(order.total || 0),
        },
        payment: {
            method: order.payment_method,
            status: order.payment_status,
            provider: order.payment_provider,
            reference: order.payment_reference || order.payment_id,
        },
    };
};

export const reorderCustomerOrder = async ({ customerId, orderId }) => {
    await ensureCustomerOwnsOrder(customerId, orderId);
    const items = await getOrderItems(orderId);

    if (!items.length) {
        throw new AppError(400, "Order has no items to reorder");
    }

    const currentCart = await getCartForUser(customerId);

    if (currentCart.length) {
        throw new AppError(409, "Please clear your cart before reordering");
    }

    const skipped = [];

    for (const item of items) {
        try {
            await upsertCartItem({
                userId: customerId,
                menuItemId: item.menu_item_id,
                quantity: Number(item.quantity || 1),
                unitPrice: Number(item.price || 0),
                totalPrice: Number(item.subtotal || 0),
            });
        } catch {
            skipped.push(item.menu_item_id);
        }
    }

    const cart = await getCartForUser(customerId);

    return {
        cart,
        skippedMenuItemIds: skipped,
    };
};

export const listAdminTickets = (filters) =>
    listSupportTicketsForAdmin(filters);

export const getAdminTicket = async (ticketId) => {
    const ticket = await getSupportTicketWithMessages(ticketId);

    if (!ticket) {
        throw new AppError(404, "Support ticket not found");
    }

    return ticket;
};

export const replyToAdminTicket = async ({
    adminId,
    ticketId,
    message,
    isInternal,
}) => {
    if (!message) {
        throw new AppError(400, "Message is required");
    }

    const ticket = await getSupportTicketById(ticketId);

    if (!ticket) {
        throw new AppError(404, "Support ticket not found");
    }

    await addSupportMessage({
        ticketId,
        senderId: adminId,
        senderRole: "admin",
        message,
        isInternal,
    });

    if (ticket.status === "open") {
        await updateSupportTicket({ ticketId, status: "in_progress" });
    }

    return getAdminTicket(ticketId);
};

export const updateAdminTicket = async ({
    adminId,
    ticketId,
    status,
    priority,
    assignedAdminId,
    resolution,
}) => {
    if (status && !TICKET_STATUSES.has(status)) {
        throw new AppError(400, "Invalid ticket status");
    }

    if (priority && !TICKET_PRIORITIES.has(priority)) {
        throw new AppError(400, "Invalid ticket priority");
    }

    const ticket = await getSupportTicketById(ticketId);

    if (!ticket) {
        throw new AppError(404, "Support ticket not found");
    }

    await updateSupportTicket({
        ticketId,
        status,
        priority,
        assignedAdminId:
            assignedAdminId === undefined ? adminId : assignedAdminId,
        resolution,
    });

    return getAdminTicket(ticketId);
};

export const listAdminRefunds = (filters) => listRefundRequests(filters);

export const updateAdminRefund = async ({
    adminId,
    refundId,
    status,
    adminNotes,
    gatewayRefundId,
}) => {
    if (!REFUND_STATUSES.has(status)) {
        throw new AppError(400, "Invalid refund status");
    }

    const refund = await getRefundRequestById(refundId);

    if (!refund) {
        throw new AppError(404, "Refund request not found");
    }

    await updateRefundRequest({
        refundId,
        status,
        adminId,
        adminNotes,
        gatewayRefundId,
    });

    if (status === "processed") {
        await updateOrderStatus({
            orderId: refund.order_id,
            nextStatus: "refunded",
            actorId: adminId,
            actorRole: "admin",
            notes: adminNotes || "Refund processed",
        });
    }

    return getRefundRequestById(refundId);
};

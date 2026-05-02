import { asyncHandler } from "../utils/asyncHandler.js";
import { AppError, sendSuccess } from "../utils/http.js";
import { updateDeliveryAvailability } from "../models/userModel.js";
import {
    claimReadyOrderAssignment,
    clearOrderDeliveryPartner,
    confirmOrderPaymentByDeliveryPartner,
    getAssignmentForOrderAndPartner,
    getDeliveryPartnerStats,
    getOrderById,
    getOrderItems,
    listDeliveryAssignments,
    markOrderRejectedForPartner,
    updateAssignmentStatus,
    updateOrderStatus,
} from "../models/orderModel.js";
import {
    DELIVERY_ASSIGNMENT_STATUS,
    ORDER_STATUS,
} from "../constants/index.js";

const ASSIGNMENT_RESPONSE_WINDOW_MS = 5 * 60 * 1000;

const normalizeDeliveryStatusInput = (value) => {
    const normalized = String(value || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "_");

    const aliases = {
        accepted: "accepted",
        picked_up: "picked_up",
        out_for_delivery: "picked_up",
        on_the_way: "picked_up",
        delivered: "delivered",
        out: "picked_up",
    };

    return aliases[normalized] || normalized;
};

const isAcceptanceWindowOpen = (assignedAt) => {
    if (!assignedAt) return false;
    return (
        Date.now() - new Date(assignedAt).getTime() <=
        ASSIGNMENT_RESPONSE_WINDOW_MS
    );
};

export const getDeliveryDashboard = asyncHandler(async (req, res) => {
    const assignments = await listDeliveryAssignments(req.user.id);
    const assignmentsWithItems = await Promise.all(
        assignments.map(async (assignment) => {
            const items = await getOrderItems(assignment.order_id);
            return { ...assignment, items };
        })
    );
    const stats = await getDeliveryPartnerStats(req.user.id);

    sendSuccess(
        res,
        {
            profile: req.user,
            openOrders: [],
            assignments: assignmentsWithItems,
            stats,
        },
        "Delivery dashboard fetched successfully"
    );
});

export const getDeliveryOrders = asyncHandler(async (req, res) => {
    const assignments = await listDeliveryAssignments(req.user.id);
    const ordersWithItems = await Promise.all(
        assignments.map(async (assignment) => {
            const order = await getOrderById(assignment.order_id);
            const items = await getOrderItems(assignment.order_id);
            return { ...assignment, ...order, items };
        })
    );
    sendSuccess(res, ordersWithItems, "Delivery orders fetched successfully");
});

export const getDeliveryIncome = asyncHandler(async (req, res) => {
    const assignments = await listDeliveryAssignments(req.user.id);
    const totalIncome = assignments
        .filter((a) => a.assignment_status === "delivered")
        .reduce((sum, a) => sum + Number(a.total || 0) * 0.1, 0); // 10% commission

    sendSuccess(
        res,
        {
            totalDeliveries: assignments.filter(
                (a) => a.assignment_status === "delivered"
            ).length,
            totalIncome: Number(totalIncome.toFixed(2)),
        },
        "Delivery income fetched successfully"
    );
});

export const setDeliveryAvailability = asyncHandler(async (req, res) => {
    const isAvailable = Boolean(req.body.isAvailable);

    // If trying to go offline, check for active/pending orders
    if (!isAvailable) {
        const assignments = await listDeliveryAssignments(req.user.id);

        // Check for orders that are not delivered or rejected
        const activeOrders = assignments.filter(
            (a) =>
                !["delivered", "rejected", "cancelled"].includes(
                    a.assignment_status
                )
        );

        if (activeOrders.length > 0) {
            throw new AppError(
                400,
                `Cannot go offline: You have ${activeOrders.length} active/pending order(s). Complete or hand over these orders first.`
            );
        }
    }

    await updateDeliveryAvailability(req.user.id, isAvailable);
    sendSuccess(
        res,
        {
            ...req.user,
            is_available: isAvailable,
        },
        isAvailable
            ? "You are now online and ready for deliveries"
            : "You are now offline"
    );
});

export const acceptDeliveryOrder = asyncHandler(async (req, res) => {
    const order = await getOrderById(req.params.orderId);
    const allowedStatuses = [
        ORDER_STATUS.READY,
        ORDER_STATUS.PREPARED,
        "ready_for_pickup",
    ];

    if (!order || !allowedStatuses.includes(order.status)) {
        throw new AppError(404, "Ready order not found");
    }

    const assignment = await getAssignmentForOrderAndPartner(
        order.id,
        req.user.id
    );
    if (
        assignment?.status === DELIVERY_ASSIGNMENT_STATUS.ACCEPTED ||
        assignment?.status === DELIVERY_ASSIGNMENT_STATUS.PAYMENT_CONFIRMED ||
        assignment?.status === DELIVERY_ASSIGNMENT_STATUS.PICKED_UP
    ) {
        return sendSuccess(res, null, "Delivery assignment already accepted");
    }

    const assignedToCurrentPartner =
        Number(order.delivery_partner_id) === Number(req.user.id);
    const hasDifferentAssignedPartner =
        order.delivery_partner_id &&
        Number(order.delivery_partner_id) !== Number(req.user.id);

    if (hasDifferentAssignedPartner) {
        throw new AppError(409, "Order is already assigned to another partner");
    }

    if (
        assignment &&
        assignment.status !== DELIVERY_ASSIGNMENT_STATUS.ASSIGNED
    ) {
        throw new AppError(400, "Assignment is not in assignable state");
    }

    if (assignedToCurrentPartner && assignment) {
        if (!isAcceptanceWindowOpen(assignment.assigned_at)) {
            await updateAssignmentStatus({
                orderId: order.id,
                deliveryPartnerId: req.user.id,
                status: DELIVERY_ASSIGNMENT_STATUS.REJECTED,
                rejectionReason: "Acceptance window expired (5 minutes)",
            });
            await clearOrderDeliveryPartner(order.id, req.user.id);
            await updateDeliveryAvailability(req.user.id, true);
            throw new AppError(
                400,
                "Acceptance window expired. Please wait for reassignment."
            );
        }

        await updateAssignmentStatus({
            orderId: order.id,
            deliveryPartnerId: req.user.id,
            status: DELIVERY_ASSIGNMENT_STATUS.ACCEPTED,
        });
        await updateDeliveryAvailability(req.user.id, false);
        return sendSuccess(res, null, "Delivery assignment accepted");
    }

    const claimResult = await claimReadyOrderAssignment({
        orderId: order.id,
        deliveryPartnerId: req.user.id,
    });
    if (!claimResult?.success) {
        throw new AppError(409, "Order is already assigned to another partner");
    }

    await updateDeliveryAvailability(req.user.id, false);
    sendSuccess(res, null, "Delivery assignment accepted");
});

export const rejectDeliveryOrder = asyncHandler(async (req, res) => {
    const order = await getOrderById(req.params.orderId);
    if (!order) throw new AppError(404, "Order not found");

    const assignment = await getAssignmentForOrderAndPartner(
        req.params.orderId,
        req.user.id
    );
    if (!assignment) {
        const assignedToOtherPartner =
            order.delivery_partner_id &&
            Number(order.delivery_partner_id) !== Number(req.user.id);
        if (assignedToOtherPartner) {
            throw new AppError(404, "Order not found or not assigned to you");
        }

        await markOrderRejectedForPartner({
            orderId: req.params.orderId,
            deliveryPartnerId: req.user.id,
            rejectionReason:
                req.body.reason || "Skipped by delivery partner from open list",
        });
        return sendSuccess(res, null, "Order skipped");
    }

    if (
        [
            DELIVERY_ASSIGNMENT_STATUS.PAYMENT_CONFIRMED,
            DELIVERY_ASSIGNMENT_STATUS.PICKED_UP,
            DELIVERY_ASSIGNMENT_STATUS.DELIVERED,
        ].includes(assignment.status)
    ) {
        throw new AppError(400, "Cannot reject after pickup has started");
    }

    await updateAssignmentStatus({
        orderId: req.params.orderId,
        deliveryPartnerId: req.user.id,
        status: DELIVERY_ASSIGNMENT_STATUS.REJECTED,
        rejectionReason:
            req.body.reason ||
            "Rejected by delivery partner within response window",
    });
    await clearOrderDeliveryPartner(req.params.orderId, req.user.id);
    await updateDeliveryAvailability(req.user.id, true);

    sendSuccess(res, null, "Delivery assignment rejected");
});

export const confirmDeliveryOrderPayment = asyncHandler(async (req, res) => {
    const order = await getOrderById(req.params.orderId);
    if (!order || Number(order.delivery_partner_id) !== Number(req.user.id)) {
        throw new AppError(404, "Order not found or not assigned to you");
    }
    if (String(order.payment_method).toLowerCase() !== "cash") {
        throw new AppError(400, "Only cash orders require manual payment confirmation");
    }
    const normalizedPaymentStatus = String(order.payment_status || "")
        .trim()
        .toLowerCase();
    if (["completed", "paid", "confirmed", "success"].includes(normalizedPaymentStatus)) {
        return sendSuccess(res, null, "Payment already confirmed");
    }

    const assignment = await getAssignmentForOrderAndPartner(
        req.params.orderId,
        req.user.id
    );
    if (
        !assignment ||
        ![
            DELIVERY_ASSIGNMENT_STATUS.ACCEPTED,
            DELIVERY_ASSIGNMENT_STATUS.PAYMENT_CONFIRMED,
            DELIVERY_ASSIGNMENT_STATUS.PICKED_UP,
            DELIVERY_ASSIGNMENT_STATUS.DELIVERED,
        ].includes(assignment.status)
    ) {
        throw new AppError(
            400,
            "Accept the assignment before confirming payment"
        );
    }

    const result = await confirmOrderPaymentByDeliveryPartner({
        orderId: req.params.orderId,
        deliveryPartnerId: req.user.id,
    });
    if (!result?.affectedRows) {
        throw new AppError(400, "Payment is not pending for this order");
    }

    try {
        await updateAssignmentStatus({
            orderId: req.params.orderId,
            deliveryPartnerId: req.user.id,
            status: DELIVERY_ASSIGNMENT_STATUS.PAYMENT_CONFIRMED,
        });
    } catch (error) {
        const message = String(error?.message || "").toLowerCase();
        if (!message.includes("data truncated for column 'status'")) {
            throw error;
        }
        // Compatibility fallback for DBs where delivery_assignments enum
        // does not yet include `payment_confirmed`.
        await updateAssignmentStatus({
            orderId: req.params.orderId,
            deliveryPartnerId: req.user.id,
            status: DELIVERY_ASSIGNMENT_STATUS.ACCEPTED,
        });
    }

    sendSuccess(res, null, "Payment confirmed successfully");
});

export const pickupDeliveryOrder = asyncHandler(async (req, res) => {
    const order = await getOrderById(req.params.orderId);
    const allowedStatuses = [
        ORDER_STATUS.READY,
        ORDER_STATUS.PREPARED,
        ORDER_STATUS.ON_THE_WAY,
        "ready_for_pickup",
    ];

    if (!order || Number(order.delivery_partner_id) !== Number(req.user.id)) {
        throw new AppError(404, "Order not found or not assigned to you");
    }
    if (!allowedStatuses.includes(order.status)) {
        throw new AppError(400, "Order cannot be picked up in current state");
    }

    const assignment = await getAssignmentForOrderAndPartner(
        req.params.orderId,
        req.user.id
    );
    if (!assignment) {
        throw new AppError(403, "Order assignment not found");
    }
    if (
        ![
            DELIVERY_ASSIGNMENT_STATUS.ACCEPTED,
            DELIVERY_ASSIGNMENT_STATUS.PAYMENT_CONFIRMED,
            DELIVERY_ASSIGNMENT_STATUS.PICKED_UP,
        ].includes(assignment.status)
    ) {
        throw new AppError(400, "Accept the assignment before pickup");
    }

    await updateAssignmentStatus({
        orderId: req.params.orderId,
        deliveryPartnerId: req.user.id,
        status: DELIVERY_ASSIGNMENT_STATUS.PICKED_UP,
    });

    if (order.status !== ORDER_STATUS.ON_THE_WAY) {
        await updateOrderStatus({
            orderId: req.params.orderId,
            currentStatus: order?.status,
            nextStatus: ORDER_STATUS.ON_THE_WAY,
            actorId: req.user.id,
            actorRole: "delivery_partner",
            notes: "Order picked up by delivery partner",
            deliveryPartnerId: req.user.id,
        });
    }

    await updateDeliveryAvailability(req.user.id, false);
    sendSuccess(res, null, "Order picked up successfully");
});

export const completeDeliveryOrder = asyncHandler(async (req, res) => {
    const order = await getOrderById(req.params.orderId);
    if (!order || Number(order.delivery_partner_id) !== Number(req.user.id)) {
        throw new AppError(404, "Order not found or not assigned to you");
    }
    if (order.status === ORDER_STATUS.DELIVERED) {
        return sendSuccess(res, null, "Order already delivered");
    }
    // Accept both on_the_way, out_for_delivery, picked_up (once picked up, can mark delivered)
    const inDeliveryStatuses = [
        ORDER_STATUS.ON_THE_WAY,
        ORDER_STATUS.PICKED_UP,
        "out_for_delivery",
        "picked_up",
    ];
    if (!inDeliveryStatuses.includes(order.status)) {
        throw new AppError(
            400,
            "Order must be picked up before marking delivered. Current status: " +
                order.status
        );
    }

    const assignment = await getAssignmentForOrderAndPartner(
        req.params.orderId,
        req.user.id
    );
    if (!assignment) {
        throw new AppError(403, "Order assignment not found");
    }
    if (
        ![
            DELIVERY_ASSIGNMENT_STATUS.PICKED_UP,
            DELIVERY_ASSIGNMENT_STATUS.ACCEPTED,
            DELIVERY_ASSIGNMENT_STATUS.PAYMENT_CONFIRMED,
        ].includes(assignment.status)
    ) {
        throw new AppError(
            400,
            "Assignment must be accepted before delivery completion"
        );
    }

    await updateAssignmentStatus({
        orderId: req.params.orderId,
        deliveryPartnerId: req.user.id,
        status: DELIVERY_ASSIGNMENT_STATUS.DELIVERED,
    });
    await updateOrderStatus({
        orderId: req.params.orderId,
        currentStatus: order?.status,
        nextStatus: ORDER_STATUS.DELIVERED,
        actorId: req.user.id,
        actorRole: "delivery_partner",
        notes: "Order delivered to customer",
        deliveryPartnerId: req.user.id,
    });
    await updateDeliveryAvailability(req.user.id, true);
    sendSuccess(res, null, "Order delivered successfully");
});

export const updateDeliveryOrderStatus = asyncHandler(async (req, res) => {
    const status = normalizeDeliveryStatusInput(req.body?.status);
    const { deliveryNotes } = req.body;
    const order = await getOrderById(req.params.orderId);
    if (!order || Number(order.delivery_partner_id) !== Number(req.user.id)) {
        throw new AppError(404, "Order not found or not assigned to you");
    }

    // Handle pickup (mark order as on the way)
    if (status === "picked_up" || status === "on_the_way") {
        await updateAssignmentStatus({
            orderId: req.params.orderId,
            deliveryPartnerId: req.user.id,
            status: DELIVERY_ASSIGNMENT_STATUS.PICKED_UP,
        });
        await updateOrderStatus({
            orderId: req.params.orderId,
            currentStatus: order.status,
            nextStatus: ORDER_STATUS.ON_THE_WAY,
            actorId: req.user.id,
            actorRole: "delivery_partner",
            notes: deliveryNotes || "Order picked up",
            deliveryPartnerId: req.user.id,
        });
        await updateDeliveryAvailability(req.user.id, false);
    }
    // Handle delivery completion
    else if (status === "delivered") {
        await updateAssignmentStatus({
            orderId: req.params.orderId,
            deliveryPartnerId: req.user.id,
            status: DELIVERY_ASSIGNMENT_STATUS.DELIVERED,
        });
        await updateOrderStatus({
            orderId: req.params.orderId,
            currentStatus: order.status,
            nextStatus: ORDER_STATUS.DELIVERED,
            actorId: req.user.id,
            actorRole: "delivery_partner",
            notes: deliveryNotes || "Order delivered",
            deliveryPartnerId: req.user.id,
        });
        await updateDeliveryAvailability(req.user.id, true);
    } else {
        throw new AppError(
            400,
            "Invalid status update. Use 'picked_up' or 'delivered'"
        );
    }

    sendSuccess(res, null, "Order status updated successfully");
});

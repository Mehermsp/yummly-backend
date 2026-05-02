import { asyncHandler } from "../utils/asyncHandler.js";
import { AppError, sendSuccess } from "../utils/http.js";
import { updateDeliveryAvailability } from "../models/userModel.js";
import {
    clearOrderDeliveryPartner,
    getDeliveryOpenOrders,
    getAssignmentForOrderAndPartner,
    getDeliveryPartnerStats,
    getOrderById,
    getOrderItems,
    listDeliveryAssignments,
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
        out_for_delivery: "picked_up",
    };

    return aliases[normalized] || normalized;
};

const isAcceptanceWindowOpen = (assignedAt) => {
    if (!assignedAt) return false;
    return Date.now() - new Date(assignedAt).getTime() <= ASSIGNMENT_RESPONSE_WINDOW_MS;
};

export const getDeliveryDashboard = asyncHandler(async (req, res) => {
    const openOrders = await getDeliveryOpenOrders();
    const assignments = await listDeliveryAssignments(req.user.id);
    const stats = await getDeliveryPartnerStats(req.user.id);

    sendSuccess(
        res,
        {
            profile: req.user,
            openOrders,
            assignments,
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
    await updateDeliveryAvailability(
        req.user.id,
        Boolean(req.body.isAvailable)
    );
    sendSuccess(
        res,
        {
            ...req.user,
            is_available: Boolean(req.body.isAvailable),
        },
        "Availability updated successfully"
    );
});

export const acceptDeliveryOrder = asyncHandler(async (req, res) => {
    const order = await getOrderById(req.params.orderId);
    if (
        !order ||
        Number(order.delivery_partner_id) !== Number(req.user.id) ||
        order.status !== ORDER_STATUS.READY_FOR_PICKUP
    ) {
        throw new AppError(404, "Ready-for-pickup order not found");
    }

    const assignment = await getAssignmentForOrderAndPartner(
        order.id,
        req.user.id
    );
    if (!assignment) {
        throw new AppError(403, "Order is not assigned to you");
    }

    if (assignment.status === DELIVERY_ASSIGNMENT_STATUS.ACCEPTED) {
        return sendSuccess(res, null, "Delivery assignment already accepted");
    }

    if (assignment.status !== DELIVERY_ASSIGNMENT_STATUS.ASSIGNED) {
        throw new AppError(400, "Assignment is not in assignable state");
    }

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

    sendSuccess(res, null, "Delivery assignment accepted");
});

export const rejectDeliveryOrder = asyncHandler(async (req, res) => {
    const order = await getOrderById(req.params.orderId);
    if (!order || Number(order.delivery_partner_id) !== Number(req.user.id)) {
        throw new AppError(404, "Order not found or not assigned to you");
    }

    const assignment = await getAssignmentForOrderAndPartner(
        req.params.orderId,
        req.user.id
    );
    if (!assignment) {
        throw new AppError(403, "Order assignment not found");
    }
    if (
        [
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
            req.body.reason || "Rejected by delivery partner within response window",
    });
    await clearOrderDeliveryPartner(req.params.orderId, req.user.id);
    await updateDeliveryAvailability(req.user.id, true);

    sendSuccess(res, null, "Delivery assignment rejected");
});

export const pickupDeliveryOrder = asyncHandler(async (req, res) => {
    const order = await getOrderById(req.params.orderId);
    if (!order || Number(order.delivery_partner_id) !== Number(req.user.id)) {
        throw new AppError(404, "Order not found or not assigned to you");
    }
    if (
        ![
            ORDER_STATUS.READY_FOR_PICKUP,
            ORDER_STATUS.OUT_FOR_DELIVERY,
        ].includes(order.status)
    ) {
        throw new AppError(
            400,
            "Order cannot be picked up in current state"
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
            DELIVERY_ASSIGNMENT_STATUS.ACCEPTED,
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

    if (order.status !== ORDER_STATUS.OUT_FOR_DELIVERY) {
        await updateOrderStatus({
            orderId: req.params.orderId,
            currentStatus: order?.status,
            nextStatus: ORDER_STATUS.OUT_FOR_DELIVERY,
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
    if (order.status !== ORDER_STATUS.OUT_FOR_DELIVERY) {
        throw new AppError(
            400,
            "Order must be out for delivery before marking delivered"
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

    if (status === "picked_up") {
        await updateAssignmentStatus({
            orderId: req.params.orderId,
            deliveryPartnerId: req.user.id,
            status: DELIVERY_ASSIGNMENT_STATUS.PICKED_UP,
        });
        await updateOrderStatus({
            orderId: req.params.orderId,
            currentStatus: order.status,
            nextStatus: ORDER_STATUS.OUT_FOR_DELIVERY,
            actorId: req.user.id,
            actorRole: "delivery_partner",
            notes: deliveryNotes || "Order picked up",
            deliveryPartnerId: req.user.id,
        });
        await updateDeliveryAvailability(req.user.id, false);
    } else if (status === "delivered") {
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
        throw new AppError(400, "Invalid status update");
    }

    sendSuccess(res, null, "Order status updated successfully");
});

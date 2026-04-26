import { asyncHandler } from "../utils/asyncHandler.js";
import { AppError, sendSuccess } from "../utils/http.js";
import { updateDeliveryAvailability } from "../models/userModel.js";
import {
    createDeliveryAssignment,
    getDeliveryOpenOrders,
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
    if (!order || order.status !== ORDER_STATUS.READY_FOR_PICKUP) {
        throw new AppError(404, "Ready-for-pickup order not found");
    }

    const existingAssignments = await listDeliveryAssignments(req.user.id);
    const existing = existingAssignments.find(
        (assignment) => String(assignment.order_id) === String(order.id)
    );

    if (existing) {
        await updateAssignmentStatus({
            orderId: order.id,
            deliveryPartnerId: req.user.id,
            status: DELIVERY_ASSIGNMENT_STATUS.ACCEPTED,
        });
    } else {
        try {
            await createDeliveryAssignment({
                orderId: order.id,
                deliveryPartnerId: req.user.id,
            });
        } catch (error) {
            throw new AppError(409, error.message);
        }
    }

    sendSuccess(res, null, "Delivery assignment accepted");
});

export const rejectDeliveryOrder = asyncHandler(async (req, res) => {
    await updateAssignmentStatus({
        orderId: req.params.orderId,
        deliveryPartnerId: req.user.id,
        status: DELIVERY_ASSIGNMENT_STATUS.REJECTED,
        rejectionReason: req.body.reason,
    });
    sendSuccess(res, null, "Delivery assignment rejected");
});

export const pickupDeliveryOrder = asyncHandler(async (req, res) => {
    const order = await getOrderById(req.params.orderId);
    if (!order || order.delivery_partner_id !== req.user.id) {
        throw new AppError(404, "Order not found or not assigned to you");
    }

    await updateAssignmentStatus({
        orderId: req.params.orderId,
        deliveryPartnerId: req.user.id,
        status: DELIVERY_ASSIGNMENT_STATUS.PICKED_UP,
    });
    await updateOrderStatus({
        orderId: req.params.orderId,
        currentStatus: order?.status,
        nextStatus: ORDER_STATUS.OUT_FOR_DELIVERY,
        actorId: req.user.id,
        actorRole: "delivery_partner",
        notes: "Order picked up by delivery partner",
        deliveryPartnerId: req.user.id,
    });
    sendSuccess(res, null, "Order picked up successfully");
});

export const completeDeliveryOrder = asyncHandler(async (req, res) => {
    const order = await getOrderById(req.params.orderId);
    if (!order || order.delivery_partner_id !== req.user.id) {
        throw new AppError(404, "Order not found or not assigned to you");
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
    sendSuccess(res, null, "Order delivered successfully");
});

export const updateDeliveryOrderStatus = asyncHandler(async (req, res) => {
    const { status, deliveryNotes, estimatedDeliveryTime } = req.body;
    const order = await getOrderById(req.params.orderId);
    if (!order || order.delivery_partner_id !== req.user.id) {
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
    } else {
        throw new AppError(400, "Invalid status update");
    }

    sendSuccess(res, null, "Order status updated successfully");
});

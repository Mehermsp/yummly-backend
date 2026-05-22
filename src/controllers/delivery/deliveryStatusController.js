import { asyncHandler } from "../../utils/asyncHandler.js";

import { AppError, sendSuccess } from "../../utils/http.js";

import { updateDeliveryAvailability } from "../../models/userModel.js";

import {
    confirmOrderPaymentByDeliveryPartner,
    getAssignmentForOrderAndPartner,
    getOrderById,
    updateAssignmentStatus,
    updateOrderStatus,
} from "../../models/orderModel.js";

import {
    DELIVERY_ASSIGNMENT_STATUS,
    ORDER_STATUS,
} from "../../constants/index.js";

import { normalizeDeliveryStatusInput } from "./helpers.js";

export const confirmDeliveryOrderPayment = asyncHandler(async (req, res) => {
    const result = await confirmOrderPaymentByDeliveryPartner({
        orderId: req.params.orderId,

        deliveryPartnerId: req.user.id,
    });

    if (!result?.affectedRows) {
        throw new AppError(400, "Payment confirmation failed");
    }

    sendSuccess(res, null, "Payment confirmed successfully");
});

export const pickupDeliveryOrder = asyncHandler(async (req, res) => {
    const order = await getOrderById(req.params.orderId);

    if (!order || Number(order.delivery_partner_id) !== Number(req.user.id)) {
        throw new AppError(404, "Order not found");
    }

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
    });

    await updateDeliveryAvailability(req.user.id, false);

    sendSuccess(res, null, "Order picked up successfully");
});

export const completeDeliveryOrder = asyncHandler(async (req, res) => {
    const order = await getOrderById(req.params.orderId);

    if (!order || Number(order.delivery_partner_id) !== Number(req.user.id)) {
        throw new AppError(404, "Order not found");
    }

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
    });

    await updateDeliveryAvailability(req.user.id, true);

    sendSuccess(res, null, "Order delivered successfully");
});

export const updateDeliveryOrderStatus = asyncHandler(async (req, res) => {
    const status = normalizeDeliveryStatusInput(req.body?.status);

    if (status === "picked_up") {
        return pickupDeliveryOrder(req, res);
    }

    if (status === "delivered") {
        return completeDeliveryOrder(req, res);
    }

    throw new AppError(400, "Invalid status");
});

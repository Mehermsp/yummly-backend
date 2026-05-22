import { asyncHandler } from "../../utils/asyncHandler.js";

import { sendSuccess } from "../../utils/http.js";

import * as deliveryOrderService from "../../services/order/deliveryOrderService.js";

export const getDeliveryAssignments = asyncHandler(async (req, res) => {
    const orders = await deliveryOrderService.getDeliveryAssignments(
        req.user.id
    );

    sendSuccess(res, orders, "Assignments fetched successfully");
});

export const getOpenOrders = asyncHandler(async (req, res) => {
    const orders = await deliveryOrderService.getOpenOrders(req.user.id);

    sendSuccess(res, orders, "Open orders fetched successfully");
});

export const acceptOrder = asyncHandler(async (req, res) => {
    const result = await deliveryOrderService.acceptOrder({
        orderId: req.params.orderId,

        deliveryPartnerId: req.user.id,
    });

    sendSuccess(res, result, "Order accepted successfully");
});

export const rejectOrder = asyncHandler(async (req, res) => {
    await deliveryOrderService.rejectOrder({
        orderId: req.params.orderId,

        deliveryPartnerId: req.user.id,

        reason: req.body.reason,
    });

    sendSuccess(res, null, "Order rejected successfully");
});

export const pickupOrder = asyncHandler(async (req, res) => {
    const result = await deliveryOrderService.pickupOrder({
        orderId: req.params.orderId,

        deliveryPartnerId: req.user.id,
    });

    sendSuccess(res, result, "Order picked up successfully");
});

export const deliverOrder = asyncHandler(async (req, res) => {
    const result = await deliveryOrderService.deliverOrder({
        orderId: req.params.orderId,

        deliveryPartnerId: req.user.id,
    });

    sendSuccess(res, result, "Order delivered successfully");
});

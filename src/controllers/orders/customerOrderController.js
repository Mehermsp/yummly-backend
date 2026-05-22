import { asyncHandler } from "../../utils/asyncHandler.js";

import { AppError, sendSuccess } from "../../utils/http.js";

import * as customerOrderService from "../../services/orders/customerOrderService.js";

export const placeOrder = asyncHandler(async (req, res) => {
    throw new AppError(
        400,
        "Direct order placement is disabled. Complete online payment first."
    );
});

export const getMyOrders = asyncHandler(async (req, res) => {
    const orders = await customerOrderService.getMyOrders({
        customerId: req.user.id,
        status: req.query.status,
    });

    sendSuccess(res, orders, "Orders fetched successfully");
});

export const getOrderDetails = asyncHandler(async (req, res) => {
    const order = await customerOrderService.getOrderDetails({
        orderId: req.params.orderId,
        user: req.user,
    });

    sendSuccess(res, order, "Order details fetched successfully");
});

export const cancelOrder = asyncHandler(async (req, res) => {
    await customerOrderService.cancelOrder({
        orderId: req.params.orderId,
        customerId: req.user.id,
        reason: req.body.reason,
    });

    sendSuccess(res, null, "Order cancelled successfully");
});

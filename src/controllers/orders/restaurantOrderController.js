import { asyncHandler } from "../../utils/asyncHandler.js";

import { sendSuccess } from "../../utils/http.js";

import * as restaurantOrderService from "../../services/orders/restaurantOrderService.js";

export const getRestaurantOrders = asyncHandler(async (req, res) => {
    const orders = await restaurantOrderService.getRestaurantOrders({
        ownerId: req.user.id,
        status: req.query.status,
    });

    sendSuccess(res, orders, "Restaurant orders fetched successfully");
});

export const updateRestaurantOrderStatus = asyncHandler(async (req, res) => {
    const updated = await restaurantOrderService.updateRestaurantOrderStatus({
        ownerId: req.user.id,
        orderId: req.params.orderId,
        status: req.body.status,
        notes: req.body.notes,
    });

    sendSuccess(res, updated, "Order status updated successfully");
});

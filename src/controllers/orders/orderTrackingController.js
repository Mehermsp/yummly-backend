import { asyncHandler } from "../../utils/asyncHandler.js";

import { sendSuccess } from "../../utils/http.js";

import * as orderTrackingService from "../../services/orders/orderTrackingService.js";

export const getOrderTracking = asyncHandler(async (req, res) => {
    const tracking = await orderTrackingService.getOrderTracking({
        orderId: req.params.orderId,
        customerId: req.user.id,
    });

    sendSuccess(res, tracking, "Order tracking fetched successfully");
});

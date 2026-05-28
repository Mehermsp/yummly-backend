import { asyncHandler } from "../utils/asyncHandler.js";

import { sendSuccess } from "../utils/http.js";

import { getMockPaymentMethods } from "../services/payment/paymentGatewayService.js";

import { processMockPaymentAndPlaceOrder } from "../services/payment/paymentOrderService.js";

export { selectPaymentMethod } from "./payment/selectController.js";

export const getMockPaymentConfig = asyncHandler(async (req, res) => {
    sendSuccess(
        res,
        {
            provider: "mock_gateway",

            methods: getMockPaymentMethods(),

            note: "Fake payment gateway for testing. No real transaction happens.",
        },
        "Mock payment config fetched successfully"
    );
});

export const completeMockPaymentAndPlaceOrder = asyncHandler(
    async (req, res) => {
        const result = await processMockPaymentAndPlaceOrder({
            userId: req.user.id,

            ...req.body,
        });

        sendSuccess(
            res,
            result,
            result.payment?.method === "cash"
                ? "Order placed with Cash on Delivery"
                : "Mock payment successful and order placed",
            201
        );
    }
);

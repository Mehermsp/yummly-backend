import { asyncHandler } from "../../utils/asyncHandler.js";
import { sendSuccess } from "../../utils/http.js";
import { processMockPaymentAndPlaceOrder } from "../../services/payment/paymentOrderService.js";

// POST /payment/select – accepts either a saved paymentMethodId or mock payment data
export const selectPaymentMethod = asyncHandler(async (req, res) => {
  const result = await processMockPaymentAndPlaceOrder({
    userId: req.user.id,
    // The client can send { paymentMethodId, addressId, customerNotes, paymentMethod, paymentData }
    ...req.body,
  });
  sendSuccess(res, result, "Payment method selected and order placed", 201);
});

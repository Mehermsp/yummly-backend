import { asyncHandler } from "../../utils/asyncHandler.js";
import { sendSuccess } from "../../utils/http.js";
import {
  addPaymentMethod,
  listPaymentMethods,
  getPaymentMethodById,
  deletePaymentMethod,
  setDefaultPaymentMethod,
} from "../../models/paymentMethodModel.js";

// GET /payment-methods – list all saved methods for the logged‑in user
export const listMethods = asyncHandler(async (req, res) => {
  const methods = await listPaymentMethods(req.user.id);
  sendSuccess(res, methods, "Payment methods fetched successfully");
});

// POST /payment-methods – add a new tokenised method
export const addMethod = asyncHandler(async (req, res) => {
  const { type, gatewayToken, details } = req.body;
  const methodId = await addPaymentMethod(req.user.id, { type, gatewayToken, details });
  const method = await getPaymentMethodById(req.user.id, methodId);
  sendSuccess(res, method, "Payment method added", 201);
});

// DELETE /payment-methods/:id – remove a saved method
export const removeMethod = asyncHandler(async (req, res) => {
  await deletePaymentMethod(req.user.id, req.params.methodId);
  sendSuccess(res, null, "Payment method deleted");
});

// PATCH /payment-methods/:id/default – make a method the default
export const setDefaultMethod = asyncHandler(async (req, res) => {
  await setDefaultPaymentMethod(req.user.id, req.params.methodId);
  const methods = await listPaymentMethods(req.user.id);
  sendSuccess(res, methods, "Default payment method updated");
});

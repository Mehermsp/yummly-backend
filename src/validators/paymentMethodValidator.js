import { body } from "express-validator";

// For simplicity we store only a token/identifier from the payment gateway.
export const addPaymentMethodSchema = [
  body("type").isIn(["card", "upi", "wallet"]).withMessage("Invalid payment type"),
  body("gatewayToken").isString().notEmpty().withMessage("gatewayToken is required"),
  body("details").optional().isObject(), // optional free‑form metadata (e.g. last4, brand)
];

import axios from "axios";
import crypto from "crypto";
import { env } from "../config/env.js";
import {
    createOrder,
    findOrderByPaymentReference,
    getCustomerCheckoutSummary,
    getOrderById,
    getOrderItems,
} from "../models/orderModel.js";
import { sendEmail } from "../utils/email.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { AppError, sendSuccess } from "../utils/http.js";

const ONLINE_METHODS = new Set(["upi", "card", "wallet"]);

const ensureRazorpayConfig = () => {
    if (!env.razorpayKeyId || !env.razorpayKeySecret) {
        throw new AppError(
            500,
            "Razorpay is not configured. Please set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET."
        );
    }
};

const normalizeAmountToPaise = (amount) => {
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
        throw new AppError(400, "Valid amount is required");
    }
    return Math.round(numericAmount * 100);
};

const verifyRazorpaySignature = ({
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature,
}) => {
    const payload = `${razorpayOrderId}|${razorpayPaymentId}`;
    const generatedSignature = crypto
        .createHmac("sha256", env.razorpayKeySecret)
        .update(payload)
        .digest("hex");

    return generatedSignature === razorpaySignature;
};

const normalizePaymentMethod = (method) => {
    const normalized = String(method || "")
        .trim()
        .toLowerCase();

    if (!ONLINE_METHODS.has(normalized)) {
        return "upi";
    }

    return normalized;
};

const fetchRazorpayPaymentDetails = async (paymentId) => {
    const response = await axios.get(
        `https://api.razorpay.com/v1/payments/${paymentId}`,
        {
            auth: {
                username: env.razorpayKeyId,
                password: env.razorpayKeySecret,
            },
            timeout: 20000,
        }
    );
    return response.data || null;
};

export const getRazorpayConfig = asyncHandler(async (req, res) => {
    ensureRazorpayConfig();
    sendSuccess(
        res,
        {
            keyId: env.razorpayKeyId,
            currency: env.razorpayCurrency || "INR",
        },
        "Razorpay config fetched successfully"
    );
});

export const createRazorpayOrder = asyncHandler(async (req, res) => {
    ensureRazorpayConfig();

    let checkoutSummary;
    try {
        checkoutSummary = await getCustomerCheckoutSummary(req.user.id);
    } catch (error) {
        throw new AppError(400, error.message || "Unable to compute cart total");
    }

    const paiseAmount = normalizeAmountToPaise(checkoutSummary?.total);
    const currency = String(
        req.body?.currency || env.razorpayCurrency || "INR"
    ).toUpperCase();
    const receipt = req.body?.receipt || `tk_${req.user.id}_${Date.now()}`;

    try {
        const response = await axios.post(
            "https://api.razorpay.com/v1/orders",
            {
                amount: paiseAmount,
                currency,
                receipt,
                notes: {
                    customerId: String(req.user.id),
                    source: "tastiekit_checkout",
                    ...(req.body?.notes || {}),
                },
            },
            {
                auth: {
                    username: env.razorpayKeyId,
                    password: env.razorpayKeySecret,
                },
                timeout: 20000,
            }
        );

        sendSuccess(
            res,
            {
                id: response.data?.id,
                amount: response.data?.amount,
                displayAmount: checkoutSummary?.total,
                currency: response.data?.currency || currency,
                receipt: response.data?.receipt || receipt,
                status: response.data?.status,
                keyId: env.razorpayKeyId,
            },
            "Razorpay order created successfully"
        );
    } catch (error) {
        const razorpayMessage =
            error?.response?.data?.error?.description ||
            error?.response?.data?.error?.reason ||
            error?.response?.data?.error?.code;

        throw new AppError(
            502,
            razorpayMessage || "Failed to create Razorpay order"
        );
    }
});

export const verifyPaymentAndPlaceOrder = asyncHandler(async (req, res) => {
    ensureRazorpayConfig();

    const {
        addressId,
        customerNotes,
        paymentMethod,
        razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature,
    } = req.body || {};

    if (!addressId) {
        throw new AppError(400, "Address is required");
    }
    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
        throw new AppError(
            400,
            "razorpayOrderId, razorpayPaymentId and razorpaySignature are required"
        );
    }

    const signatureValid = verifyRazorpaySignature({
        razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature,
    });

    if (!signatureValid) {
        throw new AppError(400, "Invalid Razorpay signature");
    }

    const duplicateOrder = await findOrderByPaymentReference(razorpayPaymentId);
    if (duplicateOrder?.id) {
        throw new AppError(
            409,
            `This payment was already used for order ${duplicateOrder.order_number || duplicateOrder.id}`
        );
    }

    let checkoutSummary;
    try {
        checkoutSummary = await getCustomerCheckoutSummary(req.user.id);
    } catch (error) {
        throw new AppError(400, error.message || "Unable to compute cart total");
    }
    const expectedPaiseAmount = normalizeAmountToPaise(checkoutSummary?.total);

    let paymentDetails;
    try {
        paymentDetails = await fetchRazorpayPaymentDetails(razorpayPaymentId);
    } catch (error) {
        const razorpayMessage =
            error?.response?.data?.error?.description ||
            error?.response?.data?.error?.reason ||
            "Failed to verify payment with Razorpay";
        throw new AppError(502, razorpayMessage);
    }

    if (paymentDetails?.order_id !== razorpayOrderId) {
        throw new AppError(400, "Payment does not match the provided Razorpay order");
    }

    if (Number(paymentDetails?.amount || 0) !== Number(expectedPaiseAmount)) {
        throw new AppError(400, "Payment amount mismatch. Please retry checkout.");
    }

    const paymentStatus = String(paymentDetails?.status || "").toLowerCase();
    if (!["captured", "authorized"].includes(paymentStatus)) {
        throw new AppError(400, `Payment is not successful (status: ${paymentStatus || "unknown"})`);
    }

    let orderId;
    try {
        orderId = await createOrder({
            customerId: req.user.id,
            addressId,
            paymentMethod: normalizePaymentMethod(paymentMethod),
            customerNotes,
            paymentStatus: "completed",
            paymentReference: razorpayPaymentId,
        });
    } catch (error) {
        throw new AppError(400, error.message);
    }

    const order = await getOrderById(orderId);
    const items = await getOrderItems(orderId);

    void sendEmail({
        to: order?.customer_email,
        subject: `Order placed: ${order?.order_number || orderId}`,
        text: `Your order ${
            order?.order_number || orderId
        } has been placed successfully.`,
    });
    void sendEmail({
        to: order?.restaurant_email,
        subject: `New order received: ${order?.order_number || orderId}`,
        text: `A new order ${
            order?.order_number || orderId
        } was placed and is awaiting action.`,
    });

    sendSuccess(
        res,
        {
            ...order,
            items,
            payment: {
                razorpayOrderId,
                razorpayPaymentId,
            },
        },
        "Payment verified and order placed successfully",
        201
    );
});

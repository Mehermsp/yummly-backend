import axios from "axios";
import crypto from "crypto";
import { env } from "../config/env.js";
import { getAddressById } from "../models/customerModel.js";
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

const base64UrlEncode = (value) =>
    Buffer.from(String(value), "utf8")
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");

const base64UrlDecode = (value) => {
    const normalized = String(value || "")
        .replace(/-/g, "+")
        .replace(/_/g, "/");
    const padding = normalized.length % 4;
    const padded =
        padding === 0 ? normalized : normalized + "=".repeat(4 - padding);
    return Buffer.from(padded, "base64").toString("utf8");
};

const signToken = (token) =>
    crypto
        .createHmac("sha256", env.jwtAccessSecret)
        .update(token)
        .digest("hex");

const normalizeOnlineMethod = (method) => {
    const normalized = String(method || "")
        .trim()
        .toLowerCase();
    return ONLINE_METHODS.has(normalized) ? normalized : "upi";
};

const parseCheckoutToken = ({ token, sig }) => {
    if (!token || !sig) {
        throw new AppError(400, "Invalid payment checkout request");
    }

    const expectedSig = signToken(token);
    if (sig !== expectedSig) {
        throw new AppError(400, "Checkout signature mismatch");
    }

    let payload;
    try {
        payload = JSON.parse(base64UrlDecode(token));
    } catch {
        throw new AppError(400, "Invalid checkout payload");
    }

    return payload;
};

const parseAmountToPaise = (amount) => {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
        throw new AppError(400, "Invalid order amount");
    }
    return Math.round(value * 100);
};

const verifyRazorpaySignature = ({
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature,
}) => {
    const payload = `${razorpayOrderId}|${razorpayPaymentId}`;
    const expectedSignature = crypto
        .createHmac("sha256", env.razorpayKeySecret)
        .update(payload)
        .digest("hex");
    return expectedSignature === razorpaySignature;
};

const fetchRazorpayPayment = async (paymentId) => {
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

const getPublicBaseUrl = (req) => {
    const proto = req.headers["x-forwarded-proto"] || req.protocol || "http";
    const host = req.get("host");
    return `${proto}://${host}`;
};

const jsonForInlineScript = (value) =>
    JSON.stringify(value)
        .replace(/</g, "\\u003c")
        .replace(/>/g, "\\u003e")
        .replace(/&/g, "\\u0026");

const buildCheckoutHtml = ({
    orderId,
    amount,
    currency,
    keyId,
    returnUrl,
    customerName,
    customerEmail,
    customerPhone,
    checkoutToken,
    checkoutSig,
}) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>TastieKit Payment</title>
  <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
  <style>
    body { font-family: Arial, sans-serif; margin: 0; padding: 24px; background: #f7f7f8; color: #222; }
    .card { max-width: 480px; margin: 0 auto; background: #fff; border-radius: 16px; padding: 24px; box-shadow: 0 8px 30px rgba(0,0,0,.08); text-align: center; }
    .title { font-size: 20px; font-weight: 700; margin-bottom: 8px; }
    .subtitle { font-size: 14px; color: #666; margin-bottom: 18px; }
    .amount { font-size: 28px; font-weight: 800; color: #e53935; margin-bottom: 14px; }
    .btn { border: 0; border-radius: 10px; padding: 12px 18px; background: #e53935; color: #fff; font-weight: 700; cursor: pointer; }
  </style>
</head>
<body>
  <div class="card">
    <div class="title">TastieKit Checkout</div>
    <div class="subtitle">Secure payment via Razorpay</div>
    <div class="amount">INR ${(Number(amount || 0) / 100).toFixed(2)}</div>
    <button id="retryBtn" class="btn" style="display:none;">Retry Payment</button>
  </div>

  <script>
    const CONTEXT = ${jsonForInlineScript({
        orderId,
        amount,
        currency,
        keyId,
        returnUrl,
        customerName,
        customerEmail,
        customerPhone,
        checkoutToken,
        checkoutSig,
    })};

    const toReturnUrl = (params) => {
      const url = new URL(CONTEXT.returnUrl);
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      });
      window.location.replace(url.toString());
    };

    const openCheckout = () => {
      const options = {
        key: CONTEXT.keyId,
        amount: CONTEXT.amount,
        currency: CONTEXT.currency,
        name: "TastieKit",
        description: "Food order payment",
        order_id: CONTEXT.orderId,
        handler: function (response) {
          toReturnUrl({
            status: "success",
            razorpay_order_id: response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature: response.razorpay_signature,
            checkout_token: CONTEXT.checkoutToken,
            checkout_sig: CONTEXT.checkoutSig
          });
        },
        modal: {
          ondismiss: function () {
            toReturnUrl({
              status: "cancelled",
              checkout_token: CONTEXT.checkoutToken,
              checkout_sig: CONTEXT.checkoutSig
            });
          }
        },
        prefill: {
          name: CONTEXT.customerName || "",
          email: CONTEXT.customerEmail || "",
          contact: CONTEXT.customerPhone || ""
        },
        theme: { color: "#E53935" }
      };

      const rzp = new Razorpay(options);
      rzp.on("payment.failed", function (response) {
        const meta = response?.error?.metadata || {};
        toReturnUrl({
          status: "failed",
          error_code: response?.error?.code,
          error_description: response?.error?.description,
          razorpay_order_id: meta.order_id,
          razorpay_payment_id: meta.payment_id,
          checkout_token: CONTEXT.checkoutToken,
          checkout_sig: CONTEXT.checkoutSig
        });
      });

      rzp.open();
    };

    document.getElementById("retryBtn").addEventListener("click", openCheckout);
    openCheckout();
  </script>
</body>
</html>`;

export const createRazorpayOrder = asyncHandler(async (req, res) => {
    ensureRazorpayConfig();

    const { returnUrl, addressId, customerNotes } = req.body || {};
    const paymentMethod = normalizeOnlineMethod(req.body?.paymentMethod);

    if (!addressId) {
        throw new AppError(400, "Address is required");
    }
    if (!returnUrl || !/^([a-z][a-z0-9+\-.]*):/i.test(String(returnUrl))) {
        throw new AppError(400, "Valid returnUrl is required");
    }

    const address = await getAddressById(req.user.id, addressId);
    if (!address) {
        throw new AppError(400, "Valid delivery address is required");
    }

    let checkoutSummary;
    try {
        checkoutSummary = await getCustomerCheckoutSummary(req.user.id);
    } catch (error) {
        throw new AppError(400, error.message || "Unable to compute order total");
    }

    const amountInPaise = parseAmountToPaise(checkoutSummary.total);
    const currency = env.razorpayCurrency || "INR";
    const receipt = `tk_${req.user.id}_${Date.now()}`.slice(0, 40);

    let razorpayOrder;
    try {
        const response = await axios.post(
            "https://api.razorpay.com/v1/orders",
            {
                amount: amountInPaise,
                currency,
                receipt,
                notes: {
                    customerId: String(req.user.id),
                    source: "tastiekit_app",
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
        razorpayOrder = response.data || {};
    } catch (error) {
        const message =
            error?.response?.data?.error?.description ||
            "Failed to create Razorpay order";
        throw new AppError(502, message);
    }

    const checkoutPayload = {
        v: 1,
        customerId: Number(req.user.id),
        addressId: Number(addressId),
        customerNotes: customerNotes || null,
        paymentMethod,
        razorpayOrderId: razorpayOrder.id,
        amount: Number(razorpayOrder.amount),
        currency: razorpayOrder.currency || currency,
        returnUrl: String(returnUrl),
        prefill: {
            name: req.user.name || "TastieKit Customer",
            email: req.user.email || "",
            phone: req.user.phone || "",
        },
        issuedAt: Date.now(),
    };

    const checkoutToken = base64UrlEncode(JSON.stringify(checkoutPayload));
    const checkoutSig = signToken(checkoutToken);
    const checkoutUrl = `${getPublicBaseUrl(
        req
    )}/api/payment/razorpay/checkout?token=${encodeURIComponent(
        checkoutToken
    )}&sig=${encodeURIComponent(checkoutSig)}`;

    sendSuccess(
        res,
        {
            razorpayOrderId: razorpayOrder.id,
            amount: checkoutSummary.total,
            amountInPaise,
            currency: checkoutPayload.currency,
            checkoutUrl,
            checkoutToken,
            checkoutSig,
        },
        "Razorpay checkout initialized successfully"
    );
});

export const renderRazorpayCheckout = asyncHandler(async (req, res) => {
    ensureRazorpayConfig();

    const { token, sig } = req.query || {};
    const payload = parseCheckoutToken({ token, sig });

    if (!payload?.razorpayOrderId || !payload?.amount || !payload?.returnUrl) {
        throw new AppError(400, "Invalid checkout payload");
    }

    const html = buildCheckoutHtml({
        orderId: payload.razorpayOrderId,
        amount: payload.amount,
        currency: payload.currency || env.razorpayCurrency || "INR",
        keyId: env.razorpayKeyId,
        returnUrl: payload.returnUrl,
        customerName: payload?.prefill?.name || "",
        customerEmail: payload?.prefill?.email || "",
        customerPhone: payload?.prefill?.phone || "",
        checkoutToken: token,
        checkoutSig: sig,
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(html);
});

export const verifyPaymentAndPlaceOrder = asyncHandler(async (req, res) => {
    ensureRazorpayConfig();

    const {
        razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature,
        checkoutToken,
        checkoutSig,
    } = req.body || {};

    if (
        !razorpayOrderId ||
        !razorpayPaymentId ||
        !razorpaySignature ||
        !checkoutToken ||
        !checkoutSig
    ) {
        throw new AppError(400, "Missing payment verification parameters");
    }

    const checkoutPayload = parseCheckoutToken({
        token: checkoutToken,
        sig: checkoutSig,
    });
    if (Number(checkoutPayload.customerId) !== Number(req.user.id)) {
        throw new AppError(403, "Payment session does not belong to this user");
    }
    if (String(checkoutPayload.razorpayOrderId) !== String(razorpayOrderId)) {
        throw new AppError(400, "Razorpay order mismatch");
    }

    const duplicateOrder = await findOrderByPaymentReference(razorpayPaymentId);
    if (duplicateOrder?.id) {
        throw new AppError(
            409,
            `This payment is already used for order ${
                duplicateOrder.order_number || duplicateOrder.id
            }`
        );
    }

    const signatureOk = verifyRazorpaySignature({
        razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature,
    });
    if (!signatureOk) {
        throw new AppError(400, "Invalid Razorpay signature");
    }

    let paymentDetails;
    try {
        paymentDetails = await fetchRazorpayPayment(razorpayPaymentId);
    } catch (error) {
        const message =
            error?.response?.data?.error?.description ||
            "Unable to fetch payment details from Razorpay";
        throw new AppError(502, message);
    }

    const paymentStatus = String(paymentDetails?.status || "").toLowerCase();
    if (!["captured", "authorized"].includes(paymentStatus)) {
        throw new AppError(
            400,
            `Payment is not successful (status: ${paymentStatus || "unknown"})`
        );
    }
    if (String(paymentDetails?.order_id) !== String(razorpayOrderId)) {
        throw new AppError(400, "Payment order id mismatch");
    }
    if (Number(paymentDetails?.amount || 0) !== Number(checkoutPayload.amount)) {
        throw new AppError(400, "Payment amount mismatch");
    }

    let orderId;
    try {
        orderId = await createOrder({
            customerId: req.user.id,
            addressId: checkoutPayload.addressId,
            paymentMethod: normalizeOnlineMethod(checkoutPayload.paymentMethod),
            customerNotes: checkoutPayload.customerNotes || null,
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
                status: paymentStatus,
            },
        },
        "Payment verified and order placed successfully",
        201
    );
});

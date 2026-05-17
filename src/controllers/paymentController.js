import { getAddressById } from "../models/customerModel.js";
import {
    createOrder,
    findOrderByPaymentId,
    getCustomerCheckoutSummary,
    getOrderById,
    getOrderItems,
    saveOrderPaymentRecord,
    updateOrderPaymentSnapshot,
} from "../models/orderModel.js";
import { sendEmail } from "../utils/email.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { AppError, sendSuccess } from "../utils/http.js";

const ALLOWED_METHODS = new Set(["upi", "card"]);
const UPI_ID_REGEX = /^[a-zA-Z0-9.\-_]{2,}@[a-zA-Z]{2,}$/;

const getMockPaymentMethods = () => [
    {
        method: "upi",
        title: "UPI",
        fields: ["upiId"],
    },
    {
        method: "card",
        title: "Card",
        fields: ["cardHolderName", "cardNumber", "expiryMonth", "expiryYear", "cvv"],
    },
];

const normalizeMethod = (value) => {
    const method = String(value || "")
        .trim()
        .toLowerCase();
    if (!ALLOWED_METHODS.has(method)) {
        throw new AppError(400, "paymentMethod must be either 'upi' or 'card'");
    }
    return method;
};

const normalizeUpiId = (value) => String(value || "").trim().toLowerCase();

const normalizeCardNumber = (value) =>
    String(value || "")
        .replace(/\s+/g, "")
        .replace(/-/g, "")
        .trim();

const detectCardNetwork = (cardNumber) => {
    if (/^4\d{12,18}$/.test(cardNumber)) return "visa";
    if (/^(5[1-5]\d{14}|2(2[2-9]\d{12}|[3-6]\d{13}|7[01]\d{12}|720\d{12}))$/.test(cardNumber))
        return "mastercard";
    if (/^3[47]\d{13}$/.test(cardNumber)) return "amex";
    if (/^(6011\d{12}|65\d{14}|64[4-9]\d{13})$/.test(cardNumber)) return "discover";
    if (/^(352[89]\d{12}|35[3-8]\d{13})$/.test(cardNumber)) return "jcb";
    if (/^(30[0-5]\d{11}|3[689]\d{12})$/.test(cardNumber)) return "diners";
    return "unknown";
};

const luhnCheck = (cardNumber) => {
    let sum = 0;
    let shouldDouble = false;
    for (let i = cardNumber.length - 1; i >= 0; i -= 1) {
        let digit = Number(cardNumber[i]);
        if (!Number.isFinite(digit)) return false;
        if (shouldDouble) {
            digit *= 2;
            if (digit > 9) digit -= 9;
        }
        sum += digit;
        shouldDouble = !shouldDouble;
    }
    return sum % 10 === 0;
};

const parsePositiveInt = (value) => {
    const num = Number(value);
    if (!Number.isInteger(num)) return null;
    return num;
};

const validateCardExpiry = (month, year) => {
    const m = parsePositiveInt(month);
    let y = parsePositiveInt(year);
    if (!m || m < 1 || m > 12) {
        throw new AppError(400, "Invalid card expiry month");
    }
    if (!y) {
        throw new AppError(400, "Invalid card expiry year");
    }
    if (String(y).length === 2) {
        y += 2000;
    }
    if (y < 2000 || y > 2100) {
        throw new AppError(400, "Invalid card expiry year");
    }

    const now = new Date();
    const expEdge = new Date(y, m, 1);
    if (expEdge <= now) {
        throw new AppError(400, "Card is expired");
    }

    return { month: m, year: y };
};

const validatePaymentData = (method, paymentData) => {
    const payload = paymentData || {};
    if (method === "upi") {
        const upiId = normalizeUpiId(payload.upiId);
        if (!UPI_ID_REGEX.test(upiId)) {
            throw new AppError(400, "Invalid UPI ID format");
        }
        return {
            upiId,
            paymentInstrumentType: "upi",
            paymentInstrumentLabel: upiId,
            persisted: {
                upiId,
                cardNetwork: null,
                cardLast4: null,
                cardHolderName: null,
                cardExpiryMonth: null,
                cardExpiryYear: null,
            },
        };
    }

    const cardHolderName = String(payload.cardHolderName || "").trim();
    const cardNumber = normalizeCardNumber(payload.cardNumber);
    const cvv = String(payload.cvv || "").trim();

    if (cardHolderName.length < 2) {
        throw new AppError(400, "Card holder name is required");
    }
    if (!/^\d{12,19}$/.test(cardNumber)) {
        throw new AppError(400, "Card number must be 12 to 19 digits");
    }
    if (!luhnCheck(cardNumber)) {
        throw new AppError(400, "Invalid card number");
    }
    if (!/^\d{3,4}$/.test(cvv)) {
        throw new AppError(400, "Invalid CVV");
    }

    const { month, year } = validateCardExpiry(payload.expiryMonth, payload.expiryYear);
    const cardLast4 = cardNumber.slice(-4);
    const cardNetwork = detectCardNetwork(cardNumber);

    return {
        upiId: null,
        paymentInstrumentType: "card",
        paymentInstrumentLabel: `**** **** **** ${cardLast4}`,
        persisted: {
            upiId: null,
            cardNetwork,
            cardLast4,
            cardHolderName,
            cardExpiryMonth: month,
            cardExpiryYear: year,
        },
    };
};

const buildMockTransactionId = (method) =>
    `MOCK_${method.toUpperCase()}_${Date.now()}_${Math.floor(
        Math.random() * 1000000
    )}`;

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

export const completeMockPaymentAndPlaceOrder = asyncHandler(async (req, res) => {
    const { addressId, customerNotes, paymentMethod, paymentData } = req.body || {};

    if (!addressId) {
        throw new AppError(400, "Address is required");
    }
    const address = await getAddressById(req.user.id, addressId);
    if (!address) {
        throw new AppError(400, "Valid delivery address is required");
    }

    const method = normalizeMethod(paymentMethod);
    const normalized = validatePaymentData(method, paymentData);
    const transactionId = buildMockTransactionId(method);

    const duplicate = await findOrderByPaymentId(transactionId);
    if (duplicate?.id) {
        throw new AppError(409, "Duplicate mock transaction detected. Retry payment.");
    }

    let checkoutSummary;
    try {
        checkoutSummary = await getCustomerCheckoutSummary(req.user.id);
    } catch (error) {
        throw new AppError(400, error.message || "Unable to compute cart total");
    }

    let orderId;
    try {
        orderId = await createOrder({
            customerId: req.user.id,
            addressId,
            paymentMethod: method,
            customerNotes,
            paymentStatus: "completed",
            paymentReference: transactionId,
        });
    } catch (error) {
        throw new AppError(400, error.message);
    }

    try {
        await updateOrderPaymentSnapshot({
            orderId,
            paymentId: transactionId,
            paymentStatus: "completed",
            paymentMethod: method,
            paymentProvider: "mock_gateway",
            paymentInstrumentType: normalized.paymentInstrumentType,
            paymentInstrumentLabel: normalized.paymentInstrumentLabel,
        });

        await saveOrderPaymentRecord({
            orderId,
            customerId: req.user.id,
            amount: checkoutSummary.total,
            currency: "INR",
            paymentMethod: method,
            paymentStatus: "captured",
            provider: "mock_gateway",
            transactionId,
            upiId: normalized.persisted.upiId,
            cardNetwork: normalized.persisted.cardNetwork,
            cardLast4: normalized.persisted.cardLast4,
            cardHolderName: normalized.persisted.cardHolderName,
            cardExpiryMonth: normalized.persisted.cardExpiryMonth,
            cardExpiryYear: normalized.persisted.cardExpiryYear,
            gatewayPayload: {
                simulated: true,
                approvalCode: `APR${Math.floor(100000 + Math.random() * 900000)}`,
                method,
                customerId: req.user.id,
            },
        });
    } catch (error) {
        throw new AppError(
            500,
            "Order created but payment audit save failed. Run DB migration for payments table."
        );
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
                provider: "mock_gateway",
                transactionId,
                method,
                status: "captured",
                upiId: normalized.persisted.upiId,
                cardLast4: normalized.persisted.cardLast4,
                cardNetwork: normalized.persisted.cardNetwork,
            },
        },
        "Mock payment successful and order placed",
        201
    );
});

import { AppError } from "../../utils/http.js";

export const ALLOWED_METHODS = new Set(["upi", "card", "cash"]);

export const UPI_ID_REGEX = /^[a-zA-Z0-9.\-_]{2,}@[a-zA-Z]{2,}$/;

export const normalizeMethod = (value) => {
    const rawMethod = String(value || "")
        .trim()
        .toLowerCase();

    const aliases = {
        cash_on_delivery: "cash",

        cod: "cash",
    };

    const method = aliases[rawMethod] || rawMethod;

    if (!ALLOWED_METHODS.has(method)) {
        throw new AppError(
            400,
            "paymentMethod must be one of 'upi', 'card', or 'cash'"
        );
    }

    return method;
};

export const normalizeUpiId = (value) =>
    String(value || "")
        .trim()
        .toLowerCase();

export const normalizeCardNumber = (value) =>
    String(value || "")
        .replace(/\s+/g, "")
        .replace(/-/g, "")
        .trim();

export const detectCardNetwork = (cardNumber) => {
    if (/^4\d{12,18}$/.test(cardNumber)) return "visa";

    if (
        /^(5[1-5]\d{14}|2(2[2-9]\d{12}|[3-6]\d{13}|7[01]\d{12}|720\d{12}))$/.test(
            cardNumber
        )
    )
        return "mastercard";

    if (/^3[47]\d{13}$/.test(cardNumber)) return "amex";

    return "unknown";
};

export const luhnCheck = (cardNumber) => {
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

export const parsePositiveInt = (value) => {
    const num = Number(value);

    if (!Number.isInteger(num)) return null;

    return num;
};

export const validateCardExpiry = (month, year) => {
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

    const now = new Date();

    const expEdge = new Date(y, m, 1);

    if (expEdge <= now) {
        throw new AppError(400, "Card is expired");
    }

    return {
        month: m,
        year: y,
    };
};

export const validatePaymentData = (method, paymentData) => {
    const payload = paymentData || {};

    if (method === "cash") {
        return {
            upiId: null,

            paymentInstrumentType: "cash",

            paymentInstrumentLabel: "Cash on Delivery",

            persisted: {
                upiId: null,

                cardNetwork: null,

                cardLast4: null,

                cardHolderName: null,

                cardExpiryMonth: null,

                cardExpiryYear: null,
            },
        };
    }

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

    const { month, year } = validateCardExpiry(
        payload.expiryMonth,
        payload.expiryYear
    );

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

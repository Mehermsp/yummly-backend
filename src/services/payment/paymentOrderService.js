import { getAddressById } from "../../models/customerModel.js";
import { getPaymentMethodById } from "../../models/paymentMethodModel.js";

import {
    createOrder,
    findOrderByPaymentId,
    getCustomerCheckoutSummary,
    getOrderById,
    getOrderItems,
    saveOrderPaymentRecord,
    updateOrderPaymentSnapshot,
} from "../../models/orderModel.js";

import { sendEmail } from "../../utils/email.js";

import { AppError } from "../../utils/http.js";
import { notifyOrderStakeholders } from "../notificationService.js";

import {
    normalizeMethod,
    validatePaymentData,
} from "./paymentValidationService.js";

import { buildMockTransactionId } from "./paymentGatewayService.js";

export const processMockPaymentAndPlaceOrder = async ({
    userId,
    addressId,
    customerNotes,
    paymentMethod,
    paymentData,
}) => {
    if (!addressId) {
        throw new AppError(400, "Address is required");
    }

    const address = await getAddressById(userId, addressId);

    if (!address) {
        throw new AppError(400, "Valid delivery address is required");
    }

    const method = normalizeMethod(paymentMethod);

    const normalized = validatePaymentData(method, paymentData);

    const transactionId = buildMockTransactionId(method);

    const isCashOnDelivery = method === "cash";

    const paymentStatus = isCashOnDelivery ? "pending" : "completed";

    const paymentRecordStatus = isCashOnDelivery ? "pending" : "captured";

    const paymentProvider = isCashOnDelivery
        ? "cash_on_delivery"
        : "mock_gateway";

    const duplicate = await findOrderByPaymentId(transactionId);

    if (duplicate?.id) {
        throw new AppError(409, "Duplicate mock transaction detected");
    }

    let checkoutSummary;

    try {
        checkoutSummary = await getCustomerCheckoutSummary(userId);
    } catch (error) {
        throw new AppError(
            400,
            error.message || "Unable to compute cart total"
        );
    }

    let orderId;

    try {
        orderId = await createOrder({
            customerId: userId,

            addressId,

            paymentMethod: method,

            customerNotes,

            paymentStatus,

            paymentReference: transactionId,
        });
    } catch (error) {
        throw new AppError(400, error.message);
    }

    await updateOrderPaymentSnapshot({
        orderId,

        paymentId: transactionId,

        paymentStatus,

        paymentMethod: method,

        paymentProvider,

        paymentInstrumentType: normalized.paymentInstrumentType,

        paymentInstrumentLabel: normalized.paymentInstrumentLabel,
    });

    await saveOrderPaymentRecord({
        orderId,

        customerId: userId,

        amount: checkoutSummary.total,

        currency: "INR",

        paymentMethod: method,

        paymentStatus: paymentRecordStatus,

        provider: paymentProvider,

        transactionId,

        upiId: normalized.persisted.upiId,

        cardNetwork: normalized.persisted.cardNetwork,

        cardLast4: normalized.persisted.cardLast4,

        cardHolderName: normalized.persisted.cardHolderName,

        cardExpiryMonth: normalized.persisted.cardExpiryMonth,

        cardExpiryYear: normalized.persisted.cardExpiryYear,

        gatewayPayload: {
            simulated: !isCashOnDelivery,

            method,

            customerId: userId,
        },
    });

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

    await notifyOrderStakeholders({
        order,
        title: "New order placed",
        message: `Order ${order?.order_number || orderId} has been placed.`,
        type: "order_placed",
        data: {
            status: order?.status,
            paymentStatus,
            paymentMethod: method,
        },
    });

    return {
        ...order,

        items,

        payment: {
            provider: paymentProvider,

            transactionId,

            method,

            status: paymentRecordStatus,

            upiId: normalized.persisted.upiId,

            cardLast4: normalized.persisted.cardLast4,

            cardNetwork: normalized.persisted.cardNetwork,
        },
    };
};

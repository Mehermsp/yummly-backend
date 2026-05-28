import { AppError } from "../../utils/http.js";

import { sendEmail } from "../../utils/email.js";

import {
    getOrderById,
    updateOrderStatus,
    listRestaurantOrders,
} from "../../models/orderModel.js";

import { getRestaurantByOwnerId } from "../../models/restaurantModel.js";
import { normalizeOrderStatusInput } from "../../utils/orderStatus.js";

const validateRestaurantStatusTransition = (currentStatus, nextStatus) => {
    const allowedTransitions = {
        placed: ["confirmed", "cancelled"],

        confirmed: ["preparing", "cancelled"],

        preparing: ["prepared", "ready", "cancelled"],

        prepared: ["ready", "cancelled"],

        ready: ["cancelled"],

        picked_up: [],

        on_the_way: [],

        delivered: [],

        cancelled: [],
    };

    return allowedTransitions[currentStatus]?.includes(nextStatus);
};

export const getRestaurantOrders = async ({ ownerId, status }) => {
    const restaurant = await getRestaurantByOwnerId(ownerId);

    if (!restaurant) {
        throw new AppError(404, "Restaurant account is not active");
    }

    return await listRestaurantOrders(restaurant.id, status);
};

export const updateRestaurantOrderStatus = async ({
    ownerId,
    orderId,
    status,
    notes,
}) => {
    const restaurant = await getRestaurantByOwnerId(ownerId);

    if (!restaurant) {
        throw new AppError(404, "Restaurant account is not active");
    }

    const order = await getOrderById(orderId);

    if (!order || Number(order.restaurant_id) !== Number(restaurant.id)) {
        throw new AppError(404, "Order not found");
    }

    const normalizedStatus = normalizeOrderStatusInput(status);

    if (!normalizedStatus) {
        throw new AppError(400, "Status is required");
    }

    const currentStatus = normalizeOrderStatusInput(order.status);

    const valid = validateRestaurantStatusTransition(
        currentStatus,
        normalizedStatus
    );

    if (!valid) {
        throw new AppError(400, "Invalid status transition for restaurant");
    }

    await updateOrderStatus({
        orderId: order.id,

        currentStatus,

        nextStatus: normalizedStatus,

        actorId: ownerId,

        actorRole: "restaurant_partner",

        notes,
    });

    const updated = await getOrderById(order.id);

    void sendEmail({
        to: updated?.customer_email,

        subject: `Order update: ${updated?.order_number || updated?.id}`,

        text: `Your order ${
            updated?.order_number || updated?.id
        } is now ${String(normalizedStatus || "").replace(/_/g, " ")}.`,
    });

    return updated;
};

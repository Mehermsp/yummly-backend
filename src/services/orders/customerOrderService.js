import { getCache, setCache } from "../../utils/redisCache.js";

import { AppError } from "../../utils/http.js";

import {
    getOrderById,
    getOrderItems,
    getOrderStatusLogs,
    listCustomerOrders,
    cancelOrder as cancelOrderModel,
} from "../../models/orderModel.js";

import { getRestaurantByOwnerId } from "../../models/restaurantModel.js";

import { ROLES } from "../../constants/index.js";
import { notifyOrderStakeholders } from "../notificationService.js";

export const getMyOrders = async ({ customerId, status }) => {
    return await listCustomerOrders(customerId, status);
};

export const getOrderDetails = async ({ orderId, user }) => {
    const cacheKey = `order:${orderId}`;

    let order = await getCache(cacheKey);

    if (!order) {
        order = await getOrderById(orderId);

        if (order) {
            await setCache(cacheKey, order, 300);
        }
    }

    if (!order) {
        throw new AppError(404, "Order not found");
    }

    const canAccess =
        Number(order.customer_id) === Number(user.id) ||
        Number(order.delivery_partner_id) === Number(user.id) ||
        user.role === ROLES.ADMIN;

    if (user.role === ROLES.RESTAURANT_PARTNER) {
        const restaurant = await getRestaurantByOwnerId(user.id);

        if (Number(restaurant?.id) === Number(order.restaurant_id)) {
            const items = await getOrderItems(order.id);

            const logs = await getOrderStatusLogs(order.id);

            return {
                ...order,
                items,
                statusLogs: logs,
            };
        }
    }

    if (!canAccess) {
        throw new AppError(403, "You do not have access to this order");
    }

    const items = await getOrderItems(order.id);

    const logs = await getOrderStatusLogs(order.id);

    return {
        ...order,
        items,
        statusLogs: logs,
    };
};

export const cancelOrder = async ({ orderId, customerId, reason }) => {
    const order = await getOrderById(orderId);

    if (!order || Number(order.customer_id) !== Number(customerId)) {
        throw new AppError(404, "Order not found");
    }

    if (!["placed", "confirmed"].includes(order.status)) {
        throw new AppError(400, "Order cannot be cancelled at this stage");
    }

    await cancelOrderModel({
        orderId: order.id,
        currentStatus: order.status,
        actorId: customerId,
        actorRole: "customer",
        notes: reason || "Cancelled by customer",
    });

    const updated = await getOrderById(order.id);
    await notifyOrderStakeholders({
        order: updated,
        title: "Order cancelled",
        message: `Order ${updated?.order_number || updated?.id} was cancelled.`,
        type: "order_cancelled",
        data: {
            previousStatus: order.status,
            status: "cancelled",
            reason: reason || "Cancelled by customer",
            actorRole: "customer",
        },
    });
};

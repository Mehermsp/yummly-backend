import { asyncHandler } from "../utils/asyncHandler.js";
import { getCache, setCache } from "../utils/redisCache.js";
import { AppError, sendSuccess } from "../utils/http.js";
import { sendEmail } from "../utils/email.js";
import {
    createOrder,
    getOrderById,
    getOrderItems,
    getOrderStatusLogs,
    listCustomerOrders,
    updateOrderStatus,
    cancelOrder as cancelOrderModel,
} from "../models/orderModel.js";
import { getAddressById } from "../models/customerModel.js";
import { ORDER_STATUS, ROLES } from "../constants/index.js";
import {
    getRestaurantByOwnerId,
    listRestaurantOrders,
} from "../models/restaurantModel.js";

const normalizeOrderStatusInput = (value) => {
    const normalized = String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[-\s]+/g, "_")
        .replace(/_+/g, "_");

    // Map to exact database enum values: placed, confirmed, preparing, prepared, ready, picked_up, on_the_way, delivered, cancelled
    const aliases = {
        accepted: "confirmed",
        confirmed: "confirmed",
        preparing: "preparing",
        prepared: "prepared",
        ready_to_pickup: "ready",
        ready_forpickup: "ready",
        ready_for__pickup: "ready",
        ready: "ready",
        ready_for_pickup: "ready",
        ready_to_pick_up: "ready",
        picked_up: "picked_up",
        on_the_way: "on_the_way",
        out_for_delivery: "on_the_way",
        delivering: "on_the_way",
        out: "picked_up",
        delivered: "delivered",
        cancelled: "cancelled",
        cancel: "cancelled",
    };

    return aliases[normalized] || normalized;
};

const validateRestaurantStatusTransition = (currentStatus, nextStatus) => {
    // Use database enum values directly: placed, confirmed, preparing, prepared, ready, picked_up, on_the_way, delivered, cancelled
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

export const placeOrder = asyncHandler(async (req, res) => {
    const { addressId, paymentMethod, customerNotes } = req.body;
    const address = await getAddressById(req.user.id, addressId);
    if (!address) {
        throw new AppError(400, "Valid delivery address is required");
    }

    let orderId;
    try {
        orderId = await createOrder({
            customerId: req.user.id,
            addressId,
            paymentMethod,
            customerNotes,
        });
    } catch (error) {
        throw new AppError(400, error.message);
    }

    const order = await getOrderById(orderId);
    const items = await getOrderItems(orderId);

    // Non-blocking transactional emails.
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

    sendSuccess(res, { ...order, items }, "Order placed successfully", 201);
});

export const getMyOrders = asyncHandler(async (req, res) => {
    const orders = await listCustomerOrders(req.user.id, req.query.status);
    sendSuccess(res, orders, "Orders fetched successfully");
});

export const getOrderDetails = asyncHandler(async (req, res) => {
    const orderId = req.params.orderId;
    const cacheKey = `order:${orderId}`;
    let order = await getCache(cacheKey);

    if (!order) {
        // Cache miss or Redis error, fallback to MySQL
        order = await getOrderById(orderId);
        if (order) {
            // Set cache for future requests
            setCache(cacheKey, order, 300); // 5 min TTL
        }
    }

    if (!order) {
        throw new AppError(404, "Order not found");
    }

    const canAccess =
        Number(order.customer_id) === Number(req.user.id) ||
        Number(order.delivery_partner_id) === Number(req.user.id) ||
        req.user.role === ROLES.ADMIN;

    if (req.user.role === ROLES.RESTAURANT_PARTNER) {
        const restaurant = await getRestaurantByOwnerId(req.user.id);
        if (Number(restaurant?.id) === Number(order.restaurant_id)) {
            const items = await getOrderItems(order.id);
            const logs = await getOrderStatusLogs(order.id);
            return sendSuccess(
                res,
                { ...order, items, statusLogs: logs },
                "Order details fetched successfully"
            );
        }
    }

    if (!canAccess) {
        throw new AppError(403, "You do not have access to this order");
    }

    const items = await getOrderItems(order.id);
    const logs = await getOrderStatusLogs(order.id);
    sendSuccess(
        res,
        { ...order, items, statusLogs: logs },
        "Order details fetched successfully"
    );
});

export const getOrderTracking = asyncHandler(async (req, res) => {
    const order = await getOrderById(req.params.orderId);
    if (!order || Number(order.customer_id) !== Number(req.user.id)) {
        throw new AppError(404, "Order not found");
    }

    const logs = await getOrderStatusLogs(order.id);
    sendSuccess(
        res,
        {
            id: order.id,
            orderNumber: order.order_number,
            status: order.status,
            deliveryPartnerName: order.delivery_partner_name,
            deliveryPartnerPhone: order.delivery_partner_phone,
            logs,
        },
        "Order tracking fetched successfully"
    );
});

export const cancelOrder = asyncHandler(async (req, res) => {
    const order = await getOrderById(req.params.orderId);
    if (!order || Number(order.customer_id) !== Number(req.user.id)) {
        throw new AppError(404, "Order not found");
    }

    if (!["placed", "confirmed"].includes(order.status)) {
        throw new AppError(400, "Order cannot be cancelled at this stage");
    }

    await cancelOrderModel({
        orderId: order.id,
        currentStatus: order.status,
        actorId: req.user.id,
        actorRole: "customer",
        notes: req.body.reason || "Cancelled by customer",
    });

    sendSuccess(res, null, "Order cancelled successfully");
});

export const getRestaurantOrders = asyncHandler(async (req, res) => {
    const restaurant = await getRestaurantByOwnerId(req.user.id);
    if (!restaurant) {
        throw new AppError(404, "Restaurant account is not active");
    }

    const orders = await listRestaurantOrders(restaurant.id, req.query.status);
    sendSuccess(res, orders, "Restaurant orders fetched successfully");
});

export const updateRestaurantOrderStatus = asyncHandler(async (req, res) => {
    const restaurant = await getRestaurantByOwnerId(req.user.id);
    if (!restaurant) {
        throw new AppError(404, "Restaurant account is not active");
    }

    const order = await getOrderById(req.params.orderId);
    if (!order || Number(order.restaurant_id) !== Number(restaurant.id)) {
        throw new AppError(404, "Order not found");
    }

    const { notes } = req.body;
    const status = normalizeOrderStatusInput(req.body?.status);

    if (!status) {
        throw new AppError(400, "Status is required");
    }

    const currentStatus = normalizeOrderStatusInput(order.status);
    if (!validateRestaurantStatusTransition(currentStatus, status)) {
        throw new AppError(400, "Invalid status transition for restaurant");
    }

    await updateOrderStatus({
        orderId: order.id,
        currentStatus,
        nextStatus: status,
        actorId: req.user.id,
        actorRole: "restaurant_partner",
        notes,
    });

    const updated = await getOrderById(order.id);

    void sendEmail({
        to: updated?.customer_email,
        subject: `Order update: ${updated?.order_number || updated?.id}`,
        text: `Your order ${
            updated?.order_number || updated?.id
        } is now ${String(status || "").replace(/_/g, " ")}.`,
    });

    sendSuccess(res, updated, "Order status updated successfully");
});

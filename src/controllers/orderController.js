import { asyncHandler } from "../utils/asyncHandler.js";
import { AppError, sendSuccess } from "../utils/http.js";
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

const validateRestaurantStatusTransition = (currentStatus, nextStatus) => {
    const allowedTransitions = {
        placed: [ORDER_STATUS.CONFIRMED, ORDER_STATUS.CANCELLED],
        confirmed: [ORDER_STATUS.PREPARING, ORDER_STATUS.CANCELLED],
        preparing: [ORDER_STATUS.READY_FOR_PICKUP],
        ready_for_pickup: [],
        out_for_delivery: [],
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
    sendSuccess(res, { ...order, items }, "Order placed successfully", 201);
});

export const getMyOrders = asyncHandler(async (req, res) => {
    const orders = await listCustomerOrders(req.user.id, req.query.status);
    sendSuccess(res, orders, "Orders fetched successfully");
});

export const getOrderDetails = asyncHandler(async (req, res) => {
    const order = await getOrderById(req.params.orderId);
    if (!order) {
        throw new AppError(404, "Order not found");
    }

    const canAccess =
        order.customer_id === req.user.id ||
        order.delivery_partner_id === req.user.id ||
        req.user.role === ROLES.ADMIN;

    if (req.user.role === ROLES.RESTAURANT_PARTNER) {
        const restaurant = await getRestaurantByOwnerId(req.user.id);
        if (restaurant?.id === order.restaurant_id) {
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
    if (!order || order.customer_id !== req.user.id) {
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
    if (!order || order.customer_id !== req.user.id) {
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
    if (!order || order.restaurant_id !== restaurant.id) {
        throw new AppError(404, "Order not found");
    }

    const { status, notes } = req.body;
    if (!validateRestaurantStatusTransition(order.status, status)) {
        throw new AppError(400, "Invalid status transition for restaurant");
    }

    await updateOrderStatus({
        orderId: order.id,
        currentStatus: order.status,
        nextStatus: status,
        actorId: req.user.id,
        actorRole: "restaurant_partner",
        notes,
    });

    const updated = await getOrderById(order.id);
    sendSuccess(res, updated, "Order status updated successfully");
});

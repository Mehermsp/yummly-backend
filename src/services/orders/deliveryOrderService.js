import { AppError } from "../../utils/http.js";

import {
    getOrderById,
    updateOrderStatus,
    listDeliveryAssignments,
    getDeliveryOpenOrders,
    claimReadyOrderAssignment,
    markOrderRejectedForPartner,
    updateAssignmentStatus,
    getAssignmentForOrderAndPartner,
} from "../../models/orderModel.js";

export const getDeliveryAssignments = async (deliveryPartnerId) => {
    return await listDeliveryAssignments(deliveryPartnerId);
};

export const getOpenOrders = async (deliveryPartnerId) => {
    return await getDeliveryOpenOrders(deliveryPartnerId);
};

export const acceptOrder = async ({ orderId, deliveryPartnerId }) => {
    const result = await claimReadyOrderAssignment({
        orderId,
        deliveryPartnerId,
    });

    if (!result.success) {
        throw new AppError(400, "Order already assigned");
    }

    await updateAssignmentStatus({
        orderId,

        deliveryPartnerId,

        status: "accepted",
    });

    await updateOrderStatus({
        orderId,

        nextStatus: "picked_up",

        actorId: deliveryPartnerId,

        actorRole: "delivery_partner",
    });

    return await getOrderById(orderId);
};

export const rejectOrder = async ({ orderId, deliveryPartnerId, reason }) => {
    await markOrderRejectedForPartner({
        orderId,

        deliveryPartnerId,

        rejectionReason: reason,
    });
};

export const pickupOrder = async ({ orderId, deliveryPartnerId }) => {
    const assignment = await getAssignmentForOrderAndPartner(
        orderId,
        deliveryPartnerId
    );

    if (!assignment) {
        throw new AppError(404, "Assignment not found");
    }

    await updateAssignmentStatus({
        orderId,

        deliveryPartnerId,

        status: "picked_up",
    });

    await updateOrderStatus({
        orderId,

        nextStatus: "on_the_way",

        actorId: deliveryPartnerId,

        actorRole: "delivery_partner",
    });

    return await getOrderById(orderId);
};

export const deliverOrder = async ({ orderId, deliveryPartnerId }) => {
    const assignment = await getAssignmentForOrderAndPartner(
        orderId,
        deliveryPartnerId
    );

    if (!assignment) {
        throw new AppError(404, "Assignment not found");
    }

    await updateAssignmentStatus({
        orderId,

        deliveryPartnerId,

        status: "delivered",
    });

    await updateOrderStatus({
        orderId,

        nextStatus: "delivered",

        actorId: deliveryPartnerId,

        actorRole: "delivery_partner",
    });

    return await getOrderById(orderId);
};

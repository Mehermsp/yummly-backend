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
import { notifyOrderStakeholders } from "../notificationService.js";

export const getDeliveryAssignments = async (deliveryPartnerId) => {
    return await listDeliveryAssignments(deliveryPartnerId);
};

export const getOpenOrders = async (deliveryPartnerId) => {
    return await getDeliveryOpenOrders(deliveryPartnerId);
};

export const acceptOrder = async ({ orderId, deliveryPartnerId }) => {
    const order = await getOrderById(orderId);

    if (!order) {
        throw new AppError(404, "Order not found");
    }

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

    const updated = await getOrderById(orderId);
    await notifyOrderStakeholders({
        order: updated,
        title: "Delivery partner assigned",
        message: `A delivery partner accepted order ${
            updated?.order_number || updated?.id
        }.`,
        type: "delivery_assignment",
        data: {
            assignmentStatus: "accepted",
            deliveryPartnerId,
        },
    });

    return updated;
};

export const rejectOrder = async ({ orderId, deliveryPartnerId, reason }) => {
    await markOrderRejectedForPartner({
        orderId,

        deliveryPartnerId,

        rejectionReason: reason,
    });

    const order = await getOrderById(orderId);
    await notifyOrderStakeholders({
        order,
        title: "Delivery assignment rejected",
        message: `Delivery assignment was rejected for order ${
            order?.order_number || orderId
        }.`,
        type: "delivery_assignment",
        data: {
            assignmentStatus: "rejected",
            deliveryPartnerId,
            reason,
        },
        includeAdmins: true,
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

    const updated = await getOrderById(orderId);
    await notifyOrderStakeholders({
        order: updated,
        title: "Order picked up",
        message: `Order ${
            updated?.order_number || updated?.id
        } is on the way.`,
        type: "order_status",
        data: {
            status: "on_the_way",
            actorRole: "delivery_partner",
        },
    });

    return updated;
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

    const updated = await getOrderById(orderId);
    await notifyOrderStakeholders({
        order: updated,
        title: "Order delivered",
        message: `Order ${
            updated?.order_number || updated?.id
        } was delivered successfully.`,
        type: "order_status",
        data: {
            status: "delivered",
            actorRole: "delivery_partner",
        },
    });

    return updated;
};

import { asyncHandler } from "../../utils/asyncHandler.js";

import { AppError, sendSuccess } from "../../utils/http.js";

import { updateDeliveryAvailability } from "../../models/userModel.js";

import {
    claimReadyOrderAssignment,
    clearOrderDeliveryPartner,
    getAssignmentForOrderAndPartner,
    getOrderById,
    listDeliveryAssignments,
    markOrderRejectedForPartner,
    updateAssignmentStatus,
} from "../../models/orderModel.js";

import {
    DELIVERY_ASSIGNMENT_STATUS,
    ORDER_STATUS,
} from "../../constants/index.js";

import { isAcceptanceWindowOpen } from "./helpers.js";

export const acceptDeliveryOrder = asyncHandler(async (req, res) => {
    const order = await getOrderById(req.params.orderId);

    const allowedStatuses = [
        ORDER_STATUS.READY,
        ORDER_STATUS.PREPARED,
        "ready_for_pickup",
    ];

    if (!order || !allowedStatuses.includes(order.status)) {
        throw new AppError(404, "Ready order not found");
    }

    const assignment = await getAssignmentForOrderAndPartner(
        order.id,
        req.user.id
    );

    if (
        assignment?.status === DELIVERY_ASSIGNMENT_STATUS.ACCEPTED ||
        assignment?.status === DELIVERY_ASSIGNMENT_STATUS.PICKED_UP
    ) {
        return sendSuccess(res, null, "Delivery assignment already accepted");
    }

    const assignedToCurrentPartner =
        Number(order.delivery_partner_id) === Number(req.user.id);

    if (assignedToCurrentPartner && assignment) {
        if (!isAcceptanceWindowOpen(assignment.assigned_at)) {
            await updateAssignmentStatus({
                orderId: order.id,

                deliveryPartnerId: req.user.id,

                status: DELIVERY_ASSIGNMENT_STATUS.REJECTED,
            });

            await clearOrderDeliveryPartner(order.id, req.user.id);

            await updateDeliveryAvailability(req.user.id, true);

            throw new AppError(400, "Acceptance window expired");
        }

        await updateAssignmentStatus({
            orderId: order.id,

            deliveryPartnerId: req.user.id,

            status: DELIVERY_ASSIGNMENT_STATUS.ACCEPTED,
        });

        await updateDeliveryAvailability(req.user.id, false);

        return sendSuccess(res, null, "Delivery assignment accepted");
    }

    const claimResult = await claimReadyOrderAssignment({
        orderId: order.id,

        deliveryPartnerId: req.user.id,
    });

    if (!claimResult?.success) {
        throw new AppError(409, "Order already assigned");
    }

    await updateDeliveryAvailability(req.user.id, false);

    sendSuccess(res, null, "Delivery assignment accepted");
});

export const rejectDeliveryOrder = asyncHandler(async (req, res) => {
    const order = await getOrderById(req.params.orderId);

    if (!order) {
        throw new AppError(404, "Order not found");
    }

    await markOrderRejectedForPartner({
        orderId: req.params.orderId,

        deliveryPartnerId: req.user.id,

        rejectionReason: req.body.reason || "Rejected by delivery partner",
    });

    await clearOrderDeliveryPartner(req.params.orderId, req.user.id);

    await updateDeliveryAvailability(req.user.id, true);

    sendSuccess(res, null, "Delivery assignment rejected");
});

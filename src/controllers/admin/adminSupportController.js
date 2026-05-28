import { asyncHandler } from "../../utils/asyncHandler.js";
import { sendSuccess } from "../../utils/http.js";
import * as supportService from "../../services/support/supportService.js";

export const listTickets = asyncHandler(async (req, res) => {
    const tickets = await supportService.listAdminTickets(req.query);

    sendSuccess(res, tickets, "Support tickets fetched successfully");
});

export const getTicket = asyncHandler(async (req, res) => {
    const ticket = await supportService.getAdminTicket(req.params.ticketId);

    sendSuccess(res, ticket, "Support ticket fetched successfully");
});

export const updateTicket = asyncHandler(async (req, res) => {
    const ticket = await supportService.updateAdminTicket({
        adminId: req.user.id,
        ticketId: req.params.ticketId,
        ...req.body,
    });

    sendSuccess(res, ticket, "Support ticket updated successfully");
});

export const replyToTicket = asyncHandler(async (req, res) => {
    const ticket = await supportService.replyToAdminTicket({
        adminId: req.user.id,
        ticketId: req.params.ticketId,
        message: req.body.message,
        isInternal: req.body.isInternal,
    });

    sendSuccess(res, ticket, "Support reply added successfully");
});

export const listRefunds = asyncHandler(async (req, res) => {
    const refunds = await supportService.listAdminRefunds(req.query);

    sendSuccess(res, refunds, "Refund requests fetched successfully");
});

export const updateRefund = asyncHandler(async (req, res) => {
    const refund = await supportService.updateAdminRefund({
        adminId: req.user.id,
        refundId: req.params.refundId,
        status: req.body.status,
        adminNotes: req.body.adminNotes,
        gatewayRefundId: req.body.gatewayRefundId,
    });

    sendSuccess(res, refund, "Refund request updated successfully");
});

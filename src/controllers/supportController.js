import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/http.js";
import * as supportService from "../services/support/supportService.js";

export const createTicket = asyncHandler(async (req, res) => {
    const ticket = await supportService.createCustomerTicket({
        customerId: req.user.id,
        role: req.user.role,
        ...req.body,
    });

    sendSuccess(res, ticket, "Support ticket created successfully", 201);
});

export const listMyTickets = asyncHandler(async (req, res) => {
    const tickets = await supportService.listCustomerTickets({
        customerId: req.user.id,
        status: req.query.status,
    });

    sendSuccess(res, tickets, "Support tickets fetched successfully");
});

export const getMyTicket = asyncHandler(async (req, res) => {
    const ticket = await supportService.getCustomerTicket({
        customerId: req.user.id,
        ticketId: req.params.ticketId,
    });

    sendSuccess(res, ticket, "Support ticket fetched successfully");
});

export const replyToMyTicket = asyncHandler(async (req, res) => {
    const ticket = await supportService.replyToCustomerTicket({
        customerId: req.user.id,
        ticketId: req.params.ticketId,
        message: req.body.message,
    });

    sendSuccess(res, ticket, "Support reply added successfully");
});

export const requestRefund = asyncHandler(async (req, res) => {
    const refund = await supportService.requestCustomerRefund({
        customerId: req.user.id,
        orderId: req.params.orderId,
        reason: req.body.reason,
        amount: req.body.amount,
    });

    sendSuccess(res, refund, "Refund request submitted successfully", 201);
});

export const listMyRefunds = asyncHandler(async (req, res) => {
    const refunds = await supportService.listCustomerRefunds({
        customerId: req.user.id,
        status: req.query.status,
    });

    sendSuccess(res, refunds, "Refund requests fetched successfully");
});

export const getInvoice = asyncHandler(async (req, res) => {
    const invoice = await supportService.buildCustomerInvoice({
        customerId: req.user.id,
        orderId: req.params.orderId,
    });

    sendSuccess(res, invoice, "Invoice generated successfully");
});

export const reorderOrder = asyncHandler(async (req, res) => {
    const result = await supportService.reorderCustomerOrder({
        customerId: req.user.id,
        orderId: req.params.orderId,
    });

    sendSuccess(res, result, "Order items added to cart successfully");
});

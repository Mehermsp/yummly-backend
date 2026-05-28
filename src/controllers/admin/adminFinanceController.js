import { asyncHandler } from "../../utils/asyncHandler.js";
import { sendSuccess } from "../../utils/http.js";
import * as incomeService from "../../services/finance/incomeManagementService.js";
import * as settlementService from "../../services/finance/settlementService.js";

export const getFinancialDashboard = asyncHandler(async (req, res) => {
    const dashboard = await incomeService.getAdminFinancialDashboard();
    sendSuccess(res, dashboard, "Financial dashboard fetched successfully");
});

export const listOrderFinancials = asyncHandler(async (req, res) => {
    const financials = await incomeService.listOrderFinancials(req.query);
    sendSuccess(res, financials, "Order financials fetched successfully");
});

export const listRestaurantSettlements = asyncHandler(async (req, res) => {
    const settlements = await incomeService.listRestaurantSettlements(req.query);
    sendSuccess(res, settlements, "Restaurant settlements fetched successfully");
});

export const listDeliveryEarnings = asyncHandler(async (req, res) => {
    const earnings = await incomeService.listDeliveryEarnings(req.query);
    sendSuccess(res, earnings, "Delivery earnings fetched successfully");
});

export const updateRestaurantSettlement = asyncHandler(async (req, res) => {
    await incomeService.updateRestaurantSettlementStatus({
        settlementId: req.params.settlementId,
        status: req.body.status,
        transactionReference: req.body.transactionReference,
        adminNotes: req.body.adminNotes,
        adminId: req.user.id,
    });
    const settlements = await incomeService.listRestaurantSettlements({});
    sendSuccess(res, settlements, "Restaurant settlement updated successfully");
});

export const applyPenalty = asyncHandler(async (req, res) => {
    const penaltyId = await incomeService.applyFinancialPenalty({
        entityType: req.body.entityType,
        entityId: req.body.entityId,
        orderId: req.body.orderId,
        penaltyType: req.body.penaltyType,
        penaltyReason: req.body.penaltyReason,
        amount: req.body.amount,
        status: req.body.status || "applied",
        createdBy: req.user.id,
    });
    sendSuccess(res, { penaltyId }, "Financial penalty applied successfully", 201);
});

export const applyBonus = asyncHandler(async (req, res) => {
    const result = await incomeService.applyFinancialBonus({
        entityType: req.body.entityType,
        entityId: req.body.entityId,
        orderId: req.body.orderId,
        bonusReason: req.body.bonusReason,
        amount: req.body.amount,
        idempotencyKey: req.body.idempotencyKey,
        createdBy: req.user.id,
    });
    sendSuccess(res, result, "Financial bonus applied successfully", 201);
});

export const createRefundTransaction = asyncHandler(async (req, res) => {
    const refundId = await incomeService.createRefundTransaction({
        orderId: req.body.orderId,
        refundAmount: req.body.refundAmount,
        refundReason: req.body.refundReason,
        refundStatus: req.body.refundStatus || "pending",
        gatewayRefundId: req.body.gatewayRefundId,
        idempotencyKey: req.body.idempotencyKey,
        createdBy: req.user.id,
    });
    sendSuccess(res, { refundId }, "Refund transaction recorded successfully", 201);
});

export const listBankAccounts = asyncHandler(async (req, res) => {
    const accounts = await settlementService.listBankAccountsForAdmin(req.query);
    sendSuccess(res, accounts, "Partner bank accounts fetched successfully");
});

export const verifyBankAccount = asyncHandler(async (req, res) => {
    const accounts = await settlementService.verifyBankAccountForAdmin({
        bankAccountId: req.params.bankAccountId,
        status: req.body.status,
        adminId: req.user.id,
        notes: req.body.notes,
    });
    sendSuccess(res, accounts, "Bank verification updated successfully");
});

export const listSettlements = asyncHandler(async (req, res) => {
    const settlements = await settlementService.listSettlementsForAdmin(req.query);
    sendSuccess(res, settlements, "Monthly settlements fetched successfully");
});

export const generateSettlements = asyncHandler(async (req, res) => {
    const result = await settlementService.generateSettlementsForAdmin({
        periodStart: req.body.periodStart,
        periodEnd: req.body.periodEnd,
        adminId: req.user.id,
        restaurantCommissionPercent: req.body.restaurantCommissionPercent,
        deliveryPartnerSharePercent: req.body.deliveryPartnerSharePercent,
    });
    sendSuccess(res, result, "Monthly settlements generated successfully", 201);
});

export const updateSettlement = asyncHandler(async (req, res) => {
    const settlements = await settlementService.updateSettlementForAdmin({
        settlementId: req.params.settlementId,
        status: req.body.status,
        paymentReference: req.body.paymentReference,
        adminNotes: req.body.adminNotes,
    });
    sendSuccess(res, settlements, "Settlement updated successfully");
});

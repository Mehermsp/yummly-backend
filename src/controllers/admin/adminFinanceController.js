import { asyncHandler } from "../../utils/asyncHandler.js";
import { sendSuccess } from "../../utils/http.js";
import * as settlementService from "../../services/finance/settlementService.js";

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

import {
    generateMonthlySettlements,
    getPartnerBankAccount,
    listMonthlySettlements,
    listPartnerBankAccounts,
    updateBankVerification,
    updateSettlementStatus,
    upsertPartnerBankAccount,
} from "../../models/settlementModel.js";
import { getRestaurantByOwnerId } from "../../models/restaurantModel.js";
import { AppError } from "../../utils/http.js";

const BANK_STATUSES = new Set(["pending", "verified", "rejected"]);
const SETTLEMENT_STATUSES = new Set([
    "generated",
    "approved",
    "processing",
    "paid",
    "failed",
    "on_hold",
]);

const getPreviousMonthRange = () => {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
    return {
        periodStart: start.toISOString().slice(0, 10),
        periodEnd: end.toISOString().slice(0, 10),
    };
};

export const submitRestaurantBankAccount = async ({ ownerId, payload }) => {
    const restaurant = await getRestaurantByOwnerId(ownerId);

    if (!restaurant) {
        throw new AppError(404, "Restaurant account is not active");
    }

    await upsertPartnerBankAccount({
        partnerType: "restaurant",
        partnerId: restaurant.id,
        accountHolderName: payload.accountHolderName,
        bankName: payload.bankName,
        accountNumber: payload.accountNumber,
        ifscCode: payload.ifscCode,
        upiId: payload.upiId,
    });

    return getPartnerBankAccount("restaurant", restaurant.id);
};

export const getRestaurantBankAccount = async (ownerId) => {
    const restaurant = await getRestaurantByOwnerId(ownerId);

    if (!restaurant) {
        throw new AppError(404, "Restaurant account is not active");
    }

    return getPartnerBankAccount("restaurant", restaurant.id);
};

export const submitDeliveryBankAccount = async ({ deliveryPartnerId, payload }) => {
    await upsertPartnerBankAccount({
        partnerType: "delivery_partner",
        partnerId: deliveryPartnerId,
        accountHolderName: payload.accountHolderName,
        bankName: payload.bankName,
        accountNumber: payload.accountNumber,
        ifscCode: payload.ifscCode,
        upiId: payload.upiId,
    });

    return getPartnerBankAccount("delivery_partner", deliveryPartnerId);
};

export const getDeliveryBankAccount = (deliveryPartnerId) =>
    getPartnerBankAccount("delivery_partner", deliveryPartnerId);

export const listBankAccountsForAdmin = ({ partnerType, status } = {}) => {
    if (status && !BANK_STATUSES.has(status)) {
        throw new AppError(400, "Invalid bank verification status");
    }

    return listPartnerBankAccounts({ partnerType, status });
};

export const verifyBankAccountForAdmin = async ({
    bankAccountId,
    status,
    adminId,
    notes,
}) => {
    if (!["verified", "rejected", "pending"].includes(status)) {
        throw new AppError(400, "Invalid bank verification status");
    }

    await updateBankVerification({
        bankAccountId,
        status,
        adminId,
        notes,
    });

    return listPartnerBankAccounts({});
};

export const listSettlementsForAdmin = (filters = {}) =>
    listMonthlySettlements(filters);

export const generateSettlementsForAdmin = async ({
    periodStart,
    periodEnd,
    adminId,
    restaurantCommissionPercent,
    deliveryPartnerSharePercent,
}) => {
    const fallback = getPreviousMonthRange();
    const start = periodStart || fallback.periodStart;
    const end = periodEnd || fallback.periodEnd;

    const summary = await generateMonthlySettlements({
        periodStart: start,
        periodEnd: end,
        generatedBy: adminId,
        restaurantCommissionPercent,
        deliveryPartnerSharePercent,
    });

    const settlements = await listMonthlySettlements({
        periodStart: start,
        periodEnd: end,
    });

    return {
        periodStart: start,
        periodEnd: end,
        summary,
        settlements,
    };
};

export const updateSettlementForAdmin = async ({
    settlementId,
    status,
    paymentReference,
    adminNotes,
}) => {
    if (!SETTLEMENT_STATUSES.has(status)) {
        throw new AppError(400, "Invalid settlement status");
    }

    await updateSettlementStatus({
        settlementId,
        status,
        paymentReference,
        adminNotes,
    });

    return listMonthlySettlements({});
};

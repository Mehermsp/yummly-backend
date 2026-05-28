import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/http.js";
import * as settlementService from "../services/finance/settlementService.js";

export const getMyRestaurantBank = asyncHandler(async (req, res) => {
    const bank = await settlementService.getRestaurantBankAccount(req.user.id);
    sendSuccess(res, bank, "Restaurant bank account fetched successfully");
});

export const saveMyRestaurantBank = asyncHandler(async (req, res) => {
    const bank = await settlementService.submitRestaurantBankAccount({
        ownerId: req.user.id,
        payload: req.body,
    });
    sendSuccess(res, bank, "Restaurant bank account submitted for verification");
});

export const getMyDeliveryBank = asyncHandler(async (req, res) => {
    const bank = await settlementService.getDeliveryBankAccount(req.user.id);
    sendSuccess(res, bank, "Delivery bank account fetched successfully");
});

export const saveMyDeliveryBank = asyncHandler(async (req, res) => {
    const bank = await settlementService.submitDeliveryBankAccount({
        deliveryPartnerId: req.user.id,
        payload: req.body,
    });
    sendSuccess(res, bank, "Delivery bank account submitted for verification");
});

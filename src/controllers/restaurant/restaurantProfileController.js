import { asyncHandler } from "../../utils/asyncHandler.js";

import { AppError, sendSuccess } from "../../utils/http.js";

import {
    getRestaurantByOwnerId,
    updateRestaurantProfileByOwnerId,
} from "../../models/restaurantModel.js";

export const getPartnerProfile = asyncHandler(async (req, res) => {
    const restaurant = await getRestaurantByOwnerId(req.user.id);

    if (!restaurant) {
        throw new AppError(404, "Restaurant account is not active");
    }

    sendSuccess(res, restaurant, "Restaurant profile fetched successfully");
});

export const updatePartnerProfile = asyncHandler(async (req, res) => {
    const existing = await getRestaurantByOwnerId(req.user.id);

    if (!existing) {
        throw new AppError(404, "Restaurant account is not active");
    }

    await updateRestaurantProfileByOwnerId(req.user.id, req.body || {});

    const restaurant = await getRestaurantByOwnerId(req.user.id);

    sendSuccess(res, restaurant, "Restaurant profile updated successfully");
});

import { asyncHandler } from "../../utils/asyncHandler.js";

import { AppError, sendSuccess } from "../../utils/http.js";

import {
    createMenuItem,
    deleteMenuItem,
    getRestaurantByOwnerId,
    getRestaurantMenu,
    updateMenuItem,
} from "../../models/restaurantModel.js";

export const getPartnerMenu = asyncHandler(async (req, res) => {
    const restaurant = await getRestaurantByOwnerId(req.user.id);

    if (!restaurant) {
        throw new AppError(404, "Restaurant account is not active");
    }

    const menu = await getRestaurantMenu(restaurant.id);

    sendSuccess(res, menu, "Restaurant menu fetched successfully");
});

export const createPartnerMenuItem = asyncHandler(async (req, res) => {
    const restaurant = await getRestaurantByOwnerId(req.user.id);
    if (!restaurant) {
        throw new AppError(404, "Restaurant account is not active");
    }

    let payload = req.body || {};
    if (req.file && req.file.path) {
        payload.image = req.file.path;
    }

    const itemId = await createMenuItem(restaurant.id, payload);
    const menu = await getRestaurantMenu(restaurant.id);
    sendSuccess(
        res,
        {
            itemId,
            menu,
        },
        "Menu item created successfully",
        201
    );
});

export const updatePartnerMenuItem = asyncHandler(async (req, res) => {
    const restaurant = await getRestaurantByOwnerId(req.user.id);
    if (!restaurant) {
        throw new AppError(404, "Restaurant account is not active");
    }

    let payload = req.body || {};
    if (req.file && req.file.path) {
        // Remove old image from Cloudinary if exists
        // (You may want to fetch the old item and delete its image if needed)
        payload.image = req.file.path;
    }

    await updateMenuItem(restaurant.id, req.params.itemId, payload);
    const menu = await getRestaurantMenu(restaurant.id);
    sendSuccess(res, menu, "Menu item updated successfully");
});

export const deletePartnerMenuItem = asyncHandler(async (req, res) => {
    const restaurant = await getRestaurantByOwnerId(req.user.id);

    if (!restaurant) {
        throw new AppError(404, "Restaurant account is not active");
    }

    await deleteMenuItem(restaurant.id, req.params.itemId);

    const menu = await getRestaurantMenu(restaurant.id);

    sendSuccess(res, menu, "Menu item deleted successfully");
});

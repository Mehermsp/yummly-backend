import { asyncHandler } from "../utils/asyncHandler.js";
import { AppError, sendSuccess } from "../utils/http.js";
import {
    createMenuItem,
    createRestaurantApplication,
    deleteMenuItem,
    getActiveApplicationByOwner,
    getRestaurantByOwnerId,
    getRestaurantDashboard,
    getRestaurantMenu,
    updateMenuItem,
} from "../models/restaurantModel.js";

export const submitApplication = asyncHandler(async (req, res) => {
    const existing = await getActiveApplicationByOwner(req.user.id);
    if (existing && existing.status === "pending") {
        throw new AppError(409, "A pending application already exists");
    }

    const applicationId = await createRestaurantApplication({
        ownerId: req.user.id,
        ...req.body,
    });
    const application = await getActiveApplicationByOwner(req.user.id);
    sendSuccess(
        res,
        { applicationId, application },
        "Restaurant application submitted successfully",
        201
    );
});

export const getPartnerDashboard = asyncHandler(async (req, res) => {
    const restaurant = await getRestaurantByOwnerId(req.user.id);
    if (!restaurant) {
        const application = await getActiveApplicationByOwner(req.user.id);
        return sendSuccess(
            res,
            { restaurant: null, application },
            "Application status fetched successfully"
        );
    }

    const dashboard = await getRestaurantDashboard(restaurant.id);
    sendSuccess(
        res,
        { restaurant, ...dashboard },
        "Restaurant dashboard fetched successfully"
    );
});

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

    const itemId = await createMenuItem(restaurant.id, req.body);
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

    await updateMenuItem(restaurant.id, req.params.itemId, req.body);
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

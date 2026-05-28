import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError, sendSuccess } from "../../utils/http.js";
import {
    getRestaurantByOwnerId,
    updateRestaurantOperationsByOwnerId,
    updateRestaurantProfileByOwnerId,
} from "../../models/restaurantModel.js";
import { deleteImage } from "../../utils/cloudinary.js";
import {
    emitRealtimeEvent,
    notifyAdmins,
} from "../../services/notificationService.js";

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

    let updatePayload = req.body || {};

    // Handle image upload
    if (req.file && req.file.path) {
        // Remove old image from Cloudinary if exists
        if (existing.logo && existing.logo.includes("cloudinary.com")) {
            // Extract public_id from URL
            const publicId = existing.logo
                .split("/")
                .slice(-1)[0]
                .split(".")[0];
            await deleteImage(publicId);
        }
        updatePayload.logo = req.file.path;
    }

    await updateRestaurantProfileByOwnerId(req.user.id, updatePayload);
    const restaurant = await getRestaurantByOwnerId(req.user.id);
    sendSuccess(res, restaurant, "Restaurant profile updated successfully");
});

export const updatePartnerOperations = asyncHandler(async (req, res) => {
    const existing = await getRestaurantByOwnerId(req.user.id);

    if (!existing) {
        throw new AppError(404, "Restaurant account is not active");
    }

    await updateRestaurantOperationsByOwnerId(req.user.id, req.body || {});

    const restaurant = await getRestaurantByOwnerId(req.user.id);

    emitRealtimeEvent({
        room: `restaurant:${restaurant.id}`,
        eventName: "restaurant:operations-updated",
        payload: restaurant,
    });
    emitRealtimeEvent({
        room: "admin:restaurants",
        eventName: "restaurant:operations-updated",
        payload: restaurant,
    });
    emitRealtimeEvent({
        room: "admin:dashboard",
        eventName: "restaurant:operations-updated",
        payload: restaurant,
    });

    await notifyAdmins({
        title: "Restaurant operations changed",
        message: `${restaurant.name} updated operational availability.`,
        type: "restaurant_operations",
        data: {
            restaurantId: restaurant.id,
            isOpen: restaurant.is_open,
            isBusy: restaurant.is_busy,
            deliveryEnabled: restaurant.delivery_enabled,
            peakHourAvailable: restaurant.peak_hour_available,
        },
    });

    sendSuccess(res, restaurant, "Restaurant operations updated successfully");
});

import { asyncHandler } from "../../utils/asyncHandler.js";

import { sendSuccess } from "../../utils/http.js";

import {
    getActiveApplicationByOwner,
    getRestaurantByOwnerId,
    getRestaurantDashboard,
} from "../../models/restaurantModel.js";

export const getPartnerDashboard = asyncHandler(async (req, res) => {
    const restaurant = await getRestaurantByOwnerId(req.user.id);

    if (!restaurant) {
        const application = await getActiveApplicationByOwner(req.user.id);

        return sendSuccess(
            res,
            {
                restaurant: null,

                application,
            },
            "Application status fetched successfully"
        );
    }

    const dashboard = await getRestaurantDashboard(restaurant.id);

    sendSuccess(
        res,
        {
            restaurant,
            ...dashboard,
        },
        "Restaurant dashboard fetched successfully"
    );
});

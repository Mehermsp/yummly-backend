import { asyncHandler } from "../../utils/asyncHandler.js";

import { AppError, sendSuccess } from "../../utils/http.js";

import {
    createRestaurantApplication,
    getActiveApplicationByOwner,
} from "../../models/restaurantModel.js";

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
        {
            applicationId,
            application,
        },
        "Restaurant application submitted successfully",
        201
    );
});

import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError, sendSuccess } from "../../utils/http.js";
import {
    createRestaurantApplication,
    getActiveApplicationByOwner,
} from "../../models/restaurantModel.js";

export const submitApplication = asyncHandler(async (req, res) => {
    const ownerId = req.user?.id;

    if (!ownerId) {
        throw new AppError(401, "Authentication required");
    }

    // Check for existing pending application
    const existing = await getActiveApplicationByOwner(ownerId);
    if (existing && existing.status === "pending") {
        throw new AppError(
            409,
            "A pending application already exists. Please wait for review."
        );
    }

    // Handle logo file (if using multer)
    const logoPath = req.file ? req.file.path : null;

    const applicationData = {
        ownerId,
        ownerName: req.body.ownerName,
        restaurantName: req.body.restaurantName,
        email: req.body.email,
        phone: req.body.phone,
        address: req.body.address,
        city: req.body.city,
        pincode: req.body.pincode,
        landmark: req.body.landmark,
        cuisines: req.body.cuisines,
        openTime: req.body.openTime,
        closeTime: req.body.closeTime,
        daysOpen: req.body.daysOpen,
        fssai: req.body.fssai,
        gst: req.body.gst,
        pan: req.body.pan,
        logo: logoPath,
    };

    const applicationId = await createRestaurantApplication(applicationData);

    const application = await getActiveApplicationByOwner(ownerId);

    sendSuccess(
        res,
        { applicationId, application },
        "Restaurant application submitted successfully. Awaiting admin approval.",
        201
    );
});

import { Router } from "express";

import {
    getGeneralSettings,
    updateGeneralSettings,
    getNotificationSettings,
    updateNotificationSettings,
    getSecuritySettings,
    updateSecuritySettings,
    getRestaurantCommission,
    updateRestaurantCommission,
    getDeliverySettings,
    updateDeliverySettings,
} from "../../controllers/admin/adminSettingsController.js";

const router = Router();

// General
router.get("/general", getGeneralSettings);

router.put("/general", updateGeneralSettings);

// Notifications
router.get("/notifications", getNotificationSettings);

router.put("/notifications", updateNotificationSettings);

// Security
router.get("/security", getSecuritySettings);

router.put("/security", updateSecuritySettings);

// Commission
router.get("/restaurant-commission", getRestaurantCommission);

router.put("/restaurant-commission", updateRestaurantCommission);

// Delivery
router.get("/delivery", getDeliverySettings);

router.put("/delivery", updateDeliverySettings);

export default router;

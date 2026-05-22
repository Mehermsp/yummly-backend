import { Router } from "express";

import {
    getApplications,
    getApplicationById,
    approveApplication,
    rejectApplication,
    getRestaurants,
    getRestaurantAnalytics,
    getRestaurantMenu,
    getRestaurantById,
    updateRestaurantStatus,
    updateRestaurant,
} from "../../controllers/admin/adminRestaurantController.js";

const router = Router();

// Applications
router.get("/applications", getApplications);

router.get("/applications/:id", getApplicationById);

router.put("/applications/:id/approve", approveApplication);

router.put("/applications/:id/reject", rejectApplication);

// Restaurants
router.get("/", getRestaurants);

router.get("/analytics", getRestaurantAnalytics);

router.get("/:id/menu", getRestaurantMenu);

router.get("/:id", getRestaurantById);

router.put("/:id/status", updateRestaurantStatus);

router.put("/:id", updateRestaurant);

export default router;

import { Router } from "express";

import { ROLES } from "../constants/index.js";

import { authenticate } from "../middleware/authenticate.js";

import { authorize } from "../middleware/authorize.js";

// =====================================================
// APPLICATION CONTROLLER
// =====================================================

import { submitApplication } from "../controllers/restaurant/restaurantApplicationController.js";

// =====================================================
// DASHBOARD CONTROLLER
// =====================================================

import { getPartnerDashboard } from "../controllers/restaurant/restaurantDashboardController.js";

// =====================================================
// PROFILE CONTROLLER
// =====================================================

import {
    getPartnerProfile,
    updatePartnerProfile,
} from "../controllers/restaurant/restaurantProfileController.js";

// =====================================================
// MENU CONTROLLER
// =====================================================

import {
    getPartnerMenu,
    createPartnerMenuItem,
    updatePartnerMenuItem,
    deletePartnerMenuItem,
} from "../controllers/restaurant/restaurantMenuController.js";

const router = Router();

router.use(authenticate, authorize(ROLES.RESTAURANT_PARTNER));

// =====================================================
// DASHBOARD
// =====================================================

router.get("/dashboard", getPartnerDashboard);

// =====================================================
// PROFILE
// =====================================================

router.get("/profile", getPartnerProfile);

router.put("/profile", updatePartnerProfile);

// =====================================================
// APPLICATIONS
// =====================================================

router.post("/applications", submitApplication);

// =====================================================
// MENU
// =====================================================

router.get("/menu", getPartnerMenu);

router.post("/menu", createPartnerMenuItem);

router.put("/menu/:itemId", updatePartnerMenuItem);

router.delete("/menu/:itemId", deletePartnerMenuItem);

export default router;

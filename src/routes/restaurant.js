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
    updatePartnerOperations,
    updatePartnerProfile,
} from "../controllers/restaurant/restaurantProfileController.js";
import {
    getMyRestaurantBank,
    getMyRestaurantIncome,
    saveMyRestaurantBank,
} from "../controllers/financeController.js";
import { upload } from "../middleware/upload.js";

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

router.put("/profile", upload.single("image"), updatePartnerProfile);
router.patch("/operations", updatePartnerOperations);
router.get("/income", getMyRestaurantIncome);
router.get("/bank-account", getMyRestaurantBank);
router.put("/bank-account", saveMyRestaurantBank);

// =====================================================
// APPLICATIONS
// =====================================================

router.post("/applications", submitApplication);

// =====================================================
// MENU
// =====================================================

router.get("/menu", getPartnerMenu);

router.post("/menu", upload.single("image"), createPartnerMenuItem);

router.put("/menu/:itemId", upload.single("image"), updatePartnerMenuItem);

router.delete("/menu/:itemId", deletePartnerMenuItem);

export default router;

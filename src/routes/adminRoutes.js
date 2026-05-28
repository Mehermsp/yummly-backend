import { Router } from "express";

import { ROLES } from "../constants/index.js";

import { authenticate } from "../middleware/authenticate.js";
import { authorize } from "../middleware/authorize.js";

// Dashboard
import dashboardRoutes from "./admin/dashboard.js";

// Orders
import orderRoutes from "./admin/orders.js";

// Restaurants
import restaurantRoutes from "./admin/restaurants.js";

// Users & Delivery Partners
import userRoutes from "./admin/users.js";

// Settings
import settingsRoutes from "./admin/settings.js";

// Logs
import logRoutes from "./admin/logs.js";

// Finance
import financeRoutes from "./admin/finance.js";

// Support & Refunds
import refundRoutes from "./admin/refunds.js";
import supportRoutes from "./admin/support.js";
import notificationRoutes from "./admin/notifications.js";

const router = Router();

// ==============================
// ADMIN AUTHORIZATION
// ==============================

router.use(authenticate);
router.use(authorize(ROLES.ADMIN));

// ==============================
// DASHBOARD
// ==============================

router.use("/", dashboardRoutes);

// ==============================
// ORDERS
// ==============================

router.use("/orders", orderRoutes);

// ==============================
// RESTAURANTS
// ==============================

router.use("/restaurants", restaurantRoutes);

// ==============================
// USERS
// ==============================

router.use("/users", userRoutes);

// ==============================
// SETTINGS
// ==============================

router.use("/settings", settingsRoutes);

// ==============================
// FINANCE
// ==============================

router.use("/finance", financeRoutes);

// ==============================
// LOGS
// ==============================

router.use("/logs", logRoutes);

// ==============================
// SUPPORT & REFUNDS
// ==============================

router.use("/support", supportRoutes);
router.use("/refunds", refundRoutes);
router.use("/notifications", notificationRoutes);

export default router;

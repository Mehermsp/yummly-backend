import { Router } from "express";

import { ROLES } from "../constants/index.js";

import { authenticate } from "../middleware/authenticate.js";

import { authorize } from "../middleware/authorize.js";

// =====================================================
// DASHBOARD CONTROLLERS
// =====================================================

import {
    getDeliveryDashboard,
    getDeliveryOrders,
    getDeliveryIncome,
    setDeliveryAvailability,
} from "../controllers/delivery/deliveryDashboardController.js";

// =====================================================
// ASSIGNMENT CONTROLLERS
// =====================================================

import {
    acceptDeliveryOrder,
    rejectDeliveryOrder,
} from "../controllers/delivery/deliveryAssignmentController.js";

// =====================================================
// STATUS CONTROLLERS
// =====================================================

import {
    confirmDeliveryOrderPayment,
    pickupDeliveryOrder,
    completeDeliveryOrder,
    updateDeliveryOrderStatus,
} from "../controllers/delivery/deliveryStatusController.js";
import {
    getMyDeliveryBank,
    saveMyDeliveryBank,
} from "../controllers/financeController.js";

const router = Router();

router.use(authenticate, authorize(ROLES.DELIVERY_PARTNER));

// =====================================================
// DASHBOARD
// =====================================================

router.get("/dashboard", getDeliveryDashboard);

router.get("/orders", getDeliveryOrders);

router.get("/income", getDeliveryIncome);

router.patch("/availability", setDeliveryAvailability);

router.get("/bank-account", getMyDeliveryBank);

router.put("/bank-account", saveMyDeliveryBank);

// =====================================================
// ORDER STATUS
// =====================================================

router.put("/orders/:orderId/status", updateDeliveryOrderStatus);

router.post("/orders/:orderId/payment-confirmed", confirmDeliveryOrderPayment);

router.post("/orders/:orderId/pickup", pickupDeliveryOrder);

router.post("/orders/:orderId/deliver", completeDeliveryOrder);

// =====================================================
// ASSIGNMENTS
// =====================================================

router.post("/orders/:orderId/accept", acceptDeliveryOrder);

router.post("/orders/:orderId/reject", rejectDeliveryOrder);

export default router;

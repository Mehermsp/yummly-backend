import { Router } from "express";

import { authenticate } from "../middleware/authenticate.js";

import { authorize } from "../middleware/authorize.js";

import { ROLES } from "../constants/index.js";

// ==============================
// CUSTOMER
// ==============================

import {
    placeOrder,
    getMyOrders,
    getOrderDetails,
    cancelOrder,
} from "../controllers/orders/customerOrderController.js";

// ==============================
// TRACKING
// ==============================

import { getOrderTracking } from "../controllers/orders/orderTrackingController.js";

// ==============================
// RESTAURANT
// ==============================

import {
    getRestaurantOrders,
    updateRestaurantOrderStatus,
} from "../controllers/orders/restaurantOrderController.js";

// ==============================
// DELIVERY
// ==============================

import {
    getDeliveryAssignments,
    getOpenOrders,
    acceptOrder,
    rejectOrder,
    pickupOrder,
    deliverOrder,
} from "../controllers/orders/deliveryOrderController.js";

const router = Router();

router.use(authenticate);

// =====================================================
// CUSTOMER ROUTES
// =====================================================

router.post("/", authorize(ROLES.CUSTOMER), placeOrder);

router.get("/my", authorize(ROLES.CUSTOMER), getMyOrders);

router.get("/:orderId/tracking", authorize(ROLES.CUSTOMER), getOrderTracking);

router.post("/:orderId/cancel", authorize(ROLES.CUSTOMER), cancelOrder);

// =====================================================
// RESTAURANT ROUTES
// =====================================================

router.get(
    "/restaurant/list",
    authorize(ROLES.RESTAURANT_PARTNER),
    getRestaurantOrders
);

router.patch(
    "/restaurant/:orderId/status",
    authorize(ROLES.RESTAURANT_PARTNER),
    updateRestaurantOrderStatus
);

router.put(
    "/restaurant/:orderId/status",
    authorize(ROLES.RESTAURANT_PARTNER),
    updateRestaurantOrderStatus
);

// =====================================================
// DELIVERY ROUTES
// =====================================================

router.get("/delivery/open", authorize(ROLES.DELIVERY_PARTNER), getOpenOrders);

router.get(
    "/delivery/assignments",
    authorize(ROLES.DELIVERY_PARTNER),
    getDeliveryAssignments
);

router.post(
    "/delivery/:orderId/accept",
    authorize(ROLES.DELIVERY_PARTNER),
    acceptOrder
);

router.post(
    "/delivery/:orderId/reject",
    authorize(ROLES.DELIVERY_PARTNER),
    rejectOrder
);

router.post(
    "/delivery/:orderId/pickup",
    authorize(ROLES.DELIVERY_PARTNER),
    pickupOrder
);

router.post(
    "/delivery/:orderId/deliver",
    authorize(ROLES.DELIVERY_PARTNER),
    deliverOrder
);

// =====================================================
// COMMON ORDER DETAILS
// =====================================================

router.get(
    "/:orderId",
    authorize(
        ROLES.CUSTOMER,
        ROLES.RESTAURANT_PARTNER,
        ROLES.DELIVERY_PARTNER,
        ROLES.ADMIN
    ),
    getOrderDetails
);

export default router;

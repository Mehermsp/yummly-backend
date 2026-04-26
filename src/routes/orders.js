import { Router } from "express";
import { authenticate } from "../middleware/authenticate.js";
import { authorize } from "../middleware/authorize.js";
import { ROLES } from "../constants/index.js";
import {
    cancelOrder,
    getMyOrders,
    getOrderDetails,
    getOrderTracking,
    getRestaurantOrders,
    placeOrder,
    updateRestaurantOrderStatus,
} from "../controllers/orderController.js";

const router = Router();

router.use(authenticate);
router.post("/", authorize(ROLES.CUSTOMER), placeOrder);
router.get("/my", authorize(ROLES.CUSTOMER), getMyOrders);
router.get("/:orderId/tracking", authorize(ROLES.CUSTOMER), getOrderTracking);
router.post("/:orderId/cancel", authorize(ROLES.CUSTOMER), cancelOrder);
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

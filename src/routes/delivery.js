import { Router } from "express";
import { ROLES } from "../constants/index.js";
import {
    acceptDeliveryOrder,
    completeDeliveryOrder,
    getDeliveryDashboard,
    getDeliveryOrders,
    getDeliveryIncome,
    pickupDeliveryOrder,
    rejectDeliveryOrder,
    setDeliveryAvailability,
    updateDeliveryOrderStatus,
} from "../controllers/deliveryController.js";
import { authenticate } from "../middleware/authenticate.js";
import { authorize } from "../middleware/authorize.js";

const router = Router();

router.use(authenticate, authorize(ROLES.DELIVERY_PARTNER));
router.get("/dashboard", getDeliveryDashboard);
router.get("/orders", getDeliveryOrders);
router.get("/income", getDeliveryIncome);
router.patch("/availability", setDeliveryAvailability);
router.put("/orders/:orderId/status", updateDeliveryOrderStatus);
router.post("/orders/:orderId/accept", acceptDeliveryOrder);
router.post("/orders/:orderId/reject", rejectDeliveryOrder);
router.post("/orders/:orderId/pickup", pickupDeliveryOrder);
router.post("/orders/:orderId/deliver", completeDeliveryOrder);

export default router;

import { Router } from "express";
import { ROLES } from "../constants/index.js";
import {
    approveApplication,
    assignOrderToPartner,
    getApplications,
    getDeliveryPartners,
    getLogs,
    getOrders,
    getOverview,
    getReadyForPickupOrders,
    getUsers,
    rejectApplication,
} from "../controllers/adminController.js";
import { authenticate } from "../middleware/authenticate.js";
import { authorize } from "../middleware/authorize.js";

const router = Router();

router.use(authenticate, authorize(ROLES.ADMIN));
router.get("/overview", getOverview);
router.get("/restaurants/applications", getApplications);
router.post(
    "/restaurants/applications/:applicationId/approve",
    approveApplication
);
router.post(
    "/restaurants/applications/:applicationId/reject",
    rejectApplication
);
router.get("/users", getUsers);
router.get("/orders", getOrders);
router.get("/logs", getLogs);
router.get("/delivery-partners", getDeliveryPartners);
router.get("/orders/ready-for-pickup", getReadyForPickupOrders);
router.post("/orders/:orderId/assign", assignOrderToPartner);

export default router;

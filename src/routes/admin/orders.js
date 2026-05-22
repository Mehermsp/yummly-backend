import { Router } from "express";

import {
    getOrders,
    getOrderById,
    updateOrderStatus,
    assignDeliveryPartner,
    getReadyForPickupOrders,
} from "../../controllers/admin/adminOrderController.js";

const router = Router();

router.get("/", getOrders);

router.get(
    "/pending",
    (req, res, next) => {
        req.query.status = "ready";
        next();
    },
    getOrders
);

router.get("/ready-for-pickup", getReadyForPickupOrders);

router.get("/:id", getOrderById);

router.put("/:id/status", updateOrderStatus);

router.put("/:id/assign", assignDeliveryPartner);

export default router;

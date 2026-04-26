import express from "express";
import {
    getAvailableOrders,
    acceptOrder,
    updateLocation,
    markDelivered,
} from "../controllers/deliveryController.js";
import { authenticate, requireRole } from "../middleware/auth.js";

const router = express.Router();

router.use(authenticate, requireRole("delivery_partner"));

router.get("/available-orders", getAvailableOrders);
router.post("/orders/:id/accept", acceptOrder);
router.post("/orders/:id/deliver", markDelivered);
router.post("/location", updateLocation);

export default router;

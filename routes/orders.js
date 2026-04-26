import express from "express";
import {
    createOrder,
    getUserOrders,
    getOrderById,
    cancelOrder,
    trackOrder,
} from "../controllers/orderController.js";
import { authenticate, requireRole } from "../middleware/auth.js";

const router = express.Router();

router.use(authenticate);

router.post("/", requireRole("customer"), createOrder);
router.get("/", requireRole("customer"), getUserOrders);
router.get("/:id", requireRole("customer"), getOrderById);
router.post("/:id/cancel", requireRole("customer"), cancelOrder);
router.get(
    "/:id/track",
    requireRole("customer", "delivery_partner"),
    trackOrder
);

export default router;

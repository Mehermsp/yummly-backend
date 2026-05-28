import { Router } from "express";
import adminRoutes from "./adminRoutes.js";
import authRoutes from "./auth.js";
import cartRoutes from "./cart.js";
import customerRoutes from "./customer.js";
import deliveryRoutes from "./delivery.js";
import notificationRoutes from "./notifications.js";
import orderRoutes from "./orders.js";
import paymentRoutes from "./payment.js";
import restaurantRoutes from "./restaurant.js";
import restaurantsRoutes from "./restaurants.js";
import reviewRoutes from "./reviews.js";
import supportRoutes from "./support.js";

const router = Router();

router.use("/auth", authRoutes);
router.use("/admin", adminRoutes);
router.use("/customer", customerRoutes);
router.use("/restaurant", restaurantRoutes);
router.use("/restaurants", restaurantsRoutes);
router.use("/orders", orderRoutes);
router.use("/cart", cartRoutes);
router.use("/delivery", deliveryRoutes);
router.use("/notifications", notificationRoutes);
router.use("/reviews", reviewRoutes);
router.use("/payment", paymentRoutes);
router.use("/support", supportRoutes);

// Health check
router.get("/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
});

export default router;

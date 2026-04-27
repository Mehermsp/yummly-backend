import { Router } from "express";
import adminRoutes from "./admin.js";
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

const router = Router();

router.use("/auth", authRoutes);
router.use("/customer", customerRoutes);
router.use("/orders", orderRoutes);
router.use("/delivery", deliveryRoutes);
router.use("/restaurant", restaurantRoutes);
router.use("/restaurants", restaurantsRoutes);
router.use("/admin", adminRoutes);
router.use("/payment", paymentRoutes);
router.use("/cart", cartRoutes);
router.use("/notifications", notificationRoutes);
router.use("/reviews", reviewRoutes);

export default router;

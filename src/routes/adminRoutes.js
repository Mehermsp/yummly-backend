import { Router } from "express";
import * as adminController from "../controllers/adminController.js";
import { ROLES } from "../constants/index.js";
import { authenticate } from "../middleware/authenticate.js";
import { authorize } from "../middleware/authorize.js";

const router = Router();

// Apply authentication and admin role check to all routes
router.use(authenticate);
router.use(authorize(ROLES.ADMIN));

// Dashboard & Statistics
router.get("/statistics", adminController.getStatistics);

// Restaurant Applications
router.get("/applications", adminController.getApplications);
router.get("/applications/:id", adminController.getApplicationById);
router.put("/applications/:id/approve", adminController.approveApplication);
router.put("/applications/:id/reject", adminController.rejectApplication);

// Restaurants Management
router.get("/restaurants", adminController.getRestaurants);
router.get("/restaurants/:id", adminController.getRestaurantById);
router.put("/restaurants/:id/status", adminController.updateRestaurantStatus);
router.put("/restaurants/:id", adminController.updateRestaurant);

// Orders Management
router.get("/orders", adminController.getOrders);
router.get("/orders/pending", (req, res) => {
    req.query.status = "pending";
    return adminController.getOrders(req, res);
});
router.get("/orders/:id", adminController.getOrderById);
router.put("/orders/:id/status", adminController.updateOrderStatus);
router.put("/orders/:id/assign", adminController.assignDeliveryPartner);

// Delivery Partners Management
router.get("/delivery-partners", adminController.getDeliveryPartners);
router.get("/delivery-partners/:id", adminController.getDeliveryPartnerById);
router.put("/delivery-partners/:id/status", adminController.updateDeliveryPartnerStatus);
router.put("/delivery-partners/:id", adminController.updateDeliveryPartner);

// Settings Management
router.get("/settings/general", adminController.getGeneralSettings);
router.put("/settings/general", adminController.updateGeneralSettings);
router.get("/settings/notifications", adminController.getNotificationSettings);
router.put("/settings/notifications", adminController.updateNotificationSettings);
router.get("/settings/security", adminController.getSecuritySettings);
router.put("/settings/security", adminController.updateSecuritySettings);
router.get("/settings/restaurant-commission", adminController.getRestaurantCommission);
router.put("/settings/restaurant-commission", adminController.updateRestaurantCommission);
router.get("/settings/delivery", adminController.getDeliverySettings);
router.put("/settings/delivery", adminController.updateDeliverySettings);

export default router;

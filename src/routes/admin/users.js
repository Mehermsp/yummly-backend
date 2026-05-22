import { Router } from "express";

import {
    getUsers,
    getUserById,
    updateUserStatus,
    updateUserRole,
    deleteUser,
    getDeliveryPartners,
    getDeliveryPartnerById,
    updateDeliveryPartnerStatus,
    getDeliveryPartnerAnalytics,
} from "../../controllers/admin/adminUserController.js";

const router = Router();

// Users
router.get("/", getUsers);

router.get("/:id", getUserById);

router.put("/:id/status", updateUserStatus);

router.put("/:id/role", updateUserRole);

router.delete("/:id", deleteUser);

// Delivery Partners
router.get("/delivery-partners/all", getDeliveryPartners);

router.get("/delivery-partners/analytics", getDeliveryPartnerAnalytics);

router.get("/delivery-partners/:id", getDeliveryPartnerById);

router.put("/delivery-partners/:id/status", updateDeliveryPartnerStatus);

export default router;

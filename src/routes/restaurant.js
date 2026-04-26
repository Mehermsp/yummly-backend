import { Router } from "express";
import { ROLES } from "../constants/index.js";
import {
    createPartnerMenuItem,
    deletePartnerMenuItem,
    getPartnerDashboard,
    getPartnerMenu,
    submitApplication,
    updatePartnerMenuItem,
} from "../controllers/restaurantController.js";
import { authenticate } from "../middleware/authenticate.js";
import { authorize } from "../middleware/authorize.js";

const router = Router();

router.use(authenticate, authorize(ROLES.RESTAURANT_PARTNER));
router.get("/dashboard", getPartnerDashboard);
router.post("/applications", submitApplication);
router.get("/menu", getPartnerMenu);
router.post("/menu", createPartnerMenuItem);
router.put("/menu/:itemId", updatePartnerMenuItem);
router.delete("/menu/:itemId", deletePartnerMenuItem);

export default router;

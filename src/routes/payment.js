import { Router } from "express";
import { ROLES } from "../constants/index.js";
import {
    completeMockPaymentAndPlaceOrder,
    getMockPaymentConfig,
    selectPaymentMethod,
} from "../controllers/paymentController.js";
import { authenticate } from "../middleware/authenticate.js";
import { authorize } from "../middleware/authorize.js";

const router = Router();

router.use(authenticate);
router.use(authorize(ROLES.CUSTOMER));
router.get("/mock/config", getMockPaymentConfig);
router.post("/mock/complete", completeMockPaymentAndPlaceOrder);

export default router;

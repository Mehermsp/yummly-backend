import { Router } from "express";
import { authenticate } from "../middleware/authenticate.js";
import { authorize } from "../middleware/authorize.js";
import { ROLES } from "../constants/index.js";
import {
    createRazorpayOrder,
    getRazorpayConfig,
    verifyPaymentAndPlaceOrder,
} from "../controllers/paymentController.js";

const router = Router();

router.use(authenticate);
router.use(authorize(ROLES.CUSTOMER));

router.get("/razorpay/config", getRazorpayConfig);
router.post("/razorpay/order", createRazorpayOrder);
router.post("/razorpay/verify-and-place-order", verifyPaymentAndPlaceOrder);

export default router;

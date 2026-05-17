import { Router } from "express";
import { ROLES } from "../constants/index.js";
import {
    createRazorpayOrder,
    renderRazorpayCheckout,
    verifyPaymentAndPlaceOrder,
} from "../controllers/paymentController.js";
import { authenticate } from "../middleware/authenticate.js";
import { authorize } from "../middleware/authorize.js";

const router = Router();

router.get("/razorpay/checkout", renderRazorpayCheckout);

router.use(authenticate);
router.use(authorize(ROLES.CUSTOMER));
router.post("/razorpay/order", createRazorpayOrder);
router.post("/razorpay/verify-and-place-order", verifyPaymentAndPlaceOrder);

export default router;

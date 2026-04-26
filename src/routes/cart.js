import { Router } from "express";
import { ROLES } from "../constants/index.js";
import {
    addCartItem,
    deleteCartItem,
    getCart,
    updateCartItem,
} from "../controllers/cartController.js";
import { authenticate } from "../middleware/authenticate.js";
import { authorize } from "../middleware/authorize.js";

const router = Router();

router.use(authenticate, authorize(ROLES.CUSTOMER));
router.get("/", getCart);
router.post("/items", addCartItem);
router.patch("/items/:cartItemId", updateCartItem);
router.delete("/items/:cartItemId", deleteCartItem);

export default router;

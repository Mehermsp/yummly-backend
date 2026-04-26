import { Router } from "express";
import { ROLES } from "../constants/index.js";
import {
    addWishlist,
    createCustomerAddress,
    getAddresses,
    getWishlist,
    removeWishlist,
} from "../controllers/customerController.js";
import { authenticate } from "../middleware/authenticate.js";
import { authorize } from "../middleware/authorize.js";

const router = Router();

router.use(authenticate, authorize(ROLES.CUSTOMER));
router.get("/addresses", getAddresses);
router.post("/addresses", createCustomerAddress);
router.get("/wishlist", getWishlist);
router.post("/wishlist", addWishlist);
router.delete("/wishlist/:wishlistId", removeWishlist);

export default router;

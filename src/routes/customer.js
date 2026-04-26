import { Router } from "express";
import { ROLES } from "../constants/index.js";
import {
    addWishlist,
    createCustomerAddress,
    deleteCustomerAddress,
    getAddresses,
    getWishlist,
    markDefaultCustomerAddress,
    removeWishlist,
    updateCustomerAddress,
} from "../controllers/customerController.js";
import { authenticate } from "../middleware/authenticate.js";
import { authorize } from "../middleware/authorize.js";

const router = Router();

router.use(authenticate, authorize(ROLES.CUSTOMER));
router.get("/addresses", getAddresses);
router.post("/addresses", createCustomerAddress);
router.put("/addresses/:addressId", updateCustomerAddress);
router.delete("/addresses/:addressId", deleteCustomerAddress);
router.patch("/addresses/:addressId/default", markDefaultCustomerAddress);
router.get("/wishlist", getWishlist);
router.post("/wishlist", addWishlist);
router.delete("/wishlist/:wishlistId", removeWishlist);

export default router;

import { Router } from "express";

import { ROLES } from "../constants/index.js";

import { authenticate } from "../middleware/authenticate.js";

import { authorize } from "../middleware/authorize.js";

// ==============================
// ADDRESS CONTROLLERS
// ==============================

import {
    getAddresses,
    createCustomerAddress,
    updateCustomerAddress,
    deleteCustomerAddress,
    markDefaultCustomerAddress,
} from "../controllers/customer/addressController.js";

// ==============================
// WISHLIST CONTROLLERS
// ==============================

import {
    getWishlist,
    addWishlist,
    removeWishlist,
} from "../controllers/customer/wishlistController.js";

const router = Router();

router.use(authenticate, authorize(ROLES.CUSTOMER));

// =====================================================
// ADDRESS ROUTES
// =====================================================

router.get("/addresses", getAddresses);

router.post("/addresses", createCustomerAddress);

router.put("/addresses/:addressId", updateCustomerAddress);

router.delete("/addresses/:addressId", deleteCustomerAddress);

router.patch("/addresses/:addressId/default", markDefaultCustomerAddress);

// =====================================================
// WISHLIST ROUTES
// =====================================================

router.get("/wishlist", getWishlist);

router.post("/wishlist", addWishlist);

router.delete("/wishlist/:wishlistId", removeWishlist);

export default router;

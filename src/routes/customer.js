import { Router } from "express";

import { ROLES } from "../constants/index.js";

import { authenticate } from "../middleware/authenticate.js";
import { validateRequest } from "../middleware/validation.js";

import { authorize } from "../middleware/authorize.js";

import {
    getRestaurantDetails,
    getRestaurantMenuItems,
    listRestaurants,
} from "../controllers/restaurantsController.js";
import { getProfile, updateProfile } from "../controllers/customer/profileController.js";
import { updateProfileSchema } from "../validators/profileValidator.js";
import {
  listMethods,
  addMethod,
  removeMethod,
  setDefaultMethod,
} from "../controllers/customer/paymentMethodController.js";
import { addPaymentMethodSchema } from "../validators/paymentMethodValidator.js";

import {
    addCartItem,
    clearCustomerCart,
    deleteCartItem,
    getCart,
    updateCartItem,
} from "../controllers/cartController.js";

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

// Backward-compatible customer catalog aliases used by older clients.
router.get("/restaurants", listRestaurants);
router.get("/restaurants/:restaurantId", getRestaurantDetails);
router.get("/restaurants/:restaurantId/menu", getRestaurantMenuItems);

router.use(authenticate, authorize(ROLES.CUSTOMER));

// PROFILE ROUTES
router.get("/profile", getProfile);
router.put("/profile", updateProfileSchema, validateRequest, updateProfile);

// PAYMENT METHOD ROUTES
router.get("/payment-methods", listMethods);
router.post("/payment-methods", addPaymentMethodSchema, validateRequest, addMethod);
router.delete("/payment-methods/:methodId", removeMethod);
router.patch("/payment-methods/:methodId/default", setDefaultMethod);

// Backward-compatible customer cart aliases. Canonical routes live under /api/cart.
router.get("/cart", getCart);
router.delete("/cart", clearCustomerCart);
router.post("/cart", addCartItem);
router.post("/cart/items", addCartItem);
router.patch("/cart/items/:cartItemId", updateCartItem);
router.delete("/cart/items/:cartItemId", deleteCartItem);

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

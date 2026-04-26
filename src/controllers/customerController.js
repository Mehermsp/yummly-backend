import { asyncHandler } from "../utils/asyncHandler.js";
import { AppError, sendSuccess } from "../utils/http.js";
import {
    addWishlistRestaurant,
    createAddress,
    getAddressById,
    listAddresses,
    listWishlist,
    removeWishlistRestaurant,
} from "../models/customerModel.js";

export const getAddresses = asyncHandler(async (req, res) => {
    const items = await listAddresses(req.user.id);
    sendSuccess(res, items, "Addresses fetched successfully");
});

export const createCustomerAddress = asyncHandler(async (req, res) => {
    const { street, city, pincode } = req.body;
    if (!street || !city || !pincode) {
        throw new AppError(400, "street, city and pincode are required");
    }

    const addressId = await createAddress(req.user.id, req.body);
    const address = await getAddressById(req.user.id, addressId);
    sendSuccess(res, address, "Address created successfully", 201);
});

export const getWishlist = asyncHandler(async (req, res) => {
    const items = await listWishlist(req.user.id);
    sendSuccess(res, items, "Wishlist fetched successfully");
});

export const addWishlist = asyncHandler(async (req, res) => {
    if (!req.body.menuItemId) {
        throw new AppError(400, "menuItemId is required");
    }

    await addWishlistRestaurant(req.user.id, req.body.menuItemId);
    const items = await listWishlist(req.user.id);
    sendSuccess(res, items, "Item added to wishlist");
});

export const removeWishlist = asyncHandler(async (req, res) => {
    await removeWishlistRestaurant(req.user.id, req.params.wishlistId);
    const items = await listWishlist(req.user.id);
    sendSuccess(res, items, "Item removed from wishlist");
});

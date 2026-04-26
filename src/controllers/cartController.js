import { asyncHandler } from "../utils/asyncHandler.js";
import { AppError, sendSuccess } from "../utils/http.js";
import {
    findMenuItemForCart,
    getCartForUser,
    getCartRestaurant,
    removeCartItem,
    upsertCartItem,
} from "../models/cartModel.js";

export const getCart = asyncHandler(async (req, res) => {
    const items = await getCartForUser(req.user.id);
    const subtotal = items.reduce((sum, item) => sum + Number(item.total_price), 0);
    sendSuccess(
        res,
        {
            items,
            summary: {
                subtotal,
                deliveryFee: subtotal >= 400 || subtotal === 0 ? 0 : 35,
                taxAmount: Number((subtotal * 0.05).toFixed(2)),
            },
        },
        "Cart fetched successfully"
    );
});

export const addCartItem = asyncHandler(async (req, res) => {
    const { menuItemId, quantity } = req.body;
    if (!menuItemId || !quantity) {
        throw new AppError(400, "menuItemId and quantity are required");
    }

    const menuItem = await findMenuItemForCart(menuItemId);
    if (!menuItem || !menuItem.is_available || !menuItem.is_active) {
        throw new AppError(400, "Menu item is not available");
    }

    const existingCartRestaurant = await getCartRestaurant(req.user.id);
    if (
        existingCartRestaurant &&
        existingCartRestaurant.restaurant_id !== menuItem.restaurant_id
    ) {
        throw new AppError(
            409,
            "Cart already contains items from another restaurant"
        );
    }

    const unitPrice = Number(menuItem.price);
    const totalPrice = Number((unitPrice * Number(quantity)).toFixed(2));

    await upsertCartItem({
        userId: req.user.id,
        restaurantId: menuItem.restaurant_id,
        menuItemId,
        quantity,
        unitPrice,
        totalPrice,
    });

    const items = await getCartForUser(req.user.id);
    sendSuccess(res, items, "Cart updated successfully");
});

export const updateCartItem = asyncHandler(async (req, res) => {
    const { menuItemId, restaurantId, unitPrice, quantity } = req.body;
    if (!menuItemId || !restaurantId || !unitPrice || !quantity || quantity < 1) {
        throw new AppError(400, "menuItemId, restaurantId, unitPrice and valid quantity are required");
    }

    await upsertCartItem({
        userId: req.user.id,
        restaurantId,
        menuItemId,
        quantity,
        unitPrice,
        totalPrice: Number((unitPrice * quantity).toFixed(2)),
    });
    const items = await getCartForUser(req.user.id);
    sendSuccess(res, items, "Cart item updated successfully");
});

export const deleteCartItem = asyncHandler(async (req, res) => {
    await removeCartItem(req.user.id, req.params.cartItemId);
    const items = await getCartForUser(req.user.id);
    sendSuccess(res, items, "Cart item removed");
});

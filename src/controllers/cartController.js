import { asyncHandler } from "../utils/asyncHandler.js";
import { AppError, sendSuccess } from "../utils/http.js";
import {
    clearCart,
    findMenuItemForCart,
    getCartForUser,
    getCartItemById,
    getCartRestaurant,
    removeCartItem,
    upsertCartItem,
} from "../models/cartModel.js";

const buildCartResponse = (items = []) => {
    const subtotal = items.reduce(
        (sum, item) => sum + Number(item.total_price || 0),
        0
    );
    const deliveryFee = subtotal >= 400 || subtotal === 0 ? 0 : 35;
    const taxAmount = Number((subtotal * 0.05).toFixed(2));

    return {
        items,
        summary: {
            subtotal,
            deliveryFee,
            taxAmount,
            total: Number((subtotal + deliveryFee + taxAmount).toFixed(2)),
        },
    };
};

export const getCart = asyncHandler(async (req, res) => {
    const items = await getCartForUser(req.user.id);
    sendSuccess(res, buildCartResponse(items), "Cart fetched successfully");
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

    const safeQuantity = Math.max(1, Number(quantity));
    const unitPrice = Number(menuItem.price);
    const totalPrice = Number((unitPrice * safeQuantity).toFixed(2));

    await upsertCartItem({
        userId: req.user.id,
        restaurantId: menuItem.restaurant_id,
        menuItemId,
        quantity: safeQuantity,
        unitPrice,
        totalPrice,
    });

    const items = await getCartForUser(req.user.id);
    sendSuccess(
        res,
        buildCartResponse(items),
        "Cart updated successfully"
    );
});

export const updateCartItem = asyncHandler(async (req, res) => {
    const safeQuantity = Number(req.body.quantity);
    if (!Number.isFinite(safeQuantity)) {
        throw new AppError(400, "quantity is required");
    }

    const existing = await getCartItemById(req.user.id, req.params.cartItemId);
    if (!existing) {
        throw new AppError(404, "Cart item not found");
    }

    if (safeQuantity <= 0) {
        await removeCartItem(req.user.id, req.params.cartItemId);
    } else {
        await upsertCartItem({
            userId: req.user.id,
            restaurantId: existing.restaurant_id,
            menuItemId: existing.menu_item_id,
            quantity: safeQuantity,
            unitPrice: Number(existing.unit_price),
            totalPrice: Number(
                (Number(existing.unit_price) * safeQuantity).toFixed(2)
            ),
        });
    }

    const items = await getCartForUser(req.user.id);
    sendSuccess(
        res,
        buildCartResponse(items),
        "Cart item updated successfully"
    );
});

export const deleteCartItem = asyncHandler(async (req, res) => {
    await removeCartItem(req.user.id, req.params.cartItemId);
    const items = await getCartForUser(req.user.id);
    sendSuccess(res, buildCartResponse(items), "Cart item removed");
});

export const clearCustomerCart = asyncHandler(async (req, res) => {
    await clearCart(req.user.id);
    sendSuccess(res, buildCartResponse([]), "Cart cleared successfully");
});

import { asyncHandler } from "../utils/asyncHandler.js";
import { AppError, sendSuccess } from "../utils/http.js";
import {
    clearCart,
    findMenuItemForCart,
    getCartForUser,
    getCartItemById,
    getCartItemByMenuId,
    getCartRestaurant,
    removeCartItem,
    removeCartItemByMenuId,
    upsertCartItem,
} from "../models/cartModel.js";
import {
    buildCartResponse,
    validateMenuItemForCart,
    addOrUpdateCartItem,
} from "../services/cart/cartService.js";


export const getCart = asyncHandler(async (req, res) => {
    const items = await getCartForUser(req.user.id);
    sendSuccess(res, buildCartResponse(items), "Cart fetched successfully");
});

export const addCartItem = asyncHandler(async (req, res) => {
    const { menuItemId, quantity } = req.body;

    if (!menuItemId || !quantity) {
        throw new AppError(400, "menuItemId and quantity are required");
    }

    const menuItem = await validateMenuItemForCart({
        userId: req.user.id,

        menuItemId,
    });

    const cart = await addOrUpdateCartItem({
        userId: req.user.id,

        menuItemId,

        quantity,

        unitPrice: Number(menuItem.price),

        restaurantId: menuItem.restaurant_id,
    });

    sendSuccess(res, cart, "Cart updated successfully");
});

export const updateCartItem = asyncHandler(async (req, res) => {
    const safeQuantity = Number(req.body.quantity);
    if (!Number.isFinite(safeQuantity)) {
        throw new AppError(400, "quantity is required");
    }

    const cartItemId = Number(req.params.cartItemId);
    if (!Number.isFinite(cartItemId) || cartItemId <= 0) {
        throw new AppError(400, "cartItemId is invalid");
    }

    let existing = await getCartItemById(req.user.id, cartItemId);
    let lookupMode = "cart_id";

    // Backward compatibility:
    // Some clients send menu_id in :cartItemId path param.
    if (!existing) {
        existing = await getCartItemByMenuId(req.user.id, cartItemId);
        if (existing) {
            lookupMode = "menu_id";
        }
    }

    if (!existing) {
        // Recovery path for stale IDs:
        // treat path param as menu_items.id and upsert cart row.
        const menuItem = await findMenuItemForCart(cartItemId);
        if (menuItem && menuItem.is_available && menuItem.is_active) {
            const existingCartRestaurant = await getCartRestaurant(req.user.id);
            if (
                !existingCartRestaurant ||
                Number(existingCartRestaurant.restaurant_id) ===
                    Number(menuItem.restaurant_id)
            ) {
                await upsertCartItem({
                    userId: req.user.id,
                    restaurantId: menuItem.restaurant_id,
                    menuItemId: cartItemId,
                    quantity: Math.max(1, safeQuantity),
                    unitPrice: Number(menuItem.price),
                    totalPrice: Number(
                        (Number(menuItem.price) * Math.max(1, safeQuantity)).toFixed(2)
                    ),
                });
                const recoveredItems = await getCartForUser(req.user.id);
                sendSuccess(
                    res,
                    buildCartResponse(recoveredItems),
                    "Cart item updated successfully"
                );
                return;
            }
        }

        // Idempotent behavior for stale clients: return latest cart instead of 404.
        const latestItems = await getCartForUser(req.user.id);
        sendSuccess(
            res,
            buildCartResponse(latestItems),
            "Cart item not found; returning latest cart"
        );
        return;
    }

    if (safeQuantity <= 0) {
        if (lookupMode === "menu_id") {
            await removeCartItemByMenuId(req.user.id, existing.menu_item_id);
        } else {
            await removeCartItem(req.user.id, existing.id);
        }
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
    const cartItemId = Number(req.params.cartItemId);
    if (!Number.isFinite(cartItemId) || cartItemId <= 0) {
        throw new AppError(400, "cartItemId is invalid");
    }

    const byCartId = await getCartItemById(req.user.id, cartItemId);
    if (byCartId) {
        await removeCartItem(req.user.id, byCartId.id);
    } else {
        const byMenuId = await getCartItemByMenuId(req.user.id, cartItemId);
        if (byMenuId) {
            await removeCartItemByMenuId(req.user.id, byMenuId.menu_item_id);
        }
    }

    const items = await getCartForUser(req.user.id);
    sendSuccess(res, buildCartResponse(items), "Cart item removed");
});

export const clearCustomerCart = asyncHandler(async (req, res) => {
    await clearCart(req.user.id);
    sendSuccess(res, buildCartResponse([]), "Cart cleared successfully");
});

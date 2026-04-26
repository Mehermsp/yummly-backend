import { getOne, query } from "../config/db.js";

export const getCartForUser = async (userId) =>
    query(
        `
        SELECT
            ci.id,
            ci.quantity,
            ci.unit_price,
            ci.total_price,
            mi.id AS menu_item_id,
            mi.name,
            mi.description,
            mi.image_url,
            mi.price,
            mi.discount_percent,
            r.id AS restaurant_id,
            r.name AS restaurant_name
        FROM cart_items ci
        INNER JOIN menu_items mi ON mi.id = ci.menu_item_id
        INNER JOIN restaurants r ON r.id = ci.restaurant_id
        WHERE ci.user_id = ?
        ORDER BY ci.created_at DESC
        `,
        [userId]
    );

export const findMenuItemForCart = async (menuItemId) =>
    getOne(
        `
        SELECT
            mi.id,
            mi.restaurant_id,
            mi.name,
            mi.price,
            mi.discount_percent,
            mi.is_available,
            r.is_active,
            r.is_open
        FROM menu_items mi
        INNER JOIN restaurants r ON r.id = mi.restaurant_id
        WHERE mi.id = ? AND mi.is_deleted = 0
        LIMIT 1
        `,
        [menuItemId]
    );

export const getCartRestaurant = async (userId) =>
    getOne(
        `
        SELECT restaurant_id
        FROM cart_items
        WHERE user_id = ?
        LIMIT 1
        `,
        [userId]
    );

export const upsertCartItem = async ({
    userId,
    restaurantId,
    menuItemId,
    quantity,
    unitPrice,
    totalPrice,
}) =>
    query(
        `
        INSERT INTO cart_items (
            user_id,
            restaurant_id,
            menu_item_id,
            quantity,
            unit_price,
            total_price
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
            quantity = VALUES(quantity),
            unit_price = VALUES(unit_price),
            total_price = VALUES(total_price),
            updated_at = CURRENT_TIMESTAMP
        `,
        [userId, restaurantId, menuItemId, quantity, unitPrice, totalPrice]
    );

export const removeCartItem = async (userId, cartItemId) =>
    query(`DELETE FROM cart_items WHERE id = ? AND user_id = ?`, [
        cartItemId,
        userId,
    ]);

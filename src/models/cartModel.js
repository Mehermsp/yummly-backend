import { getOne, query } from "../config/db.js";

export const getCartForUser = async (userId) =>
    query(
        `
        SELECT
            c.id,
            c.quantity,
            c.unit_price,
            c.total_price,
            c.menu_item_id,
            mi.name,
            mi.description,
            mi.image_url,
            mi.price,
            mi.discount_percent,
            r.id AS restaurant_id,
            r.name AS restaurant_name
        FROM cart_items c
        INNER JOIN menu_items mi ON mi.id = c.menu_item_id
        INNER JOIN restaurants r ON r.id = mi.restaurant_id
        WHERE c.user_id = ?
        ORDER BY c.id DESC
        `,
        [userId]
    );

export const getCartItemById = async (userId, cartItemId) =>
    getOne(
        `
        SELECT
            c.*,
            c.menu_item_id,
            c.unit_price,
            mi.restaurant_id
        FROM cart_items c
        INNER JOIN menu_items mi ON mi.id = c.menu_item_id
        WHERE c.id = ? AND c.user_id = ?
        LIMIT 1
        `,
        [cartItemId, userId]
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
            COALESCE(mi.is_available, 1) AS is_available,
            COALESCE(mi.is_deleted, 0) AS is_deleted,
            r.is_active,
            r.is_open
        FROM menu_items mi
        INNER JOIN restaurants r ON r.id = mi.restaurant_id
        WHERE mi.id = ?
        LIMIT 1
        `,
        [menuItemId]
    );

export const getCartRestaurant = async (userId) =>
    getOne(
        `
        SELECT restaurant_id
        FROM cart_items c
        INNER JOIN menu_items mi ON mi.id = c.menu_item_id
        WHERE c.user_id = ?
        LIMIT 1
        `,
        [userId]
    );

export const upsertCartItem = async ({
    userId,
    menuItemId,
    quantity,
    unitPrice,
    totalPrice,
}) => {
    const existing = await getOne(
        `
        SELECT id
        FROM cart_items
        WHERE user_id = ? AND menu_item_id = ?
        LIMIT 1
        `,
        [userId, menuItemId]
    );

    if (existing) {
        return query(
            `
            UPDATE cart_items
            SET quantity = ?, unit_price = ?, total_price = ?
            WHERE id = ? AND user_id = ?
            `,
            [quantity, unitPrice, totalPrice, existing.id, userId]
        );
    }

    return query(
        `
        INSERT INTO cart_items (
            user_id,
            restaurant_id,
            menu_item_id,
            quantity,
            unit_price,
            total_price
        )
        SELECT ?, mi.restaurant_id, mi.id, ?, ?, ?
        FROM menu_items mi
        WHERE mi.id = ?
        `,
        [userId, quantity, unitPrice, totalPrice, menuItemId]
    );
};

export const removeCartItem = async (userId, cartItemId) =>
    query(`DELETE FROM cart_items WHERE id = ? AND user_id = ?`, [
        cartItemId,
        userId,
    ]);

export const clearCart = async (userId) =>
    query(`DELETE FROM cart_items WHERE user_id = ?`, [userId]);

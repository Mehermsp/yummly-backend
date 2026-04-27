import { getOne, query } from "../config/db.js";

export const getCartForUser = async (userId) =>
    query(
        `
        SELECT
            c.id,
            c.qty AS quantity,
            c.price AS unit_price,
            ROUND(c.price * c.qty, 2) AS total_price,
            c.menu_id AS menu_item_id,
            mi.name,
            mi.description,
            mi.image AS image_url,
            mi.price,
            mi.discount AS discount_percent,
            r.id AS restaurant_id,
            r.name AS restaurant_name
        FROM carts c
        INNER JOIN menu_items mi ON mi.id = c.menu_id
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
            c.menu_id AS menu_item_id,
            c.price AS unit_price,
            mi.restaurant_id
        FROM carts c
        INNER JOIN menu_items mi ON mi.id = c.menu_id
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
            mi.discount AS discount_percent,
            COALESCE(mi.is_available, mi.available, 1) AS is_available,
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
        FROM carts c
        INNER JOIN menu_items mi ON mi.id = c.menu_id
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
    totalPrice: _totalPrice,
}) => {
    const existing = await getOne(
        `
        SELECT id
        FROM carts
        WHERE user_id = ? AND menu_id = ?
        LIMIT 1
        `,
        [userId, menuItemId]
    );

    if (existing) {
        return query(
            `
            UPDATE carts
            SET qty = ?, price = ?
            WHERE id = ? AND user_id = ?
            `,
            [quantity, unitPrice, existing.id, userId]
        );
    }

    return query(
        `
        INSERT INTO carts (user_id, menu_id, name, price, qty)
        SELECT ?, mi.id, mi.name, ?, ?
        FROM menu_items mi
        WHERE mi.id = ?
        `,
        [userId, unitPrice, quantity, menuItemId]
    );
};

export const removeCartItem = async (userId, cartItemId) =>
    query(`DELETE FROM carts WHERE id = ? AND user_id = ?`, [
        cartItemId,
        userId,
    ]);

export const clearCart = async (userId) =>
    query(`DELETE FROM carts WHERE user_id = ?`, [userId]);

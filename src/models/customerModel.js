import { getOne, query } from "../config/db.js";

export const listAddresses = async (userId) =>
    query(
        `
        SELECT *
        FROM addresses
        WHERE user_id = ?
        ORDER BY is_default DESC, created_at DESC
        `,
        [userId]
    );

export const createAddress = async (userId, payload) => {
    const result = await query(
        `
        INSERT INTO addresses (
            user_id,
            label,
            door_no,
            street,
            area,
            city,
            state,
            pincode,
            landmark,
            latitude,
            longitude,
            is_default
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
            userId,
            payload.label || "Home",
            payload.doorNo || null,
            payload.street,
            payload.area || null,
            payload.city,
            payload.state || null,
            payload.pincode,
            payload.landmark || null,
            payload.latitude || null,
            payload.longitude || null,
            payload.isDefault ? 1 : 0,
        ]
    );

    if (payload.isDefault) {
        await query(
            `
            UPDATE addresses
            SET is_default = CASE WHEN id = ? THEN 1 ELSE 0 END
            WHERE user_id = ?
            `,
            [result.insertId, userId]
        );
    }

    return result.insertId;
};

export const getAddressById = async (userId, addressId) =>
    getOne(
        `
        SELECT *
        FROM addresses
        WHERE id = ? AND user_id = ?
        LIMIT 1
        `,
        [addressId, userId]
    );

export const listWishlist = async (userId) =>
    query(
        `
        SELECT
            w.id,
            mi.id AS menu_id,
            mi.name,
            mi.price,
            mi.image_url AS image,
            mi.description,
            mi.category,
            mi.discount_percent AS discount,
            r.id AS restaurant_id,
            r.name AS restaurant_name
        FROM wishlists w
        INNER JOIN menu_items mi ON mi.id = w.menu_item_id
        INNER JOIN restaurants r ON r.id = mi.restaurant_id
        WHERE w.user_id = ?
        ORDER BY w.created_at DESC
        `,
        [userId]
    );

export const addWishlistRestaurant = async (userId, menuItemId) =>
    query(
        `
        INSERT IGNORE INTO wishlists (user_id, menu_item_id)
        VALUES (?, ?)
        `,
        [userId, menuItemId]
    );

export const removeWishlistRestaurant = async (userId, wishlistId) =>
    query(`DELETE FROM wishlists WHERE id = ? AND user_id = ?`, [
        wishlistId,
        userId,
    ]);

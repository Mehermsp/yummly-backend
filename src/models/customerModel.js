import { getOne, query } from "../config/db.js";

const resolveAddressPayload = (payload = {}) => ({
    label: payload.label || "Home",
    doorNo: payload.doorNo ?? payload.door_no ?? null,
    street: payload.street ?? "",
    area: payload.area ?? null,
    city: payload.city ?? "",
    state: payload.state ?? null,
    pincode: payload.pincode ?? payload.zip_code ?? "",
    landmark: payload.landmark ?? null,
    latitude: payload.latitude ?? null,
    longitude: payload.longitude ?? null,
    isDefault:
        payload.isDefault === true ||
        payload.is_default === true ||
        Number(payload.is_default) === 1,
});

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
    const address = resolveAddressPayload(payload);

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
            address.label,
            address.doorNo,
            address.street,
            address.area,
            address.city,
            address.state,
            address.pincode,
            address.landmark,
            address.latitude,
            address.longitude,
            address.isDefault ? 1 : 0,
        ]
    );

    if (address.isDefault) {
        await setDefaultAddress(userId, result.insertId);
    }

    return result.insertId;
};

export const updateAddress = async (userId, addressId, payload) => {
    const address = resolveAddressPayload(payload);

    await query(
        `
        UPDATE addresses
        SET
            label = ?,
            door_no = ?,
            street = ?,
            area = ?,
            city = ?,
            state = ?,
            pincode = ?,
            landmark = ?,
            latitude = ?,
            longitude = ?,
            is_default = ?
        WHERE id = ? AND user_id = ?
        `,
        [
            address.label,
            address.doorNo,
            address.street,
            address.area,
            address.city,
            address.state,
            address.pincode,
            address.landmark,
            address.latitude,
            address.longitude,
            address.isDefault ? 1 : 0,
            addressId,
            userId,
        ]
    );

    if (address.isDefault) {
        await setDefaultAddress(userId, addressId);
    }
};

export const deleteAddress = async (userId, addressId) =>
    query(`DELETE FROM addresses WHERE id = ? AND user_id = ?`, [
        addressId,
        userId,
    ]);

export const setDefaultAddress = async (userId, addressId) =>
    query(
        `
        UPDATE addresses
        SET is_default = CASE WHEN id = ? THEN 1 ELSE 0 END
        WHERE user_id = ?
        `,
        [addressId, userId]
    );

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
            w.id AS wishlist_id,
            w.menu_item_id,
            mi.id AS menu_id,
            mi.name,
            mi.price,
            mi.image_url AS image,
            mi.description,
            mi.category,
            mi.discount_percent AS discount,
            mi.restaurant_id,
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

export const removeWishlistRestaurant = async (
    userId,
    wishlistOrMenuItemId
) =>
    query(
        `
        DELETE FROM wishlists
        WHERE user_id = ?
          AND (id = ? OR menu_item_id = ?)
        `,
        [userId, wishlistOrMenuItemId, wishlistOrMenuItemId]
    );

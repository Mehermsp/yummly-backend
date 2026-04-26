import express from 'express';
import {
  asyncHandler,
  ValidationError,
  AppError,
  sendSuccess,
  sendPaginatedSuccess,
} from '../middleware/errorHandler.js';
import { authenticate, requireCustomer } from '../middleware/auth.js';
import { query, getOne, insert, update, deleteRow, transaction } from '../config/database.js';

const router = express.Router();

// =====================================================
// 1. GET RESTAURANTS (with pagination, filters)
// =====================================================

router.get('/restaurants', asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(50, parseInt(req.query.limit) || 10);
  const city = req.query.city;
  const search = req.query.search;
  const sort = req.query.sort || 'rating';

  const offset = (page - 1) * limit;
  let whereConditions = ['r.is_active = 1'];
  let params = [];

  if (city) {
    whereConditions.push('r.city = ?');
    params.push(city);
  }

  if (search) {
    whereConditions.push('(r.name LIKE ? OR r.cuisines LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }

  const whereClause = whereConditions.join(' AND ');

  // Get total count
  const countResult = await getOne(
    `SELECT COUNT(*) as total FROM restaurants r WHERE ${whereClause}`,
    params
  );
  const total = countResult?.total || 0;

  // Get paginated results
  let sortClause = 'r.rating DESC';
  if (sort === 'new') sortClause = 'r.created_at DESC';

  const restaurants = await query(
    `SELECT 
      r.id, r.name, r.email, r.phone, r.description,
      r.logo_url, r.city, r.area, r.cuisines, r.rating,
      r.total_orders, r.is_open,
      (SELECT COUNT(*) FROM menu_items WHERE restaurant_id = r.id AND is_available = 1) as available_items
    FROM restaurants r
    WHERE ${whereClause}
    ORDER BY ${sortClause}
    LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  // Parse cuisines JSON
  const restaurantData = restaurants.map(r => ({
    ...r,
    cuisines: typeof r.cuisines === 'string' ? JSON.parse(r.cuisines) : r.cuisines,
  }));

  sendPaginatedSuccess(res, restaurantData, { page, limit, total });
}));

// =====================================================
// 2. GET RESTAURANT DETAILS
// =====================================================

router.get('/restaurants/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;

  const restaurant = await getOne(
    `SELECT 
      r.* 
    FROM restaurants r
    WHERE r.id = ? AND r.is_active = 1`,
    [id]
  );

  if (!restaurant) {
    throw new AppError('Restaurant not found', 404);
  }

  // Parse JSON fields
  restaurant.cuisines = typeof restaurant.cuisines === 'string' ? JSON.parse(restaurant.cuisines) : restaurant.cuisines;
  restaurant.days_open = typeof restaurant.days_open === 'string' ? JSON.parse(restaurant.days_open) : restaurant.days_open;

  sendSuccess(res, restaurant);
}));

// =====================================================
// 3. GET RESTAURANT MENU
// =====================================================

router.get('/restaurants/:restaurantId/menu', asyncHandler(async (req, res) => {
  const { restaurantId } = req.params;
  const category = req.query.category;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(50, parseInt(req.query.limit) || 20);
  const offset = (page - 1) * limit;

  // Verify restaurant exists
  const restaurant = await getOne(
    'SELECT id FROM restaurants WHERE id = ? AND is_active = 1',
    [restaurantId]
  );

  if (!restaurant) {
    throw new AppError('Restaurant not found', 404);
  }

  // Get categories
  let categoryQuery = 'SELECT DISTINCT category FROM menu_items WHERE restaurant_id = ? AND is_available = 1 AND category IS NOT NULL';
  const categories = await query(categoryQuery, [restaurantId]);

  // Get items
  let whereClause = 'restaurant_id = ? AND is_available = 1';
  let params = [restaurantId];

  if (category) {
    whereClause += ' AND category = ?';
    params.push(category);
  }

  const countResult = await getOne(
    `SELECT COUNT(*) as total FROM menu_items WHERE ${whereClause}`,
    params
  );
  const total = countResult?.total || 0;

  const items = await query(
    `SELECT 
      id, name, description, price, discount_percent,
      category, meal_type, food_type, image_url, rating, popularity
    FROM menu_items
    WHERE ${whereClause}
    ORDER BY popularity DESC, rating DESC
    LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  sendPaginatedSuccess(res, {
    categories: categories.map(c => c.category),
    items,
  }, { page, limit, total });
}));

// =====================================================
// 4. SEARCH MENU ITEMS
// =====================================================

router.get('/restaurants/:restaurantId/search', asyncHandler(async (req, res) => {
  const { restaurantId } = req.params;
  const q = req.query.q;

  if (!q || q.trim().length < 2) {
    throw new ValidationError('Search term minimum 2 characters');
  }

  const items = await query(
    `SELECT id, name, description, price, discount_percent,
      category, image_url, rating FROM menu_items
    WHERE restaurant_id = ? AND is_available = 1 AND (name LIKE ? OR description LIKE ?)
    ORDER BY rating DESC, popularity DESC
    LIMIT 20`,
    [restaurantId, `%${q}%`, `%${q}%`]
  );

  sendSuccess(res, items);
}));

// =====================================================
// 5. GET CART
// =====================================================

router.get('/cart', authenticate, requireCustomer, asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const cartItems = await query(
    `SELECT 
      c.id, c.menu_item_id, c.quantity, c.item_price, c.restaurant_id,
      m.name, m.image_url, m.description,
      r.name as restaurant_name, r.delivery_fee
    FROM carts c
    JOIN menu_items m ON c.menu_item_id = m.id
    JOIN restaurants r ON c.restaurant_id = r.id
    WHERE c.user_id = ?
    ORDER BY c.added_at DESC`,
    [userId]
  );

  if (cartItems.length === 0) {
    sendSuccess(res, { items: [], subtotal: 0, tax: 0, delivery: 0, total: 0 });
    return;
  }

  const restaurantId = cartItems[0].restaurant_id;
  const subtotal = cartItems.reduce((sum, item) => sum + (item.item_price * item.quantity), 0);
  const tax = Math.round(subtotal * 0.05 * 100) / 100; // 5% tax
  const delivery = cartItems[0].delivery_fee || 0;
  const total = subtotal + tax + delivery;

  sendSuccess(res, {
    items: cartItems,
    restaurantId,
    subtotal,
    tax,
    delivery,
    total,
  });
}));

// =====================================================
// 6. ADD TO CART
// =====================================================

router.post('/cart', authenticate, requireCustomer, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { restaurantId, menuItemId, quantity = 1 } = req.body;

  if (!restaurantId || !menuItemId) {
    throw new ValidationError('restaurantId and menuItemId required');
  }

  if (quantity < 1 || quantity > 99) {
    throw new ValidationError('Quantity must be between 1 and 99');
  }

  // Verify menu item exists and get price
  const menuItem = await getOne(
    'SELECT id, price, restaurant_id, is_available FROM menu_items WHERE id = ? AND is_available = 1',
    [menuItemId]
  );

  if (!menuItem) {
    throw new AppError('Menu item not available', 404);
  }

  if (menuItem.restaurant_id !== parseInt(restaurantId)) {
    throw new ValidationError('Menu item does not belong to this restaurant');
  }

  // Check if user has items from different restaurant
  const differentRestaurant = await getOne(
    'SELECT id FROM carts WHERE user_id = ? AND restaurant_id != ?',
    [userId, restaurantId]
  );

  if (differentRestaurant) {
    // Clear cart for new restaurant
    await deleteRow('carts', { user_id: userId });
  }

  // Add or update cart item
  const existing = await getOne(
    'SELECT id, quantity FROM carts WHERE user_id = ? AND menu_item_id = ?',
    [userId, menuItemId]
  );

  if (existing) {
    await update('carts', { quantity: existing.quantity + quantity }, { id: existing.id });
  } else {
    await insert('carts', {
      user_id: userId,
      restaurant_id: restaurantId,
      menu_item_id: menuItemId,
      quantity,
      item_price: menuItem.price,
    });
  }

  sendSuccess(res, { success: true, message: 'Item added to cart' }, 'Item added', 201);
}));

// =====================================================
// 7. UPDATE CART ITEM QUANTITY
// =====================================================

router.put('/cart/:cartItemId', authenticate, requireCustomer, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { cartItemId } = req.params;
  const { quantity } = req.body;

  if (!quantity || quantity < 0) {
    throw new ValidationError('Valid quantity required');
  }

  // Verify ownership
  const cartItem = await getOne('SELECT user_id FROM carts WHERE id = ?', [cartItemId]);
  if (!cartItem || cartItem.user_id !== userId) {
    throw new AppError('Cart item not found', 404);
  }

  if (quantity === 0) {
    await deleteRow('carts', { id: cartItemId });
  } else {
    await update('carts', { quantity }, { id: cartItemId });
  }

  sendSuccess(res, { success: true });
}));

// =====================================================
// 8. REMOVE FROM CART
// =====================================================

router.delete('/cart/:cartItemId', authenticate, requireCustomer, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { cartItemId } = req.params;

  // Verify ownership
  const cartItem = await getOne('SELECT user_id FROM carts WHERE id = ?', [cartItemId]);
  if (!cartItem || cartItem.user_id !== userId) {
    throw new AppError('Cart item not found', 404);
  }

  await deleteRow('carts', { id: cartItemId });

  sendSuccess(res, { success: true });
}));

// =====================================================
// 9. CLEAR CART
// =====================================================

router.delete('/cart', authenticate, requireCustomer, asyncHandler(async (req, res) => {
  const userId = req.user.id;

  await deleteRow('carts', { user_id: userId });

  sendSuccess(res, { success: true });
}));

// =====================================================
// 10. ADD TO WISHLIST
// =====================================================

router.post('/wishlist/:menuItemId', authenticate, requireCustomer, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { menuItemId } = req.params;

  // Verify menu item exists
  const menuItem = await getOne(
    'SELECT id, restaurant_id FROM menu_items WHERE id = ?',
    [menuItemId]
  );

  if (!menuItem) {
    throw new AppError('Menu item not found', 404);
  }

  // Check if already in wishlist
  const existing = await getOne(
    'SELECT id FROM wishlists WHERE user_id = ? AND menu_item_id = ?',
    [userId, menuItemId]
  );

  if (existing) {
    sendSuccess(res, { success: true, message: 'Already in wishlist' });
    return;
  }

  await insert('wishlists', {
    user_id: userId,
    menu_item_id: menuItemId,
    restaurant_id: menuItem.restaurant_id,
  });

  sendSuccess(res, { success: true }, 'Added to wishlist', 201);
}));

// =====================================================
// 11. GET WISHLIST
// =====================================================

router.get('/wishlist', authenticate, requireCustomer, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(50, parseInt(req.query.limit) || 10);
  const offset = (page - 1) * limit;

  const countResult = await getOne('SELECT COUNT(*) as total FROM wishlists WHERE user_id = ?', [userId]);
  const total = countResult?.total || 0;

  const items = await query(
    `SELECT 
      w.id, w.menu_item_id, w.restaurant_id,
      m.name, m.description, m.price, m.image_url, m.rating,
      r.name as restaurant_name
    FROM wishlists w
    JOIN menu_items m ON w.menu_item_id = m.id
    JOIN restaurants r ON w.restaurant_id = r.id
    WHERE w.user_id = ?
    ORDER BY w.created_at DESC
    LIMIT ? OFFSET ?`,
    [userId, limit, offset]
  );

  sendPaginatedSuccess(res, items, { page, limit, total });
}));

// =====================================================
// 12. REMOVE FROM WISHLIST
// =====================================================

router.delete('/wishlist/:menuItemId', authenticate, requireCustomer, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { menuItemId } = req.params;

  await deleteRow('wishlists', { user_id: userId, menu_item_id: menuItemId });

  sendSuccess(res, { success: true });
}));

// =====================================================
// 13. GET ADDRESSES
// =====================================================

router.get('/addresses', authenticate, requireCustomer, asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const addresses = await query(
    'SELECT id, label, door_no, street, area, city, state, pincode, landmark, latitude, longitude, is_default FROM addresses WHERE user_id = ? ORDER BY is_default DESC, created_at DESC',
    [userId]
  );

  sendSuccess(res, addresses);
}));

// =====================================================
// 14. ADD ADDRESS
// =====================================================

router.post('/addresses', authenticate, requireCustomer, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { label, door_no, street, area, city, state, pincode, landmark, latitude, longitude } = req.body;

  if (!area || !city || !pincode) {
    throw new ValidationError('area, city, pincode required');
  }

  const addressId = await insert('addresses', {
    user_id: userId,
    label: label || 'Home',
    door_no: door_no || null,
    street: street || null,
    area,
    city,
    state: state || null,
    pincode,
    landmark: landmark || null,
    latitude: latitude || null,
    longitude: longitude || null,
    is_default: 0,
  });

  sendSuccess(res, { id: addressId }, 'Address added', 201);
}));

// =====================================================
// 15. UPDATE ADDRESS
// =====================================================

router.put('/addresses/:addressId', authenticate, requireCustomer, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { addressId } = req.params;

  // Verify ownership
  const address = await getOne('SELECT user_id FROM addresses WHERE id = ?', [addressId]);
  if (!address || address.user_id !== userId) {
    throw new AppError('Address not found', 404);
  }

  const { label, door_no, street, area, city, state, pincode, landmark, latitude, longitude } = req.body;

  await update('addresses', {
    label: label || undefined,
    door_no: door_no || undefined,
    street: street || undefined,
    area: area || undefined,
    city: city || undefined,
    state: state || undefined,
    pincode: pincode || undefined,
    landmark: landmark || undefined,
    latitude: latitude || undefined,
    longitude: longitude || undefined,
  }, { id: addressId });

  sendSuccess(res, { success: true });
}));

// =====================================================
// 16. DELETE ADDRESS
// =====================================================

router.delete('/addresses/:addressId', authenticate, requireCustomer, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { addressId } = req.params;

  // Verify ownership
  const address = await getOne('SELECT user_id FROM addresses WHERE id = ?', [addressId]);
  if (!address || address.user_id !== userId) {
    throw new AppError('Address not found', 404);
  }

  await deleteRow('addresses', { id: addressId });

  sendSuccess(res, { success: true });
}));

// =====================================================
// 17. SET DEFAULT ADDRESS
// =====================================================

router.patch('/addresses/:addressId/default', authenticate, requireCustomer, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { addressId } = req.params;

  // Verify ownership
  const address = await getOne('SELECT user_id FROM addresses WHERE id = ?', [addressId]);
  if (!address || address.user_id !== userId) {
    throw new AppError('Address not found', 404);
  }

  // Clear other defaults
  await query('UPDATE addresses SET is_default = 0 WHERE user_id = ?', [userId]);

  // Set as default
  await update('addresses', { is_default: 1 }, { id: addressId });



// =====================================================
// 1. GET RESTAURANTS (with pagination, filters)
// =====================================================

router.get(
    "/restaurants",
    asyncHandler(async (req, res) => {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(50, parseInt(req.query.limit) || 10);
        const city = req.query.city;
        const search = req.query.search;
        const sort = req.query.sort || "rating";

        const offset = (page - 1) * limit;
        let whereConditions = ["r.is_active = 1"];
        let params = [];

        if (city) {
            whereConditions.push("r.city = ?");
            params.push(city);
        }

        if (search) {
            whereConditions.push("(r.name LIKE ? OR r.cuisines LIKE ?)");
            params.push(`%${search}%`, `%${search}%`);
        }

        const whereClause = whereConditions.join(" AND ");

        // Get total count
        const countResult = await getOne(
            `SELECT COUNT(*) as total FROM restaurants r WHERE ${whereClause}`,
            params
        );
        const total = countResult?.total || 0;

        // Get paginated results
        let sortClause = "r.rating DESC";
        if (sort === "new") sortClause = "r.created_at DESC";

        const restaurants = await query(
            `SELECT 
      r.id, r.name, r.email, r.phone, r.description,
      r.logo_url, r.city, r.area, r.cuisines, r.rating,
      r.total_orders, r.is_open,
      (SELECT COUNT(*) FROM menu_items WHERE restaurant_id = r.id AND is_available = 1) as available_items
    FROM restaurants r
    WHERE ${whereClause}
    ORDER BY ${sortClause}
    LIMIT ? OFFSET ?`,
            [...params, limit, offset]
        );

        // Parse cuisines JSON
        const restaurantData = restaurants.map((r) => ({
            ...r,
            cuisines:
                typeof r.cuisines === "string"
                    ? JSON.parse(r.cuisines)
                    : r.cuisines,
        }));

        sendPaginatedSuccess(res, restaurantData, { page, limit, total });
    })
);

// =====================================================
// 2. GET RESTAURANT DETAILS
// =====================================================

router.get(
    "/restaurants/:id",
    asyncHandler(async (req, res) => {
        const { id } = req.params;

        const restaurant = await getOne(
            `SELECT 
      r.* 
    FROM restaurants r
    WHERE r.id = ? AND r.is_active = 1`,
            [id]
        );

        if (!restaurant) {
            throw new AppError("Restaurant not found", 404);
        }

        // Parse JSON fields
        restaurant.cuisines =
            typeof restaurant.cuisines === "string"
                ? JSON.parse(restaurant.cuisines)
                : restaurant.cuisines;
        restaurant.days_open =
            typeof restaurant.days_open === "string"
                ? JSON.parse(restaurant.days_open)
                : restaurant.days_open;

        sendSuccess(res, restaurant);
    })
);

// =====================================================
// 3. GET RESTAURANT MENU
// =====================================================

router.get(
    "/restaurants/:restaurantId/menu",
    asyncHandler(async (req, res) => {
        const { restaurantId } = req.params;
        const category = req.query.category;
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(50, parseInt(req.query.limit) || 20);
        const offset = (page - 1) * limit;

        // Verify restaurant exists
        const restaurant = await getOne(
            "SELECT id FROM restaurants WHERE id = ? AND is_active = 1",
            [restaurantId]
        );

        if (!restaurant) {
            throw new AppError("Restaurant not found", 404);
        }

        // Get categories
        let categoryQuery =
            "SELECT DISTINCT category FROM menu_items WHERE restaurant_id = ? AND is_available = 1 AND category IS NOT NULL";
        const categories = await query(categoryQuery, [restaurantId]);

        // Get items
        let whereClause = "restaurant_id = ? AND is_available = 1";
        let params = [restaurantId];

        if (category) {
            whereClause += " AND category = ?";
            params.push(category);
        }

        const countResult = await getOne(
            `SELECT COUNT(*) as total FROM menu_items WHERE ${whereClause}`,
            params
        );
        const total = countResult?.total || 0;

        const items = await query(
            `SELECT 
      id, name, description, price, discount_percent,
      category, meal_type, food_type, image_url, rating, popularity
    FROM menu_items
    WHERE ${whereClause}
    ORDER BY popularity DESC, rating DESC
    LIMIT ? OFFSET ?`,
            [...params, limit, offset]
        );

        sendPaginatedSuccess(
            res,
            {
                categories: categories.map((c) => c.category),
                items,
            },
            { page, limit, total }
        );
    })
);

// =====================================================
// 4. SEARCH MENU ITEMS
// =====================================================

router.get(
    "/restaurants/:restaurantId/search",
    asyncHandler(async (req, res) => {
        const { restaurantId } = req.params;
        const q = req.query.q;

        if (!q || q.trim().length < 2) {
            throw new ValidationError("Search term minimum 2 characters");
        }

        const items = await query(
            `SELECT id, name, description, price, discount_percent,
      category, image_url, rating FROM menu_items
    WHERE restaurant_id = ? AND is_available = 1 AND (name LIKE ? OR description LIKE ?)
    ORDER BY rating DESC, popularity DESC
    LIMIT 20`,
            [restaurantId, `%${q}%`, `%${q}%`]
        );

        sendSuccess(res, items);
    })
);

// =====================================================
// 5. GET CART
// =====================================================

router.get(
    "/cart",
    authenticate,
    requireCustomer,
    asyncHandler(async (req, res) => {
        const userId = req.user.id;

        const cartItems = await query(
            `SELECT 
      c.id, c.menu_item_id, c.quantity, c.item_price, c.restaurant_id,
      m.name, m.image_url, m.description,
      r.name as restaurant_name, r.delivery_fee
    FROM carts c
    JOIN menu_items m ON c.menu_item_id = m.id
    JOIN restaurants r ON c.restaurant_id = r.id
    WHERE c.user_id = ?
    ORDER BY c.added_at DESC`,
            [userId]
        );

        if (cartItems.length === 0) {
            sendSuccess(res, {
                items: [],
                subtotal: 0,
                tax: 0,
                delivery: 0,
                total: 0,
            });
            return;
        }

        const restaurantId = cartItems[0].restaurant_id;
        const subtotal = cartItems.reduce(
            (sum, item) => sum + item.item_price * item.quantity,
            0
        );
        const tax = Math.round(subtotal * 0.05 * 100) / 100; // 5% tax
        const delivery = cartItems[0].delivery_fee || 0;
        const total = subtotal + tax + delivery;

        sendSuccess(res, {
            items: cartItems,
            restaurantId,
            subtotal,
            tax,
            delivery,
            total,
        });
    })
);

// =====================================================
// 6. ADD TO CART
// =====================================================

router.post(
    "/cart",
    authenticate,
    requireCustomer,
    asyncHandler(async (req, res) => {
        const userId = req.user.id;
        const { restaurantId, menuItemId, quantity = 1 } = req.body;

        if (!restaurantId || !menuItemId) {
            throw new ValidationError("restaurantId and menuItemId required");
        }

        if (quantity < 1 || quantity > 99) {
            throw new ValidationError("Quantity must be between 1 and 99");
        }

        // Verify menu item exists and get price
        const menuItem = await getOne(
            "SELECT id, price, restaurant_id, is_available FROM menu_items WHERE id = ? AND is_available = 1",
            [menuItemId]
        );

        if (!menuItem) {
            throw new AppError("Menu item not available", 404);
        }

        if (menuItem.restaurant_id !== parseInt(restaurantId)) {
            throw new ValidationError(
                "Menu item does not belong to this restaurant"
            );
        }

        // Check if user has items from different restaurant
        const differentRestaurant = await getOne(
            "SELECT id FROM carts WHERE user_id = ? AND restaurant_id != ?",
            [userId, restaurantId]
        );

        if (differentRestaurant) {
            // Clear cart for new restaurant
            await deleteRow("carts", { user_id: userId });
        }

        // Add or update cart item
        const existing = await getOne(
            "SELECT id, quantity FROM carts WHERE user_id = ? AND menu_item_id = ?",
            [userId, menuItemId]
        );

        if (existing) {
            await update(
                "carts",
                { quantity: existing.quantity + quantity },
                { id: existing.id }
            );
        } else {
            await insert("carts", {
                user_id: userId,
                restaurant_id: restaurantId,
                menu_item_id: menuItemId,
                quantity,
                item_price: menuItem.price,
            });
        }

        sendSuccess(
            res,
            { success: true, message: "Item added to cart" },
            "Item added",
            201
        );
    })
);

// =====================================================
// 7. UPDATE CART ITEM QUANTITY
// =====================================================

router.put(
    "/cart/:cartItemId",
    authenticate,
    requireCustomer,
    asyncHandler(async (req, res) => {
        const userId = req.user.id;
        const { cartItemId } = req.params;
        const { quantity } = req.body;

        if (!quantity || quantity < 0) {
            throw new ValidationError("Valid quantity required");
        }

        // Verify ownership
        const cartItem = await getOne(
            "SELECT user_id FROM carts WHERE id = ?",
            [cartItemId]
        );
        if (!cartItem || cartItem.user_id !== userId) {
            throw new AppError("Cart item not found", 404);
        }

        if (quantity === 0) {
            await deleteRow("carts", { id: cartItemId });
        } else {
            await update("carts", { quantity }, { id: cartItemId });
        }

        sendSuccess(res, { success: true });
    })
);

// =====================================================
// 8. REMOVE FROM CART
// =====================================================

router.delete(
    "/cart/:cartItemId",
    authenticate,
    requireCustomer,
    asyncHandler(async (req, res) => {
        const userId = req.user.id;
        const { cartItemId } = req.params;

        // Verify ownership
        const cartItem = await getOne(
            "SELECT user_id FROM carts WHERE id = ?",
            [cartItemId]
        );
        if (!cartItem || cartItem.user_id !== userId) {
            throw new AppError("Cart item not found", 404);
        }

        await deleteRow("carts", { id: cartItemId });

        sendSuccess(res, { success: true });
    })
);

// =====================================================
// 9. CLEAR CART
// =====================================================

router.delete(
    "/cart",
    authenticate,
    requireCustomer,
    asyncHandler(async (req, res) => {
        const userId = req.user.id;

        await deleteRow("carts", { user_id: userId });

        sendSuccess(res, { success: true });
    })
);

// =====================================================
// 10. ADD TO WISHLIST
// =====================================================

router.post(
    "/wishlist/:menuItemId",
    authenticate,
    requireCustomer,
    asyncHandler(async (req, res) => {
        const userId = req.user.id;
        const { menuItemId } = req.params;

        // Verify menu item exists
        const menuItem = await getOne(
            "SELECT id, restaurant_id FROM menu_items WHERE id = ?",
            [menuItemId]
        );

        if (!menuItem) {
            throw new AppError("Menu item not found", 404);
        }

        // Check if already in wishlist
        const existing = await getOne(
            "SELECT id FROM wishlists WHERE user_id = ? AND menu_item_id = ?",
            [userId, menuItemId]
        );

        if (existing) {
            sendSuccess(res, { success: true, message: "Already in wishlist" });
            return;
        }

        await insert("wishlists", {
            user_id: userId,
            menu_item_id: menuItemId,
            restaurant_id: menuItem.restaurant_id,
        });

        sendSuccess(res, { success: true }, "Added to wishlist", 201);
    })
);

// =====================================================
// 11. GET WISHLIST
// =====================================================

router.get(
    "/wishlist",
    authenticate,
    requireCustomer,
    asyncHandler(async (req, res) => {
        const userId = req.user.id;
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(50, parseInt(req.query.limit) || 10);
        const offset = (page - 1) * limit;

        const countResult = await getOne(
            "SELECT COUNT(*) as total FROM wishlists WHERE user_id = ?",
            [userId]
        );
        const total = countResult?.total || 0;

        const items = await query(
            `SELECT 
      w.id, w.menu_item_id, w.restaurant_id,
      m.name, m.description, m.price, m.image_url, m.rating,
      r.name as restaurant_name
    FROM wishlists w
    JOIN menu_items m ON w.menu_item_id = m.id
    JOIN restaurants r ON w.restaurant_id = r.id
    WHERE w.user_id = ?
    ORDER BY w.created_at DESC
    LIMIT ? OFFSET ?`,
            [userId, limit, offset]
        );

        sendPaginatedSuccess(res, items, { page, limit, total });
    })
);

// =====================================================
// 12. REMOVE FROM WISHLIST
// =====================================================

router.delete(
    "/wishlist/:menuItemId",
    authenticate,
    requireCustomer,
    asyncHandler(async (req, res) => {
        const userId = req.user.id;
        const { menuItemId } = req.params;

        await deleteRow("wishlists", {
            user_id: userId,
            menu_item_id: menuItemId,
        });

        sendSuccess(res, { success: true });
    })
);

// =====================================================
// 13. GET ADDRESSES
// =====================================================

router.get(
    "/addresses",
    authenticate,
    requireCustomer,
    asyncHandler(async (req, res) => {
        const userId = req.user.id;

        const addresses = await query(
            "SELECT id, label, door_no, street, area, city, state, pincode, landmark, latitude, longitude, is_default FROM addresses WHERE user_id = ? ORDER BY is_default DESC, created_at DESC",
            [userId]
        );

        sendSuccess(res, addresses);
    })
);

// =====================================================
// 14. ADD ADDRESS
// =====================================================

router.post(
    "/addresses",
    authenticate,
    requireCustomer,
    asyncHandler(async (req, res) => {
        const userId = req.user.id;
        const {
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
        } = req.body;

        if (!area || !city || !pincode) {
            throw new ValidationError("area, city, pincode required");
        }

        const addressId = await insert("addresses", {
            user_id: userId,
            label: label || "Home",
            door_no: door_no || null,
            street: street || null,
            area,
            city,
            state: state || null,
            pincode,
            landmark: landmark || null,
            latitude: latitude || null,
            longitude: longitude || null,
            is_default: 0,
        });

        sendSuccess(res, { id: addressId }, "Address added", 201);
    })
);

// =====================================================
// 15. UPDATE ADDRESS
// =====================================================

router.put(
    "/addresses/:addressId",
    authenticate,
    requireCustomer,
    asyncHandler(async (req, res) => {
        const userId = req.user.id;
        const { addressId } = req.params;

        // Verify ownership
        const address = await getOne(
            "SELECT user_id FROM addresses WHERE id = ?",
            [addressId]
        );
        if (!address || address.user_id !== userId) {
            throw new AppError("Address not found", 404);
        }

        const {
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
        } = req.body;

        await update(
            "addresses",
            {
                label: label || undefined,
                door_no: door_no || undefined,
                street: street || undefined,
                area: area || undefined,
                city: city || undefined,
                state: state || undefined,
                pincode: pincode || undefined,
                landmark: landmark || undefined,
                latitude: latitude || undefined,
                longitude: longitude || undefined,
            },
            { id: addressId }
        );

        sendSuccess(res, { success: true });
    })
);

// =====================================================
// 16. DELETE ADDRESS
// =====================================================

router.delete(
    "/addresses/:addressId",
    authenticate,
    requireCustomer,
    asyncHandler(async (req, res) => {
        const userId = req.user.id;
        const { addressId } = req.params;

        // Verify ownership
        const address = await getOne(
            "SELECT user_id FROM addresses WHERE id = ?",
            [addressId]
        );
        if (!address || address.user_id !== userId) {
            throw new AppError("Address not found", 404);
        }

        await deleteRow("addresses", { id: addressId });

        sendSuccess(res, { success: true });
    })
);

// =====================================================
// 17. SET DEFAULT ADDRESS
// =====================================================

router.patch(
    "/addresses/:addressId/default",
    authenticate,
    requireCustomer,
    asyncHandler(async (req, res) => {
        const userId = req.user.id;
        const { addressId } = req.params;

        // Verify ownership
        const address = await getOne(
            "SELECT user_id FROM addresses WHERE id = ?",
            [addressId]
        );
        if (!address || address.user_id !== userId) {
            throw new AppError("Address not found", 404);
        }

        // Clear other defaults
        await query("UPDATE addresses SET is_default = 0 WHERE user_id = ?", [
            userId,
        ]);

        // Set as default
        await update("addresses", { is_default: 1 }, { id: addressId });

        sendSuccess(res, { success: true });
    })
);

export default router;

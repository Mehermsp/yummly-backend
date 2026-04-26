import pool from "../config/database.js";

export const createOrder = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const {
            cartData,
            deliveryAddressId,
            paymentMethod,
            restaurantId,
            totalAmount,
        } = req.body;

        if (!cartData || cartData.length === 0) {
            return res
                .status(400)
                .json({ success: false, error: "Cart is empty" });
        }

        const connection = await pool.getConnection();
        await connection.beginTransaction();

        try {
            // Create the main order record
            const [orderResult] = await connection.query(
                `INSERT INTO orders (user_id, restaurant_id, total_amount, status, payment_method, delivery_address_id) 
         VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    userId,
                    restaurantId,
                    totalAmount,
                    "placed",
                    paymentMethod,
                    deliveryAddressId,
                ]
            );

            const orderId = orderResult.insertId;

            // Create order items
            const orderItemsValues = cartData.map((item) => [
                orderId,
                item.menuItemId,
                item.quantity,
                item.price,
            ]);
            await connection.query(
                `INSERT INTO order_items (order_id, menu_item_id, quantity, price) VALUES ?`,
                [orderItemsValues]
            );

            // Log order status
            await connection.query(
                `INSERT INTO order_status_logs (order_id, status, changed_by) VALUES (?, ?, ?)`,
                [orderId, "placed", userId]
            );

            await connection.commit();

            res.status(201).json({
                success: true,
                data: {
                    orderId,
                    orderNumber: `ORD-${orderId}`,
                    estimatedTime: "45 mins",
                },
                message: "Order placed successfully",
            });
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    } catch (error) {
        next(error);
    }
};

export const getUserOrders = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;

        const [orders] = await pool.query(
            `SELECT id, total_amount, status, created_at 
       FROM orders WHERE user_id = ? 
       ORDER BY created_at DESC LIMIT ? OFFSET ?`,
            [userId, limit, offset]
        );

        res.status(200).json({
            success: true,
            data: orders,
        });
    } catch (error) {
        next(error);
    }
};

export const getOrderById = async (req, res, next) => {
    try {
        const orderId = req.params.id;
        const userId = req.user.id;

        const [orders] = await pool.query(
            `SELECT * FROM orders WHERE id = ? AND user_id = ?`,
            [orderId, userId]
        );

        if (orders.length === 0) {
            return res
                .status(404)
                .json({ success: false, error: "Order not found" });
        }

        const [items] = await pool.query(
            `SELECT * FROM order_items WHERE order_id = ?`,
            [orderId]
        );

        res.status(200).json({
            success: true,
            data: {
                order: orders[0],
                items,
            },
        });
    } catch (error) {
        next(error);
    }
};

export const cancelOrder = async (req, res, next) => {
    // Implement order cancellation logic
    res.status(200).json({
        success: true,
        message: "Order cancellation logic pending",
    });
};

export const trackOrder = async (req, res, next) => {
    // In a real production app, this would query Socket.IO references or real-time location sets
    res.status(200).json({
        success: true,
        data: {
            status: "preparing",
            eta: "30 mins",
            coordinates: { latitude: 0, longitude: 0 },
        },
    });
};

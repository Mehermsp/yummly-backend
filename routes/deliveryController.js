import pool from "../config/database.js";

export const getAvailableOrders = async (req, res, next) => {
    try {
        // Fetch orders that are 'ready' but not yet assigned
        const [orders] = await pool.query(
            `SELECT o.id, o.restaurant_id, o.total_amount, o.status, o.created_at, r.name as restaurant_name 
       FROM orders o 
       LEFT JOIN delivery_assignments da ON o.id = da.order_id 
       JOIN restaurants r ON o.restaurant_id = r.id
       WHERE o.status = 'ready' AND da.id IS NULL
       ORDER BY o.created_at DESC`
        );

        res.status(200).json({
            success: true,
            data: orders,
        });
    } catch (error) {
        next(error);
    }
};

export const acceptOrder = async (req, res, next) => {
    try {
        const partnerId = req.user.id;
        const orderId = req.params.id;

        const connection = await pool.getConnection();
        await connection.beginTransaction();

        try {
            // Assign the order to this partner
            await connection.query(
                `INSERT INTO delivery_assignments (order_id, delivery_partner_id, status) VALUES (?, ?, 'assigned')`,
                [orderId, partnerId]
            );

            // Update overall order status
            await connection.query(
                `UPDATE orders SET status = 'out_for_delivery' WHERE id = ?`,
                [orderId]
            );

            await connection.commit();
            res.status(200).json({
                success: true,
                message: "Order accepted for delivery",
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

export const markDelivered = async (req, res, next) => {
    try {
        const partnerId = req.user.id;
        const orderId = req.params.id;

        // Update both the assignment and the master order state
        await pool.query(
            `UPDATE orders SET status = 'delivered' WHERE id = ?`,
            [orderId]
        );
        await pool.query(
            `UPDATE delivery_assignments SET status = 'delivered' WHERE order_id = ? AND delivery_partner_id = ?`,
            [orderId, partnerId]
        );

        res.status(200).json({
            success: true,
            message: "Order marked as delivered",
        });
    } catch (error) {
        next(error);
    }
};

export const updateLocation = async (req, res, next) => {
    res.status(200).json({
        success: true,
        message: "Location updated successfully",
    });
};

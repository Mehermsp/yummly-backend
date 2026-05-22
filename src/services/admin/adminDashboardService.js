import { query } from "../../config/db.js";

export const getDashboardStatistics = async () => {
    const restaurants = await query(`
        SELECT COUNT(*) as total
        FROM restaurants
        WHERE is_approved = 1 OR is_active = 1
    `);

    const applications = await query(`
        SELECT COUNT(*) as total
        FROM restaurant_applications
        WHERE status = 'pending'
    `);

    const orders = await query(`
        SELECT COUNT(*) as total
        FROM orders
    `);

    const partners = await query(`
        SELECT COUNT(*) as total
        FROM users
        WHERE role = 'delivery_partner'
        AND is_available = 1
    `);

    const revenue = await query(`
        SELECT COALESCE(SUM(total), 0) as total
        FROM orders
        WHERE status = 'delivered'
    `);

    const ordersToday = await query(`
        SELECT COUNT(*) as total
        FROM orders
        WHERE DATE(created_at) = CURDATE()
    `);

    return {
        total_restaurants: Number(restaurants[0]?.total || 0),
        pending_applications: Number(applications[0]?.total || 0),
        total_orders: Number(orders[0]?.total || 0),
        total_revenue: Number(revenue[0]?.total || 0),
        active_delivery_partners: Number(partners[0]?.total || 0),
        orders_today: Number(ordersToday[0]?.total || 0),
    };
};

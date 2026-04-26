import { getOne, withTransaction } from "../config/db.js";

export const getReviewByOrderId = async (orderId) =>
    getOne(`SELECT * FROM reviews WHERE order_id = ? LIMIT 1`, [orderId]);

export const createReview = async ({
    orderId,
    customerId,
    restaurantId,
    deliveryPartnerId,
    restaurantRating,
    restaurantComment,
    deliveryRating,
    deliveryComment,
}) =>
    withTransaction(async (connection) => {
        await connection.execute(
            `
            INSERT INTO reviews (
                order_id,
                customer_id,
                restaurant_id,
                delivery_partner_id,
                restaurant_rating,
                restaurant_comment,
                delivery_rating,
                delivery_comment
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
                orderId,
                customerId,
                restaurantId,
                deliveryPartnerId || null,
                restaurantRating,
                restaurantComment || null,
                deliveryRating || null,
                deliveryComment || null,
            ]
        );

        await connection.execute(
            `
            UPDATE restaurants r
            JOIN (
                SELECT restaurant_id, AVG(restaurant_rating) AS avg_rating
                FROM reviews
                WHERE restaurant_id = ?
            ) agg ON agg.restaurant_id = r.id
            SET r.rating = ROUND(agg.avg_rating, 2)
            WHERE r.id = ?
            `,
            [restaurantId, restaurantId]
        );

        if (deliveryPartnerId && deliveryRating) {
            await connection.execute(
                `
                UPDATE users u
                JOIN (
                    SELECT delivery_partner_id, AVG(delivery_rating) AS avg_rating, COUNT(*) AS delivery_count
                    FROM reviews
                    WHERE delivery_partner_id = ? AND delivery_rating IS NOT NULL
                ) agg ON agg.delivery_partner_id = u.id
                SET u.delivery_rating = ROUND(agg.avg_rating, 2),
                    u.total_deliveries = agg.delivery_count
                WHERE u.id = ?
                `,
                [deliveryPartnerId, deliveryPartnerId]
            );
        }
    });

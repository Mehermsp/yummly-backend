import { getOne, withTransaction } from "../config/db.js";

export const getReviewByOrderId = async (orderId) =>
    getOne(`SELECT * FROM reviews WHERE order_id = ? LIMIT 1`, [orderId]);

export const createReview = async ({
    orderId,
    customerId,
    restaurantId,
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
                user_id,
                restaurant_id,
                rating,
                comment,
                delivery_rating,
                delivery_comment
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `,
            [
                orderId,
                customerId,
                restaurantId,
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
                SELECT restaurant_id, AVG(rating) AS avg_rating
                FROM reviews
                WHERE restaurant_id = ?
            ) agg ON agg.restaurant_id = r.id
            SET r.rating = ROUND(agg.avg_rating, 2)
            WHERE r.id = ?
            `,
            [restaurantId, restaurantId]
        );
    });

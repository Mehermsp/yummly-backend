import { getOne, query, withTransaction } from "../../config/db.js";
import { getRestaurantByOwnerId } from "../../models/restaurantModel.js";
import { AppError } from "../../utils/http.js";

const DEFAULT_COMMISSION_PERCENT = 15;
const DEFAULT_DELIVERY_BASE_PERCENT = 70;

const money = (value) => Number(Number(value || 0).toFixed(2));
const positiveMoney = (value) => Math.max(0, money(value));
const safeJson = (value) => JSON.stringify(value || {});

const getCommissionPercent = async (connection) => {
    try {
        const executor = connection || { execute: async (sql, params) => [await query(sql, params)] };
        const [rows] = await executor.execute(
            `
            SELECT setting_value
            FROM admin_settings
            WHERE setting_key IN ('commission_rate', 'commission_percentage')
            ORDER BY FIELD(setting_key, 'commission_rate', 'commission_percentage')
            LIMIT 1
            `
        );
        const value = Number(rows[0]?.setting_value);
        return Number.isFinite(value) && value >= 0
            ? value
            : DEFAULT_COMMISSION_PERCENT;
    } catch {
        return DEFAULT_COMMISSION_PERCENT;
    }
};

const insertFinancialLog = async (
    connection,
    {
        transactionType,
        entityType,
        entityId,
        orderId = null,
        amount,
        currency = "INR",
        direction,
        referenceType = null,
        referenceId = null,
        idempotencyKey,
        metadata = {},
        createdBy = null,
    }
) =>
    connection.execute(
        `
        INSERT INTO financial_transaction_logs (
            transaction_type,
            entity_type,
            entity_id,
            order_id,
            amount,
            currency,
            direction,
            reference_type,
            reference_id,
            idempotency_key,
            metadata,
            created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE id = id
        `,
        [
            transactionType,
            entityType,
            entityId,
            orderId,
            money(amount),
            currency,
            direction,
            referenceType,
            referenceId,
            idempotencyKey || null,
            safeJson(metadata),
            createdBy,
        ]
    );

export const recordPaymentCapture = async ({
    orderId,
    customerId,
    paymentGateway,
    gatewayTransactionId,
    amount,
    currency = "INR",
    paymentStatus = "captured",
    idempotencyKey,
    gatewayPayload = null,
}) =>
    withTransaction(async (connection) => {
        const key =
            idempotencyKey ||
            `payment:${paymentGateway}:${gatewayTransactionId || orderId}`;

        const [paymentResult] = await connection.execute(
            `
            INSERT INTO payments (
                order_id,
                customer_id,
                payment_gateway,
                gateway_transaction_id,
                amount,
                currency,
                payment_status,
                idempotency_key,
                gateway_payload,
                paid_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON DUPLICATE KEY UPDATE
                amount = VALUES(amount),
                currency = VALUES(currency),
                payment_status = VALUES(payment_status),
                gateway_payload = COALESCE(VALUES(gateway_payload), gateway_payload),
                paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP),
                updated_at = CURRENT_TIMESTAMP
            `,
            [
                orderId,
                customerId,
                paymentGateway,
                gatewayTransactionId || `order_${orderId}`,
                money(amount),
                currency,
                paymentStatus,
                key,
                gatewayPayload ? safeJson(gatewayPayload) : null,
            ]
        );

        const paymentId =
            paymentResult.insertId ||
            (
                await connection.execute(
                    `
                    SELECT id
                    FROM payments
                    WHERE payment_gateway = ? AND gateway_transaction_id = ?
                    LIMIT 1
                    `,
                    [paymentGateway, gatewayTransactionId || `order_${orderId}`]
                )
            )[0][0]?.id;

        await insertFinancialLog(connection, {
            transactionType: "customer_payment_captured",
            entityType: "platform",
            entityId: 1,
            orderId,
            amount,
            currency,
            direction: "credit",
            referenceType: "payment",
            referenceId: paymentId || null,
            idempotencyKey: `ledger:${key}:platform_credit`,
            metadata: {
                customerId,
                paymentGateway,
                gatewayTransactionId,
            },
        });

        await ensureOrderFinancialsForOrder(orderId, connection);

        return { paymentId };
    });

export const ensureOrderFinancialsForOrder = async (orderId, connection = null) => {
    const run = async (conn) => {
        const [orders] = await conn.execute(
            `
            SELECT
                id,
                user_id,
                restaurant_id,
                delivery_partner_id,
                subtotal,
                discount_amount,
                delivery_fee,
                tax_amount,
                total,
                status
            FROM orders
            WHERE id = ?
            LIMIT 1
            FOR UPDATE
            `,
            [orderId]
        );

        const order = orders[0];
        if (!order) throw new AppError(404, "Order not found");

        const commissionPercent = await getCommissionPercent(conn);
        const foodAmount = positiveMoney(
            Number(order.subtotal || 0) - Number(order.discount_amount || 0)
        );
        const deliveryFee = positiveMoney(order.delivery_fee);
        const platformFee = 0;
        const taxAmount = positiveMoney(order.tax_amount);
        const discountAmount = positiveMoney(order.discount_amount);
        const tipAmount = 0;
        const commissionAmount = money((foodAmount * commissionPercent) / 100);
        const deliveryPartnerAmount = money(
            deliveryFee * (DEFAULT_DELIVERY_BASE_PERCENT / 100) + tipAmount
        );
        const restaurantNetAmount = positiveMoney(
            foodAmount - commissionAmount - taxAmount
        );
        const platformProfitAmount = money(
            commissionAmount + platformFee + deliveryFee - deliveryPartnerAmount
        );

        await conn.execute(
            `
            INSERT INTO order_financials (
                order_id,
                food_amount,
                delivery_fee,
                platform_fee,
                tax_amount,
                discount_amount,
                tip_amount,
                restaurant_commission_amount,
                restaurant_net_amount,
                delivery_partner_amount,
                platform_profit_amount,
                refund_amount,
                calculation_version
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0.00, 'v1')
            ON DUPLICATE KEY UPDATE
                food_amount = VALUES(food_amount),
                delivery_fee = VALUES(delivery_fee),
                platform_fee = VALUES(platform_fee),
                tax_amount = VALUES(tax_amount),
                discount_amount = VALUES(discount_amount),
                tip_amount = VALUES(tip_amount),
                restaurant_commission_amount = VALUES(restaurant_commission_amount),
                restaurant_net_amount = VALUES(restaurant_net_amount),
                delivery_partner_amount = VALUES(delivery_partner_amount),
                platform_profit_amount = VALUES(platform_profit_amount),
                calculation_version = VALUES(calculation_version),
                updated_at = CURRENT_TIMESTAMP
            `,
            [
                order.id,
                foodAmount,
                deliveryFee,
                platformFee,
                taxAmount,
                discountAmount,
                tipAmount,
                commissionAmount,
                restaurantNetAmount,
                deliveryPartnerAmount,
                platformProfitAmount,
            ]
        );

        await insertFinancialLog(conn, {
            transactionType: "order_financials_calculated",
            entityType: "order",
            entityId: order.id,
            orderId: order.id,
            amount: money(Number(order.total || 0)),
            direction: "credit",
            referenceType: "order_financials",
            idempotencyKey: `ledger:order:${order.id}:financials_calculated`,
            metadata: {
                commissionPercent,
                restaurantId: order.restaurant_id,
                deliveryPartnerId: order.delivery_partner_id,
            },
        });

        return {
            order,
            foodAmount,
            deliveryFee,
            platformFee,
            taxAmount,
            discountAmount,
            tipAmount,
            commissionAmount,
            restaurantNetAmount,
            deliveryPartnerAmount,
            platformProfitAmount,
        };
    };

    return connection ? run(connection) : withTransaction(run);
};

export const finalizeDeliveredOrderFinancials = async ({ orderId }) =>
    withTransaction(async (connection) => {
        const financials = await ensureOrderFinancialsForOrder(orderId, connection);
        const { order } = financials;

        if (String(order.status) !== "delivered") {
            throw new AppError(400, "Order must be delivered before settlement");
        }

        const [penaltyRows] = await connection.execute(
            `
            SELECT
                entity_type,
                COALESCE(SUM(CASE WHEN status = 'applied' THEN amount ELSE 0 END), 0) AS amount
            FROM financial_penalties
            WHERE order_id = ?
            GROUP BY entity_type
            `,
            [order.id]
        );
        const penaltyByType = Object.fromEntries(
            penaltyRows.map((row) => [row.entity_type, money(row.amount)])
        );

        await connection.execute(
            `
            INSERT INTO restaurant_settlements (
                restaurant_id,
                order_id,
                gross_amount,
                commission_amount,
                penalty_amount,
                bonus_amount,
                refund_amount,
                net_amount,
                settlement_status
            ) VALUES (?, ?, ?, ?, ?, 0.00, 0.00, ?, 'pending')
            ON DUPLICATE KEY UPDATE
                gross_amount = VALUES(gross_amount),
                commission_amount = VALUES(commission_amount),
                penalty_amount = VALUES(penalty_amount),
                net_amount = CASE
                    WHEN settlement_status IN ('paid', 'processing') THEN net_amount
                    ELSE VALUES(net_amount)
                END,
                updated_at = CURRENT_TIMESTAMP
            `,
            [
                order.restaurant_id,
                order.id,
                financials.foodAmount,
                financials.commissionAmount,
                penaltyByType.restaurant || 0,
                positiveMoney(
                    financials.restaurantNetAmount -
                        (penaltyByType.restaurant || 0)
                ),
            ]
        );

        if (order.delivery_partner_id) {
            const deliveryPenalty = penaltyByType.delivery_partner || 0;
            await connection.execute(
                `
                INSERT INTO delivery_partner_earnings (
                    delivery_partner_id,
                    order_id,
                    base_amount,
                    distance_amount,
                    surge_amount,
                    bonus_amount,
                    tip_amount,
                    penalty_amount,
                    net_amount,
                    earning_status
                ) VALUES (?, ?, ?, 0.00, 0.00, 0.00, ?, ?, ?, 'pending')
                ON DUPLICATE KEY UPDATE
                    base_amount = VALUES(base_amount),
                    tip_amount = VALUES(tip_amount),
                    penalty_amount = VALUES(penalty_amount),
                    net_amount = CASE
                        WHEN earning_status = 'paid' THEN net_amount
                        ELSE VALUES(net_amount)
                    END,
                    updated_at = CURRENT_TIMESTAMP
                `,
                [
                    order.delivery_partner_id,
                    order.id,
                    positiveMoney(financials.deliveryPartnerAmount - financials.tipAmount),
                    financials.tipAmount,
                    deliveryPenalty,
                    positiveMoney(financials.deliveryPartnerAmount - deliveryPenalty),
                ]
            );
        }

        await insertFinancialLog(connection, {
            transactionType: "order_settlement_generated",
            entityType: "restaurant",
            entityId: order.restaurant_id,
            orderId: order.id,
            amount: financials.restaurantNetAmount,
            direction: "credit",
            referenceType: "restaurant_settlement",
            idempotencyKey: `ledger:order:${order.id}:restaurant_settlement`,
        });

        if (order.delivery_partner_id) {
            await insertFinancialLog(connection, {
                transactionType: "delivery_earning_generated",
                entityType: "delivery_partner",
                entityId: order.delivery_partner_id,
                orderId: order.id,
                amount: financials.deliveryPartnerAmount,
                direction: "credit",
                referenceType: "delivery_partner_earning",
                idempotencyKey: `ledger:order:${order.id}:delivery_earning`,
            });
        }

        return financials;
    });

export const createRefundTransaction = async ({
    orderId,
    refundAmount,
    refundReason,
    refundStatus = "pending",
    gatewayRefundId = null,
    idempotencyKey = null,
    createdBy = null,
}) =>
    withTransaction(async (connection) => {
        const [payments] = await connection.execute(
            `
            SELECT id, customer_id
            FROM payments
            WHERE order_id = ?
            ORDER BY paid_at DESC, id DESC
            LIMIT 1
            FOR UPDATE
            `,
            [orderId]
        );

        const payment = payments[0] || null;
        const key = idempotencyKey || `refund:${orderId}:${gatewayRefundId || refundAmount}`;
        const [result] = await connection.execute(
            `
            INSERT INTO refund_transactions (
                order_id,
                payment_id,
                refund_amount,
                refund_reason,
                refund_status,
                gateway_refund_id,
                idempotency_key
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                refund_status = VALUES(refund_status),
                gateway_refund_id = COALESCE(VALUES(gateway_refund_id), gateway_refund_id),
                updated_at = CURRENT_TIMESTAMP
            `,
            [
                orderId,
                payment?.id || null,
                money(refundAmount),
                refundReason,
                refundStatus,
                gatewayRefundId,
                key,
            ]
        );

        await connection.execute(
            `
            UPDATE order_financials
            SET refund_amount = refund_amount + ?,
                restaurant_net_amount = GREATEST(0, restaurant_net_amount - ?),
                platform_profit_amount = platform_profit_amount - ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE order_id = ?
            `,
            [money(refundAmount), money(refundAmount), money(refundAmount), orderId]
        );

        await insertFinancialLog(connection, {
            transactionType: "refund_recorded",
            entityType: "customer",
            entityId: payment?.customer_id || 0,
            orderId,
            amount: refundAmount,
            direction: "debit",
            referenceType: "refund_transaction",
            referenceId: result.insertId || null,
            idempotencyKey: `ledger:${key}:refund`,
            metadata: { refundReason, refundStatus, gatewayRefundId },
            createdBy,
        });

        return result.insertId;
    });

export const applyFinancialPenalty = async ({
    entityType,
    entityId,
    orderId = null,
    penaltyType,
    penaltyReason,
    amount,
    status = "applied",
    createdBy = null,
}) => {
    if (!["restaurant", "delivery_partner", "customer"].includes(entityType)) {
        throw new AppError(400, "Invalid penalty entity type");
    }

    if (!penaltyType || !penaltyReason || Number(amount) <= 0) {
        throw new AppError(400, "Penalty type, reason, and positive amount are required");
    }

    const result = await query(
        `
        INSERT INTO financial_penalties (
            entity_type,
            entity_id,
            order_id,
            penalty_type,
            penalty_reason,
            amount,
            status,
            created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
            entityType,
            entityId,
            orderId,
            penaltyType,
            penaltyReason,
            money(amount),
            status,
            createdBy,
        ]
    );

    if (orderId) {
        await finalizeDeliveredOrderFinancials({ orderId }).catch(() => null);
    }

    return result.insertId;
};

export const applyFinancialBonus = async ({
    entityType,
    entityId,
    orderId = null,
    bonusReason,
    amount,
    idempotencyKey = null,
    createdBy = null,
}) => {
    if (!["restaurant", "delivery_partner"].includes(entityType)) {
        throw new AppError(400, "Invalid bonus entity type");
    }

    if (!bonusReason || Number(amount) <= 0) {
        throw new AppError(400, "Bonus reason and positive amount are required");
    }

    const key =
        idempotencyKey ||
        `bonus:${entityType}:${entityId}:${orderId}:${money(amount)}:${bonusReason}`;

    await withTransaction(async (connection) => {
        const [existingLogs] = await connection.execute(
            `
            SELECT id
            FROM financial_transaction_logs
            WHERE idempotency_key = ?
            LIMIT 1
            `,
            [`ledger:${key}`]
        );

        if (existingLogs.length) return;

        let result;
        if (entityType === "restaurant") {
            if (!orderId) {
                throw new AppError(400, "Restaurant bonuses require an orderId");
            }

            [result] = await connection.execute(
                `
                UPDATE restaurant_settlements
                SET bonus_amount = bonus_amount + ?,
                    net_amount = net_amount + ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE restaurant_id = ? AND order_id = ?
                `,
                [money(amount), money(amount), entityId, orderId]
            );
        } else {
            if (!orderId) {
                throw new AppError(400, "Delivery bonuses require an orderId");
            }

            [result] = await connection.execute(
                `
                UPDATE delivery_partner_earnings
                SET bonus_amount = bonus_amount + ?,
                    net_amount = net_amount + ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE delivery_partner_id = ? AND order_id = ?
                `,
                [money(amount), money(amount), entityId, orderId]
            );
        }

        if (!result?.affectedRows) {
            throw new AppError(404, "Eligible earning or settlement was not found");
        }

        await insertFinancialLog(connection, {
            transactionType: "bonus_applied",
            entityType,
            entityId,
            orderId,
            amount,
            direction: "credit",
            referenceType: "manual_bonus",
            idempotencyKey: `ledger:${key}`,
            metadata: { bonusReason },
            createdBy,
        });
    });

    return { success: true };
};

export const getAdminFinancialDashboard = async () => {
    const [summary] = await query(
        `
        SELECT
            COALESCE(SUM(p.amount), 0) AS total_collected,
            COALESCE(SUM(CASE WHEN DATE(p.paid_at) = CURRENT_DATE THEN p.amount ELSE 0 END), 0) AS today_collected
        FROM payments p
        WHERE p.payment_status IN ('captured', 'completed')
        `
    );

    const [financials] = await query(
        `
        SELECT
            COALESCE(SUM(restaurant_commission_amount), 0) AS commission_revenue,
            COALESCE(SUM(platform_fee), 0) AS platform_fees,
            COALESCE(SUM(platform_profit_amount), 0) AS platform_profit,
            COALESCE(SUM(refund_amount), 0) AS refunds
        FROM order_financials
        `
    );

    const [settlements] = await query(
        `
        SELECT
            COALESCE(SUM(CASE WHEN settlement_status IN ('pending', 'approved', 'processing') THEN net_amount ELSE 0 END), 0) AS active_restaurant_payouts,
            COALESCE(SUM(CASE WHEN settlement_status = 'paid' THEN net_amount ELSE 0 END), 0) AS paid_restaurant_payouts
        FROM restaurant_settlements
        `
    );

    const [delivery] = await query(
        `
        SELECT
            COALESCE(SUM(CASE WHEN earning_status IN ('pending', 'approved') THEN net_amount ELSE 0 END), 0) AS pending_delivery_payouts,
            COALESCE(SUM(CASE WHEN earning_status = 'paid' THEN net_amount ELSE 0 END), 0) AS paid_delivery_payouts
        FROM delivery_partner_earnings
        `
    );

    const topRestaurants = await query(
        `
        SELECT r.id, r.name, COALESCE(SUM(rs.net_amount), 0) AS net_amount
        FROM restaurant_settlements rs
        INNER JOIN restaurants r ON r.id = rs.restaurant_id
        GROUP BY r.id, r.name
        ORDER BY net_amount DESC
        LIMIT 10
        `
    );

    const topDeliveryPartners = await query(
        `
        SELECT u.id, u.name, COALESCE(SUM(dpe.net_amount), 0) AS net_amount
        FROM delivery_partner_earnings dpe
        INNER JOIN users u ON u.id = dpe.delivery_partner_id
        GROUP BY u.id, u.name
        ORDER BY net_amount DESC
        LIMIT 10
        `
    );

    return {
        total_platform_revenue: money(
            Number(financials[0]?.commission_revenue || 0) +
                Number(financials[0]?.platform_fees || 0)
        ),
        total_collected: money(summary[0]?.total_collected),
        today_collected: money(summary[0]?.today_collected),
        commission_revenue: money(financials[0]?.commission_revenue),
        platform_profit: money(financials[0]?.platform_profit),
        refunds: money(financials[0]?.refunds),
        active_payouts: money(
            Number(settlements[0]?.active_restaurant_payouts || 0) +
                Number(delivery[0]?.pending_delivery_payouts || 0)
        ),
        paid_payouts: money(
            Number(settlements[0]?.paid_restaurant_payouts || 0) +
                Number(delivery[0]?.paid_delivery_payouts || 0)
        ),
        top_restaurants: topRestaurants,
        top_delivery_partners: topDeliveryPartners,
    };
};

export const listOrderFinancials = ({ status, restaurantId } = {}) =>
    query(
        `
        SELECT
            ofn.*,
            o.order_number,
            o.status AS order_status,
            o.created_at AS order_created_at,
            r.name AS restaurant_name,
            u.name AS customer_name
        FROM order_financials ofn
        INNER JOIN orders o ON o.id = ofn.order_id
        LEFT JOIN restaurants r ON r.id = o.restaurant_id
        LEFT JOIN users u ON u.id = o.user_id
        WHERE (? IS NULL OR o.status = ?)
          AND (? IS NULL OR o.restaurant_id = ?)
        ORDER BY ofn.created_at DESC
        LIMIT 200
        `,
        [
            status || null,
            status || null,
            restaurantId || null,
            restaurantId || null,
        ]
    );

export const listRestaurantSettlements = ({ status, restaurantId } = {}) =>
    query(
        `
        SELECT rs.*, r.name AS restaurant_name, o.order_number
        FROM restaurant_settlements rs
        INNER JOIN restaurants r ON r.id = rs.restaurant_id
        LEFT JOIN orders o ON o.id = rs.order_id
        WHERE (? IS NULL OR rs.settlement_status = ?)
          AND (? IS NULL OR rs.restaurant_id = ?)
        ORDER BY rs.created_at DESC
        LIMIT 200
        `,
        [status || null, status || null, restaurantId || null, restaurantId || null]
    );

export const listDeliveryEarnings = ({ status, deliveryPartnerId } = {}) =>
    query(
        `
        SELECT dpe.*, u.name AS delivery_partner_name, o.order_number
        FROM delivery_partner_earnings dpe
        INNER JOIN users u ON u.id = dpe.delivery_partner_id
        LEFT JOIN orders o ON o.id = dpe.order_id
        WHERE (? IS NULL OR dpe.earning_status = ?)
          AND (? IS NULL OR dpe.delivery_partner_id = ?)
        ORDER BY dpe.created_at DESC
        LIMIT 200
        `,
        [
            status || null,
            status || null,
            deliveryPartnerId || null,
            deliveryPartnerId || null,
        ]
    );

export const updateRestaurantSettlementStatus = async ({
    settlementId,
    status,
    transactionReference,
    adminNotes,
    adminId,
}) => {
    const allowed = new Set([
        "pending",
        "approved",
        "processing",
        "paid",
        "failed",
        "frozen",
        "rejected",
    ]);
    if (!allowed.has(status)) throw new AppError(400, "Invalid settlement status");

    await query(
        `
        UPDATE restaurant_settlements
        SET settlement_status = ?,
            transaction_reference = COALESCE(?, transaction_reference),
            settlement_date = CASE WHEN ? = 'paid' THEN CURRENT_DATE ELSE settlement_date END,
            approved_by = CASE WHEN ? IN ('approved', 'paid') THEN ? ELSE approved_by END,
            admin_notes = COALESCE(?, admin_notes),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        `,
        [
            status,
            transactionReference || null,
            status,
            status,
            adminId || null,
            adminNotes || null,
            settlementId,
        ]
    );
};

export const getRestaurantFinancialDashboard = async (ownerId) => {
    const restaurant = await getRestaurantByOwnerId(ownerId);
    if (!restaurant) throw new AppError(404, "Restaurant account is not active");

    const [summary] = await query(
        `
        SELECT
            COALESCE(SUM(net_amount), 0) AS total_settled_earnings,
            COALESCE(SUM(CASE WHEN settlement_status IN ('pending', 'approved', 'processing') THEN net_amount ELSE 0 END), 0) AS pending_settlements,
            COALESCE(SUM(CASE WHEN settlement_status = 'paid' THEN net_amount ELSE 0 END), 0) AS completed_settlements,
            COALESCE(SUM(commission_amount), 0) AS commission_total,
            COALESCE(SUM(refund_amount), 0) AS refund_deductions,
            COALESCE(SUM(CASE WHEN DATE(created_at) = CURRENT_DATE THEN gross_amount ELSE 0 END), 0) AS daily_sales,
            COALESCE(SUM(CASE WHEN created_at >= DATE_SUB(CURRENT_DATE, INTERVAL 7 DAY) THEN gross_amount ELSE 0 END), 0) AS weekly_sales,
            COALESCE(SUM(CASE WHEN created_at >= DATE_SUB(CURRENT_DATE, INTERVAL 30 DAY) THEN gross_amount ELSE 0 END), 0) AS monthly_sales
        FROM restaurant_settlements
        WHERE restaurant_id = ?
        `,
        [restaurant.id]
    );

    const settlements = await listRestaurantSettlements({
        restaurantId: restaurant.id,
    });

    return {
        restaurant_id: restaurant.id,
        ...summary[0],
        settlements,
    };
};

export const getDeliveryFinancialDashboard = async (deliveryPartnerId) => {
    const [summary] = await query(
        `
        SELECT
            COALESCE(SUM(net_amount), 0) AS total_earnings,
            COALESCE(SUM(CASE WHEN DATE(created_at) = CURRENT_DATE THEN net_amount ELSE 0 END), 0) AS today_earnings,
            COALESCE(SUM(CASE WHEN created_at >= DATE_SUB(CURRENT_DATE, INTERVAL 7 DAY) THEN net_amount ELSE 0 END), 0) AS weekly_earnings,
            COALESCE(SUM(CASE WHEN created_at >= DATE_SUB(CURRENT_DATE, INTERVAL 30 DAY) THEN net_amount ELSE 0 END), 0) AS monthly_earnings,
            COALESCE(SUM(CASE WHEN earning_status IN ('pending', 'approved') THEN net_amount ELSE 0 END), 0) AS pending_payouts,
            COALESCE(SUM(CASE WHEN earning_status = 'paid' THEN net_amount ELSE 0 END), 0) AS completed_payouts,
            COALESCE(SUM(penalty_amount), 0) AS penalty_total,
            COALESCE(SUM(bonus_amount + surge_amount), 0) AS incentive_total
        FROM delivery_partner_earnings
        WHERE delivery_partner_id = ?
        `,
        [deliveryPartnerId]
    );

    const earnings = await listDeliveryEarnings({ deliveryPartnerId });
    const penalties = await query(
        `
        SELECT *
        FROM financial_penalties
        WHERE entity_type = 'delivery_partner' AND entity_id = ?
        ORDER BY created_at DESC
        LIMIT 100
        `,
        [deliveryPartnerId]
    );

    return {
        delivery_partner_id: deliveryPartnerId,
        ...summary[0],
        earnings,
        penalties,
    };
};

import { query, withTransaction } from "../../config/db.js";
import { emitRealtimeEvent } from "../notificationService.js";
import { logger } from "../../utils/logger.js";

const DEFAULT_INTERVAL_MS = 5000;
const DEFAULT_BATCH_SIZE = 25;
const MAX_ATTEMPTS = 5;

let timer = null;
let running = false;

const parsePayload = (payload) => {
    if (!payload) return {};
    if (typeof payload === "object") return payload;

    try {
        return JSON.parse(payload);
    } catch {
        return { raw: payload };
    }
};

const markOutboxRow = async ({ id, status, attempts, error = null }) => {
    try {
        await query(
            `
            UPDATE notification_outbox
            SET status = ?,
                attempts = ?,
                last_error = ?,
                processed_at = CASE WHEN ? = 'sent' THEN CURRENT_TIMESTAMP ELSE processed_at END,
                next_attempt_at = CASE
                    WHEN ? IN ('pending', 'failed') THEN DATE_ADD(CURRENT_TIMESTAMP, INTERVAL LEAST(POW(2, ?), 300) SECOND)
                    ELSE next_attempt_at
                END,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            `,
            [status, attempts, error, status, status, attempts, id]
        );
    } catch {
        const compatibleStatus = status === "dead_letter" ? "failed" : status;
        await query(`UPDATE notification_outbox SET status = ? WHERE id = ?`, [
            compatibleStatus,
            id,
        ]);
    }
};

const claimRows = async (batchSize) =>
    withTransaction(async (connection) => {
        let rows;
        try {
            [rows] = await connection.execute(
                `
                SELECT id, notification_id, channel, recipient_user_id, payload, status,
                       COALESCE(attempts, 0) AS attempts
                FROM notification_outbox
                WHERE status IN ('pending', 'failed')
                  AND (next_attempt_at IS NULL OR next_attempt_at <= CURRENT_TIMESTAMP)
                ORDER BY id ASC
                LIMIT ?
                FOR UPDATE
                `,
                [batchSize]
            );
        } catch {
            try {
                [rows] = await connection.execute(
                    `
                    SELECT id, notification_id, channel, recipient_user_id, payload, status,
                           COALESCE(attempt_count, 0) AS attempts
                    FROM notification_outbox
                    WHERE status IN ('pending', 'failed')
                      AND (next_attempt_at IS NULL OR next_attempt_at <= CURRENT_TIMESTAMP)
                    ORDER BY id ASC
                    LIMIT ?
                    FOR UPDATE
                    `,
                    [batchSize]
                );
            } catch {
                [rows] = await connection.execute(
                    `
                    SELECT id, notification_id, channel, recipient_user_id, payload, status,
                           0 AS attempts
                    FROM notification_outbox
                    WHERE status IN ('pending', 'failed')
                    ORDER BY id ASC
                    LIMIT ?
                    FOR UPDATE
                    `,
                    [batchSize]
                );
            }
        }

        if (!rows.length) return [];

        const ids = rows.map((row) => row.id);
        const placeholders = ids.map(() => "?").join(", ");
        try {
            await connection.execute(
                `UPDATE notification_outbox SET status = 'processing' WHERE id IN (${placeholders})`,
                ids
            );
        } catch (error) {
            logger.warn("Notification outbox processing claim is compatibility-noop", {
                error: error?.message,
            });
        }

        return rows;
    });

const deliverRow = async (row) => {
    const payload = parsePayload(row.payload);

    if (row.recipient_user_id) {
        emitRealtimeEvent({
            room: `user:${row.recipient_user_id}`,
            eventName: "notification:push",
            payload: {
                notificationId: row.notification_id,
                channel: row.channel,
                ...payload,
            },
        });
    }

    return true;
};

export const processNotificationOutboxBatch = async ({
    batchSize = DEFAULT_BATCH_SIZE,
} = {}) => {
    let rows = [];
    try {
        rows = await claimRows(batchSize);
    } catch (error) {
        logger.warn("Notification outbox claim skipped", {
            error: error?.message,
        });
        return { processed: 0, failed: 0 };
    }

    let processed = 0;
    let failed = 0;

    for (const row of rows) {
        const attempts = Number(row.attempts || 0) + 1;

        try {
            await deliverRow(row);
            await markOutboxRow({ id: row.id, status: "sent", attempts });
            processed += 1;
        } catch (error) {
            const terminal = attempts >= MAX_ATTEMPTS;
            await markOutboxRow({
                id: row.id,
                status: terminal ? "dead_letter" : "failed",
                attempts,
                error: String(error?.message || error).slice(0, 500),
            });
            failed += 1;
        }
    }

    return { processed, failed };
};

export const startNotificationOutboxWorker = ({
    intervalMs = Number(process.env.NOTIFICATION_OUTBOX_INTERVAL_MS) ||
        DEFAULT_INTERVAL_MS,
    batchSize = Number(process.env.NOTIFICATION_OUTBOX_BATCH_SIZE) ||
        DEFAULT_BATCH_SIZE,
} = {}) => {
    if (timer) return;

    const tick = async () => {
        if (running) return;
        running = true;

        try {
            await processNotificationOutboxBatch({ batchSize });
        } finally {
            running = false;
        }
    };

    timer = setInterval(tick, intervalMs);
    timer.unref?.();
    void tick();

    logger.info("Notification outbox worker started", {
        intervalMs,
        batchSize,
    });
};

export const stopNotificationOutboxWorker = () => {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
};

const crypto = require("crypto");

class HttpError extends Error {
    constructor(status, message, details) {
        super(message);
        this.status = status;
        this.details = details;
    }
}

function asyncHandler(handler) {
    return async (req, res, next) => {
        try {
            await handler(req, res, next);
        } catch (error) {
            next(error);
        }
    };
}

function sendOk(res, data, meta) {
    const payload = { success: true, data };
    if (meta) payload.meta = meta;
    return res.json(payload);
}

function normalizeBoolean(value, fallback = false) {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value === 1;
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (["1", "true", "yes", "on"].includes(normalized)) return true;
        if (["0", "false", "no", "off"].includes(normalized)) return false;
    }
    return fallback;
}

function toNumber(value, fallback = 0) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : fallback;
}

function parseJsonList(value) {
    if (Array.isArray(value)) return value;
    if (typeof value !== "string" || !value.trim()) return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return value
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean);
    }
}

function generateOrderNumber() {
    return `TK-${new Date()
        .toISOString()
        .slice(0, 10)
        .replace(/-/g, "")}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

async function query(pool, sql, params = []) {
    const [rows] = await pool.query(sql, params);
    return rows;
}

async function queryOne(pool, sql, params = []) {
    const rows = await query(pool, sql, params);
    return rows[0] || null;
}

function buildPagination(req) {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    return { page, limit, offset };
}

async function withTransaction(pool, work) {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const result = await work(connection);
        await connection.commit();
        return result;
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

module.exports = {
    HttpError,
    asyncHandler,
    buildPagination,
    generateOrderNumber,
    normalizeBoolean,
    parseJsonList,
    query,
    queryOne,
    sendOk,
    toNumber,
    withTransaction,
};

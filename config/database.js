import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

// =====================================================
// CONNECTION POOL
// =====================================================
let pool = null;

export async function initializeDatabase() {
    try {
        pool = await mysql.createPool({
            host: process.env.DB_HOST || "localhost",
            user: process.env.DB_USER || "root",
            password: process.env.DB_PASSWORD || "",
            database: process.env.DB_NAME || "tastiekit",
            waitForConnections: true,
            connectionLimit: parseInt(process.env.DB_POOL_LIMIT || "10"),
            queueLimit: 0,
            enableKeepAlive: true,
            keepAliveInitialDelayMs: 0,
        });

        // Test connection
        const connection = await pool.getConnection();
        await connection.ping();
        connection.release();

        console.log("Database pool created successfully");
        return pool;
    } catch (error) {
        console.error("Failed to initialize database:", error);
        throw error;
    }
}

export function getPool() {
    if (!pool) {
        throw new Error("Database pool not initialized");
    }
    return pool;
}

// =====================================================
// QUERY HELPERS
// =====================================================

/**
 * Execute a single query
 */
export async function query(sql, values = []) {
    try {
        const connection = await getPool().getConnection();
        try {
            const [rows] = await connection.execute(sql, values);
            return rows;
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error("Database query error:", { sql, error });
        throw error;
    }
}

/**
 * Get a single row
 */
export async function getOne(sql, values = []) {
    const rows = await query(sql, values);
    return rows?.[0] || null;
}

/**
 * Insert a row and return the inserted ID
 */
export async function insert(table, data) {
    const columns = Object.keys(data);
    const values = Object.values(data);
    const placeholders = columns.map(() => "?").join(", ");

    const sql = `
    INSERT INTO ${table} (${columns.join(", ")})
    VALUES (${placeholders})
  `;

    const connection = await getPool().getConnection();
    try {
        const [result] = await connection.execute(sql, values);
        return result.insertId;
    } finally {
        connection.release();
    }
}

/**
 * Update a row
 */
export async function update(table, data, where = {}) {
    const columns = Object.keys(data);
    const values = [...Object.values(data), ...Object.values(where)];
    const setClause = columns.map((col) => `${col} = ?`).join(", ");
    const whereClause = Object.keys(where)
        .map((key) => `${key} = ?`)
        .join(" AND ");

    const sql = `
    UPDATE ${table}
    SET ${setClause}
    WHERE ${whereClause}
  `;

    return await query(sql, values);
}

/**
 * Delete rows
 */
export async function deleteRow(table, where = {}) {
    const whereClause = Object.keys(where)
        .map((key) => `${key} = ?`)
        .join(" AND ");
    const values = Object.values(where);

    const sql = `DELETE FROM ${table} WHERE ${whereClause}`;

    return await query(sql, values);
}

/**
 * Execute transaction
 */
export async function transaction(callback) {
    const connection = await getPool().getConnection();
    try {
        await connection.beginTransaction();
        const result = await callback(connection);
        await connection.commit();
        return result;
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

/**
 * Get connection for manual query execution
 */
export async function getConnection() {
    return await getPool().getConnection();
}

export default {
    initializeDatabase,
    getPool,
    query,
    getOne,
    insert,
    update,
    deleteRow,
    transaction,
    getConnection,
};

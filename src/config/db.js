import mysql from "mysql2/promise";
import { env } from "./env.js";
import { logger } from "../utils/logger.js";

let pool;

export const initializeDatabase = async () => {
    // Debug logging - remove after fixing
    console.log("=== Database Env Variables ===");
    console.log("DB_HOST:", env.dbHost ? "Loaded" : "MISSING");
    console.log("DB_USER:", env.dbUser ? "Loaded" : "MISSING");
    console.log("DB_NAME:", env.dbName ? "Loaded" : "MISSING");
    console.log(
        "DB_PASS:",
        env.dbPassword ? "****** (present)" : "MISSING or EMPTY"
    );
    console.log("DB_SSL:", env.dbSsl);

    if (!env.dbPassword) {
        throw new Error(
            "Database password is missing! Check environment variables on Render."
        );
    }

    pool = mysql.createPool({
        host: env.dbHost,
        port: env.dbPort,
        user: env.dbUser,
        password: env.dbPassword,
        database: env.dbName,
        waitForConnections: true,
        connectionLimit: env.dbPoolLimit || 10,
        connectTimeout: env.dbConnectTimeout || 10000,
        decimalNumbers: true,
        ssl: env.dbSsl
            ? {
                  rejectUnauthorized: env.dbSslRejectUnauthorized !== false,
              }
            : undefined,
    });

    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();

    logger.info("MySQL connection pool ready");
    return pool;
};

export const getPool = () => {
    if (!pool) {
        throw new Error("Database not initialized");
    }

    return pool;
};

export const query = async (sql, params = []) => {
    const [rows] = await getPool().execute(sql, params);
    return rows;
};

export const getOne = async (sql, params = []) => {
    const rows = await query(sql, params);
    return rows[0] || null;
};

export const withTransaction = async (handler) => {
    const connection = await getPool().getConnection();

    try {
        await connection.beginTransaction();
        const result = await handler(connection);
        await connection.commit();
        return result;
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

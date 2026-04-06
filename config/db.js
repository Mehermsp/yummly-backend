const mysql = require("mysql2/promise");

let pool;
let availabilityColumnReady = false;
let mealTypeColumnReady = false;

async function ensureAvailabilityColumn() {
    if (availabilityColumnReady) {
        return;
    }

    const [availabilityColumn] = await pool.query(
        `
        SELECT COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = ?
        AND TABLE_NAME = 'users'
        AND COLUMN_NAME = 'is_available'
    `,
        [process.env.DB_NAME]
    );

    if (!availabilityColumn.length) {
        await pool.query(
            "ALTER TABLE users ADD COLUMN is_available TINYINT(1) NOT NULL DEFAULT 1"
        );
        console.log("Added users.is_available column");
    }

    availabilityColumnReady = true;
}

async function ensureMealTypeColumn() {
    if (mealTypeColumnReady) {
        return;
    }

    const [mealTypeColumn] = await pool.query(
        `
        SELECT COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = ?
        AND TABLE_NAME = 'menu'
        AND COLUMN_NAME = 'meal_type'
    `,
        [process.env.DB_NAME]
    );

    if (!mealTypeColumn.length) {
        await pool.query(
            "ALTER TABLE menu ADD COLUMN meal_type VARCHAR(30) NOT NULL DEFAULT 'Lunch' AFTER category"
        );
        console.log("Added menu.meal_type column");

        await pool.query(`
            UPDATE menu
            SET meal_type = CASE
                WHEN LOWER(name) REGEXP 'dosa|idli|uttapam|vada|sambhar|sambar|chai|coffee|lassi|sandwich'
                    OR category = 'South Indian'
                THEN 'Breakfast'
                WHEN LOWER(name) REGEXP 'samosa|roll|fries|65|tikka|vada pav|spring|brownie|jamun|jalebi|kulfi|rasmalai|ice cream|soda|lemonade'
                    OR category IN ('Street Food', 'Street', 'Starters', 'Dessert', 'Drinks')
                THEN 'Snacks'
                WHEN LOWER(name) REGEXP 'pizza|noodles|fried rice|chicken|fish|mutton|prawn|chettinad|tandoori|butter chicken'
                THEN 'Dinner'
                ELSE 'Lunch'
            END
        `);
    }

    mealTypeColumnReady = true;
}

async function initDb() {
    const config = {
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        user: process.env.DB_USER,
        password: process.env.DB_PASS,
        database: process.env.DB_NAME,
        waitForConnections: true,
        connectionLimit: 10,
        connectTimeout: 10000,
    };

    if (process.env.DB_SSL === "true") {
        config.ssl = {
            rejectUnauthorized: process.env.DB_SSL_REJECT !== "false",
        };
        console.log("SSL enabled for DB connection");
    }

    pool = await mysql.createPool(config);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS wishlists (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            menu_id INT,
            name VARCHAR(255),
            price DECIMAL(10,2),
            image VARCHAR(1024),
            description TEXT,
            category VARCHAR(50),
            discount INT DEFAULT 0,
            KEY idx_user_id (user_id),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `);

    // Add restaurant_id column to orders table if it doesn't exist
    try {
        await pool.query("SELECT restaurant_id FROM orders LIMIT 1");
    } catch (e) {
        await pool.query("ALTER TABLE orders ADD COLUMN restaurant_id INT AFTER user_id");
    }

    // Reviews table for customer feedback
    await pool.query(`
        CREATE TABLE IF NOT EXISTS reviews (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            restaurant_id INT,
            menu_item_id INT,
            order_id INT,
            rating DECIMAL(3,1) NOT NULL,
            comment TEXT,
            delivery_rating DECIMAL(3,1),
            delivery_comment TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            KEY idx_user_id (user_id),
            KEY idx_restaurant_id (restaurant_id),
            KEY idx_menu_item_id (menu_item_id),
            KEY idx_order_id (order_id),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL
        )
    `);

    await ensureAvailabilityColumn();
    await ensureMealTypeColumn();
}

function getPool() {
    return pool;
}

module.exports = {
    initDb,
    getPool,
    ensureAvailabilityColumn,
    ensureMealTypeColumn,
};

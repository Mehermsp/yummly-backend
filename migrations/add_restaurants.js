require("dotenv").config();
const { initDb, getPool } = require("../config/db");
// DB_NAME from env

async function migrate() {
    await initDb();
    const pool = getPool();
    try {
        console.log("🧑‍🍳 Running restaurants migration...");

        // 1. Add restaurant_id column if missing
        const [existingCol] = await pool.query(`
      SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = '${DB_NAME}' AND TABLE_NAME = 'menu' AND COLUMN_NAME = 'restaurant_id'
    `);
        if (existingCol[0].cnt === 0) {
            await pool.query(
                "ALTER TABLE menu ADD COLUMN restaurant_id INT AFTER category"
            );
            await pool.query(
                "ALTER TABLE menu ADD INDEX idx_restaurant_id (restaurant_id)"
            );
            console.log("✓ Added restaurant_id column and index");
        } else {
            console.log("- restaurant_id column exists");
        }

        // 2. Create restaurants table if missing
        const [restTable] = await pool.query(`
      SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_SCHEMA = '${DB_NAME}' AND TABLE_NAME = 'restaurants'
    `);
        if (restTable[0].cnt === 0) {
            await pool.query(`
        CREATE TABLE restaurants (
          id INT AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          description TEXT,
          image VARCHAR(1024),
          cuisine VARCHAR(100),
          rating DECIMAL(3,1) DEFAULT 4.5,
          delivery_time_min INT DEFAULT 30,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
            console.log("✓ Created restaurants table");
        } else {
            console.log("- restaurants table exists");
        }

        // 3. Seed restaurants if empty
        const [restCount] = await pool.query(
            "SELECT COUNT(*) as cnt FROM restaurants"
        );
        if (restCount[0].cnt === 0) {
            await pool.query(`
        INSERT INTO restaurants (name, description, image, cuisine, rating, delivery_time_min) VALUES
        (1, 'Spice Haven', 'Authentic Indian cuisine with rich flavors and traditional recipes from across India.', 'https://images.unsplash.com/photo-1565299624946-b28f40a0ca4b?w=400', 'Indian', 4.6, 35),
        (2, 'Pizza Palace', 'Fresh wood-fired pizzas, pastas and classic Italian favorites made with love.', 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=400', 'Italian', 4.7, 40),
        (3, 'Green Bowl', 'Healthy salads, fresh juices, smoothies and nutritious bowls for wellness.', 'https://images.unsplash.com/photo-1546793665-c74683f339c1?w=400', 'Healthy', 4.4, 25),
        (4, 'Fusion Street', 'Street food fusion with Indo-Chinese, Continental and global street eats.', 'https://images.unsplash.com/photo-1552611052-33e04de081de?w=400', 'Fusion', 4.5, 30)
      `);
            console.log("✓ Seeded 4 restaurants");
        } else {
            console.log("- Restaurants data exists");
        }

        // 4. Add FK constraint if not exists
        try {
            await pool.query(`
        ALTER TABLE menu ADD CONSTRAINT fk_menu_restaurant 
        FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE SET NULL
      `);
            console.log("✓ Added foreign key constraint");
        } catch (e) {
            console.log("- FK constraint exists or already set");
        }

        // 5. Assign unassigned foods to restaurants
        const [unassigned] = await pool.query(
            "SELECT COUNT(*) as cnt FROM menu WHERE restaurant_id IS NULL OR restaurant_id = 0"
        );
        if (unassigned[0].cnt > 0) {
            await pool.query(
                "UPDATE menu SET restaurant_id = 1 WHERE id IN (1,2,4,9,10,19)"
            );
            await pool.query(
                "UPDATE menu SET restaurant_id = 2 WHERE id IN (3,7,12)"
            );
            await pool.query(
                "UPDATE menu SET restaurant_id = 3 WHERE id IN (6,8,14,15,20)"
            );
            await pool.query(
                "UPDATE menu SET restaurant_id = 4 WHERE id IN (5,11,13,16,17,18)"
            );
            console.log("✓ Assigned foods to restaurants");
        } else {
            console.log("- All foods assigned");
        }

        // 6. Verification
        const [summary] = await pool.query(`
      SELECT r.name, r.cuisine, r.rating, COUNT(m.id) as food_count 
      FROM restaurants r 
      LEFT JOIN menu m ON r.id = m.restaurant_id 
      GROUP BY r.id, r.name, r.cuisine, r.rating
    `);
        console.table(summary);
        console.log("✅ Migration complete!");
    } catch (error) {
        console.error("❌ Migration failed:", error.message);
        process.exit(1);
    }
}

migrate();

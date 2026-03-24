-- Create database (run as a privileged user)
CREATE DATABASE IF NOT EXISTS yummly CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE yummly;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255),
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  role VARCHAR(50) DEFAULT 'user',
  is_available TINYINT(1) NOT NULL DEFAULT 1,
  phone VARCHAR(30),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS menu (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  price DECIMAL(10,2) NOT NULL DEFAULT 0,
  image VARCHAR(1024),
  category VARCHAR(50) DEFAULT 'Veg',
  meal_type VARCHAR(30) NOT NULL DEFAULT 'Lunch',
  season VARCHAR(50) DEFAULT 'All',
  rating DECIMAL(3,1) DEFAULT 4.0,
  discount INT DEFAULT 0,
  popularity INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT,
  total DECIMAL(10,2) DEFAULT 0,
  status VARCHAR(50) DEFAULT 'pending',
  driver TEXT,
  payment_method VARCHAR(50),
  address TEXT,
  phone VARCHAR(30),
  notes TEXT,
  payment_id VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_user_id (user_id),
  KEY idx_status (status),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS order_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  menu_id INT,
  name VARCHAR(255),
  price DECIMAL(10,2),
  qty INT DEFAULT 1,
  KEY idx_order_id (order_id),
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (menu_id) REFERENCES menu(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS carts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  menu_id INT,
  name VARCHAR(255),
  price DECIMAL(10,2),
  qty INT DEFAULT 1,
  KEY idx_user_id (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (menu_id) REFERENCES menu(id) ON DELETE SET NULL
);

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
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (menu_id) REFERENCES menu(id) ON DELETE SET NULL
);

-- Insert sample menu with comprehensive data
INSERT IGNORE INTO menu (id, name, description, price, image, category, meal_type, season, rating, discount, popularity) VALUES
(1, 'Paneer Butter Masala', 'Creamy, rich paneer curry with butter and aromatic spices. Served with basmati rice or naan.', 220, 'https://images.unsplash.com/photo-1565299624946-b28f40a0ca4b?w=400', 'Veg', 'Lunch', 'All', 4.5, 10, 95),
(2, 'Veg Biryani', 'Fragrant basmati rice cooked with mixed vegetables, saffron, and authentic spices. A complete meal.', 180, 'https://images.unsplash.com/photo-1563379091339-03246963d96c?w=400', 'Veg', 'Lunch', 'All', 4.3, 5, 88),
(3, 'Margherita Pizza', 'Classic pizza with fresh mozzarella, tomato sauce, and basil leaves. Wood-fired perfection.', 350, 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=400', 'Veg', 'Dinner', 'All', 4.7, 15, 92),
(4, 'Butter Naan', 'Soft, fluffy Indian bread made with butter and refined flour. Perfect accompaniment.', 40, 'https://images.unsplash.com/photo-1581417478175-a9ba53488670?w=400', 'Veg', 'Lunch', 'All', 4.2, 0, 85),
(5, 'Chicken Tikka', 'Tender chicken pieces marinated in yogurt and spices, grilled to perfection.', 280, 'https://images.unsplash.com/photo-1599487488170-d11ec9c172f0?w=400', 'Non-Veg', 'Snacks', 'All', 4.6, 8, 90),
(6, 'Veg Spring Roll', 'Crispy rolls filled with mixed vegetables and noodles. Served with sweet chili sauce.', 120, 'https://images.unsplash.com/photo-1541599468348-e96984315621?w=400', 'Veg', 'Snacks', 'All', 4.1, 0, 75),
(7, 'Chocolate Brownie', 'Rich, fudgy chocolate brownie with walnuts. Served warm with vanilla ice cream.', 150, 'https://images.unsplash.com/photo-1607478900766-efe13248b125?w=400', 'Dessert', 'Snacks', 'All', 4.8, 12, 87),
(8, 'Caesar Salad', 'Fresh romaine lettuce with parmesan cheese, croutons, and Caesar dressing.', 180, 'https://images.unsplash.com/photo-1546793665-c74683f339c1?w=400', 'Veg', 'Lunch', 'Summer', 4.4, 0, 70),
(9, 'Pav Bhaji', 'Spicy vegetable mash served with butter-toasted pav bread. Mumbai street food classic.', 140, 'https://images.unsplash.com/photo-1606491956689-2ea866880c84?w=400', 'Veg', 'Snacks', 'All', 4.3, 7, 82),
(10, 'Masala Dosa', 'Crispy fermented crepe filled with potato masala. Served with sambar and chutney.', 120, 'https://images.unsplash.com/photo-1589301760014-959c99da4b9e?w=400', 'Veg', 'Breakfast', 'All', 4.5, 5, 89),
(11, 'Schezwan Noodles', 'Spicy Indo-Chinese noodles with vegetables and schezwan sauce.', 160, 'https://images.unsplash.com/photo-1552611052-33e04de081de?w=400', 'Veg', 'Dinner', 'All', 4.2, 0, 76),
(12, 'Grilled Sandwich', 'Toasted sandwich with cheese, vegetables, and herbs. Perfect for a light meal.', 100, 'https://images.unsplash.com/photo-1481070414801-51b21d356d97?w=400', 'Veg', 'Breakfast', 'All', 4.0, 0, 68),
(13, 'Fish Curry', 'Fresh fish cooked in coconut milk with traditional Kerala spices. Served with rice.', 320, 'https://images.unsplash.com/photo-1559847844-5315695dadae?w=400', 'Non-Veg', 'Dinner', 'Monsoon', 4.6, 10, 84),
(14, 'Lemonade', 'Fresh lemonade made with real lemons and mint. Refreshing and healthy.', 60, 'https://images.unsplash.com/photo-1621263764928-df1444c5e859?w=400', 'Drinks', 'Snacks', 'Summer', 4.1, 0, 72),
(15, 'Mango Lassi', 'Thick yogurt drink with ripe mangoes and cardamom. Traditional Indian beverage.', 80, 'https://images.unsplash.com/photo-1553909489-cd47e9adb3cc?w=400', 'Drinks', 'Breakfast', 'Summer', 4.4, 0, 79),
(16, 'Gulab Jamun', 'Soft milk dumplings soaked in rose-flavored sugar syrup. Classic Indian dessert.', 90, 'https://images.unsplash.com/photo-1605191602382-e9289a4b6379?w=400', 'Dessert', 'Snacks', 'All', 4.7, 8, 91),
(17, 'Tandoori Chicken', 'Chicken marinated in yogurt and red spices, cooked in tandoor oven.', 300, 'https://images.unsplash.com/photo-1598103442097-2b74394b95c6?w=400', 'Non-Veg', 'Dinner', 'Winter', 4.5, 12, 86),
(18, 'Hakka Noodles', 'Stir-fried noodles with vegetables and Indo-Chinese flavors.', 140, 'https://images.unsplash.com/photo-1555126634-323283e090fa?w=400', 'Veg', 'Dinner', 'All', 4.3, 0, 73),
(19, 'Samosa', 'Crispy pastry filled with spiced potatoes and peas. Served with chutney.', 30, 'https://images.unsplash.com/photo-1601050690597-df0568f70950?w=400', 'Starters', 'Snacks', 'All', 4.2, 0, 80),
(20, 'Idli Sambhar', 'Steamed rice cakes served with lentil soup and coconut chutney. South Indian breakfast.', 100, 'https://images.unsplash.com/photo-1589301760014-959c99da4b9e?w=400', 'Veg', 'Breakfast', 'All', 4.4, 5, 77);

-- Add delivered_at timestamp to orders table
ALTER TABLE orders ADD COLUMN delivered_at TIMESTAMP NULL;

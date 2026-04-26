DROP VIEW IF EXISTS order_metrics;
DROP VIEW IF EXISTS active_restaurants;

DROP TABLE IF EXISTS admin_activity_logs;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS reviews;
DROP TABLE IF EXISTS delivery_assignments;
DROP TABLE IF EXISTS order_status_logs;
DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS cart_items;
DROP TABLE IF EXISTS wishlists;
DROP TABLE IF EXISTS menu_items;
DROP TABLE IF EXISTS restaurants;
DROP TABLE IF EXISTS restaurant_applications;
DROP TABLE IF EXISTS addresses;
DROP TABLE IF EXISTS jwt_refresh_tokens;
DROP TABLE IF EXISTS otp_verifications;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    role ENUM('customer', 'restaurant_partner', 'delivery_partner', 'admin') NOT NULL,
    name VARCHAR(120) NOT NULL,
    email VARCHAR(190) NOT NULL UNIQUE,
    phone VARCHAR(20) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NULL,
    is_phone_verified TINYINT(1) NOT NULL DEFAULT 0,
    phone_verified_at TIMESTAMP NULL,
    is_email_verified TINYINT(1) NOT NULL DEFAULT 0,
    email_verified_at TIMESTAMP NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    restaurant_id INT NULL,
    is_available TINYINT(1) NOT NULL DEFAULT 0,
    vehicle_type VARCHAR(50) NULL,
    vehicle_number VARCHAR(50) NULL,
    delivery_rating DECIMAL(3,2) NOT NULL DEFAULT 0,
    total_deliveries INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_users_role (role),
    INDEX idx_users_phone_verified (is_phone_verified),
    INDEX idx_users_active (is_active)
);

CREATE TABLE otp_verifications (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NULL,
    phone VARCHAR(20) NOT NULL,
    otp_code CHAR(6) NOT NULL,
    type ENUM('register', 'login', 'password_reset') NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    is_used TINYINT(1) NOT NULL DEFAULT 0,
    used_at TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_otp_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_otp_lookup (phone, type, is_used),
    INDEX idx_otp_expiry (expires_at)
);

CREATE TABLE jwt_refresh_tokens (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    token_hash CHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMP NOT NULL,
    revoked_at TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_refresh_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_refresh_user (user_id),
    INDEX idx_refresh_expiry (expires_at)
);

CREATE TABLE addresses (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    label VARCHAR(50) NOT NULL DEFAULT 'Home',
    door_no VARCHAR(50) NULL,
    street VARCHAR(255) NOT NULL,
    area VARCHAR(255) NULL,
    city VARCHAR(100) NOT NULL,
    state VARCHAR(100) NULL,
    pincode VARCHAR(12) NOT NULL,
    landmark VARCHAR(255) NULL,
    latitude DECIMAL(10,7) NULL,
    longitude DECIMAL(10,7) NULL,
    is_default TINYINT(1) NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_address_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_address_user (user_id)
);

CREATE TABLE restaurant_applications (
    id INT AUTO_INCREMENT PRIMARY KEY,
    owner_id INT NOT NULL,
    restaurant_name VARCHAR(160) NOT NULL,
    email VARCHAR(190) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    address TEXT NOT NULL,
    city VARCHAR(100) NOT NULL,
    state VARCHAR(100) NULL,
    pincode VARCHAR(12) NOT NULL,
    landmark VARCHAR(255) NULL,
    cuisines JSON NOT NULL,
    open_time TIME NOT NULL,
    close_time TIME NOT NULL,
    days_open JSON NOT NULL,
    fssai_number VARCHAR(100) NULL,
    gst_number VARCHAR(100) NULL,
    pan_number VARCHAR(100) NULL,
    status ENUM('pending', 'approved', 'rejected', 'suspended') NOT NULL DEFAULT 'pending',
    rejection_reason TEXT NULL,
    reviewed_by INT NULL,
    reviewed_at TIMESTAMP NULL,
    review_notes TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_application_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_application_admin FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_application_status (status),
    INDEX idx_application_owner (owner_id)
);

CREATE TABLE restaurants (
    id INT AUTO_INCREMENT PRIMARY KEY,
    owner_id INT NOT NULL UNIQUE,
    application_id INT NOT NULL UNIQUE,
    name VARCHAR(160) NOT NULL,
    email VARCHAR(190) NULL,
    phone VARCHAR(20) NULL,
    description TEXT NULL,
    address TEXT NOT NULL,
    city VARCHAR(100) NOT NULL,
    state VARCHAR(100) NULL,
    pincode VARCHAR(12) NOT NULL,
    landmark VARCHAR(255) NULL,
    latitude DECIMAL(10,7) NULL,
    longitude DECIMAL(10,7) NULL,
    cuisines JSON NOT NULL,
    open_time TIME NOT NULL,
    close_time TIME NOT NULL,
    days_open JSON NOT NULL,
    fssai_number VARCHAR(100) NULL,
    gst_number VARCHAR(100) NULL,
    pan_number VARCHAR(100) NULL,
    logo_url VARCHAR(1024) NULL,
    cover_image_url VARCHAR(1024) NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    is_open TINYINT(1) NOT NULL DEFAULT 1,
    rating DECIMAL(3,2) NOT NULL DEFAULT 0,
    total_orders INT NOT NULL DEFAULT 0,
    total_revenue DECIMAL(12,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_restaurant_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_restaurant_application FOREIGN KEY (application_id) REFERENCES restaurant_applications(id) ON DELETE RESTRICT,
    INDEX idx_restaurant_city (city),
    INDEX idx_restaurant_active (is_active, is_open),
    INDEX idx_restaurant_rating (rating)
);

ALTER TABLE users
    ADD CONSTRAINT fk_user_restaurant FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE SET NULL;

CREATE TABLE menu_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    restaurant_id INT NOT NULL,
    name VARCHAR(160) NOT NULL,
    description TEXT NULL,
    price DECIMAL(10,2) NOT NULL,
    discount_percent INT NOT NULL DEFAULT 0,
    category VARCHAR(80) NULL,
    cuisine_type VARCHAR(80) NULL,
    meal_type ENUM('breakfast', 'lunch', 'dinner', 'snack', 'beverages') NOT NULL DEFAULT 'lunch',
    food_type ENUM('vegetarian', 'non_vegetarian', 'vegan') NOT NULL DEFAULT 'vegetarian',
    preparation_time_mins INT NOT NULL DEFAULT 20,
    is_available TINYINT(1) NOT NULL DEFAULT 1,
    is_deleted TINYINT(1) NOT NULL DEFAULT 0,
    rating DECIMAL(3,2) NOT NULL DEFAULT 0,
    popularity INT NOT NULL DEFAULT 0,
    image_url VARCHAR(1024) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_menu_restaurant FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE,
    INDEX idx_menu_restaurant (restaurant_id, is_available),
    INDEX idx_menu_category (category)
);

CREATE TABLE wishlists (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    menu_item_id INT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_wishlist_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_wishlist_menu_item FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE CASCADE,
    UNIQUE KEY uniq_wishlist_user_menu_item (user_id, menu_item_id)
);

CREATE TABLE cart_items (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    restaurant_id INT NOT NULL,
    menu_item_id INT NOT NULL,
    quantity INT NOT NULL,
    unit_price DECIMAL(10,2) NOT NULL,
    total_price DECIMAL(10,2) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_cart_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_cart_restaurant FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE,
    CONSTRAINT fk_cart_menu_item FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE CASCADE,
    UNIQUE KEY uniq_cart_user_item (user_id, menu_item_id),
    INDEX idx_cart_user_restaurant (user_id, restaurant_id)
);

CREATE TABLE orders (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_number VARCHAR(40) NOT NULL UNIQUE,
    customer_id INT NOT NULL,
    restaurant_id INT NOT NULL,
    delivery_partner_id INT NULL,
    delivery_address_id INT NOT NULL,
    status ENUM('placed', 'confirmed', 'preparing', 'ready_for_pickup', 'out_for_delivery', 'delivered', 'cancelled') NOT NULL DEFAULT 'placed',
    subtotal DECIMAL(12,2) NOT NULL,
    item_discount DECIMAL(12,2) NOT NULL DEFAULT 0,
    delivery_fee DECIMAL(10,2) NOT NULL DEFAULT 0,
    tax_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
    total DECIMAL(12,2) NOT NULL,
    payment_method ENUM('card', 'upi', 'wallet', 'cash') NOT NULL DEFAULT 'cash',
    payment_status ENUM('pending', 'completed', 'failed', 'refunded') NOT NULL DEFAULT 'pending',
    payment_reference VARCHAR(255) NULL,
    estimated_delivery_time TIMESTAMP NULL,
    actual_delivery_time TIMESTAMP NULL,
    customer_notes TEXT NULL,
    delivery_notes TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    confirmed_at TIMESTAMP NULL,
    prepared_at TIMESTAMP NULL,
    picked_up_at TIMESTAMP NULL,
    delivered_at TIMESTAMP NULL,
    cancelled_at TIMESTAMP NULL,
    CONSTRAINT fk_order_customer FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_order_restaurant FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE RESTRICT,
    CONSTRAINT fk_order_delivery_partner FOREIGN KEY (delivery_partner_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_order_address FOREIGN KEY (delivery_address_id) REFERENCES addresses(id) ON DELETE RESTRICT,
    INDEX idx_order_customer (customer_id, created_at),
    INDEX idx_order_restaurant (restaurant_id, status),
    INDEX idx_order_delivery_partner (delivery_partner_id, status),
    INDEX idx_order_status_timeline (status, created_at)
);

CREATE TABLE order_items (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_id BIGINT NOT NULL,
    menu_item_id INT NULL,
    name VARCHAR(160) NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    quantity INT NOT NULL,
    discount_percent INT NOT NULL DEFAULT 0,
    subtotal DECIMAL(12,2) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_order_item_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    CONSTRAINT fk_order_item_menu_item FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE SET NULL,
    INDEX idx_order_item_order (order_id)
);

CREATE TABLE order_status_logs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_id BIGINT NOT NULL,
    old_status VARCHAR(40) NULL,
    new_status VARCHAR(40) NOT NULL,
    changed_by INT NULL,
    changed_by_role VARCHAR(40) NOT NULL,
    notes TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_status_log_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    CONSTRAINT fk_status_log_actor FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_status_log_order (order_id, created_at)
);

CREATE TABLE delivery_assignments (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_id BIGINT NOT NULL,
    delivery_partner_id INT NOT NULL,
    status ENUM('assigned', 'accepted', 'rejected', 'picked_up', 'delivered') NOT NULL DEFAULT 'assigned',
    rejection_reason TEXT NULL,
    assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    accepted_at TIMESTAMP NULL,
    rejected_at TIMESTAMP NULL,
    picked_up_at TIMESTAMP NULL,
    delivered_at TIMESTAMP NULL,
    CONSTRAINT fk_assignment_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    CONSTRAINT fk_assignment_partner FOREIGN KEY (delivery_partner_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY uniq_assignment_order_partner (order_id, delivery_partner_id),
    INDEX idx_assignment_partner_status (delivery_partner_id, status),
    INDEX idx_assignment_order (order_id, status)
);

CREATE TABLE reviews (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_id BIGINT NOT NULL UNIQUE,
    customer_id INT NOT NULL,
    restaurant_id INT NOT NULL,
    delivery_partner_id INT NULL,
    restaurant_rating INT NOT NULL,
    restaurant_comment TEXT NULL,
    delivery_rating INT NULL,
    delivery_comment TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_review_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    CONSTRAINT fk_review_customer FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_review_restaurant FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE,
    CONSTRAINT fk_review_delivery_partner FOREIGN KEY (delivery_partner_id) REFERENCES users(id) ON DELETE SET NULL,
    CHECK (restaurant_rating BETWEEN 1 AND 5),
    CHECK (delivery_rating IS NULL OR delivery_rating BETWEEN 1 AND 5),
    INDEX idx_review_restaurant (restaurant_id),
    INDEX idx_review_delivery_partner (delivery_partner_id)
);

CREATE TABLE notifications (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    type VARCHAR(50) NOT NULL,
    related_entity_type VARCHAR(50) NULL,
    related_entity_id BIGINT NULL,
    data JSON NULL,
    is_read TINYINT(1) NOT NULL DEFAULT 0,
    read_at TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_notification_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_notification_user_created (user_id, created_at),
    INDEX idx_notification_user_read (user_id, is_read)
);

CREATE TABLE admin_activity_logs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    admin_id INT NOT NULL,
    action VARCHAR(120) NOT NULL,
    entity_type VARCHAR(60) NULL,
    entity_id BIGINT NULL,
    description TEXT NULL,
    old_values JSON NULL,
    new_values JSON NULL,
    ip_address VARCHAR(45) NULL,
    user_agent TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_admin_log_admin FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_admin_log_admin_created (admin_id, created_at)
);

CREATE VIEW active_restaurants AS
SELECT *
FROM restaurants
WHERE is_active = 1 AND is_open = 1;

CREATE VIEW order_metrics AS
SELECT
    restaurant_id,
    DATE(created_at) AS order_date,
    COUNT(*) AS total_orders,
    SUM(total) AS gross_revenue
FROM orders
GROUP BY restaurant_id, DATE(created_at);

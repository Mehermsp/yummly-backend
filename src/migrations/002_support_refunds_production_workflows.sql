CREATE TABLE IF NOT EXISTS support_tickets (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    ticket_number VARCHAR(32) NOT NULL UNIQUE,
    user_id BIGINT UNSIGNED NOT NULL,
    role VARCHAR(32) NOT NULL DEFAULT 'customer',
    order_id BIGINT UNSIGNED NULL,
    restaurant_id BIGINT UNSIGNED NULL,
    delivery_partner_id BIGINT UNSIGNED NULL,
    category VARCHAR(64) NOT NULL,
    subject VARCHAR(160) NOT NULL,
    description TEXT NOT NULL,
    priority ENUM('low', 'normal', 'high', 'urgent') NOT NULL DEFAULT 'normal',
    status ENUM('open', 'in_progress', 'waiting_on_customer', 'resolved', 'closed') NOT NULL DEFAULT 'open',
    assigned_admin_id BIGINT UNSIGNED NULL,
    resolution TEXT NULL,
    resolved_at DATETIME NULL,
    closed_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_support_tickets_user (user_id, created_at),
    INDEX idx_support_tickets_order (order_id),
    INDEX idx_support_tickets_status (status, priority, created_at)
);

CREATE TABLE IF NOT EXISTS support_messages (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    ticket_id BIGINT UNSIGNED NOT NULL,
    sender_id BIGINT UNSIGNED NOT NULL,
    sender_role VARCHAR(32) NOT NULL,
    message TEXT NOT NULL,
    is_internal TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_support_messages_ticket (ticket_id, created_at),
    CONSTRAINT fk_support_messages_ticket
        FOREIGN KEY (ticket_id) REFERENCES support_tickets(id)
        ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS refund_requests (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    refund_number VARCHAR(32) NOT NULL UNIQUE,
    order_id BIGINT UNSIGNED NOT NULL,
    customer_id BIGINT UNSIGNED NOT NULL,
    support_ticket_id BIGINT UNSIGNED NULL,
    amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    reason VARCHAR(255) NOT NULL,
    status ENUM('requested', 'under_review', 'approved', 'rejected', 'processing', 'processed', 'failed') NOT NULL DEFAULT 'requested',
    payment_reference VARCHAR(128) NULL,
    gateway_refund_id VARCHAR(128) NULL,
    admin_id BIGINT UNSIGNED NULL,
    admin_notes TEXT NULL,
    requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    processed_at DATETIME NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_refund_requests_customer (customer_id, requested_at),
    INDEX idx_refund_requests_order (order_id),
    INDEX idx_refund_requests_status (status, requested_at),
    CONSTRAINT fk_refund_requests_ticket
        FOREIGN KEY (support_ticket_id) REFERENCES support_tickets(id)
        ON DELETE SET NULL
);

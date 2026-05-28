CREATE TABLE IF NOT EXISTS payments (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    order_id BIGINT UNSIGNED NOT NULL,
    customer_id BIGINT UNSIGNED NOT NULL,
    payment_gateway VARCHAR(64) NOT NULL,
    gateway_transaction_id VARCHAR(128) NOT NULL,
    amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    currency CHAR(3) NOT NULL DEFAULT 'INR',
    payment_status ENUM('pending', 'authorized', 'captured', 'completed', 'failed', 'refunded') NOT NULL DEFAULT 'pending',
    idempotency_key VARCHAR(128) NULL,
    gateway_payload JSON NULL,
    paid_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_payments_gateway_transaction (payment_gateway, gateway_transaction_id),
    UNIQUE KEY uniq_payments_idempotency (idempotency_key),
    INDEX idx_payments_order (order_id),
    INDEX idx_payments_customer (customer_id, created_at),
    INDEX idx_payments_status (payment_status, created_at)
);

CREATE TABLE IF NOT EXISTS order_financials (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    order_id BIGINT UNSIGNED NOT NULL,
    food_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    delivery_fee DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    platform_fee DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    tax_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    discount_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    tip_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    restaurant_commission_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    restaurant_net_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    delivery_partner_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    platform_profit_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    refund_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    calculation_version VARCHAR(32) NOT NULL DEFAULT 'v1',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_order_financials_order (order_id),
    INDEX idx_order_financials_created (created_at)
);

CREATE TABLE IF NOT EXISTS restaurant_settlements (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    restaurant_id BIGINT UNSIGNED NOT NULL,
    order_id BIGINT UNSIGNED NOT NULL,
    gross_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    commission_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    penalty_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    bonus_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    refund_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    net_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    settlement_status ENUM('pending', 'approved', 'processing', 'paid', 'failed', 'frozen', 'rejected') NOT NULL DEFAULT 'pending',
    settlement_date DATE NULL,
    transaction_reference VARCHAR(128) NULL,
    approved_by BIGINT UNSIGNED NULL,
    admin_notes TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_restaurant_settlement_order (order_id),
    INDEX idx_restaurant_settlements_restaurant (restaurant_id, settlement_status),
    INDEX idx_restaurant_settlements_status (settlement_status, created_at)
);

CREATE TABLE IF NOT EXISTS delivery_partner_earnings (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    delivery_partner_id BIGINT UNSIGNED NOT NULL,
    order_id BIGINT UNSIGNED NOT NULL,
    base_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    distance_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    surge_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    bonus_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    tip_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    penalty_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    net_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    earning_status ENUM('pending', 'approved', 'paid', 'held', 'reversed') NOT NULL DEFAULT 'pending',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_delivery_earning_order (order_id),
    INDEX idx_delivery_earnings_partner (delivery_partner_id, earning_status),
    INDEX idx_delivery_earnings_created (created_at)
);

CREATE TABLE IF NOT EXISTS delivery_partner_payouts (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    delivery_partner_id BIGINT UNSIGNED NOT NULL,
    total_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    payout_status ENUM('pending', 'approved', 'processing', 'paid', 'failed', 'frozen', 'rejected') NOT NULL DEFAULT 'pending',
    payout_date DATE NULL,
    transaction_reference VARCHAR(128) NULL,
    approved_by BIGINT UNSIGNED NULL,
    admin_notes TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    INDEX idx_delivery_payouts_partner (delivery_partner_id, payout_status),
    INDEX idx_delivery_payouts_status (payout_status, created_at)
);

CREATE TABLE IF NOT EXISTS refund_transactions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    order_id BIGINT UNSIGNED NOT NULL,
    payment_id BIGINT UNSIGNED NULL,
    refund_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    refund_reason VARCHAR(255) NOT NULL,
    refund_status ENUM('pending', 'processing', 'completed', 'failed', 'rejected') NOT NULL DEFAULT 'pending',
    gateway_refund_id VARCHAR(128) NULL,
    idempotency_key VARCHAR(128) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_refund_idempotency (idempotency_key),
    INDEX idx_refund_transactions_order (order_id),
    INDEX idx_refund_transactions_status (refund_status, created_at)
);

CREATE TABLE IF NOT EXISTS financial_penalties (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    entity_type ENUM('restaurant', 'delivery_partner', 'customer') NOT NULL,
    entity_id BIGINT UNSIGNED NOT NULL,
    order_id BIGINT UNSIGNED NULL,
    penalty_type VARCHAR(80) NOT NULL,
    penalty_reason VARCHAR(255) NOT NULL,
    amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    status ENUM('pending', 'applied', 'waived', 'reversed') NOT NULL DEFAULT 'pending',
    created_by BIGINT UNSIGNED NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    INDEX idx_financial_penalties_entity (entity_type, entity_id, status),
    INDEX idx_financial_penalties_order (order_id)
);

CREATE TABLE IF NOT EXISTS financial_transaction_logs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    transaction_type VARCHAR(80) NOT NULL,
    entity_type VARCHAR(40) NOT NULL,
    entity_id BIGINT UNSIGNED NOT NULL,
    order_id BIGINT UNSIGNED NULL,
    amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    currency CHAR(3) NOT NULL DEFAULT 'INR',
    direction ENUM('credit', 'debit') NOT NULL,
    reference_type VARCHAR(80) NULL,
    reference_id BIGINT UNSIGNED NULL,
    idempotency_key VARCHAR(128) NULL,
    metadata JSON NULL,
    created_by BIGINT UNSIGNED NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_financial_log_idempotency (idempotency_key),
    INDEX idx_financial_logs_entity (entity_type, entity_id, created_at),
    INDEX idx_financial_logs_order (order_id),
    INDEX idx_financial_logs_type (transaction_type, created_at)
);

CREATE DATABASE IF NOT EXISTS gote_marketplace
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE gote_marketplace;

CREATE TABLE IF NOT EXISTS sellers (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    store_name VARCHAR(80) NOT NULL,
    address VARCHAR(180) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    email VARCHAR(254) NOT NULL UNIQUE,
    product_category VARCHAR(80) NOT NULL,
    other_category VARCHAR(80) NOT NULL DEFAULT '',
    products VARCHAR(500) NOT NULL,
    nin_encrypted VARBINARY(64) NOT NULL,
    password_salt BINARY(16) NOT NULL,
    password_hash BINARY(32) NOT NULL,
    created_at VARCHAR(40) NOT NULL
) ENGINE=InnoDB
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS seller_sessions (
    token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    seller_id BIGINT UNSIGNED NOT NULL,
    expires_at VARCHAR(40) NOT NULL,
    CONSTRAINT fk_seller_sessions_seller
        FOREIGN KEY (seller_id) REFERENCES sellers(id) ON DELETE CASCADE
) ENGINE=InnoDB
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS products (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    seller_id BIGINT UNSIGNED NOT NULL,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(1000) NOT NULL,
    price BIGINT UNSIGNED NOT NULL,
    created_at VARCHAR(40) NOT NULL,
    CONSTRAINT fk_products_seller
        FOREIGN KEY (seller_id) REFERENCES sellers(id) ON DELETE CASCADE,
    INDEX idx_products_created (created_at, id)
) ENGINE=InnoDB
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS product_images (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    product_id BIGINT UNSIGNED NOT NULL,
    blob_url VARCHAR(2048) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
    position TINYINT UNSIGNED NOT NULL,
    CONSTRAINT fk_product_images_product
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    INDEX idx_product_images_position (product_id, position)
) ENGINE=InnoDB
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pending_product_images (
    blob_url VARCHAR(2048) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    seller_id BIGINT UNSIGNED NOT NULL,
    pathname VARCHAR(512) NOT NULL,
    content_type VARCHAR(40) NOT NULL,
    size BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    CONSTRAINT fk_pending_images_seller
        FOREIGN KEY (seller_id) REFERENCES sellers(id) ON DELETE CASCADE,
    INDEX idx_pending_images_seller (seller_id, created_at)
) ENGINE=InnoDB
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

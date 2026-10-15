USE gote_marketplace;

ALTER TABLE product_images
    CHANGE COLUMN filename blob_url
    VARCHAR(2048) CHARACTER SET ascii COLLATE ascii_bin NOT NULL;

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

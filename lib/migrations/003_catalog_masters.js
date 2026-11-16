"use strict";

module.exports = Object.freeze({
  version: "003_catalog_masters",
  description: "Service tariff and supplier master data",
  expectedTables: Object.freeze(["tariffs", "suppliers"]),
  statements: Object.freeze([
    `CREATE TABLE IF NOT EXISTS tariffs (
      tariff_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      public_id VARCHAR(80) NOT NULL,
      legacy_id VARCHAR(128) NULL,
      name VARCHAR(180) NOT NULL,
      service_type VARCHAR(80) NOT NULL,
      price BIGINT NOT NULL,
      active TINYINT(1) NOT NULL DEFAULT 1,
      created_at_utc DATETIME(3) NOT NULL,
      updated_at_utc DATETIME(3) NOT NULL,
      version BIGINT UNSIGNED NOT NULL DEFAULT 1,
      PRIMARY KEY (tariff_id),
      UNIQUE KEY uq_tariffs_public_id (public_id),
      KEY idx_tariffs_name (name),
      KEY idx_tariffs_active (active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
    `CREATE TABLE IF NOT EXISTS suppliers (
      supplier_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      public_id VARCHAR(80) NOT NULL,
      legacy_id VARCHAR(128) NULL,
      name VARCHAR(180) NOT NULL,
      phone VARCHAR(32) NULL,
      address TEXT NULL,
      active TINYINT(1) NOT NULL DEFAULT 1,
      created_at_utc DATETIME(3) NOT NULL,
      updated_at_utc DATETIME(3) NOT NULL,
      version BIGINT UNSIGNED NOT NULL DEFAULT 1,
      PRIMARY KEY (supplier_id),
      UNIQUE KEY uq_suppliers_public_id (public_id),
      KEY idx_suppliers_name (name),
      KEY idx_suppliers_active (active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`
  ])
});

"use strict";

module.exports = Object.freeze({
  version: "001_identity_foundation",
  description: "Server-owned users, active role slots and Firebase UID identity mapping",
  statements: Object.freeze([
    \`CREATE TABLE IF NOT EXISTS users (
      user_id VARCHAR(64) NOT NULL,
      legacy_uid VARCHAR(128) NULL,
      display_name VARCHAR(120) NOT NULL,
      phone VARCHAR(32) NULL,
      active TINYINT(1) NOT NULL DEFAULT 1,
      protected_owner TINYINT(1) NOT NULL DEFAULT 0,
      created_at_utc DATETIME(3) NOT NULL,
      updated_at_utc DATETIME(3) NOT NULL,
      version BIGINT UNSIGNED NOT NULL DEFAULT 1,
      PRIMARY KEY (user_id),
      KEY idx_users_active (active),
      KEY idx_users_protected_owner (protected_owner)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin\`,
    \`CREATE TABLE IF NOT EXISTS role_assignments (
      role_assignment_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id VARCHAR(64) NOT NULL,
      role_code VARCHAR(24) NOT NULL,
      scope_type VARCHAR(24) NOT NULL DEFAULT 'clinic',
      scope_id VARCHAR(64) NULL,
      valid_from_utc DATETIME(3) NOT NULL,
      valid_to_utc DATETIME(3) NULL,
      granted_by_user_id VARCHAR(64) NOT NULL,
      created_at_utc DATETIME(3) NOT NULL,
      PRIMARY KEY (role_assignment_id),
      UNIQUE KEY uq_role_assignment_owner (role_assignment_id, user_id),
      KEY idx_role_assignments_user_valid (user_id, valid_to_utc),
      KEY idx_role_assignments_role_valid (role_code, valid_to_utc),
      CONSTRAINT fk_role_assignments_user FOREIGN KEY (user_id)
        REFERENCES users (user_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      CONSTRAINT fk_role_assignments_grantor FOREIGN KEY (granted_by_user_id)
        REFERENCES users (user_id) ON DELETE RESTRICT ON UPDATE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin\`,
    \`CREATE TABLE IF NOT EXISTS active_role_slots (
      user_id VARCHAR(64) NOT NULL,
      role_assignment_id BIGINT UNSIGNED NOT NULL,
      activated_at_utc DATETIME(3) NOT NULL,
      PRIMARY KEY (user_id),
      UNIQUE KEY uq_active_role_assignment (role_assignment_id),
      CONSTRAINT fk_active_role_slots_user FOREIGN KEY (user_id)
        REFERENCES users (user_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      CONSTRAINT fk_active_role_slots_assignment_owner FOREIGN KEY (role_assignment_id, user_id)
        REFERENCES role_assignments (role_assignment_id, user_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin\`,
    \`CREATE TABLE IF NOT EXISTS firebase_identities (
      firebase_identity_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      provider VARCHAR(24) NOT NULL,
      subject_uid VARCHAR(128) NOT NULL,
      user_id VARCHAR(64) NOT NULL,
      email_snapshot VARCHAR(254) NULL,
      created_at_utc DATETIME(3) NOT NULL,
      last_seen_at_utc DATETIME(3) NULL,
      PRIMARY KEY (firebase_identity_id),
      UNIQUE KEY uq_firebase_identity_subject (provider, subject_uid),
      KEY idx_firebase_identity_user (user_id, provider),
      CONSTRAINT fk_firebase_identity_user FOREIGN KEY (user_id)
        REFERENCES users (user_id) ON DELETE RESTRICT ON UPDATE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin\`
  ])
});

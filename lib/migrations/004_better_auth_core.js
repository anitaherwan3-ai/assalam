"use strict";

// Better Auth core schema (email/password + database-backed sessions).
// Keep this provider schema separate from clinic authorization/profile tables.
// Better Auth model names remain the canonical defaults: user/session/account/verification.
module.exports = Object.freeze({
  version: "004_better_auth_core",
  description: "Better Auth core user, session, credential account and verification tables",
  expectedTables: Object.freeze(["user", "session", "account", "verification"]),
  statements: Object.freeze([
    `CREATE TABLE IF NOT EXISTS \`user\` (
      id VARCHAR(64) NOT NULL,
      name VARCHAR(120) NOT NULL,
      email VARCHAR(254) NOT NULL,
      emailVerified TINYINT(1) NOT NULL DEFAULT 0,
      image VARCHAR(2048) NULL,
      createdAt DATETIME(3) NOT NULL,
      updatedAt DATETIME(3) NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_ba_user_email (email)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
    `CREATE TABLE IF NOT EXISTS \`session\` (
      id VARCHAR(64) NOT NULL,
      expiresAt DATETIME(3) NOT NULL,
      token VARCHAR(255) NOT NULL,
      createdAt DATETIME(3) NOT NULL,
      updatedAt DATETIME(3) NOT NULL,
      ipAddress VARCHAR(64) NULL,
      userAgent VARCHAR(512) NULL,
      userId VARCHAR(64) NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_ba_session_token (token),
      KEY idx_ba_session_user (userId),
      KEY idx_ba_session_expires (expiresAt),
      CONSTRAINT fk_ba_session_user FOREIGN KEY (userId)
        REFERENCES \`user\` (id) ON DELETE CASCADE ON UPDATE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
    `CREATE TABLE IF NOT EXISTS \`account\` (
      id VARCHAR(64) NOT NULL,
      accountId VARCHAR(255) NOT NULL,
      providerId VARCHAR(100) NOT NULL,
      userId VARCHAR(64) NOT NULL,
      accessToken TEXT NULL,
      refreshToken TEXT NULL,
      idToken TEXT NULL,
      accessTokenExpiresAt DATETIME(3) NULL,
      refreshTokenExpiresAt DATETIME(3) NULL,
      scope TEXT NULL,
      password TEXT NULL,
      createdAt DATETIME(3) NOT NULL,
      updatedAt DATETIME(3) NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_ba_account_provider_identity (providerId, accountId),
      KEY idx_ba_account_user (userId),
      CONSTRAINT fk_ba_account_user FOREIGN KEY (userId)
        REFERENCES \`user\` (id) ON DELETE CASCADE ON UPDATE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
    `CREATE TABLE IF NOT EXISTS verification (
      id VARCHAR(64) NOT NULL,
      identifier VARCHAR(255) NOT NULL,
      value TEXT NOT NULL,
      expiresAt DATETIME(3) NOT NULL,
      createdAt DATETIME(3) NOT NULL,
      updatedAt DATETIME(3) NOT NULL,
      PRIMARY KEY (id),
      KEY idx_ba_verification_identifier (identifier),
      KEY idx_ba_verification_expiry (expiresAt)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`
  ])
});

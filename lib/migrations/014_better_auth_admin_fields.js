"use strict";

// Better Auth Admin plugin fields. Pimpinan maps to provider role "admin";
// clinic Admin and Kasir remain provider role "user".
module.exports = Object.freeze({
  version: "014_better_auth_admin_fields",
  description: "Add Better Auth administrative role and ban/session metadata",
  expectedTables: Object.freeze(["user", "session"]),
  statements: Object.freeze([
    "ALTER TABLE `user` ADD COLUMN role VARCHAR(255) NOT NULL DEFAULT 'user' AFTER emailVerified",
    "ALTER TABLE `user` ADD COLUMN banned TINYINT(1) NOT NULL DEFAULT 0 AFTER role",
    "ALTER TABLE `user` ADD COLUMN banReason VARCHAR(255) NULL AFTER banned",
    "ALTER TABLE `user` ADD COLUMN banExpires DATETIME(3) NULL AFTER banReason",
    "ALTER TABLE `session` ADD COLUMN impersonatedBy VARCHAR(64) NULL AFTER userAgent"
  ])
});

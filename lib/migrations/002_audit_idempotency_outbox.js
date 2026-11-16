"use strict";

module.exports = Object.freeze({
  version: "002_audit_idempotency_outbox",
  description: "Append-oriented audit events, command idempotency and transactional outbox",
  expectedTables: Object.freeze(["audit_events", "idempotency_requests", "outbox_jobs"]),
  statements: Object.freeze([
    `CREATE TABLE IF NOT EXISTS audit_events (
      audit_event_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      event_uuid CHAR(36) NOT NULL,
      actor_user_id VARCHAR(64) NULL,
      actor_role_snapshot VARCHAR(24) NULL,
      action_code VARCHAR(80) NOT NULL,
      entity_type VARCHAR(60) NOT NULL,
      entity_id VARCHAR(100) NOT NULL,
      before_json JSON NULL,
      after_json JSON NULL,
      reason VARCHAR(255) NULL,
      request_id VARCHAR(100) NOT NULL,
      occurred_at_utc DATETIME(3) NOT NULL,
      source_ip_hash VARCHAR(128) NULL,
      PRIMARY KEY (audit_event_id),
      UNIQUE KEY uq_audit_event_uuid (event_uuid),
      KEY idx_audit_entity_time (entity_type, entity_id, occurred_at_utc),
      KEY idx_audit_actor_time (actor_user_id, occurred_at_utc),
      KEY idx_audit_occurred (occurred_at_utc),
      CONSTRAINT fk_audit_actor FOREIGN KEY (actor_user_id)
        REFERENCES users (user_id) ON DELETE RESTRICT ON UPDATE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
    `CREATE TABLE IF NOT EXISTS idempotency_requests (
      idempotency_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      actor_user_id VARCHAR(64) NOT NULL,
      command_name VARCHAR(100) NOT NULL,
      idempotency_key VARCHAR(100) NOT NULL,
      request_hash CHAR(64) NOT NULL,
      status VARCHAR(16) NOT NULL,
      response_code SMALLINT NULL,
      response_json JSON NULL,
      entity_type VARCHAR(60) NULL,
      entity_id VARCHAR(100) NULL,
      created_at_utc DATETIME(3) NOT NULL,
      expires_at_utc DATETIME(3) NULL,
      PRIMARY KEY (idempotency_id),
      UNIQUE KEY uq_idempotency_actor_command_key (actor_user_id, command_name, idempotency_key),
      KEY idx_idempotency_expiry (expires_at_utc),
      CONSTRAINT fk_idempotency_actor FOREIGN KEY (actor_user_id)
        REFERENCES users (user_id) ON DELETE RESTRICT ON UPDATE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
    `CREATE TABLE IF NOT EXISTS outbox_jobs (
      outbox_job_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      job_type VARCHAR(60) NOT NULL,
      aggregate_type VARCHAR(60) NOT NULL,
      aggregate_id VARCHAR(100) NOT NULL,
      payload_json JSON NOT NULL,
      status VARCHAR(16) NOT NULL,
      attempts INT UNSIGNED NOT NULL DEFAULT 0,
      available_at_utc DATETIME(3) NOT NULL,
      locked_at_utc DATETIME(3) NULL,
      completed_at_utc DATETIME(3) NULL,
      last_error_code VARCHAR(80) NULL,
      created_at_utc DATETIME(3) NOT NULL,
      PRIMARY KEY (outbox_job_id),
      KEY idx_outbox_status_available (status, available_at_utc),
      KEY idx_outbox_aggregate (aggregate_type, aggregate_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`
  ])
});

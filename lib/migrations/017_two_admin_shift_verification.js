"use strict";

module.exports=Object.freeze({
  version:"017_two_admin_shift_verification",
  description:"Require two distinct Admin verifiers for cashier shifts and one Pimpinan verifier for Admin shifts",
  expectedTables:Object.freeze(["shift_verification_events"]),
  statements:Object.freeze([
    "CREATE TABLE IF NOT EXISTS shift_verification_events (\n  shift_verification_event_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,\n  shift_id BIGINT UNSIGNED NOT NULL,\n  verifier_user_id VARCHAR(64) NOT NULL,\n  verifier_role VARCHAR(16) NOT NULL,\n  reason VARCHAR(255) NULL,\n  occurred_at_utc DATETIME(3) NOT NULL,\n  PRIMARY KEY (shift_verification_event_id),\n  UNIQUE KEY uq_shift_verifier_once (shift_id, verifier_user_id),\n  KEY idx_shift_verification_time (shift_id, occurred_at_utc),\n  CONSTRAINT fk_shift_verification_shift FOREIGN KEY (shift_id) REFERENCES cashier_shifts(shift_id) ON DELETE RESTRICT ON UPDATE RESTRICT,\n  CONSTRAINT fk_shift_verification_actor FOREIGN KEY (verifier_user_id) REFERENCES users(user_id) ON DELETE RESTRICT ON UPDATE RESTRICT\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin"
  ])
});

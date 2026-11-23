"use strict";

const crypto = require("node:crypto");

function repositoryError(code, message, statusCode = 409) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function jakartaBusinessDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(now);
}

function createTidbQueueRepository() {
  async function lockOpenCashierShift(connection, shiftId) {
    const [rows] = await connection.execute(
      "SELECT s.shift_id AS shiftId, s.cashier_user_id AS cashierUserId, s.business_date AS businessDate, s.status " +
      "FROM cashier_shifts s JOIN active_shift_slots a ON a.shift_id = s.shift_id AND a.cashier_user_id = s.cashier_user_id " +
      "WHERE s.shift_id = ? AND s.status = ? FOR UPDATE", [shiftId, "open"]
    );
    return rows[0] || null;
  }


  async function createCashierShift(connection, input) {
    try {
      const [result] = await connection.execute(
        "INSERT INTO cashier_shifts (public_id, cashier_user_id, business_date, shift_code, opening_float, expected_cash, status, opened_at_utc) VALUES (?, ?, ?, ?, ?, ?, 'open', UTC_TIMESTAMP(3))",
        [crypto.randomUUID(), input.cashierUserId, input.businessDate, input.shiftCode, input.openingFloat, input.openingFloat]
      );
      const shiftId = String(result.insertId);
      await connection.execute(
        "INSERT INTO active_shift_slots (cashier_user_id, shift_id, activated_at_utc) VALUES (?, ?, UTC_TIMESTAMP(3))",
        [input.cashierUserId, shiftId]
      );
      return { shiftId, shiftCode: input.shiftCode, businessDate: input.businessDate };
    } catch (error) {
      if (error && error.code === "ER_DUP_ENTRY") {
        throw repositoryError("SHIFT_ALREADY_OPEN", "Pengguna sudah memiliki shift aktif atau shift ini sudah terdaftar.", 409);
      }
      throw error;
    }
  }

  async function assignCashierQueueLane(connection, input) {
    const [users] = await connection.execute(
      "SELECT u.user_id AS userId, ba.email, ra.role_code AS role FROM users u " +
      "JOIN `user` ba ON ba.id = u.user_id " +
      "JOIN active_role_slots ars ON ars.user_id = u.user_id " +
      "JOIN role_assignments ra ON ra.role_assignment_id = ars.role_assignment_id AND ra.user_id = u.user_id " +
      "WHERE u.user_id = ? AND u.active = 1 FOR UPDATE",
      [input.cashierUserId]
    );
    if (users.length !== 1 || users[0].role !== "kasir") {
      throw repositoryError("QUEUE_LANE_TARGET_NOT_CASHIER", "Jalur antrean hanya dapat diberikan kepada akun Kasir aktif.", 400);
    }
    const email = String(users[0].email || "").toLowerCase();
    const expectedPrefix = email === "assalamkasir1@gmail.com" ? "A"
      : email === "assalamkasir2@gmail.com" ? "B" : null;
    if (!expectedPrefix || expectedPrefix !== input.prefix) {
      throw repositoryError("QUEUE_LANE_ROSTER_MISMATCH", "Kasir 1 hanya boleh menerima jalur A dan Kasir 2 jalur B. Akun Kasir lain memerlukan kebijakan Pimpinan.", 403);
    }
    const [existing] = await connection.execute(
      "SELECT assignment_id FROM cashier_queue_assignments WHERE user_id = ? AND valid_to IS NULL FOR UPDATE",
      [input.cashierUserId]
    );
    if (existing.length) {
      throw repositoryError("QUEUE_LANE_ASSIGNMENT_EXISTS", "Akun Kasir sudah memiliki penugasan jalur aktif.", 409);
    }
    const [result] = await connection.execute(
      "INSERT INTO cashier_queue_assignments (user_id, prefix, valid_from, valid_to, assigned_by_user_id, created_at_utc) VALUES (?, ?, ?, NULL, ?, UTC_TIMESTAMP(3))",
      [input.cashierUserId, input.prefix, input.validFrom, input.assignedByUserId]
    );
    return String(result.insertId);
  }

  async function listCashierShifts(actor) {
    const { getPool } = require("../tidb");
    const pool = getPool();
    const where = actor.role === "kasir" ? "WHERE s.cashier_user_id = ?" : "";
    const params = actor.role === "kasir" ? [actor.userId] : [];
    const [rows] = await pool.execute(
      "SELECT s.shift_id AS shiftId, s.cashier_user_id AS cashierUserId, u.display_name AS cashierName, " +
      "s.business_date AS businessDate, s.shift_code AS shiftCode, s.opening_float AS openingFloat, " +
      "s.expected_cash AS expectedCash, s.counted_cash AS countedCash, s.variance_amount AS varianceAmount, " +
      "s.status, s.opened_at_utc AS openedAtUtc, s.closed_at_utc AS closedAtUtc, " +
      "s.verified_at_utc AS verifiedAtUtc, (SELECT COUNT(*) FROM shift_verification_events ve WHERE ve.shift_id=s.shift_id) AS verificationCount, " +
      "CASE WHEN s.shift_code = 'admin' THEN 1 ELSE 2 END AS requiredApprovals FROM cashier_shifts s JOIN users u ON u.user_id=s.cashier_user_id " +
      where + " ORDER BY s.business_date DESC, s.opened_at_utc DESC LIMIT 100",
      params
    );
    return rows.map(row => ({ ...row, shiftId: String(row.shiftId), cashierUserId: String(row.cashierUserId),
      openingFloat: String(row.openingFloat), expectedCash: row.expectedCash == null ? null : String(row.expectedCash),
      countedCash: row.countedCash == null ? null : String(row.countedCash),
      varianceAmount: row.varianceAmount == null ? null : String(row.varianceAmount), verificationCount: Number(row.verificationCount || 0), requiredApprovals: Number(row.requiredApprovals || 1) }));
  }

  async function getClinicBusinessDate() { return jakartaBusinessDate(); }

  async function getServerNowUtc(connection) {
    const [rows] = await connection.query("SELECT DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%fZ') AS nowUtc");
    return rows[0].nowUtc;
  }

  async function lockPatient(connection, patientId) {
    const [rows] = await connection.execute("SELECT patient_id AS patientId FROM patients WHERE patient_id = ? AND active = 1 FOR UPDATE", [patientId]);
    return rows[0] || null;
  }

  async function createPatient(connection, patient) {
    const id = crypto.randomUUID();
    const [result] = await connection.execute(
      "INSERT INTO patients (public_id, full_name, phone, active, created_at_utc, created_by_user_id, updated_at_utc) VALUES (?, ?, ?, 1, UTC_TIMESTAMP(3), ?, UTC_TIMESTAMP(3))",
      [id, patient.fullName, patient.phone, patient.createdByUserId]
    );
    return String(result.insertId);
  }

  async function createEncounter(connection, input) {
    const publicId = crypto.randomUUID();
    const [result] = await connection.execute(
      "INSERT INTO patient_encounters (public_id, patient_id, business_date, service_name_snapshot, cashier_user_id, shift_id, status, created_at_utc, updated_at_utc) VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
      [publicId, input.patientId, input.businessDate, input.serviceCode, input.cashierUserId, input.shiftId, "registered"]
    );
    return { encounterId: String(result.insertId) };
  }

  async function getQueuePrefixPolicy(_connection, prefix) {
    return { approved: prefix === "A" || prefix === "B", mode: "per_lane" };
  }

  async function allocateQueueSequence(connection, input) {
    await connection.execute(
      "INSERT IGNORE INTO queue_counters (business_date, prefix, last_sequence, updated_at_utc) VALUES (?, ?, 0, UTC_TIMESTAMP(3))",
      [input.businessDate, input.prefix]
    );
    const [rows] = await connection.execute(
      "SELECT last_sequence AS lastSequence FROM queue_counters WHERE business_date = ? AND prefix = ? FOR UPDATE",
      [input.businessDate, input.prefix]
    );
    if (rows.length !== 1) throw repositoryError("QUEUE_COUNTER_UNAVAILABLE", "Counter antrean tidak tersedia.", 503);
    const next = Number(rows[0].lastSequence) + 1;
    await connection.execute(
      "UPDATE queue_counters SET last_sequence = ?, updated_at_utc = UTC_TIMESTAMP(3) WHERE business_date = ? AND prefix = ?",
      [next, input.businessDate, input.prefix]
    );
    return next;
  }

  async function createQueueTicket(connection, input) {
    const [rows] = await connection.execute(
      "SELECT cashier_user_id AS cashierUserId, shift_id AS shiftId FROM patient_encounters WHERE encounter_id = ? FOR UPDATE",
      [input.encounterId]
    );
    if (rows.length !== 1) throw repositoryError("QUEUE_ENCOUNTER_NOT_FOUND", "Kunjungan antrean tidak ditemukan.", 404);
    const owner = rows[0];
    const [assignments] = await connection.execute(
      "SELECT assignment_id FROM cashier_queue_assignments WHERE user_id = ? AND prefix = ? AND valid_from <= ? AND (valid_to IS NULL OR valid_to >= ?) ORDER BY valid_from DESC LIMIT 1 FOR UPDATE",
      [owner.cashierUserId, input.prefix, input.businessDate, input.businessDate]
    );
    if (assignments.length !== 1) throw repositoryError("QUEUE_LANE_NOT_ASSIGNED", "Kasir belum memiliki penugasan jalur antrean ini.", 403);
    const queueNumber = input.prefix + "-" + String(input.sequence).padStart(3, "0");
    const [result] = await connection.execute(
      "INSERT INTO queue_tickets (public_id, encounter_id, business_date, prefix, sequence_no, display_number, status, current_cashier_user_id, current_shift_id, registered_by_user_id, registered_at_utc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))",
      [crypto.randomUUID(), input.encounterId, input.businessDate, input.prefix, input.sequence, queueNumber, "waiting", owner.cashierUserId, owner.shiftId, owner.cashierUserId]
    );
    return { ticketId: String(result.insertId), queueNumber };
  }

  async function readQueueActiveCallPolicy() { return { mode: "per_lane" }; }

  async function lockQueueCallGuard(connection, mode, laneCode) {
    if (mode !== "per_lane" || !["A", "B"].includes(laneCode)) throw repositoryError("QUEUE_POLICY_INVALID", "Kebijakan antrean A/B tidak valid.", 409);
    const [rows] = await connection.execute("SELECT prefix, active_queue_ticket_id AS activeTicketId, version FROM queue_call_guards WHERE prefix = ? FOR UPDATE", [laneCode]);
    if (rows.length !== 1) throw repositoryError("QUEUE_GUARD_NOT_FOUND", "Pengunci jalur antrean belum disiapkan.", 503);
    return { prefix: rows[0].prefix, activeTicketId: rows[0].activeTicketId === null ? null : String(rows[0].activeTicketId), version: String(rows[0].version) };
  }

  async function lockQueueTicket(connection, ticketId) {
    const [rows] = await connection.execute(
      "SELECT queue_ticket_id AS ticketId, prefix AS laneCode, status, current_cashier_user_id AS currentCashierUserId, current_shift_id AS currentShiftId, version " +
      "FROM queue_tickets WHERE queue_ticket_id = ? FOR UPDATE", [ticketId]
    );
    return rows[0] || null;
  }

  async function assertQueueActionAllowed(_connection, ticket, actor) {
    if (!["waiting", "called"].includes(ticket.status)) throw repositoryError("QUEUE_TICKET_NOT_CALLABLE", "Status antrean tidak dapat dipanggil.", 409);
    if (actor.role === "kasir" && String(ticket.currentCashierUserId) !== actor.userId) {
      throw repositoryError("QUEUE_TICKET_NOT_OWNED", "Kasir hanya dapat memanggil antrean yang menjadi tanggung jawabnya.", 403);
    }
  }

  async function assertQueueTransferAllowed(_connection, ticket, actor) {
    if (actor.role === "kasir" && String(ticket.currentCashierUserId) !== actor.userId) {
      throw repositoryError("QUEUE_TRANSFER_NOT_OWNED", "Kasir hanya dapat melimpahkan antrean miliknya.", 403);
    }
    if (!["kasir", "admin", "pimpinan"].includes(actor.role)) throw repositoryError("QUEUE_TRANSFER_FORBIDDEN", "Aktor tidak boleh memindahkan antrean.", 403);
  }

  async function lockTargetOpenShift(connection, shiftId, cashierUserId) {
    const [rows] = await connection.execute(
      "SELECT s.shift_id AS shiftId, s.cashier_user_id AS cashierUserId FROM cashier_shifts s JOIN active_shift_slots a ON a.shift_id = s.shift_id AND a.cashier_user_id = s.cashier_user_id WHERE s.shift_id = ? AND s.cashier_user_id = ? AND s.status = ? FOR UPDATE",
      [shiftId, cashierUserId, "open"]
    );
    return rows[0] || null;
  }

  async function transferQueueTicket(connection, input) {
    const [result] = await connection.execute(
      "UPDATE queue_tickets SET current_cashier_user_id = ?, current_shift_id = ?, version = version + 1 WHERE queue_ticket_id = ? AND version = ?",
      [input.toCashierUserId, input.toShiftId, input.ticketId, input.expectedVersion]
    );
    if (Number(result.affectedRows) !== 1) throw repositoryError("QUEUE_TRANSFER_CONFLICT", "Antrean berubah saat proses pelimpahan.", 409);
    const [event] = await connection.execute(
      "INSERT INTO queue_transfer_events (queue_ticket_id, from_cashier_user_id, from_shift_id, to_cashier_user_id, to_shift_id, reason, actor_user_id, occurred_at_utc) VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))",
      [input.ticketId, input.fromCashierUserId, input.fromShiftId, input.toCashierUserId, input.toShiftId, input.reason, input.actorUserId]
    );
    return String(event.insertId);
  }

  async function findActiveQueueCall(_connection, guard) {
    return guard.activeTicketId ? { ticketId: guard.activeTicketId } : null;
  }

  async function appendQueueCallEvent(connection, input) {
    const [result] = await connection.execute(
      "INSERT INTO queue_call_events (queue_ticket_id, event_type, event_idempotency_key, actor_user_id, occurred_at_utc) VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3))",
      [input.ticketId, input.eventType, input.requestId, input.actorUserId]
    );
    return String(result.insertId);
  }

  async function setCurrentQueueCall(connection, guard, active) {
    if (guard.activeTicketId && (!active || String(active.ticketId) !== guard.activeTicketId)) {
      await connection.execute(
        "UPDATE queue_tickets SET status = ?, version = version + 1 WHERE queue_ticket_id = ? AND status = ?",
        ["waiting", guard.activeTicketId, "called"]
      );
    }
    if (active) {
      await connection.execute(
        "UPDATE queue_tickets SET status = ?, called_at_utc = COALESCE(called_at_utc, UTC_TIMESTAMP(3)), version = version + 1 WHERE queue_ticket_id = ? AND status IN (?, ?)",
        ["called", active.ticketId, "waiting", "called"]
      );
    }
    const [result] = await connection.execute(
      "UPDATE queue_call_guards SET active_queue_ticket_id = ?, version = version + 1, updated_at_utc = UTC_TIMESTAMP(3) WHERE prefix = ? AND version = ?",
      [active ? active.ticketId : null, guard.prefix, guard.version]
    );
    if (Number(result.affectedRows) !== 1) throw repositoryError("QUEUE_GUARD_CONFLICT", "Status panggilan berubah bersamaan.", 409);
  }

  async function listQueueTickets() {
    const date = jakartaBusinessDate();
    const { getPool } = require("../tidb");
    const [rows] = await getPool().execute(
      "SELECT q.queue_ticket_id AS ticketId, q.display_number AS queueNumber, q.prefix AS laneCode, q.status, q.registered_at_utc AS registeredAtUtc, " +
      "p.full_name AS patientName, u.display_name AS cashierName, q.current_cashier_user_id AS cashierUserId, q.current_shift_id AS shiftId " +
      "FROM queue_tickets q JOIN patient_encounters e ON e.encounter_id = q.encounter_id " +
      "JOIN patients p ON p.patient_id = e.patient_id JOIN users u ON u.user_id = q.current_cashier_user_id " +
      "WHERE q.business_date = ? ORDER BY q.prefix, q.sequence_no", [date]
    );
    return rows.map(row => ({ ...row, ticketId: String(row.ticketId), shiftId: String(row.shiftId), cashierUserId: String(row.cashierUserId) }));
  }

  async function getDisplayQueue() {
    const date = jakartaBusinessDate();
    const { getPool } = require("../tidb");
    const pool = getPool();
    const [rows] = await pool.execute(
      "SELECT q.queue_ticket_id AS ticketId, q.display_number AS queueNumber, q.prefix AS laneCode, q.status, " +
      "q.called_at_utc AS calledAtUtc, q.registered_at_utc AS registeredAtUtc, " +
      "p.full_name AS patientName, e.service_name_snapshot AS serviceName, u.display_name AS cashierName " +
      "FROM queue_tickets q " +
      "JOIN patient_encounters e ON e.encounter_id = q.encounter_id " +
      "JOIN patients p ON p.patient_id = e.patient_id " +
      "JOIN users u ON u.user_id = q.current_cashier_user_id " +
      "WHERE q.business_date = ? " +
      "ORDER BY q.called_at_utc DESC, q.sequence_no ASC",
      [date]
    );

    const activeCall = rows.find(r => r.status === "called") || null;
    const waiting = rows.filter(r => r.status === "waiting");
    const lastServed = rows.find(r => r.status === "completed" || r.status === "done") || null;

    let settings = {
      nama: "Klinik Assalaam Palembang",
      alamat: "Melayani dengan Sepenuh Hati dan Profesional",
      runningText: "Selamat datang di Klinik Assalaam Palembang. Mohon perhatikan nomor antrean Anda pada layar display. Jaga selalu kebersihan dan kenyamanan bersama."
    };

    try {
      const [configs] = await pool.execute(
        "SELECT config_key AS configKey, running_text AS runningText FROM display_configs WHERE active = 1 LIMIT 1"
      );
      if (configs && configs[0] && configs[0].runningText) {
        settings.runningText = configs[0].runningText;
      }
    } catch (_) {}

    try {
      const [clinicSet] = await pool.execute(
        "SELECT setting_key AS settingKey, setting_value AS settingValue FROM clinic_settings"
      );
      if (clinicSet && clinicSet.length > 0) {
        for (const item of clinicSet) {
          if (item.settingKey === "nama" || item.settingKey === "clinic_name") settings.nama = item.settingValue;
          if (item.settingKey === "alamat" || item.settingKey === "clinic_address") settings.alamat = item.settingValue;
          if (item.settingKey === "running_text" || item.settingKey === "runningTextDisplay") settings.runningText = item.settingValue;
          if (item.settingKey === "logo") settings.logo = item.settingValue;
          if (item.settingKey === "logoImg") settings.logoImg = item.settingValue;
          if (item.settingKey === "youtubeVideoId") settings.youtubeVideoId = item.settingValue;
          if (item.settingKey === "enableYoutubeDisplay") settings.enableYoutubeDisplay = item.settingValue !== "false";
        }
      }
    } catch (_) {}

    return {
      activeCall: activeCall ? {
        ticketId: String(activeCall.ticketId),
        queueNumber: activeCall.queueNumber,
        patientName: activeCall.patientName,
        laneCode: activeCall.laneCode,
        serviceName: activeCall.serviceName || "Poli Umum",
        cashierName: activeCall.cashierName,
        calledAtUtc: activeCall.calledAtUtc
      } : null,
      waiting: waiting.map(r => ({
        ticketId: String(r.ticketId),
        queueNumber: r.queueNumber,
        patientName: r.patientName,
        laneCode: r.laneCode,
        serviceName: r.serviceName || "Poli Umum"
      })),
      lastServed: lastServed ? {
        ticketId: String(lastServed.ticketId),
        queueNumber: lastServed.queueNumber,
        patientName: lastServed.patientName,
        serviceName: lastServed.serviceName || "Poli Umum"
      } : null,
      settings,
      businessDate: date,
      serverTimeUtc: new Date().toISOString()
    };
  }

  return Object.freeze({
    lockOpenCashierShift, createCashierShift, assignCashierQueueLane, listCashierShifts, getClinicBusinessDate, getServerNowUtc, lockPatient, createPatient, createEncounter,
    getQueuePrefixPolicy, allocateQueueSequence, createQueueTicket, readQueueActiveCallPolicy,
    lockQueueCallGuard, lockQueueTicket, assertQueueActionAllowed, assertQueueTransferAllowed,
    lockTargetOpenShift, transferQueueTicket, findActiveQueueCall, appendQueueCallEvent,
    setCurrentQueueCall, listQueueTickets, getDisplayQueue
  });
}

module.exports = { createTidbQueueRepository, jakartaBusinessDate };

"use strict";

const crypto = require("node:crypto");
const { withTransaction } = require("./with-transaction");
const { claimIdempotency, completeIdempotency } = require("./idempotency");
const { writeAuditEvent } = require("./audit");

function inputError(message, code = "CATALOG_INPUT_INVALID") {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = code;
  return error;
}

function cleanText(value, field, max, required = false) {
  if (value !== undefined && value !== null && typeof value !== "string") {
    throw inputError(field + " harus berupa teks.");
  }
  const text = String(value === undefined || value === null ? "" : value).trim();
  if (required && !text) throw inputError(field + " wajib diisi.");
  if (text.length > max) throw inputError(field + " melebihi batas " + max + " karakter.");
  return text || null;
}

function rupiahInteger(value) {
  let amount;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw inputError("Harga harus berupa bilangan bulat Rupiah yang aman.");
    amount = BigInt(value);
  } else if (typeof value === "string" && /^\d{1,18}$/.test(value.trim())) {
    amount = BigInt(value.trim());
  } else {
    throw inputError("Harga harus berupa bilangan bulat Rupiah tanpa desimal atau tanda negatif.");
  }
  if (amount < 0n || amount > 9223372036854775807n) throw inputError("Harga berada di luar rentang BIGINT.");
  return amount.toString();
}

function validateTariffInput(input) {
  const value = input || {};
  return Object.freeze({
    name: cleanText(value.name, "Nama tarif", 180, true),
    serviceType: cleanText(value.serviceType, "Jenis layanan", 80, true),
    price: rupiahInteger(value.price)
  });
}

function validateSupplierInput(input) {
  const value = input || {};
  return Object.freeze({
    name: cleanText(value.name, "Nama supplier", 180, true),
    phone: cleanText(value.phone, "Nomor telepon", 32),
    address: cleanText(value.address, "Alamat", 5000)
  });
}

async function listTariffs() {
  const { getPool } = require("./tidb");
  const [rows] = await getPool().execute(
    "SELECT CAST(tariff_id AS CHAR) AS id, public_id AS publicId, name, service_type AS serviceType, CAST(price AS CHAR) AS price, active, CAST(version AS CHAR) AS version FROM tariffs WHERE active = 1 ORDER BY name LIMIT 500"
  );
  return rows;
}

async function listSuppliers() {
  const { getPool } = require("./tidb");
  const [rows] = await getPool().execute(
    "SELECT CAST(supplier_id AS CHAR) AS id, public_id AS publicId, name, phone, address, active, CAST(version AS CHAR) AS version FROM suppliers WHERE active = 1 ORDER BY name LIMIT 500"
  );
  return rows;
}

async function createTariff(actor, input, idempotencyKey, requestId) {
  const normalized = validateTariffInput(input);
  return withTransaction(async connection => {
    const claim = await claimIdempotency(connection, {
      actorUserId: actor.userId,
      commandName: "catalog.tariff.create",
      idempotencyKey,
      payload: normalized
    });
    if (claim.replayed) return { statusCode: claim.responseCode, body: claim.response };

    const publicId = crypto.randomUUID();
    const [result] = await connection.execute(
      "INSERT INTO tariffs (public_id, name, service_type, price, active, created_at_utc, updated_at_utc, version) VALUES (?, ?, ?, ?, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), 1)",
      [publicId, normalized.name, normalized.serviceType, normalized.price]
    );
    const body = {
      ok: true,
      data: {
        id: String(result.insertId),
        publicId,
        name: normalized.name,
        serviceType: normalized.serviceType,
        price: normalized.price,
        active: true,
        version: "1"
      }
    };
    await writeAuditEvent(connection, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      actionCode: "CATALOG_TARIFF_CREATED",
      entityType: "tariff",
      entityId: publicId,
      after: { name: normalized.name, serviceType: normalized.serviceType, price: normalized.price },
      requestId
    });
    await completeIdempotency(connection, {
      idempotencyId: claim.idempotencyId,
      responseCode: 201,
      response: body,
      entityType: "tariff",
      entityId: publicId
    });
    return { statusCode: 201, body };
  });
}

async function createSupplier(actor, input, idempotencyKey, requestId) {
  const normalized = validateSupplierInput(input);
  return withTransaction(async connection => {
    const claim = await claimIdempotency(connection, {
      actorUserId: actor.userId,
      commandName: "catalog.supplier.create",
      idempotencyKey,
      payload: normalized
    });
    if (claim.replayed) return { statusCode: claim.responseCode, body: claim.response };

    const publicId = crypto.randomUUID();
    const [result] = await connection.execute(
      "INSERT INTO suppliers (public_id, name, phone, address, active, created_at_utc, updated_at_utc, version) VALUES (?, ?, ?, ?, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), 1)",
      [publicId, normalized.name, normalized.phone, normalized.address]
    );
    const body = {
      ok: true,
      data: {
        id: String(result.insertId),
        publicId,
        name: normalized.name,
        phone: normalized.phone,
        address: normalized.address,
        active: true,
        version: "1"
      }
    };
    await writeAuditEvent(connection, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      actionCode: "CATALOG_SUPPLIER_CREATED",
      entityType: "supplier",
      entityId: publicId,
      after: { name: normalized.name, phone: normalized.phone },
      requestId
    });
    await completeIdempotency(connection, {
      idempotencyId: claim.idempotencyId,
      responseCode: 201,
      response: body,
      entityType: "supplier",
      entityId: publicId
    });
    return { statusCode: 201, body };
  });
}


async function updateSupplier(actor, input, idempotencyKey, requestId) {
  const value = input || {};
  const publicId = cleanText(value.publicId, "ID supplier", 80, true);
  const version = expectedVersion(value.expectedVersion);
  const normalized = validateSupplierInput(value);
  return withTransaction(async connection => {
    const payload = { publicId, expectedVersion: version, ...normalized };
    const claim = await claimIdempotency(connection, {
      actorUserId: actor.userId, commandName: "catalog.supplier.update",
      idempotencyKey, payload
    });
    if (claim.replayed) return { statusCode: claim.responseCode, body: claim.response };
    const [rows] = await connection.execute(
      "SELECT supplier_id, public_id, name, phone, address, active, CAST(version AS CHAR) AS version FROM suppliers WHERE public_id = ? FOR UPDATE",
      [publicId]
    );
    if (rows.length !== 1 || Number(rows[0].active) !== 1) {
      const error = new Error("Supplier tidak ditemukan atau sudah tidak aktif.");
      error.statusCode = 404; error.code = "CATALOG_SUPPLIER_NOT_FOUND"; throw error;
    }
    const prior = rows[0];
    if (String(prior.version) !== version) {
      const error = new Error("Supplier sudah diubah oleh perangkat lain. Muat ulang sebelum menyimpan.");
      error.statusCode = 409; error.code = "CATALOG_VERSION_CONFLICT"; throw error;
    }
    const nextVersion = (BigInt(version) + 1n).toString();
    const [updated] = await connection.execute(
      "UPDATE suppliers SET name = ?, phone = ?, address = ?, updated_at_utc = UTC_TIMESTAMP(3), version = version + 1 WHERE public_id = ? AND version = ? AND active = 1",
      [normalized.name, normalized.phone, normalized.address, publicId, version]
    );
    if (Number(updated.affectedRows) !== 1) {
      const error = new Error("Supplier berubah bersamaan. Muat ulang dan coba kembali.");
      error.statusCode = 409; error.code = "CATALOG_VERSION_CONFLICT"; throw error;
    }
    const body = { ok: true, data: {
      id: String(prior.supplier_id), publicId, name: normalized.name,
      phone: normalized.phone, address: normalized.address, active: true, version: nextVersion
    }};
    await writeAuditEvent(connection, {
      actorUserId: actor.userId, actorRole: actor.role,
      actionCode: "CATALOG_SUPPLIER_UPDATED", entityType: "supplier", entityId: publicId,
      before: { name: prior.name, phone: prior.phone, version },
      after: { name: normalized.name, phone: normalized.phone, version: nextVersion },
      requestId
    });
    await completeIdempotency(connection, {
      idempotencyId: claim.idempotencyId, responseCode: 200, response: body,
      entityType: "supplier", entityId: publicId
    });
    return { statusCode: 200, body };
  });
}

async function deactivateSupplier(actor, input, idempotencyKey, requestId) {
  const value = input || {};
  const publicId = cleanText(value.publicId, "ID supplier", 80, true);
  const version = expectedVersion(value.expectedVersion);
  return withTransaction(async connection => {
    const payload = { publicId, expectedVersion: version };
    const claim = await claimIdempotency(connection, {
      actorUserId: actor.userId, commandName: "catalog.supplier.deactivate",
      idempotencyKey, payload
    });
    if (claim.replayed) return { statusCode: claim.responseCode, body: claim.response };
    const [rows] = await connection.execute(
      "SELECT supplier_id, name, phone, active, CAST(version AS CHAR) AS version FROM suppliers WHERE public_id = ? FOR UPDATE",
      [publicId]
    );
    if (rows.length !== 1 || Number(rows[0].active) !== 1) {
      const error = new Error("Supplier tidak ditemukan atau sudah tidak aktif.");
      error.statusCode = 404; error.code = "CATALOG_SUPPLIER_NOT_FOUND"; throw error;
    }
    const prior = rows[0];
    if (String(prior.version) !== version) {
      const error = new Error("Supplier sudah diubah oleh perangkat lain. Muat ulang sebelum menonaktifkan.");
      error.statusCode = 409; error.code = "CATALOG_VERSION_CONFLICT"; throw error;
    }
    const nextVersion = (BigInt(version) + 1n).toString();
    const [updated] = await connection.execute(
      "UPDATE suppliers SET active = 0, updated_at_utc = UTC_TIMESTAMP(3), version = version + 1 WHERE public_id = ? AND version = ? AND active = 1",
      [publicId, version]
    );
    if (Number(updated.affectedRows) !== 1) {
      const error = new Error("Supplier berubah bersamaan. Muat ulang dan coba kembali.");
      error.statusCode = 409; error.code = "CATALOG_VERSION_CONFLICT"; throw error;
    }
    const body = { ok: true, data: { publicId, active: false, version: nextVersion } };
    await writeAuditEvent(connection, {
      actorUserId: actor.userId, actorRole: actor.role,
      actionCode: "CATALOG_SUPPLIER_DEACTIVATED", entityType: "supplier", entityId: publicId,
      before: { name: prior.name, phone: prior.phone, active: true, version },
      after: { active: false, version: nextVersion },
      requestId
    });
    await completeIdempotency(connection, {
      idempotencyId: claim.idempotencyId, responseCode: 200, response: body,
      entityType: "supplier", entityId: publicId
    });
    return { statusCode: 200, body };
  });
}

function expectedVersion(value) {
  const text = String(value === undefined || value === null ? "" : value).trim();
  if (!/^[1-9]\d{0,19}$/.test(text)) throw inputError("Versi data wajib diisi untuk mencegah perubahan tertimpa.", "CATALOG_VERSION_REQUIRED");
  return BigInt(text).toString();
}

async function updateTariff(actor, input, idempotencyKey, requestId) {
  const value = input || {};
  const publicId = cleanText(value.publicId, "ID tarif", 80, true);
  const version = expectedVersion(value.expectedVersion);
  const normalized = validateTariffInput(value);
  return withTransaction(async connection => {
    const payload = { publicId, expectedVersion: version, ...normalized };
    const claim = await claimIdempotency(connection, {
      actorUserId: actor.userId, commandName: "catalog.tariff.update",
      idempotencyKey, payload
    });
    if (claim.replayed) return { statusCode: claim.responseCode, body: claim.response };

    const [rows] = await connection.execute(
      "SELECT tariff_id, public_id, name, service_type, CAST(price AS CHAR) AS price, active, CAST(version AS CHAR) AS version FROM tariffs WHERE public_id = ? FOR UPDATE",
      [publicId]
    );
    if (rows.length !== 1 || Number(rows[0].active) !== 1) {
      const error = new Error("Tarif tidak ditemukan atau sudah tidak aktif.");
      error.statusCode = 404; error.code = "CATALOG_TARIFF_NOT_FOUND"; throw error;
    }
    const prior = rows[0];
    if (String(prior.version) !== version) {
      const error = new Error("Tarif sudah diubah oleh perangkat lain. Muat ulang sebelum menyimpan.");
      error.statusCode = 409; error.code = "CATALOG_VERSION_CONFLICT"; throw error;
    }
    const nextVersion = (BigInt(version) + 1n).toString();
    const [updated] = await connection.execute(
      "UPDATE tariffs SET name = ?, service_type = ?, price = ?, updated_at_utc = UTC_TIMESTAMP(3), version = version + 1 WHERE public_id = ? AND version = ? AND active = 1",
      [normalized.name, normalized.serviceType, normalized.price, publicId, version]
    );
    if (Number(updated.affectedRows) !== 1) {
      const error = new Error("Tarif berubah bersamaan. Muat ulang dan coba kembali.");
      error.statusCode = 409; error.code = "CATALOG_VERSION_CONFLICT"; throw error;
    }
    const body = { ok: true, data: {
      id: String(prior.tariff_id), publicId, name: normalized.name,
      serviceType: normalized.serviceType, price: normalized.price,
      active: true, version: nextVersion
    }};
    await writeAuditEvent(connection, {
      actorUserId: actor.userId, actorRole: actor.role,
      actionCode: "CATALOG_TARIFF_UPDATED", entityType: "tariff", entityId: publicId,
      before: { name: prior.name, serviceType: prior.service_type, price: String(prior.price), version },
      after: { name: normalized.name, serviceType: normalized.serviceType, price: normalized.price, version: nextVersion },
      requestId
    });
    await completeIdempotency(connection, {
      idempotencyId: claim.idempotencyId, responseCode: 200, response: body,
      entityType: "tariff", entityId: publicId
    });
    return { statusCode: 200, body };
  });
}

async function deactivateTariff(actor, input, idempotencyKey, requestId) {
  const value = input || {};
  const publicId = cleanText(value.publicId, "ID tarif", 80, true);
  const version = expectedVersion(value.expectedVersion);
  return withTransaction(async connection => {
    const payload = { publicId, expectedVersion: version };
    const claim = await claimIdempotency(connection, {
      actorUserId: actor.userId, commandName: "catalog.tariff.deactivate",
      idempotencyKey, payload
    });
    if (claim.replayed) return { statusCode: claim.responseCode, body: claim.response };

    const [rows] = await connection.execute(
      "SELECT tariff_id, name, service_type, CAST(price AS CHAR) AS price, active, CAST(version AS CHAR) AS version FROM tariffs WHERE public_id = ? FOR UPDATE",
      [publicId]
    );
    if (rows.length !== 1 || Number(rows[0].active) !== 1) {
      const error = new Error("Tarif tidak ditemukan atau sudah tidak aktif.");
      error.statusCode = 404; error.code = "CATALOG_TARIFF_NOT_FOUND"; throw error;
    }
    const prior = rows[0];
    if (String(prior.version) !== version) {
      const error = new Error("Tarif sudah diubah oleh perangkat lain. Muat ulang sebelum menghapus.");
      error.statusCode = 409; error.code = "CATALOG_VERSION_CONFLICT"; throw error;
    }
    const nextVersion = (BigInt(version) + 1n).toString();
    const [updated] = await connection.execute(
      "UPDATE tariffs SET active = 0, updated_at_utc = UTC_TIMESTAMP(3), version = version + 1 WHERE public_id = ? AND version = ? AND active = 1",
      [publicId, version]
    );
    if (Number(updated.affectedRows) !== 1) {
      const error = new Error("Tarif berubah bersamaan. Muat ulang dan coba kembali.");
      error.statusCode = 409; error.code = "CATALOG_VERSION_CONFLICT"; throw error;
    }
    const body = { ok: true, data: { publicId, active: false, version: nextVersion } };
    await writeAuditEvent(connection, {
      actorUserId: actor.userId, actorRole: actor.role,
      actionCode: "CATALOG_TARIFF_DEACTIVATED", entityType: "tariff", entityId: publicId,
      before: { name: prior.name, serviceType: prior.service_type, price: String(prior.price), active: true, version },
      after: { active: false, version: nextVersion },
      requestId
    });
    await completeIdempotency(connection, {
      idempotencyId: claim.idempotencyId, responseCode: 200, response: body,
      entityType: "tariff", entityId: publicId
    });
    return { statusCode: 200, body };
  });
}

module.exports = {
  validateTariffInput,
  validateSupplierInput,
  validateExpectedVersion: expectedVersion,
  listTariffs,
  listSuppliers,
  createTariff,
  createSupplier,
  updateTariff,
  deactivateTariff,
  updateSupplier,
  deactivateSupplier
};

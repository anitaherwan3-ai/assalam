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

module.exports = {
  validateTariffInput,
  validateSupplierInput,
  listTariffs,
  listSuppliers,
  createTariff,
  createSupplier
};

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { validateTariffInput, validateSupplierInput } = require("../lib/catalog");

test("tariff validation accepts integer Rupiah and trims text", () => {
  assert.deepEqual(validateTariffInput({ name: " Konsultasi ", serviceType: "Konsultasi", price: "125000" }), {
    name: "Konsultasi", serviceType: "Konsultasi", price: "125000"
  });
});

test("tariff validation rejects fractions, negative and unsafe JS numbers", () => {
  for (const price of ["100.50", "-1", Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => validateTariffInput({ name: "T", serviceType: "T", price }));
  }
});

test("supplier validation allows optional phone/address and trims name", () => {
  assert.deepEqual(validateSupplierInput({ name: " Supplier A ", phone: "", address: " Gudang " }), {
    name: "Supplier A", phone: null, address: "Gudang"
  });
});

test("supplier validation rejects empty name", () => {
  assert.throws(() => validateSupplierInput({ name: " " }), /Nama supplier wajib/);
});

test("catalog validation rejects non-text values", () => {
  assert.throws(() => validateTariffInput({ name: { bad: true }, serviceType: "T", price: "10" }), /harus berupa teks/);
});

test("tariff expected version accepts only a positive decimal version", () => {
  const { validateExpectedVersion } = require("../lib/catalog");
  assert.equal(validateExpectedVersion("12"), "12");
  assert.throws(() => validateExpectedVersion("1x"));
});

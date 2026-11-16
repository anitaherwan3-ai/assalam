"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "js", "store.js"), "utf8");

function createLegacyStore() {
  let id = 0;
  const local = new Map();
  const window = { currentUser: { u: "tester", nama: "Tester", role: "admin" } };
  const context = {
    window,
    localStorage: {
      getItem(key) { return local.has(key) ? local.get(key) : null; },
      setItem(key, value) { local.set(key, String(value)); },
      removeItem(key) { local.delete(key); }
    },
    uid: () => "test-id-" + (++id),
    rp: value => String(value),
    console: { warn() {}, error() {}, log() {} },
    Intl,
    Date,
    Math,
    JSON,
    Number,
    String,
    Array,
    Object,
    Map,
    Set,
    BigInt,
    Promise
  };
  vm.runInNewContext(source, context, { filename: "js/store.js" });
  return { store: window.clinicStore, window, local };
}

function seedMedicine(store, { stock = 0, hpp = 0 } = {}) {
  store.state.obat = [{ id: "med-1", nama: "Obat Uji", satuan: "strip", stok: stock, hpp, jual: 1500, min: 1 }];
  store.state.batch = [];
  store.state.beli = [];
  store.state.returBeli = [];
  store.state.returJual = [];
  store.state.trx = [];
  store.state.loss = [];
  store.state.log = [];
}

test("legacy FEFO takes earliest unexpired batches and leaves expired stock untouched", () => {
  const { store } = createLegacyStore();
  seedMedicine(store);
  store.state.batch = [
    { id: "late", oid: "med-1", ed: "2028-02-01", qty: 5, sisa: 5, no: "LATE" },
    { id: "expired", oid: "med-1", ed: "2026-01-01", qty: 20, sisa: 20, no: "OLD" },
    { id: "early", oid: "med-1", ed: "2027-01-01", qty: 3, sisa: 3, no: "EARLY" }
  ];

  const result = store.deductBatchFEFO("med-1", 5);
  assert.equal(result.unallocated, 0);
  assert.equal(result.deductions.length, 2);
  assert.equal(result.deductions[0].bid, "early");
  assert.equal(result.deductions[0].qty, 3);
  assert.equal(result.deductions[1].bid, "late");
  assert.equal(result.deductions[1].qty, 2);
  assert.equal(store.get("batch", "expired").sisa, 20);
  assert.equal(store.get("batch", "early").sisa, 0);
  assert.equal(store.get("batch", "late").sisa, 3);
});

test("legacy FEFO rejects insufficient unexpired quantity without partial deduction", () => {
  const { store } = createLegacyStore();
  seedMedicine(store);
  store.state.batch = [
    { id: "one", oid: "med-1", ed: "2028-01-01", qty: 2, sisa: 2, no: "ONE" },
    { id: "expired", oid: "med-1", ed: "2025-01-01", qty: 50, sisa: 50, no: "OLD" }
  ];

  const result = store.deductBatchFEFO("med-1", 3);
  assert.equal(result.deductions.length, 0);
  assert.equal(result.unallocated, 1);
  assert.equal(store.get("batch", "one").sisa, 2);
  assert.equal(store.get("batch", "expired").sisa, 50);
});

test("legacy purchase records a batch and recalculates weighted-average HPP", () => {
  const { store } = createLegacyStore();
  seedMedicine(store, { stock: 10, hpp: 100 });

  const ok = store.recordPurchase({
    supplier: "Supplier Uji",
    faktur: "INV-TEST-01",
    oid: "med-1",
    qty: 10,
    total: 3000,
    tempo: "2026-12-01",
    batchNo: "BATCH-TEST-01",
    ed: "2028-01-01",
    isLunas: false
  });

  assert.equal(ok, true);
  assert.equal(store.getObat("med-1").stok, 20);
  assert.equal(store.getObat("med-1").hpp, 200);
  assert.equal(store.state.batch.length, 1);
  assert.equal(store.state.batch[0].qty, 10);
  assert.equal(store.state.batch[0].sisa, 10);
  assert.equal(store.state.beli.length, 1);
  assert.equal(store.state.beli[0].qtyAwal, 10);
  assert.equal(store.state.beli[0].totalAwal, 3000);
  assert.equal(store.state.beli[0].batchId, store.state.batch[0].id);
});

test("legacy sales return stays pending and changes stock only after approval", () => {
  const { store, window } = createLegacyStore();
  seedMedicine(store);
  store.state.trx = [{
    id: "trx-1",
    no: "NOTA-001",
    nama: "Pasien Uji",
    metode: "tunai",
    items: [{
      nama: "Obat Uji",
      t: "Obat",
      oid: "med-1",
      qty: 2,
      harga: 2500,
      hpp: 1000,
      batchDeductions: [{ bid: "batch-1", qty: 2, batchNo: "B-1", ed: "2028-01-01" }]
    }]
  }];
  store.state.batch = [{ id: "batch-1", oid: "med-1", no: "B-1", ed: "2028-01-01", qty: 2, sisa: 0 }];

  const submitted = store.processReturJual({
    trxId: "trx-1", itemIndex: 0, qtyRetur: 1, alasan: "Barang tidak terpakai"
  });
  assert.equal(submitted, true);
  const proposal = store.state.returJual[0];
  assert.equal(proposal.status, "menunggu");
  assert.equal(proposal.total, 2500);
  assert.equal(proposal.batchRestores[0].qty, 1);
  assert.equal(store.getObat("med-1").stok, 0);
  assert.equal(store.get("batch", "batch-1").sisa, 0);

  window.currentUser = { u: "admin-test", role: "admin" };
  assert.equal(store.approveReturJual(proposal.id), true);
  assert.equal(proposal.status, "disetujui");
  assert.equal(store.getObat("med-1").stok, 1);
  assert.equal(store.get("batch", "batch-1").sisa, 1);
});

test("legacy cumulative sales-return quota counts pending requests and prevents over-return", () => {
  const { store } = createLegacyStore();
  seedMedicine(store);
  store.state.trx = [{
    id: "trx-2", no: "NOTA-002", nama: "Pasien Uji",
    items: [{
      nama: "Obat Uji", t: "Obat", oid: "med-1", qty: 2, harga: 1000, hpp: 500,
      batchDeductions: [{ bid: "batch-2", qty: 2, batchNo: "B-2", ed: "2028-01-01" }]
    }]
  }];
  store.state.batch = [{ id: "batch-2", oid: "med-1", no: "B-2", ed: "2028-01-01", qty: 2, sisa: 0 }];

  assert.equal(store.processReturJual({ trxId: "trx-2", itemIndex: 0, qtyRetur: 1 }), true);
  assert.equal(store.processReturJual({ trxId: "trx-2", itemIndex: 0, qtyRetur: 2 }), false);
  assert.equal(store.state.returJual.length, 1);
  assert.equal(store.state.returJual[0].priorQty, 0);
});

test("legacy service return is permitted without any stock or batch movement", () => {
  const { store, window } = createLegacyStore();
  seedMedicine(store);
  store.state.trx = [{
    id: "trx-3", no: "NOTA-003", nama: "Pasien Uji",
    items: [{ nama: "Konsultasi", t: "Tindakan", qty: 1, harga: 50000, hpp: 0 }]
  }];

  assert.equal(store.processReturJual({ trxId: "trx-3", itemIndex: 0, qtyRetur: 1 }), true);
  const proposal = store.state.returJual[0];
  assert.equal(proposal.total, 50000);
  assert.equal(proposal.batchRestores.length, 0);
  window.currentUser = { u: "admin-test", role: "admin" };
  assert.equal(store.approveReturJual(proposal.id), true);
  assert.equal(store.getObat("med-1").stok, 0);
  assert.equal(store.state.batch.length, 0);
});

test("legacy supplier return reduces the matching batch and unpaid invoice balance", () => {
  const { store } = createLegacyStore();
  seedMedicine(store, { stock: 10, hpp: 1000 });
  store.state.batch = [{
    id: "purchase-batch", oid: "med-1", no: "PB-1",
    ed: "2028-01-01", qty: 10, sisa: 10, beli: "purchase-1"
  }];
  store.state.beli = [{
    id: "purchase-1", supplier: "Supplier Uji", faktur: "INV-2",
    oid: "med-1", qty: 10, total: 10000, lunas: false,
    qtyAwal: 10, totalAwal: 10000, hargaBeliSatuan: 1000, batchId: "purchase-batch"
  }];

  assert.equal(store.processReturBeli({ beliId: "purchase-1", qtyRetur: 2, alasan: "Rusak" }), true);
  assert.equal(store.getObat("med-1").stok, 8);
  assert.equal(store.getObat("med-1").hpp, 1000);
  assert.equal(store.get("batch", "purchase-batch").sisa, 8);
  assert.equal(store.get("beli", "purchase-1").qty, 8);
  assert.equal(store.get("beli", "purchase-1").total, 8000);
  assert.equal(store.state.returBeli[0].nilai, 2000);
});

test("legacy supplier return preserves the historical total of a paid invoice", () => {
  const { store } = createLegacyStore();
  seedMedicine(store, { stock: 10, hpp: 1000 });
  store.state.batch = [{
    id: "paid-batch", oid: "med-1", no: "PB-PAID",
    ed: "2028-01-01", qty: 10, sisa: 10, beli: "paid-purchase"
  }];
  store.state.beli = [{
    id: "paid-purchase", supplier: "Supplier Uji", faktur: "INV-PAID",
    oid: "med-1", qty: 10, total: 10000, lunas: true,
    qtyAwal: 10, totalAwal: 10000, hargaBeliSatuan: 1000, batchId: "paid-batch"
  }];

  assert.equal(store.processReturBeli({ beliId: "paid-purchase", qtyRetur: 1, alasan: "Retur supplier" }), true);
  assert.equal(store.get("beli", "paid-purchase").qty, 9);
  assert.equal(store.get("beli", "paid-purchase").total, 10000);
  assert.equal(store.state.returBeli[0].nilai, 1000);
});

test("legacy supplier return caps excessive requests; replacement must reject instead of silently clamping", () => {
  const { store } = createLegacyStore();
  seedMedicine(store, { stock: 3, hpp: 1000 });
  store.state.batch = [{
    id: "small-batch", oid: "med-1", no: "PB-SMALL",
    ed: "2028-01-01", qty: 3, sisa: 3, beli: "small-purchase"
  }];
  store.state.beli = [{
    id: "small-purchase", supplier: "Supplier Uji", faktur: "INV-SMALL",
    oid: "med-1", qty: 3, total: 3000, lunas: false,
    qtyAwal: 3, totalAwal: 3000, hargaBeliSatuan: 1000, batchId: "small-batch"
  }];

  assert.equal(store.processReturBeli({ beliId: "small-purchase", qtyRetur: 99, alasan: "Uji batas" }), true);
  assert.equal(store.get("beli", "small-purchase").qty, 0);
  assert.equal(store.get("batch", "small-batch").sisa, 0);
  assert.equal(store.state.returBeli[0].qty, 3);
  assert.equal(store.state.returBeli[0].nilai, 3000);
});


test("legacy package return restores only its original medicine batch allocations after approval", () => {
  const { store, window } = createLegacyStore();
  seedMedicine(store);
  store.state.trx = [{
    id: "trx-package",
    no: "NOTA-PKG-01",
    nama: "Pasien Paket Uji",
    metode: "tunai",
    items: [{
      nama: "Paket Perawatan",
      t: "Paket",
      qty: 1,
      harga: 90000,
      hpp: 20000,
      items: [{
        id: "med-1",
        oid: "med-1",
        type: "obat",
        nama: "Obat Uji",
        qty: 2,
        batchDeductions: [{ bid: "pkg-batch-1", qty: 2, batchNo: "PKG-1", ed: "2028-01-01" }]
      }, {
        id: "service-1",
        type: "tarif",
        nama: "Jasa Paket",
        qty: 1,
        harga: 50000
      }]
    }]
  }];
  store.state.batch = [{
    id: "pkg-batch-1", oid: "med-1", no: "PKG-1",
    ed: "2028-01-01", qty: 2, sisa: 0
  }];

  assert.equal(store.processReturJual({
    trxId: "trx-package", itemIndex: 0, qtyRetur: 1, alasan: "Paket dikembalikan"
  }), true);
  const proposal = store.state.returJual[0];
  assert.equal(proposal.status, "menunggu");
  assert.equal(proposal.total, 90000);
  assert.equal(proposal.batchRestores.length, 1);
  assert.equal(proposal.batchRestores[0].bid, "pkg-batch-1");
  assert.equal(proposal.batchRestores[0].qty, 2);
  assert.equal(store.getObat("med-1").stok, 0);

  window.currentUser = { u: "owner-test", role: "pimpinan" };
  assert.equal(store.approveReturJual(proposal.id), true);
  assert.equal(store.getObat("med-1").stok, 2);
  assert.equal(store.get("batch", "pkg-batch-1").sisa, 2);
});

test("legacy partial service returns reuse invoice discount allocation and cannot exceed sold quantity", () => {
  const { store } = createLegacyStore();
  seedMedicine(store);
  store.state.trx = [{
    id: "trx-discount",
    no: "NOTA-DISC-01",
    nama: "Pasien Diskon Uji",
    items: [
      { nama: "Tindakan Uji", t: "Tindakan", qty: 2, harga: 10000, hpp: 0 },
      { nama: "Diskon", t: "Diskon", qty: 1, harga: -3000, hpp: 0 }
    ]
  }];

  assert.equal(store.processReturJual({
    trxId: "trx-discount", itemIndex: 0, qtyRetur: 1, alasan: "Pengembalian sebagian"
  }), true);
  assert.equal(store.state.returJual[0].total, 8500);
  assert.equal(store.processReturJual({
    trxId: "trx-discount", itemIndex: 0, qtyRetur: 1, alasan: "Sisa pengembalian"
  }), true);
  assert.equal(store.state.returJual[0].total, 8500);
  assert.equal(store.state.returJual.reduce((sum, item) => sum + item.total, 0), 17000);
  assert.equal(store.processReturJual({
    trxId: "trx-discount", itemIndex: 0, qtyRetur: 1, alasan: "Melebihi kuota"
  }), false);
  assert.equal(store.state.returJual.length, 2);
});


test("legacy queue call clears same-day local active calls before marking the selected visit", () => {
  const { store } = createLegacyStore();
  seedMedicine(store);
  const todayParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date());
  const part = type => todayParts.find(entry => entry.type === type).value;
  const today = part("year") + "-" + part("month") + "-" + part("day");
  store.state.pasien = [
    { id: "p-old-a", tgl: today, no: "A-001", calling: true, done: false, status: "aktif" },
    { id: "p-old-b", tgl: today, no: "B-001", calling: true, done: false, status: "aktif" },
    { id: "p-other-day", tgl: "2026-01-01", no: "A-009", calling: true, done: false, status: "aktif" },
    { id: "p-done", tgl: today, no: "A-002", calling: false, done: true, status: "selesai" },
    { id: "p-cancelled", tgl: today, no: "A-003", calling: false, done: false, status: "batal_berobat" },
    { id: "p-selected", tgl: today, no: "A-004", calling: false, done: false, status: "aktif" }
  ];

  assert.equal(store.callPatient("p-selected"), true);
  assert.equal(store.get("pasien", "p-old-a").calling, false);
  assert.equal(store.get("pasien", "p-old-b").calling, false);
  assert.equal(store.get("pasien", "p-other-day").calling, true);
  assert.equal(store.get("pasien", "p-done").calling, false);
  assert.equal(store.get("pasien", "p-cancelled").calling, false);
  assert.equal(store.get("pasien", "p-selected").calling, true);
});

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function installCatalogUI({ enabled = true, api = {} } = {}) {
  if (typeof api.listInventory !== "function") api.listInventory = async () => ({ ok: true, data: [] });
  const window = {
    ASSALAM_TIDB_PREVIEW_BOOTSTRAP: enabled,
    assalamTiDBApi: api
  };
  const source = fs.readFileSync(require.resolve("../js/tidb-catalog-ui.js"), "utf8");
  vm.runInNewContext(source, { window, Number, String, Error, Promise, Array });
  return window;
}

test("TiDB catalog UI is enabled only for the isolated TiDB preview deployment", async () => {
  const preview = installCatalogUI();
  const production = installCatalogUI({ enabled: false });
  assert.equal(preview.assalamTiDBCatalog.enabled(), true);
  assert.equal(production.assalamTiDBCatalog.enabled(), false);
  await assert.rejects(production.assalamTiDBCatalog.ensureLoaded(), /hanya diaktifkan/);
});

test("TiDB catalog UI loads session, tariffs and suppliers from TiDB and maps app fields", async () => {
  const calls = [];
  const api = {
    getSession: async () => { calls.push("session"); return { ok: true, role: "pimpinan" }; },
    listTariffs: async () => ({ ok: true, data: [{
      publicId: "tariff-public-1", name: "Konsultasi", serviceType: "Konsultasi",
      price: "125000", active: 1, version: "3"
    }] }),
    listSuppliers: async () => ({ ok: true, data: [{
      publicId: "supplier-public-1", name: "PBF Uji", phone: null, address: "Palembang",
      active: 1, version: "2"
    }] })
  };
  const window = installCatalogUI({ api });
  await window.assalamTiDBCatalog.ensureLoaded();
  assert.deepEqual(calls, ["session"]);
  assert.deepEqual(JSON.parse(JSON.stringify(window.assalamTiDBCatalog.getTariffs()[0])), {
    id: "tariff-public-1", publicId: "tariff-public-1", nama: "Konsultasi",
    jenis: "Konsultasi", harga: 125000, active: true, version: "3"
  });
  assert.deepEqual(JSON.parse(JSON.stringify(window.assalamTiDBCatalog.getSuppliers()[0])), {
    id: "supplier-public-1", publicId: "supplier-public-1", nama: "PBF Uji",
    phone: "", address: "Palembang", active: true, version: "2"
  });
});

test("TiDB catalog UI rejects unsafe BIGINT prices instead of silently rounding", async () => {
  const window = installCatalogUI({
    api: {
      getSession: async () => ({ ok: true }),
      listTariffs: async () => ({ ok: true, data: [{
        publicId: "too-large", name: "X", serviceType: "Y",
        price: "9007199254740993", active: 1, version: "1"
      }] }),
      listSuppliers: async () => ({ ok: true, data: [] })
    }
  });
  await assert.rejects(window.assalamTiDBCatalog.ensureLoaded(), /rentang aman/);
  assert.equal(window.assalamTiDBCatalog.isLoaded(), false);
});

test("TiDB catalog UI mutation helpers send expected versions and refresh server state", async () => {
  const calls = [];
  let version = "1";
  const api = {
    newIdempotencyKey: () => "idempotency-uuid",
    getSession: async () => ({ ok: true }),
    listTariffs: async () => ({ ok: true, data: [{
      publicId: "tariff-1", name: "Tarif", serviceType: "Tindakan", price: "5000",
      active: 1, version
    }] }),
    listSuppliers: async () => ({ ok: true, data: [{
      publicId: "supplier-1", name: "PBF", phone: null, address: null,
      active: 1, version: "1"
    }] }),
    createTariff: async (data, key) => { calls.push({ op: "createTariff", data, key }); version = "2"; },
    updateTariff: async (data, key) => { calls.push({ op: "updateTariff", data, key }); version = "3"; },
    deactivateTariff: async (data, key) => { calls.push({ op: "deactivateTariff", data, key }); version = "4"; },
    createSupplier: async (data, key) => { calls.push({ op: "createSupplier", data, key }); },
    updateSupplier: async (data, key) => { calls.push({ op: "updateSupplier", data, key }); },
    deactivateSupplier: async (data, key) => { calls.push({ op: "deactivateSupplier", data, key }); }
  };
  const window = installCatalogUI({ api });
  await window.assalamTiDBCatalog.ensureLoaded();
  await window.assalamTiDBCatalog.createTariff({ name: " Tarif Baru ", serviceType: " Konsultasi ", price: 7000 });
  await window.assalamTiDBCatalog.updateSupplier({ publicId: "supplier-1", expectedVersion: "1", name: "PBF Ubah" });
  await window.assalamTiDBCatalog.deactivateSupplier("supplier-1", "2");
  assert.equal(calls[0].op, "createTariff");
  assert.equal(calls[0].data.name, "Tarif Baru");
  assert.equal(calls[0].key, "idempotency-uuid");
  assert.equal(calls[1].data.expectedVersion, "1");
  assert.equal(calls[2].op, "deactivateSupplier");
});


test("TiDB catalog UI hydrates medicine masters from inventory and creates medicines without stock/HPP writes", async () => {
  const calls = [];
  const api = {
    newIdempotencyKey: () => "medicine-idempotency-key",
    getSession: async () => ({ ok: true }),
    listTariffs: async () => ({ ok: true, data: [] }),
    listSuppliers: async () => ({ ok: true, data: [] }),
    listInventory: async () => ({ ok: true, data: [{
      medicineId: "41", publicId: "medicine-public-41", name: "Vitamin C 500mg",
      unit: "botol", sellingPrice: "20000", minimumStock: "5",
      physicalQuantity: "12", sellableQuantity: "10", unknownHppQuantity: "0",
      weightedHpp: "12000", profitCalculationStatus: "calculated", active: 1
    }] }),
    inventoryCommand: async (body, key) => { calls.push({ body, key }); }
  };
  const window = installCatalogUI({ api });
  window.clinicStore = { state: { obat: [] } };
  await window.assalamTiDBCatalog.ensureLoaded();
  assert.deepEqual(JSON.parse(JSON.stringify(window.assalamTiDBCatalog.getMedicines()[0])), {
    id: "41", medicineId: "41", publicId: "medicine-public-41",
    nama: "Vitamin C 500mg", satuan: "botol", jual: 20000, hpp: 12000,
    stok: 10, min: 5, physicalStock: 12, unknownHppQuantity: 0,
    profitCalculationStatus: "calculated", active: true
  });
  assert.equal(window.clinicStore.state.obat[0].id, "41");
  await window.assalamTiDBCatalog.createMedicine({
    name: "Paracetamol 500mg", canonicalUnit: "tablet",
    sellingPrice: 5000, minimumStock: 10
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.action, "create_medicine");
  assert.equal(calls[0].body.medicine.canonicalUnit, "tablet");
  assert.equal(calls[0].body.medicine.quantityScale, 0);
  assert.equal(Object.hasOwn(calls[0].body.medicine, "stock"), false);
  assert.equal(Object.hasOwn(calls[0].body.medicine, "hpp"), false);
  assert.equal(calls[0].key, "medicine-idempotency-key");
});

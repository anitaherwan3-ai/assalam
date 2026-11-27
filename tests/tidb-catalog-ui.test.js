"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function installCatalogUI({ enabled = true, api = {}, role = "pimpinan" } = {}) {
  const window = {
    ASSALAM_TIDB_PREVIEW_BOOTSTRAP: enabled,
    currentUser: { role },
    assalamTiDBApi: api
  };
  const source = fs.readFileSync(require.resolve("../js/tidb-catalog-ui.js"), "utf8");
  vm.runInNewContext(source, { window, Number, String, Error, Promise, Array });
  return window;
}

test("legacy local-only UI mutations fail closed while TiDB is active", () => {
  const source = fs.readFileSync(require.resolve("../js/app.js"), "utf8");
  assert.match(source, /function blockLocalMutationInTiDB\(actionLabel\)/);
  for (const action of [
    "actionAddPetty", "editPetty", "delPetty", "editObat", "delObat",
    "actionSavePaket", "delPaket", "editBiaya", "delBiaya",
    "actionSaveSettings", "actionSaveDisplayTV"
  ]) {
    const actionStart = source.indexOf("function " + action + "(");
    assert.notEqual(actionStart, -1, action + " exists");
    const body = source.slice(actionStart, source.indexOf("\n}", actionStart) + 2);
    assert.match(body, /blockLocalMutationInTiDB/, action + " blocks unsupported TiDB writes");
  }
  assert.match(source, /e\.status === 'requested' \? 'pending' : e\.status/);
  assert.match(source, /tidbExpenseId: String\(e\.expenseId\)/);
});

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

test("cashier catalog loading does not request supplier data restricted to Admin and Pimpinan", async () => {
  const calls = [];
  const window = installCatalogUI({
    role: "kasir",
    api: {
      getSession: async () => ({ ok: true }),
      listTariffs: async () => ({ ok: true, data: [] }),
      listSuppliers: async () => { calls.push("suppliers"); throw new Error("403 forbidden"); }
    }
  });
  await window.assalamTiDBCatalog.ensureLoaded();
  assert.deepEqual(calls, []);
  assert.deepEqual(JSON.parse(JSON.stringify(window.assalamTiDBCatalog.getSuppliers())), []);
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


test("cancelled TiDB encounter refreshes business date and offers a new encounter instead of restoring across dates", () => {
  const source = fs.readFileSync(require.resolve("../js/app.js"), "utf8");
  const start = source.indexOf("function actionPulihkanBatalBerobat(");
  const end = source.indexOf("\nfunction delPasien(", start);
  const body = source.slice(start, end);
  assert.match(body, /const currentClinicDate = getClinicTodayStr\(\)/);
  assert.match(body, /ENCOUNTER_RESTORE_DATE_EXPIRED/);
  assert.match(body, /api\.registerEncounter\(\{/);
  assert.match(body, /patientId: String\(p\.patientId\)/);
  assert.match(body, /queuePrefix: laneCode/);
});

test('cashier queue recovery controls call audited TiDB actions and hide call for non-callable tickets', () => {
  const app = fs.readFileSync(require.resolve('../js/app.js'), 'utf8');
  const store = fs.readFileSync(require.resolve('../js/store.js'), 'utf8');
  const api = fs.readFileSync(require.resolve('../api/queue.js'), 'utf8');
  assert.match(app, /renderTiDBQueueCallButtons\(p\)/);
  assert.match(app, /Pulihkan Status Antrean/);
  assert.match(app, /Batal Panggilan Aktif Jalur/);
  assert.match(store, /async cancelActiveQueueCall\(laneCode\)/);
  assert.match(store, /async repairQueueTicket\(patientId\)/);
  assert.match(api, /cancel_active_call/);
  assert.match(api, /repair_ticket_status/);
});

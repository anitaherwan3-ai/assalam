"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),fixture=require("../config/firebase-master-import-fixture.v1.json");
const {buildFirebaseMasterPlan}=require("../lib/firebase-master-normalization");
test("master normalization maps legacy strip to pcs and preserves medicine prices",()=>{const p=buildFirebaseMasterPlan(fixture);assert.deepEqual(p.medicines.map(x=>x.canonicalUnit),["pcs","pcs","botol"]);assert.deepEqual(p.medicines.map(x=>x.sellingPrice),[5000,15000,20000]);assert.equal(p.summary.normalizedLegacyStripCount,2);assert.equal(p.summary.stockBalancesImported,false);assert.equal(p.summary.hppImported,false);});
test("packages retain package selling price and source component snapshots",()=>{const p=buildFirebaseMasterPlan(fixture);assert.equal(p.summary.medicineCount,3);assert.equal(p.summary.tariffCount,6);assert.equal(p.summary.packageCount,3);assert.equal(p.summary.packageComponentCount,8);assert.deepEqual(p.packagePriceChecks.map(x=>x.difference),[-15000,-15000,10000]);assert.equal(p.components.find(x=>x.packageLegacyId==="p2"&&x.medicineLegacyId==="o1").componentPriceSnapshot,5000);});
test("normalizer rejects unsupported units and orphan package references",()=>{const bad=structuredClone(fixture);bad.collections.k_obat[0].data.satuan="sachet";assert.throws(()=>buildFirebaseMasterPlan(bad),{code:"MASTER_UNIT_NOT_ALLOWED"});const orphan=structuredClone(fixture);orphan.collections.k_paket[0].data.items[0].id="missing";assert.throws(()=>buildFirebaseMasterPlan(orphan),{code:"MASTER_PACKAGE_REFERENCE_UNRESOLVED"});});
test("bootstrap route and one-time safeguards remain within existing auth catch-all",()=>{const fs=require("node:fs"),route=fs.readFileSync(require.resolve("../api/auth/[...all].js"),"utf8"),owner=fs.readFileSync(require.resolve("../lib/preview-owner-bootstrap"),"utf8");assert.match(route,/preview-bootstrap/);assert.match(route,/preview-import-dry-run/);assert.match(owner,/VERCEL_ENV/);assert.match(owner,/TIDB_PREVIEW_OWNER_BOOTSTRAP_ENABLED/);assert.doesNotMatch(owner,/VERCEL_GIT_COMMIT_REF/);assert.doesNotMatch(owner,/hostname.includes/);assert.doesNotMatch(owner,/FIREBASE_PROJECT_ID/);assert.doesNotMatch(owner,/accounts:lookup/);assert.match(owner,/TIDB_PREVIEW_OWNER_BOOTSTRAP_SECRET/);assert.match(owner,/timingSafeEqual/);assert.match(owner,/GET_LOCK/);assert.match(owner,/protected_owner/);assert.throws(()=>require.resolve("../api/auth/preview-bootstrap.js"),{code:"MODULE_NOT_FOUND"});});
test("package price snapshot migration is included in guarded preview build",()=>{const m=require("../lib/migrations/016_service_package_price_snapshots"),runner=fs.readFileSync(require.resolve("../scripts/apply-preview-migrations"),"utf8");assert.match(m.statements[0],/package_price BIGINT/);assert.match(m.statements[1],/component_price_snapshot BIGINT/);assert.match(m.statements[2],/component_name_snapshot VARCHAR/);assert.match(runner,/016_service_package_price_snapshots/);});


test("Pengguna tab always exposes the master dry-run action and Pimpinan session activation", () => {
  const app = fs.readFileSync(require.resolve("../js/app.js"), "utf8");
  const viewStart = app.indexOf("function viewTiDBPengguna()");
  const viewEnd = app.indexOf("async function loadTiDBUsers()", viewStart);
  assert.ok(viewStart >= 0 && viewEnd > viewStart);
  const view = app.slice(viewStart, viewEnd);
  assert.match(view, /Dry-run Master Data → TiDB/);
  assert.match(view, /Aktifkan Sesi Pimpinan TiDB/);
  assert.match(app, /function activatePreviewTiDBSession\(\)/);
  assert.match(app, /function restoreTiDBPreviewSession\(\)/);
  assert.match(app, /signInTiDBPreview\(email,password\)/);
});

test("TiDB expenses use backend dates, optional evidence, and Pimpinan approval",()=>{
 const domain=fs.readFileSync(require.resolve("../lib/clinic-domain-commands.js"),"utf8");
 const app=fs.readFileSync(require.resolve("../js/app.js"),"utf8");
 const api=fs.readFileSync(require.resolve("../js/tidb-api.js"),"utf8");
 const create=domain.slice(domain.indexOf("async function createExpense"),domain.indexOf("async function approveExpense"));
 assert.doesNotMatch(create,/!evidenceFileId/);
 assert.match(app,/businessDate: todayStr/);
 assert.match(app,/approveExpense\(/);
 assert.match(api,/action: "approve_expense"/);
 assert.match(app,/e\.status === 'requested' \? 'pending'/);
 assert.match(app,/Perubahan pengeluaran TiDB harus melalui alur koreksi/);
});

test("TiDB checkout requires numeric server-owned encounter and shift IDs",()=>{
 const app=fs.readFileSync(require.resolve("../js/app.js"),"utf8");
 const checkout=app.slice(app.indexOf("const checkoutPayload"),app.indexOf("const checkoutRes",app.indexOf("const checkoutPayload")));
  assert.ok(app.includes("const authoritativeEncounterId = String(pasien && pasien.id || '')"));
  assert.ok(app.includes("const authoritativeShiftId = String(shift && shift.shiftId || '')"));
  assert.ok(app.includes("if (!/^\\d+$/.test(authoritativeEncounterId))"));
  assert.ok(app.includes("if (!/^\\d+$/.test(authoritativeShiftId))"));
 assert.doesNotMatch(checkout,/shift-1|enc_.*Date\.now/);
});

test("TiDB medicine hydration replaces local seed rows and waits before rendering an authenticated session",()=>{
 const app=fs.readFileSync(require.resolve("../js/app.js"),"utf8");
 assert.match(app,/else \{[\s\S]*store\.state\.obat = medRes\.data\.map/);
 assert.match(app,/store\.state\.obat = medRes\.data\.map/);
 assert.match(app,/store\.state\.obat = \[\]/);
 assert.match(app,/Data obat belum terverifikasi/);
 const login=app.slice(app.indexOf("async function signInTiDBPreview"),app.indexOf("async function activatePreviewOwnerBootstrap"));
 assert.match(login,/await syncOperationalDataFromTiDB\(\)/);
 assert.doesNotMatch(login,/listMedicines\(\)/);
});

test("Preview login and initial owner activation use TiDB, not Firebase",()=>{
 const app=fs.readFileSync(require.resolve("../js/app.js"),"utf8");
 const api=fs.readFileSync(require.resolve("../api/auth/[...all].js"),"utf8");
 const html=fs.readFileSync(require.resolve("../index.html"),"utf8");
 assert.match(app,/async function signInTiDBPreview/);
 assert.match(app,/async function activatePreviewOwnerBootstrap/);
 assert.match(app,/if \(isTiDBCatalogPreview\(\)\)/);
 assert.doesNotMatch(app,/promptPreviewPimpinanTiDBAccess/);
 assert.match(api,/async function sessionRoute/);
 assert.match(api,/path==="\/api\/auth\/session"/);
 assert.match(api,/preview-owner-status/);
 assert.match(html,/preview-owner-bootstrap/);
 assert.match(html,/tidb-queue-fix2/);
 assert.equal(html.split("\n").filter(line=>line.includes("document.write")&&line.includes("<\\\\/script>")).length,0,"dynamic script tags must close correctly");
});

test("TiDB operational sync clears stale local snapshots before applying authoritative reads",()=>{
 const app=fs.readFileSync(require.resolve("../js/app.js"),"utf8");
 const start=app.indexOf("async function syncOperationalDataFromTiDB()");
 const end=app.indexOf("\n}\n",start);
 const sync=app.slice(start,end);
 for(const collection of ["trx","returJual","batalTrx","biaya","shift","pasien"]) {
  assert.match(sync,new RegExp("store\\.state\\."+collection+" = \\[\\]"));
 }
 assert.match(sync,/Return line details are not yet exposed by the read model/);
});
test("Preview UI exposes owner activation only when the protected owner has no Better Auth identity",()=>{
 const app=fs.readFileSync(require.resolve("../js/app.js"),"utf8");
 assert.match(app,/getPreviewOwnerStatus\(\)/);
 assert.match(app,/status\.protectedOwnerCount === 1/);
 assert.match(app,/status\.protectedOwnerActive === true/);
 assert.match(app,/status\.authUserCount === 0/);
 assert.match(app,/preview-owner-bootstrap/);
});
test("owner bootstrap adopts the existing protected clinic identity without duplicating roles",()=>{
 const owner=fs.readFileSync(require.resolve("../lib/preview-owner-bootstrap"),"utf8");
 assert.match(owner,/SELECT user_id,display_name,active FROM users WHERE protected_owner=1 FOR UPDATE/);
 assert.match(owner,/reuseExistingOwner=true/);
 assert.match(owner,/SELECT role_assignment_id,role_code,scope_type,scope_id,granted_by_user_id FROM role_assignments/);
 assert.match(owner,/INSERT INTO \`user\`/);
 assert.match(owner,/if\(!reuseExistingOwner\)/);
 assert.match(owner,/PREVIEW_OWNER_MULTIPLE_RESERVED/);
 assert.match(owner,/const now=new Date\(\)/,"Better Auth DATETIME(3) fields must receive Date values");
 assert.doesNotMatch(owner,/now=Date\.now\(\)/,"Unix milliseconds must not be inserted into DATETIME fields");
 assert.match(owner,/refresh_existing_owner_credential/,"A valid protected owner bootstrap retry refreshes the credential without creating another owner");
 assert.match(owner,/PREVIEW_OWNER_CREDENTIAL_REFRESHED/);
});


test("TiDB queue registration refreshes the authoritative queue instead of appending a local patient snapshot",()=>{
 const app=fs.readFileSync(require.resolve("../js/app.js"),"utf8");
 assert.ok(app.includes("return !!(queueRes && queueRes.ok === true && Array.isArray(queueRes.data));"));
 const patientStart=app.indexOf("async function actionAddPasien()");
 const patientEnd=app.indexOf("function editPasien",patientStart);
 const patient=app.slice(patientStart,patientEnd);
 const committed=patient.slice(patient.indexOf("patient.id = allocation.id;"));
 const tidbWrite=committed.slice(0,committed.indexOf("} else {"));
 assert.ok(tidbWrite.includes("await syncOperationalDataFromTiDB()"));
 assert.ok(!tidbWrite.includes("store.state.pasien.push"));
 assert.ok(!tidbWrite.includes("store.saveLocal()"));
});


test("TiDB Preview blocks local-only operational writes instead of presenting them as persisted data",()=>{
 const app=fs.readFileSync(require.resolve("../js/app.js"),"utf8");
 assert.match(app,/function blockLocalOnlyActionInTiDBPreview/);
 const guarded=[
  ["actionAddBeli","function delBeli"],
  ["actionAddPetty","function editPetty"],
  ["editPetty","function delPetty"],
  ["delPetty","MODULE: MASTER OBAT"],
  ["actionAddLoss","function delLoss"],
  ["delLoss","MODULE: VERIFIKASI SETORAN SHIFT"],
  ["editObat","function delObat"],
  ["delObat","async function actionAddTarif"],
  ["editPasien","function actionBatalBerobat"],
  ["actionBatalBerobat","function actionPulihkanBatalBerobat"],
  ["actionPulihkanBatalBerobat","function delPasien"],
  ["delPasien","function"]
 ];
 for(const [name,endName] of guarded){
  const start=app.indexOf("function "+name+"(")>=0?app.indexOf("function "+name+"("):app.indexOf("async function "+name+"(");
  assert.ok(start>=0,name+" exists");
  const end=app.indexOf(endName,start+1);
  const body=app.slice(start,end>start?end:start+800);
  assert.match(body,/blockLocalOnlyActionInTiDBPreview/,"guard "+name);
 }
 const purchase=app.slice(app.indexOf("async function actionAddBeli()"),app.indexOf("function delBeli"));
 assert.ok(!purchase.includes("receivePurchase("),"purchase invoice UI must not call receipt API without a purchaseLineId");
});


test("TiDB queue calls use the server command and confirm the refreshed status before TV broadcast",()=>{
 const store=fs.readFileSync(require.resolve("../js/store.js"),"utf8");
 const app=fs.readFileSync(require.resolve("../js/app.js"),"utf8");
 const start=store.indexOf("callPatient(patientId)");
 const end=store.indexOf("// Kasir hanya mengajukan retur",start);
 const method=store.slice(start,end);
 const tidbStart=method.indexOf("if (window.ASSALAM_TIDB_PREVIEW_BOOTSTRAP === true");
 const tidbEnd=method.indexOf("const dateParts",tidbStart);
 const tidb=method.slice(tidbStart,tidbEnd);
 assert.ok(tidb.includes("window.assalamTiDBApi.callQueue("));
 assert.ok(tidb.includes("await sync()"));
 assert.ok(tidb.includes("!refreshed.calling"));
 assert.ok(!tidb.includes("patient.calling = true"));
 assert.ok(app.includes("window.syncOperationalDataFromTiDB = syncOperationalDataFromTiDB;"));
});

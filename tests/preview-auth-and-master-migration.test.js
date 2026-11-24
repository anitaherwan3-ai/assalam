"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),fixture=require("../config/firebase-master-import-fixture.v1.json");
const {buildFirebaseMasterPlan}=require("../lib/firebase-master-normalization");
test("master normalization maps legacy strip to pcs and preserves medicine prices",()=>{const p=buildFirebaseMasterPlan(fixture);assert.deepEqual(p.medicines.map(x=>x.canonicalUnit),["pcs","pcs","botol"]);assert.deepEqual(p.medicines.map(x=>x.sellingPrice),[5000,15000,20000]);assert.equal(p.summary.normalizedLegacyStripCount,2);assert.equal(p.summary.stockBalancesImported,false);assert.equal(p.summary.hppImported,false);});
test("packages retain package selling price and source component snapshots",()=>{const p=buildFirebaseMasterPlan(fixture);assert.equal(p.summary.medicineCount,3);assert.equal(p.summary.tariffCount,6);assert.equal(p.summary.packageCount,3);assert.equal(p.summary.packageComponentCount,8);assert.deepEqual(p.packagePriceChecks.map(x=>x.difference),[-15000,-15000,10000]);assert.equal(p.components.find(x=>x.packageLegacyId==="p2"&&x.medicineLegacyId==="o1").componentPriceSnapshot,5000);});
test("normalizer rejects unsupported units and orphan package references",()=>{const bad=structuredClone(fixture);bad.collections.k_obat[0].data.satuan="sachet";assert.throws(()=>buildFirebaseMasterPlan(bad),{code:"MASTER_UNIT_NOT_ALLOWED"});const orphan=structuredClone(fixture);orphan.collections.k_paket[0].data.items[0].id="missing";assert.throws(()=>buildFirebaseMasterPlan(orphan),{code:"MASTER_PACKAGE_REFERENCE_UNRESOLVED"});});
test("bootstrap route and one-time safeguards remain within existing auth catch-all",()=>{const fs=require("node:fs"),route=fs.readFileSync(require.resolve("../api/auth/[...all].js"),"utf8"),owner=fs.readFileSync(require.resolve("../lib/preview-owner-bootstrap"),"utf8");assert.match(route,/preview-bootstrap/);assert.match(route,/preview-import-dry-run/);assert.match(owner,/VERCEL_GIT_COMMIT_REF/);assert.doesNotMatch(owner,/FIREBASE_PROJECT_ID/);assert.doesNotMatch(owner,/accounts:lookup/);assert.match(owner,/TIDB_PREVIEW_OWNER_BOOTSTRAP_SECRET/);assert.match(owner,/timingSafeEqual/);assert.match(owner,/GET_LOCK/);assert.match(owner,/protected_owner/);assert.throws(()=>require.resolve("../api/auth/preview-bootstrap.js"),{code:"MODULE_NOT_FOUND"});});
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

test("TiDB medicine hydration replaces local seed rows and waits before rendering an authenticated session",()=>{
 const app=fs.readFileSync(require.resolve("../js/app.js"),"utf8");
 assert.match(app,/medRes\.ok === true && Array\.isArray\(medRes\.data\)/);
 assert.match(app,/store\.state\.obat = medRes\.data\.map/);
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

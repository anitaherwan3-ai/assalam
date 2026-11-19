"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const manifest=require("../config/firebase-master-import-manifest.v1.json");
test("selective import includes only critical clinic master data",()=>{
 assert.equal(manifest.sourceOfTruthBeforeCutover,"firebase");
 assert.equal(manifest.productionCutoverAllowed,false);
 assert.deepEqual(manifest.sourceCollections.map(x=>x.source),["k_obat","k_tarif","k_paket","klinik_config or settings (select the actual collection after source profiling)"]);
 assert.equal(manifest.identityProvisioning.fixedAccounts.length,5);
 assert.equal(manifest.identityProvisioning.passwordHashesImported,false);
 assert.equal(manifest.openingInventory.importLegacyStockBalances,false);
 for(const excluded of ["patients and patient encounters","sales invoices and transaction details","inventory batches, stock quantities, stocktakes and inventory movements"]) assert.ok(manifest.explicitlyExcluded.includes(excluded));
});

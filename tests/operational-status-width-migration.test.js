"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const migration=require("../lib/migrations/015_widen_operational_status_columns");
test("repair migration widens both shift status columns and is additive",()=>{
 assert.deepEqual([...migration.expectedTables].sort(),["cashier_shifts","shift_reconciliations"]);
 assert.match(migration.statements.join(" "),/cashier_shifts MODIFY COLUMN status VARCHAR\(32\) NOT NULL/);
 assert.match(migration.statements.join(" "),/shift_reconciliations MODIFY COLUMN status VARCHAR\(32\) NOT NULL/);
 assert.doesNotMatch(migration.statements.join(" "),/DROP|DELETE|TRUNCATE/);
 const build=fs.readFileSync(path.join(__dirname,"../scripts/apply-preview-migrations.js"),"utf8");
 assert.match(build,/015_widen_operational_status_columns/);
});

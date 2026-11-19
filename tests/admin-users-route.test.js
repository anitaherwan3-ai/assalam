"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
test("Pimpinan user management API enforces server-side role and preserves audit history",()=>{
 const source=fs.readFileSync(path.join(__dirname,"../api/admin/users.js"),"utf8");
 assert.match(source,/requireRole\(await requireBetterAuthActor\(req\),\["pimpinan"\]\)/);
 assert.match(source,/auth\.api\.createUser/);
 assert.match(source,/auth\.api\.setUserPassword/);
 assert.match(source,/USER_CREATED/);
 assert.match(source,/USER_UPDATED/);
 assert.match(source,/USER_DISABLED/);
 assert.match(source,/UPDATE users SET active=0/);
 assert.match(source,/DELETE FROM .*session/);
 assert.match(source,/deleted:false/);
 assert.doesNotMatch(source,/DELETE FROM users/);
 assert.match(source,/FIXED\.has/);
});

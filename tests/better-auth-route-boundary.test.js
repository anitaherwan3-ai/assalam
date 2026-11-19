"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

function read(path) {
  return fs.readFileSync(require.resolve("../" + path), "utf8");
}

test("TiDB session and catalog APIs require Better Auth, not Firebase bearer tokens", () => {
  for (const path of ["api/auth/session.js", "api/catalog/tariffs.js", "api/catalog/suppliers.js"]) {
    const source = read(path);
    assert.match(source, /requireBetterAuthActor/);
    assert.doesNotMatch(source, /requireFirebaseActor|require-auth["']/);
  }
});

test("TiDB browser adapter uses same-origin Better Auth cookies and no Firebase token", () => {
  const source = read("js/tidb-api.js");
  assert.match(source, /credentials:\s*"same-origin"/);
  assert.doesNotMatch(source, /firebaseBackend|getIdToken|Authorization/);
  assert.doesNotMatch(source, /bootstrapPreviewOwner/);
});

test("public Firebase bootstrap route is absent; open signup stays disabled and Pimpinan provider admin is enabled", () => {
  assert.throws(() => require.resolve("../api/auth/bootstrap-preview-owner.js"), { code: "MODULE_NOT_FOUND" });
  const auth = read("lib/better-auth.js");
  assert.match(auth, /disableSignUp:\s*true/);
  assert.match(auth, /adminRoles:\s*\["admin"\]/);
  assert.match(auth, /plugins:\s*\[admin\(/);
});

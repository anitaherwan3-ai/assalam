"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ROSTER, normalizeEmail, getBootstrapIdentity } = require("../lib/clinic-auth-roster");

test("bootstrap roster contains exactly five owner-approved identities", () => {
  assert.equal(Object.keys(ROSTER).length, 5);
  assert.equal(Object.values(ROSTER).filter(x => x.role === "pimpinan").length, 2);
  assert.equal(Object.values(ROSTER).filter(x => x.role === "admin").length, 1);
  assert.equal(Object.values(ROSTER).filter(x => x.role === "kasir").length, 2);
});

test("email matching is normalized and roles are assigned only by server roster", () => {
  assert.equal(normalizeEmail("  PRAKTEKROSE@GMAIL.COM "), "praktekrose@gmail.com");
  assert.equal(getBootstrapIdentity(" PRAKTEKROSE@GMAIL.COM ").role, "pimpinan");
  assert.equal(getBootstrapIdentity("assalamadmin1@gmail.com").role, "admin");
  assert.equal(getBootstrapIdentity("assalamkasir2@gmail.com").role, "kasir");
  assert.equal(getBootstrapIdentity("intruder@example.com"), null);
  assert.equal(getBootstrapIdentity(null), null);
});

test("only the primary owner is protected by the bootstrap roster", () => {
  assert.equal(getBootstrapIdentity("praktekrose@gmail.com").protectedOwner, true);
  assert.equal(getBootstrapIdentity("nursalim42@gmail.com").protectedOwner, false);
});

test("the five active clinic identities map to the owner-confirmed roles", () => {
  assert.deepEqual({
    "praktekrose@gmail.com": getBootstrapIdentity("praktekrose@gmail.com").role,
    "nursalim42@gmail.com": getBootstrapIdentity("nursalim42@gmail.com").role,
    "assalamkasir1@gmail.com": getBootstrapIdentity("assalamkasir1@gmail.com").role,
    "assalamkasir2@gmail.com": getBootstrapIdentity("assalamkasir2@gmail.com").role,
    "assalamadmin1@gmail.com": getBootstrapIdentity("assalamadmin1@gmail.com").role
  }, {
    "praktekrose@gmail.com": "pimpinan",
    "nursalim42@gmail.com": "pimpinan",
    "assalamkasir1@gmail.com": "kasir",
    "assalamkasir2@gmail.com": "kasir",
    "assalamadmin1@gmail.com": "admin"
  });
});

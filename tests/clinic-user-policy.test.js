"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { providerRole, validateNewUser, assertRosterImmutable } = require("../lib/clinic-user-policy");

test("clinic roles map to least-privilege Better Auth provider roles", () => {
  assert.equal(providerRole("pimpinan"), "admin");
  assert.equal(providerRole("admin"), "user");
  assert.equal(providerRole("kasir"), "user");
  assert.throws(() => providerRole("superadmin"));
});

test("new staff accounts require valid email, clinic role and strong password", () => {
  assert.deepEqual(validateNewUser({email:"staff@example.org",name:"Staff Baru",role:"kasir",password:"minimum-12-chars"}).providerRole,"user");
  assert.throws(() => validateNewUser({email:"bad",name:"A",role:"kasir",password:"minimum-12-chars"}));
  assert.throws(() => validateNewUser({email:"staff@example.org",name:"A",role:"kasir",password:"qwerty123"}));
  assert.throws(() => validateNewUser({email:"praktekrose@gmail.com",name:"Owner",role:"pimpinan",password:"minimum-12-chars"}), {code:"BOOTSTRAP_ROSTER_RESERVED"});
});

test("five bootstrap emails and roles are immutable", () => {
  assert.equal(assertRosterImmutable("praktekrose@gmail.com","praktekrose@gmail.com","pimpinan","owner",true),true);
  assert.throws(() => assertRosterImmutable("praktekrose@gmail.com","owner@example.org","pimpinan","owner",true), {code:"BOOTSTRAP_ROSTER_IMMUTABLE"});
  assert.throws(() => assertRosterImmutable("assalamkasir1@gmail.com","assalamkasir1@gmail.com","admin","cashier",false), {code:"BOOTSTRAP_ROSTER_IMMUTABLE"});
});

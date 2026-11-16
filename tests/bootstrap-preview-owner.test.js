"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { bootstrapPreviewOwner } = require("../lib/bootstrap-preview-owner");

function mockConnection(existing = []) {
  const calls = [];
  return {
    calls,
    async execute(sql, params) {
      calls.push({ sql, params });
      if (sql.startsWith("SELECT u.user_id")) return [existing];
      if (sql.startsWith("INSERT INTO role_assignments")) return [{ insertId: 12 }];
      if (sql.startsWith("INSERT INTO users") ||
          sql.startsWith("INSERT INTO active_role_slots") ||
          sql.startsWith("INSERT INTO firebase_identities")) return [{ affectedRows: 1 }];
      throw new Error("Unexpected bootstrap SQL: " + sql);
    }
  };
}

test("preview owner bootstrap creates only the allowlisted identity and role", async () => {
  const connection = mockConnection();
  const result = await bootstrapPreviewOwner(connection, {
    uid: "preview-firebase-uid",
    email: "praktekrose@gmail.com",
    displayName: "Pimpinan Preview"
  }, "praktekrose@gmail.com");
  assert.equal(result.status, "provisioned");
  assert.equal(connection.calls.length, 5);
  assert.match(connection.calls[0].sql, /FOR UPDATE/);
  assert.equal(connection.calls[1].params[1], "Pimpinan Preview");
  assert.equal(connection.calls[2].params[0], connection.calls[1].params[0]);
  assert.equal(connection.calls[4].params[0], "preview-firebase-uid");
});

test("preview owner bootstrap never overwrites an existing conflicting identity", async () => {
  const connection = mockConnection([{ user_id: "existing-user", active: 1, protected_owner: 0, role_code: "kasir" }]);
  await assert.rejects(
    bootstrapPreviewOwner(connection, { uid: "preview-firebase-uid", email: "praktekrose@gmail.com" }, "praktekrose@gmail.com"),
    error => error.code === "BOOTSTRAP_EXISTING_IDENTITY_CONFLICT" && error.statusCode === 409
  );
  assert.equal(connection.calls.length, 1);
});

test("preview owner bootstrap rejects an email outside the explicit preview allowlist", async () => {
  const connection = mockConnection();
  await assert.rejects(
    bootstrapPreviewOwner(connection, { uid: "some-uid", email: "nursalim422@gmail.com" }, "praktekrose@gmail.com"),
    error => error.code === "BOOTSTRAP_IDENTITY_NOT_ALLOWED"
  );
  assert.equal(connection.calls.length, 0);
});

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { verifyFirebaseIdToken } = require("../lib/firebase-token");

const projectId = "assalam-preview-test";
const nowMs = 1794862800000;

function accountStatus(token, projectId, claims) {
  return { uid: claims.sub, disabled: false, validSince: claims.auth_time - 30, email: claims.email };
}

function base64url(value) {
  return Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");
}

function makeToken(privateKey, overrides = {}, headerOverrides = {}) {
  const header = Object.assign({ alg: "RS256", kid: "test-key", typ: "JWT" }, headerOverrides);
  const claims = Object.assign({
    aud: projectId,
    iss: "https://securetoken.google.com/" + projectId,
    sub: "preview-test-uid-001",
    iat: Math.floor(nowMs / 1000) - 10,
    exp: Math.floor(nowMs / 1000) + 3500,
    auth_time: Math.floor(nowMs / 1000) - 30,
    email: "test@example.invalid",
    email_verified: true
  }, overrides);
  const signingInput = base64url(header) + "." + base64url(claims);
  const signature = crypto.sign("RSA-SHA256", Buffer.from(signingInput), privateKey).toString("base64url");
  return signingInput + "." + signature;
}

test("accepts a correctly signed Firebase token for the configured project", async () => {
  const pair = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const token = makeToken(pair.privateKey);
  const identity = await verifyFirebaseIdToken(token, projectId, {
    nowMs,
    resolveAccountStatus: accountStatus,
    resolvePublicKey: async kid => {
      assert.equal(kid, "test-key");
      return pair.publicKey;
    }
  });
  assert.equal(identity.uid, "preview-test-uid-001");
  assert.equal(identity.email, "test@example.invalid");
  assert.equal(identity.emailVerified, true);
});

test("rejects a token whose audience belongs to another Firebase project", async () => {
  const pair = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const token = makeToken(pair.privateKey, { aud: "another-project" });
  await assert.rejects(
    verifyFirebaseIdToken(token, projectId, { nowMs, resolveAccountStatus: accountStatus, resolvePublicKey: async () => pair.publicKey }),
    error => error.statusCode === 401
  );
});

test("rejects expired tokens", async () => {
  const pair = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const token = makeToken(pair.privateKey, { exp: Math.floor(nowMs / 1000) - 120 });
  await assert.rejects(
    verifyFirebaseIdToken(token, projectId, { nowMs, resolvePublicKey: async () => pair.publicKey }),
    error => error.statusCode === 401
  );
});

test("rejects invalid signatures", async () => {
  const good = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const other = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const token = makeToken(good.privateKey);
  await assert.rejects(
    verifyFirebaseIdToken(token, projectId, { nowMs, resolvePublicKey: async () => other.publicKey }),
    error => error.statusCode === 401
  );
});

test("rejects Firebase accounts disabled after token issuance", async () => {
  const pair = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const token = makeToken(pair.privateKey);
  await assert.rejects(
    verifyFirebaseIdToken(token, projectId, {
      nowMs,
      resolvePublicKey: async () => pair.publicKey,
      resolveAccountStatus: async (_token, _project, claims) => ({
        uid: claims.sub, disabled: true, validSince: claims.auth_time, email: claims.email
      })
    }),
    error => error.code === "AUTH_ACCOUNT_REVOKED" && error.statusCode === 401
  );
});

test("rejects Firebase tokens issued before the account revocation timestamp", async () => {
  const pair = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const token = makeToken(pair.privateKey);
  await assert.rejects(
    verifyFirebaseIdToken(token, projectId, {
      nowMs,
      resolvePublicKey: async () => pair.publicKey,
      resolveAccountStatus: async (_token, _project, claims) => ({
        uid: claims.sub, disabled: false, validSince: claims.auth_time + 1, email: claims.email
      })
    }),
    error => error.code === "AUTH_ACCOUNT_REVOKED" && error.statusCode === 401
  );
});

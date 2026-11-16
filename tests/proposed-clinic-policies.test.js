"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const file = path.join(__dirname, "..", "config", "proposed-clinic-policies.v1.json");

test("clinic policy register is explicitly non-operational until owner approval", () => {
  const policy = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(policy.schemaVersion, 1);
  assert.equal(policy.documentStatus, "PROPOSAL_ONLY_NOT_OWNER_APPROVAL");
  assert.equal(policy.doNotUseAsRuntimeConfig, true);
  assert.equal(policy.policyActivationAllowed, false);
  assert.equal(policy.sourceOfTruth, "firebase");
  assert.equal(policy.ownerApproval.approvedBy, null);
  assert.equal(policy.ownerApproval.approvedAtUtc, null);
  assert.equal(policy.ownerApproval.changeReference, null);
});

test("all open policy decisions from the consolidated domain contract are represented once", () => {
  const policy = JSON.parse(fs.readFileSync(file, "utf8"));
  const ids = policy.decisions.map(item => item.id);
  const expected = ["D01", "D05", "D06", "D08", "D09", "D10", "D11", "D12", "D13", "D14", "D15", "D16", "D17", "D18", "D19", "D20"];
  assert.deepEqual([...ids].sort(), [...expected].sort());
  assert.equal(new Set(ids).size, ids.length);
  for (const item of policy.decisions) {
    assert.ok(item.area, item.id + " missing area");
    assert.ok(item.status, item.id + " missing status");
    assert.ok(item.recommendation && Object.keys(item.recommendation).length > 0, item.id + " missing recommendation");
    assert.ok(Array.isArray(item.ownerMustConfirm), item.id + " missing owner questions");
    assert.ok(Array.isArray(item.blocks), item.id + " missing blocked actions");
    assert.ok(Array.isArray(item.evidence), item.id + " missing evidence list");
  }
});

test("medical-record retention baseline reflects the legal minimum and last-visit anchor", () => {
  const policy = JSON.parse(fs.readFileSync(file, "utf8"));
  const d18 = policy.decisions.find(item => item.id === "D18");
  assert.equal(d18.recommendation.minimumElectronicRetentionYears, 25);
  assert.equal(d18.recommendation.retentionAnchor, "date of patient's last visit");
});

test("protected identities are preserved and unknown account role is not inferred", () => {
  const policy = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.deepEqual(policy.protectedAccounts.map(item => item.email), [
    "assalamkasir1@gmail.com",
    "assalamkasir2@gmail.com",
    "assalamadmin@gmail.com",
    "praktekrose@gmail.com",
    "nursalim422@gmail.com"
  ]);
  assert.equal(policy.protectedAccounts[4].role, "unknown_must_verify");
});

test("no policy can be treated as approved while the proposal activation flag is false", () => {
  const policy = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.ok(policy.decisions.every(item => !["approved", "active", "implemented"].includes(item.status)));
  assert.equal(policy.policyActivationAllowed, false);
});

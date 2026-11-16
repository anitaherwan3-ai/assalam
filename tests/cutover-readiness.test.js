"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { REQUIRED_GATES, evaluateCutoverReadiness } = require("../lib/cutover-readiness");

function readyManifest() {
  const gates = Object.fromEntries(REQUIRED_GATES.map(name => [
    name,
    { passed: true, evidence: ["verified-test-artifact:" + name] }
  ]));
  return {
    schemaVersion: 1,
    sourceOfTruth: "firebase",
    targetDatabase: "tidb-cloud",
    productionCutoverAllowed: true,
    ownerApproval: {
      approvedBy: "clinic-owner",
      approvedAtUtc: "2026-11-17T00:00:00Z",
      changeReference: "explicit-owner-approval-record"
    },
    gates
  };
}

test("checked-in cutover manifest fails closed while migration is in progress", () => {
  const manifest = JSON.parse(fs.readFileSync(
    path.join(__dirname, "..", "config", "tidb-cutover-gates.json"), "utf8"
  ));
  const result = evaluateCutoverReadiness(manifest);
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes("manifest:production-cutover-not-explicitly-enabled"));
  assert.ok(result.blockers.includes("gate:ownerPolicyClosure:not-passed"));
});

test("cutover requires every required gate and evidence", () => {
  const manifest = readyManifest();
  assert.equal(evaluateCutoverReadiness(manifest).ready, true);
  manifest.gates.backupRestoreAndRollbackDrill.evidence = [];
  const result = evaluateCutoverReadiness(manifest);
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes("gate:backupRestoreAndRollbackDrill:evidence-required"));
});

test("missing gates and invalid owner approval block cutover", () => {
  const manifest = readyManifest();
  delete manifest.gates.securityAndAuthorizationValidation;
  manifest.ownerApproval.approvedAtUtc = "yesterday";
  const result = evaluateCutoverReadiness(manifest);
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes("gate:securityAndAuthorizationValidation:not-passed"));
  assert.ok(result.blockers.includes("approval:valid-utc-timestamp-required"));
});

test("source of truth cannot be switched before the approved cutover", () => {
  const manifest = readyManifest();
  manifest.sourceOfTruth = "tidb-cloud";
  const result = evaluateCutoverReadiness(manifest);
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes("manifest:source-of-truth-must-remain-firebase-before-cutover"));
});

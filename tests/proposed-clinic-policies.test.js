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

test("administrative-financial app does not misclassify its data as clinical RME records", () => {
  const policy = JSON.parse(fs.readFileSync(file, "utf8"));
  const d18 = policy.decisions.find(item => item.id === "D18");
  assert.match(d18.recommendation.applicationScope, /administrative and financial/i);
  assert.ok(d18.recommendation.excludedClinicalContent.includes("diagnosis"));
  assert.ok(d18.recommendation.separateClinicObligation.includes("Permenkes 24/2022"));
  assert.match(d18.recommendation.accountingDocuments, /10 years/);
  assert.equal(Object.hasOwn(d18.recommendation, "minimumElectronicRetentionYears"), false);
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

test("owner-confirmed decisions are recorded while global cutover remains disabled", () => {
  const policy = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const id of ["D01", "D05", "D13", "D14", "D16", "D17", "D18", "D19"]) {
    const decision = policy.decisions.find(item => item.id === id);
    assert.ok(decision && decision.ownerApprovalStatus, id + " owner decision not recorded");
  }
  assert.equal(policy.policyActivationAllowed, false);
  assert.equal(policy.sourceOfTruth, "firebase");
});

test("medicine unit approval is restricted to whole tablet, capsule, bottle and pcs", () => {
  const policy = JSON.parse(fs.readFileSync(file, "utf8"));
  const d01 = policy.decisions.find(item => item.id === "D01");
  assert.deepEqual(d01.recommendation.canonicalUnits, ["tablet", "kapsul", "botol", "pcs"]);
  assert.equal(d01.recommendation.quantityScale, 0);
});

test("queue lanes are assigned to the owner-confirmed morning and evening cashiers", () => {
  const policy = JSON.parse(fs.readFileSync(file, "utf8"));
  const d16 = policy.decisions.find(item => item.id === "D16");
  assert.match(d16.recommendation.laneRule, /Morning shift uses lane A.*assalamkasir1@gmail.com/i);
  assert.match(d16.recommendation.laneRule, /evening shift uses lane B.*assalamkasir2@gmail.com/i);
  assert.equal(d16.ownerMustConfirm.length, 0);
  assert.match(d16.recommendation.transfer, /recorded reason/i);
  assert.match(d16.recommendation.admin, /assist/i);
  assert.match(d16.recommendation.pimpinan, /full authority/i);
  assert.match(d16.recommendation.audit, /Every queue transaction and movement/i);
});


test("owner-confirmed operating policies are recorded for expenses, supplier payables, shifts and stocktake", () => {
  const policy = JSON.parse(fs.readFileSync(file, "utf8"));
  const get = id => policy.decisions.find(item => item.id === id);
  assert.match(get("D08").recommendation.workflow, /Admin.*Pimpinan approval/i);
  assert.match(get("D09").recommendation.workflow, /Remove cash advances/i);
  assert.match(get("D10").recommendation.pending, /Pending/i);
  assert.match(get("D11").recommendation.paidStatus, /entire obligation/i);
  assert.match(get("D12").recommendation.authority, /Kasir 1.*Admin.*Pimpinan/i);
  assert.match(get("D15").recommendation.knownBatchUnknownHpp, /saleable/i);
  assert.match(get("D15").recommendation.unknownLineage, /quarantine/i);
});

test("discount is stored and reversed per service line", () => {
  const policy = JSON.parse(fs.readFileSync(file, "utf8"));
  const d06 = policy.decisions.find(item => item.id === "D06");
  assert.equal(d06.status, "owner_confirmed_discount_per_service_line");
  assert.match(d06.recommendation.discountScope, /each service item\/line/i);
  assert.match(d06.recommendation.returnBasis, /original stored net charge/i);
});

test("new authentication is Better Auth with Pimpinan-managed user registration", () => {
  const policy = JSON.parse(fs.readFileSync(file, "utf8"));
  const d20 = policy.decisions.find(item => item.id === "D20");
  assert.equal(d20.status, "owner_confirmed_better_auth_tidb_managed_identity");
  assert.match(d20.recommendation.provider, /Better Auth with TiDB/i);
  assert.match(d20.recommendation.pimpinanUserManagement, /Pimpinan can register\/create users/i);
  assert.match(d20.recommendation.credentials, /Do not migrate or store Firebase passwords/i);
});

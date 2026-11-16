"use strict";

const REQUIRED_GATES = Object.freeze([
  "ownerPolicyClosure",
  "schemaV1Approval",
  "tidbDdlAndRuntimeCompatibility",
  "firebaseSourceInventoryClosure",
  "backupAndExtractionVerification",
  "dryRunImportAndReconciliation",
  "moduleParityAcrossRoles",
  "concurrencyAndMultiDeviceValidation",
  "securityAndAuthorizationValidation",
  "backupRestoreAndRollbackDrill",
  "productionCutoverApproval"
]);

function evaluateCutoverReadiness(manifest) {
  const blockers = [];
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return { ready: false, blockers: ["manifest:invalid"] };
  }
  if (manifest.schemaVersion !== 1) blockers.push("manifest:unsupported-version");
  if (manifest.sourceOfTruth !== "firebase") blockers.push("manifest:source-of-truth-must-remain-firebase-before-cutover");
  if (manifest.targetDatabase !== "tidb-cloud") blockers.push("manifest:target-database-mismatch");
  if (manifest.productionCutoverAllowed !== true) blockers.push("manifest:production-cutover-not-explicitly-enabled");

  const gates = manifest.gates && typeof manifest.gates === "object" ? manifest.gates : {};
  for (const name of REQUIRED_GATES) {
    const gate = gates[name];
    if (!gate || gate.passed !== true) {
      blockers.push("gate:" + name + ":not-passed");
      continue;
    }
    if (!Array.isArray(gate.evidence) || gate.evidence.length === 0 ||
        gate.evidence.some(item => typeof item !== "string" || !item.trim())) {
      blockers.push("gate:" + name + ":evidence-required");
    }
  }

  const approval = manifest.ownerApproval || {};
  if (manifest.productionCutoverAllowed === true) {
    if (typeof approval.approvedBy !== "string" || !approval.approvedBy.trim()) blockers.push("approval:approved-by-required");
    if (typeof approval.approvedAtUtc !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(approval.approvedAtUtc)) {
      blockers.push("approval:valid-utc-timestamp-required");
    }
    if (typeof approval.changeReference !== "string" || !approval.changeReference.trim()) blockers.push("approval:change-reference-required");
  }

  return { ready: blockers.length === 0, blockers };
}

module.exports = { REQUIRED_GATES, evaluateCutoverReadiness };

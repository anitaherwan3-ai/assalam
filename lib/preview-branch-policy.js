"use strict";

// The operational Preview branch is allowed to serve Preview-only auth diagnostics.
// This does not authorize schema writes; migration execution has a separate guard.
const ALLOWED_PREVIEW_BRANCHES = Object.freeze([
  "migration/tidb-foundation",
  "migration/tidb-operational-cutover"
]);

function isAllowedTidbPreviewBranch(ref) {
  return ALLOWED_PREVIEW_BRANCHES.includes(String(ref || ""));
}

module.exports = { ALLOWED_PREVIEW_BRANCHES, isAllowedTidbPreviewBranch };

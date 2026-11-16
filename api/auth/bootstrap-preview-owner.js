"use strict";

// Firebase-based bootstrap is intentionally disabled. New-system accounts are provisioned
// through a Pimpinan-only Better Auth workflow, never through Firebase bearer tokens.
module.exports = async function handler(_req, res) {
  res.setHeader("Cache-Control", "no-store, private");
  return res.status(404).json({ ok: false, code: "PREVIEW_BOOTSTRAP_DISABLED" });
};

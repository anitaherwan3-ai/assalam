"use strict";

const { verifyFirebaseRequest } = require("../../lib/require-auth");
const { withTransaction } = require("../../lib/with-transaction");
const { bootstrapPreviewOwner } = require("../../lib/bootstrap-preview-owner");

function enabled() {
  return process.env.VERCEL_ENV === "preview" &&
    process.env.VERCEL_GIT_COMMIT_REF === "migration/tidb-foundation" &&
    process.env.TIDB_DATABASE === "assalam_db" &&
    process.env.FIREBASE_PROJECT_ID === "assalam-preview-test" &&
    process.env.TIDB_PREVIEW_OWNER_BOOTSTRAP_ENABLED === "true";
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, private");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, code: "METHOD_NOT_ALLOWED" });
  }
  if (!enabled()) return res.status(404).json({ ok: false, code: "PREVIEW_BOOTSTRAP_DISABLED" });

  try {
    const identity = await verifyFirebaseRequest(req);
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (!identity.authTime || identity.authTime < nowSeconds - 600 || identity.authTime > nowSeconds + 60) {
      return res.status(401).json({ ok: false, code: "BOOTSTRAP_RECENT_LOGIN_REQUIRED" });
    }
    const allowedEmail = String(process.env.TIDB_PREVIEW_OWNER_EMAIL || "").trim().toLowerCase();
    if (!allowedEmail || identity.email !== allowedEmail) {
      return res.status(403).json({ ok: false, code: "BOOTSTRAP_IDENTITY_NOT_ALLOWED" });
    }
    const result = await withTransaction(connection =>
      bootstrapPreviewOwner(connection, identity, allowedEmail)
    );
    return res.status(200).json({ ok: true, service: "assalam-tidb-preview-bootstrap", ...result });
  } catch (error) {
    const status = Number(error && error.statusCode) || 503;
    if (status >= 500) {
      console.error("[PREVIEW-OWNER-BOOTSTRAP] Failed", {
        code: error && error.code ? error.code : "UNKNOWN"
      });
    }
    return res.status(status).json({
      ok: false,
      code: error && error.code ? error.code : "PREVIEW_BOOTSTRAP_UNAVAILABLE",
      message: status >= 500 ? "Preview owner bootstrap is unavailable." : error.message
    });
  }
};

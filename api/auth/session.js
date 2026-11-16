"use strict";

const { requireBetterAuthActor } = require("../../lib/require-better-auth-actor");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, private");
  res.setHeader("Vary", "Cookie");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, code: "METHOD_NOT_ALLOWED" });
  }
  try {
    const actor = await requireBetterAuthActor(req);
    return res.status(200).json({
      ok: true,
      service: "assalam-tidb-auth",
      actor: {
        userId: actor.userId, displayName: actor.displayName, role: actor.role,
        scopeType: actor.scopeType, scopeId: actor.scopeId, protectedOwner: actor.protectedOwner
      }
    });
  } catch (error) {
    const status = Number(error && error.statusCode) || 503;
    if (status >= 500) console.error("[AUTH-SESSION] Better Auth session error", { code: error.code || "UNKNOWN" });
    return res.status(status).json({
      ok: false, code: error.code || "AUTH_SERVICE_UNAVAILABLE",
      message: status >= 500 ? "Authentication service unavailable." : error.message
    });
  }
};

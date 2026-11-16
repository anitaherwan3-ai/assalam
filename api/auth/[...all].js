"use strict";

const { getBetterAuth } = require("../../lib/better-auth");
let nodeHandlerPromise;

async function handler(req, res) {
  try {
    if (!nodeHandlerPromise) {
      nodeHandlerPromise = Promise.all([
        import("better-auth/node"),
        getBetterAuth()
      ]).then(([nodeAdapter, auth]) => nodeAdapter.toNodeHandler(auth.handler));
      nodeHandlerPromise.catch(() => { nodeHandlerPromise = null; });
    }
    const nodeHandler = await nodeHandlerPromise;
    return nodeHandler(req, res);
  } catch (error) {
    console.error("[BETTER-AUTH] Handler unavailable", {
      code: error && error.code ? error.code : "AUTH_HANDLER_ERROR"
    });
    res.statusCode = 503;
    res.setHeader("Cache-Control", "no-store");
    return res.end(JSON.stringify({ ok: false, code: "AUTH_SERVICE_UNAVAILABLE" }));
  }
}

module.exports = handler;
module.exports.config = { api: { bodyParser: false } };

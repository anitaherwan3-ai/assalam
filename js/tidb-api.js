"use strict";

(function installAssalamTiDBApi() {
  function makeError(message, status, code) {
    const error = new Error(message || "Permintaan TiDB gagal.");
    error.status = status || 0;
    error.code = code || "TIDB_REQUEST_FAILED";
    return error;
  }

  function newRequestId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
    if (window.crypto && typeof window.crypto.getRandomValues === "function") {
      const bytes = new Uint8Array(16);
      window.crypto.getRandomValues(bytes);
      return Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
    }
    throw makeError("Browser tidak menyediakan generator ID aman.", 0, "SECURE_RANDOM_UNAVAILABLE");
  }

  async function request(path, options = {}) {
    const allowedPaths = new Set([
      "/api/auth/session",
      "/api/auth/bootstrap-preview-owner",
      "/api/catalog/tariffs",
      "/api/catalog/suppliers"
    ]);
    if (!allowedPaths.has(path)) {
      throw makeError("Endpoint TiDB tidak diizinkan oleh adapter.", 0, "TIDB_ENDPOINT_NOT_ALLOWED");
    }
    const backend = window.firebaseBackend;
    const firebaseUser = backend && backend.auth && backend.auth.currentUser;
    if (!firebaseUser) throw makeError("Silakan login melalui Firebase terlebih dahulu.", 401, "AUTH_REQUIRED");

    const method = String(options.method || "GET").toUpperCase();
    const token = await firebaseUser.getIdToken();
    const headers = {
      "Authorization": "Bearer " + token,
      "Accept": "application/json",
      "X-Request-ID": newRequestId()
    };
    const init = {
      method,
      headers,
      cache: "no-store",
      credentials: "same-origin"
    };
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(options.body);
    }
    if (options.idempotencyKey) headers["Idempotency-Key"] = String(options.idempotencyKey);

    const response = await fetch(path, init);
    let payload;
    try { payload = await response.json(); }
    catch (_) { throw makeError("Server TiDB mengirim respons yang tidak valid.", response.status, "TIDB_RESPONSE_INVALID"); }
    if (!response.ok) {
      throw makeError(payload && payload.message ? payload.message : "Permintaan TiDB ditolak.",
        response.status, payload && payload.code ? payload.code : "TIDB_REQUEST_FAILED");
    }
    return payload;
  }

  window.ASSALAM_TIDB_PREVIEW_BOOTSTRAP = !!(window.ASSALAM_FIREBASE_CONFIG && window.ASSALAM_FIREBASE_CONFIG.projectId === "assalam-preview-test");

  window.assalamTiDBApi = Object.freeze({
    request,
    newIdempotencyKey: newRequestId,
    getSession: () => request("/api/auth/session"),
    bootstrapPreviewOwner: () => request("/api/auth/bootstrap-preview-owner", { method: "POST", body: {} }),
    listTariffs: () => request("/api/catalog/tariffs"),
    createTariff: (data, key) => request("/api/catalog/tariffs", { method: "POST", body: data, idempotencyKey: key }),
    updateTariff: (data, key) => request("/api/catalog/tariffs", { method: "PATCH", body: data, idempotencyKey: key }),
    deactivateTariff: (data, key) => request("/api/catalog/tariffs", { method: "DELETE", body: data, idempotencyKey: key }),
    listSuppliers: () => request("/api/catalog/suppliers"),
    createSupplier: (data, key) => request("/api/catalog/suppliers", { method: "POST", body: data, idempotencyKey: key })
  });
})();

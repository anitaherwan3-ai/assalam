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
      "/api/auth/preview-bootstrap",
      "/api/auth/sign-in/email",
      "/api/auth/sign-out",
      "/api/auth/preview-import-dry-run",
      "/api/admin/users",
      "/api/catalog/tariffs",
      "/api/catalog/suppliers"
    ]);
    if (!allowedPaths.has(path)) {
      throw makeError("Endpoint TiDB tidak diizinkan oleh adapter.", 0, "TIDB_ENDPOINT_NOT_ALLOWED");
    }
    const method = String(options.method || "GET").toUpperCase();
    const headers = {
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

  window.ASSALAM_TIDB_PREVIEW_BOOTSTRAP = !!(window.location && String(window.location.hostname || "").includes("assalam-mysql-preview"));

  window.assalamTiDBApi = Object.freeze({
    request,
    newIdempotencyKey: newRequestId,
    getSession: () => request("/api/auth/session"),
    bootstrapPreviewOwner: (email, bootstrapSecret, password) => request("/api/auth/preview-bootstrap", { method:"POST", body:{email,bootstrapSecret,password} }),
    signInEmail: (email,password) => request("/api/auth/sign-in/email", { method:"POST", body:{email,password} }),
    signOut: () => request("/api/auth/sign-out", { method:"POST", body:{} }),
    previewImportDryRun: () => request("/api/auth/preview-import-dry-run", { method:"POST", body:{} }),
    listUsers: () => request("/api/admin/users"),
    createUser: data => request("/api/admin/users", { method:"POST", body:data }),
    updateUser: data => request("/api/admin/users", { method:"PATCH", body:data }),
    disableUser: userId => request("/api/admin/users", { method:"DELETE", body:{userId} }),
    listTariffs: () => request("/api/catalog/tariffs"),
    createTariff: (data, key) => request("/api/catalog/tariffs", { method: "POST", body: data, idempotencyKey: key }),
    updateTariff: (data, key) => request("/api/catalog/tariffs", { method: "PATCH", body: data, idempotencyKey: key }),
    deactivateTariff: (data, key) => request("/api/catalog/tariffs", { method: "DELETE", body: data, idempotencyKey: key }),
    listSuppliers: () => request("/api/catalog/suppliers"),
    createSupplier: (data, key) => request("/api/catalog/suppliers", { method: "POST", body: data, idempotencyKey: key }),
    updateSupplier: (data, key) => request("/api/catalog/suppliers", { method: "PATCH", body: data, idempotencyKey: key }),
    deactivateSupplier: (data, key) => request("/api/catalog/suppliers", { method: "DELETE", body: data, idempotencyKey: key })
  });
})();

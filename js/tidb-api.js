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
      "/api/auth/preview-owner-status",
      "/api/auth/preview-bootstrap",
      "/api/auth/sign-in/email",
      "/api/auth/sign-out",
      "/api/auth/preview-import-dry-run",
      "/api/admin/users",
      "/api/catalog/tariffs",
      "/api/catalog/suppliers",
      "/api/queue",
      "/api/sales",
      "/api/inventory",
      "/api/finance"
    ]);
    // Query parameters select a read view on the same API route; they are not
    // separate endpoints. Validate only the pathname, while preserving the
    // original path (including its query string) for fetch().
    const endpointPath = String(path || "").split("?", 1)[0];
    if (!allowedPaths.has(endpointPath)) {
      throw makeError("Endpoint TiDB tidak diizinkan oleh adapter.", 0, "TIDB_ENDPOINT_NOT_ALLOWED");
    }
    const method = String(options.method || "GET").toUpperCase();
    const requestId = newRequestId();
    const headers = {
      "Accept": "application/json",
      "X-Request-ID": requestId
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

    let response;
    try {
      const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timeoutMs = Number(options.timeoutMs) || 20000;
      let timer = null;
      if (controller) {
        timer = setTimeout(() => controller.abort(), timeoutMs);
        init.signal = controller.signal;
      }
      response = await fetch(path, init);
      if (timer) clearTimeout(timer);
    } catch (networkError) {
      if (networkError && networkError.name === "AbortError") {
        throw makeError("Permintaan ke server TiDB melampaui batas waktu (timeout). Periksa koneksi internet Anda.", 0, "NETWORK_TIMEOUT");
      }
      throw makeError("Gagal terhubung ke server TiDB. Periksa jaringan internet atau status server.", 0, "NETWORK_DISCONNECTED");
    }

    let payload;
    try { payload = await response.json(); }
    catch (_) { throw makeError("Server TiDB mengirim respons yang tidak valid.", response.status, "TIDB_RESPONSE_INVALID"); }
    if (!response.ok) {
      const code = payload && payload.code ? String(payload.code) : "TIDB_REQUEST_FAILED";
      const nestedMessage = payload && payload.error && typeof payload.error === "object" ? payload.error.message : "";
      const message = payload && payload.message ? payload.message
        : (nestedMessage || (payload && typeof payload.error === "string" ? payload.error : "")
          || (payload && payload.error_description ? payload.error_description : "")
          || ("Permintaan TiDB ditolak (HTTP " + response.status + ", kode " + code + ")."));
      
      if ((response.status === 401 || code === "AUTH_ACCOUNT_DISABLED") &&
          path !== "/api/auth/sign-in/email" && path !== "/api/auth/session") {
        if (typeof window.onAssalamTiDBUnauthorized === "function") {
          window.onAssalamTiDBUnauthorized(message);
        }
      }

      const error = makeError(message, response.status, code);
      error.requestId = requestId;
      throw error;
    }
    return payload;
  }

  const hostname = String(window.location && window.location.hostname || "").toLowerCase();
  window.ASSALAM_TIDB_PREVIEW_BOOTSTRAP = !!(
    hostname.includes("assalam-mysql-preview") ||
    hostname.includes("klinik-assalaam") ||
    hostname.includes("klinikassalaam") ||
    hostname === "localhost" ||
    hostname === "127.0.0.1"
  );

  window.assalamTiDBApi = Object.freeze({
    request,
    newIdempotencyKey: newRequestId,
    getSession: () => request("/api/auth/session"),
    getPreviewOwnerStatus: () => request("/api/auth/preview-owner-status"),
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
    deactivateSupplier: (data, key) => request("/api/catalog/suppliers", { method: "DELETE", body: data, idempotencyKey: key }),
    listQueueTickets: () => request("/api/queue"),
    registerEncounter: (data, key) => request("/api/queue", { method: "POST", body: Object.assign({ action: "register" }, data), idempotencyKey: key }),
    cancelEncounter: (data, key) => request("/api/queue", { method: "POST", body: Object.assign({ action: "cancel_encounter" }, data), idempotencyKey: key }),
    restoreEncounter: (data, key) => request("/api/queue", { method: "POST", body: Object.assign({ action: "restore_encounter" }, data), idempotencyKey: key }),
    callQueue: (data, key) => request("/api/queue", { method: "POST", body: Object.assign({ action: "call" }, data), idempotencyKey: key }),
    cancelActiveQueueCall: (data, key) => request("/api/queue", { method: "POST", body: Object.assign({ action: "cancel_active_call" }, data), idempotencyKey: key }),
    transferQueue: (data, key) => request("/api/queue", { method: "POST", body: Object.assign({ action: "transfer" }, data), idempotencyKey: key }),
    listSales: () => request("/api/sales"),
    checkout: (data, key) => request("/api/sales", { method: "POST", body: Object.assign({ action: "checkout" }, data), idempotencyKey: key }),
    requestSalesReturn: (data, key) => request("/api/sales", { method: "POST", body: Object.assign({ action: "return_request" }, data), idempotencyKey: key }),
    reviewSalesReturn: (data, key) => request("/api/sales", { method: "POST", body: Object.assign({ action: "return_admin_review" }, data), idempotencyKey: key }),
    approveSalesReturn: (data, key) => request("/api/sales", { method: "POST", body: Object.assign({ action: "return_pimpinan_approve" }, data), idempotencyKey: key }),
    refundSalesReturn: (data, key) => request("/api/sales", { method: "POST", body: Object.assign({ action: "refund_pimpinan_approve" }, data), idempotencyKey: key }),
    approveRefund: (data, key) => request("/api/sales", { method: "POST", body: Object.assign({ action: "refund_pimpinan_approve" }, data), idempotencyKey: key }),
    payRefund: (data, key) => request("/api/finance", { method: "POST", body: Object.assign({ action: "refund_transfer" }, data), idempotencyKey: key }),
    cancelTransaction: (data, key) => request("/api/sales", { method: "POST", body: Object.assign({ action: "cancel_transaction" }, data), idempotencyKey: key }),
    listMedicines: () => request("/api/inventory"),
    createMedicine: (data, key) => request("/api/inventory", { method: "POST", body: Object.assign({ action: "create_medicine" }, data), idempotencyKey: key }),
    listBatches: () => request("/api/inventory?batches=1"),
    listQuarantine: () => request("/api/inventory?quarantine=1"),
    inspectQuarantine: (data, key) => request("/api/inventory", { method: "POST", body: Object.assign({ action: "quarantine_inspect" }, data), idempotencyKey: key }),
    approveQuarantineRelease: (data, key) => request("/api/inventory", { method: "POST", body: Object.assign({ action: "quarantine_approve_release" }, data), idempotencyKey: key }),
    approveQuarantineDisposition: (data, key) => request("/api/inventory", { method: "POST", body: Object.assign({ action: "quarantine_approve_disposition" }, data), idempotencyKey: key }),
    releaseQuarantine: (data, key) => request("/api/inventory", { method: "POST", body: Object.assign({ action: "quarantine_release" }, data), idempotencyKey: key }),
    disposeQuarantine: (data, key) => request("/api/inventory", { method: "POST", body: Object.assign({ action: "quarantine_dispose" }, data), idempotencyKey: key }),
    listSupplierReturns: () => request("/api/inventory?supplier_returns=1"),
    listStocktakes: () => request("/api/inventory?stocktakes=1"),
    createStocktake: (data, key) => request("/api/inventory", { method: "POST", body: Object.assign({ action: "stocktake_create" }, data), idempotencyKey: key }),
    approveStocktake: (data, key) => request("/api/inventory", { method: "POST", body: Object.assign({ action: "stocktake_approve" }, data), idempotencyKey: key }),
    listSupplierInvoices: () => request("/api/inventory?invoices=1"),
    createSupplierInvoice: (data, key) => request("/api/inventory", { method: "POST", body: Object.assign({ action: "create_supplier_invoice" }, data), idempotencyKey: key }),
    receivePurchase: (data, key) => request("/api/inventory", { method: "POST", body: Object.assign({ action: "receive_purchase" }, data), idempotencyKey: key }),
    recordSupplierPayment: (data, key) => request("/api/finance", { method: "POST", body: Object.assign({ action: "record_supplier_payment" }, data), idempotencyKey: key }),
    recordPayment: (data, key) => request("/api/finance", { method: "POST", body: Object.assign({ action: "record_payment" }, data), idempotencyKey: key }),
    listFinance: () => request("/api/finance"),
    createExpense: (data, key) => request("/api/finance", { method: "POST", body: Object.assign({ action: "create_expense" }, data), idempotencyKey: key }),
    approveExpense: (data, key) => request("/api/finance", { method: "POST", body: Object.assign({ action: "approve_expense" }, data), idempotencyKey: key }),
    rejectExpense: (data, key) => request("/api/finance", { method: "POST", body: Object.assign({ action: "reject_expense" }, data), idempotencyKey: key }),
    closeShift: (data, key) => request("/api/finance", { method: "POST", body: Object.assign({ action: "close_shift" }, data), idempotencyKey: key }),
    openShift: (data, key) => request("/api/finance", { method: "POST", body: Object.assign({ action: "open_shift" }, data), idempotencyKey: key }),
    verifyShift: (data, key) => request("/api/finance", { method: "POST", body: Object.assign({ action: "verify_shift" }, data), idempotencyKey: key }),
    assignLane: (data, key) => request("/api/queue", { method: "POST", body: Object.assign({ action: "assign_lane" }, data), idempotencyKey: key }),
    listQueueAssignments: () => request("/api/queue?assignments=1"),
    listAllQueueAssignments: () => request("/api/queue?all_assignments=1")
  });
})();

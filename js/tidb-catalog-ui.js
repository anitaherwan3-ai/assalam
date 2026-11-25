"use strict";

(function installAssalamTiDBCatalogUI() {
  const state = { loaded: false, loading: false, promise: null, error: null, tariffs: [], suppliers: [] };

  function enabled() {
    return window.ASSALAM_TIDB_PREVIEW_BOOTSTRAP === true;
  }

  function requirePreview() {
    if (!enabled()) {
      const error = new Error("Katalog TiDB hanya diaktifkan pada deployment TiDB Preview terpisah.");
      error.code = "TIDB_CATALOG_PREVIEW_ONLY";
      throw error;
    }
    if (!window.assalamTiDBApi) {
      const error = new Error("Adapter API TiDB belum tersedia.");
      error.code = "TIDB_API_UNAVAILABLE";
      throw error;
    }
  }

  function mapTariff(row) {
    const price = Number(row && row.price);
    if (!Number.isSafeInteger(price) || price < 0) {
      throw new Error("Harga tarif TiDB berada di luar rentang aman tampilan Rupiah.");
    }
    const publicId = String(row.publicId || "");
    if (!publicId) throw new Error("ID publik tarif TiDB tidak tersedia.");
    return {
      id: publicId, publicId,
      nama: String(row.name || ""),
      jenis: String(row.serviceType || ""),
      harga: price,
      active: row.active === true || Number(row.active) === 1,
      version: String(row.version || "1")
    };
  }

  function mapSupplier(row) {
    const publicId = String(row && row.publicId || "");
    if (!publicId) throw new Error("ID publik supplier TiDB tidak tersedia.");
    return {
      id: publicId, publicId,
      nama: String(row.name || ""),
      phone: row.phone == null ? "" : String(row.phone),
      address: row.address == null ? "" : String(row.address),
      active: row.active === true || Number(row.active) === 1,
      version: String(row.version || "1")
    };
  }

  async function ensureLoaded(force = false) {
    requirePreview();
    if (state.promise) return state.promise;
    if (state.loaded && !force) return state;
    state.loading = true;
    state.error = null;
    state.promise = (async () => {
      if (!window.ASSALAM_TIDB_PREVIEW_SESSION) {
        window.ASSALAM_TIDB_PREVIEW_SESSION = await window.assalamTiDBApi.getSession();
      }
      const canReadSuppliers = ["admin", "pimpinan"].includes(
        String(window.currentUser && window.currentUser.role || "").toLowerCase()
      );
      const [tariffsResponse, suppliersResponse] = await Promise.all([
        window.assalamTiDBApi.listTariffs(),
        canReadSuppliers ? window.assalamTiDBApi.listSuppliers() : Promise.resolve({ data: [] })
      ]);
      const tariffRows = Array.isArray(tariffsResponse && tariffsResponse.data) ? tariffsResponse.data : [];
      const supplierRows = Array.isArray(suppliersResponse && suppliersResponse.data) ? suppliersResponse.data : [];
      state.tariffs = tariffRows.map(mapTariff);
      state.suppliers = supplierRows.map(mapSupplier);
      state.loaded = true;
      return state;
    })().catch(error => {
      state.error = error;
      state.loaded = false;
      throw error;
    }).finally(() => {
      state.loading = false;
      state.promise = null;
    });
    return state.promise;
  }

  function newKey() {
    requirePreview();
    return window.assalamTiDBApi.newIdempotencyKey();
  }

  async function createTariff(data) {
    requirePreview();
    await window.assalamTiDBApi.createTariff({
      name: String(data.name || "").trim(),
      serviceType: String(data.serviceType || "").trim(),
      price: String(data.price)
    }, newKey());
    await ensureLoaded(true);
    return state.tariffs;
  }

  async function updateTariff(data) {
    requirePreview();
    await window.assalamTiDBApi.updateTariff({
      publicId: String(data.publicId || ""),
      expectedVersion: String(data.expectedVersion || ""),
      name: String(data.name || "").trim(),
      serviceType: String(data.serviceType || "").trim(),
      price: String(data.price)
    }, newKey());
    await ensureLoaded(true);
    return state.tariffs;
  }

  async function deactivateTariff(publicId, expectedVersion) {
    requirePreview();
    await window.assalamTiDBApi.deactivateTariff({
      publicId: String(publicId || ""),
      expectedVersion: String(expectedVersion || "")
    }, newKey());
    await ensureLoaded(true);
    return state.tariffs;
  }

  async function createSupplier(data) {
    requirePreview();
    await window.assalamTiDBApi.createSupplier({
      name: String(data.name || "").trim(),
      phone: String(data.phone || "").trim(),
      address: String(data.address || "").trim()
    }, newKey());
    await ensureLoaded(true);
    return state.suppliers;
  }

  async function updateSupplier(data) {
    requirePreview();
    await window.assalamTiDBApi.updateSupplier({
      publicId: String(data.publicId || ""),
      expectedVersion: String(data.expectedVersion || ""),
      name: String(data.name || "").trim(),
      phone: String(data.phone || "").trim(),
      address: String(data.address || "").trim()
    }, newKey());
    await ensureLoaded(true);
    return state.suppliers;
  }

  async function deactivateSupplier(publicId, expectedVersion) {
    requirePreview();
    await window.assalamTiDBApi.deactivateSupplier({
      publicId: String(publicId || ""),
      expectedVersion: String(expectedVersion || "")
    }, newKey());
    await ensureLoaded(true);
    return state.suppliers;
  }

  function findById(rows, id) {
    return (rows || []).find(item => item.id === id || item.publicId === id) || null;
  }

  function clear() {
    state.loaded = false;
    state.loading = false;
    state.promise = null;
    state.error = null;
    state.tariffs = [];
    state.suppliers = [];
  }

  window.assalamTiDBCatalog = Object.freeze({
    enabled, ensureLoaded, isLoaded: () => state.loaded, isLoading: () => state.loading,
    getError: () => state.error,
    getTariffs: () => state.tariffs.slice(),
    getSuppliers: () => state.suppliers.slice(),
    findTariff: id => findById(state.tariffs, id),
    findSupplier: id => findById(state.suppliers, id),
    createTariff, updateTariff, deactivateTariff,
    createSupplier, updateSupplier, deactivateSupplier, clear
  });
})();

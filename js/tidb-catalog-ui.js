"use strict";

(function installAssalamTiDBCatalogUI() {
  const state = { loaded: false, loading: false, promise: null, error: null, tariffs: [], suppliers: [], medicines: [] };

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

  function mapMedicine(row) {
    const medicineId = String(row && row.medicineId || "");
    if (!medicineId) throw new Error("ID obat TiDB tidak tersedia.");
    const price = Number(row.sellingPrice);
    const minimum = Number(row.minimumStock);
    const stock = Number(row.sellableQuantity);
    const hpp = row.weightedHpp == null ? 0 : Number(row.weightedHpp);
    if (![price, minimum, stock, hpp].every(Number.isSafeInteger) || price < 0 || minimum < 0 || stock < 0 || hpp < 0) {
      throw new Error("Nilai master/stok obat TiDB berada di luar rentang aman.");
    }
    return { id: medicineId, medicineId, publicId: String(row.publicId || ""), nama: String(row.name || ""), satuan: String(row.unit || ""), jual: price, hpp, stok: stock, min: minimum, physicalStock: Number(row.physicalQuantity || 0), unknownHppQuantity: Number(row.unknownHppQuantity || 0), profitCalculationStatus: String(row.profitCalculationStatus || "uncalculated"), active: row.active === true || Number(row.active) === 1 };
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
      const [tariffsResponse, suppliersResponse, inventoryResponse] = await Promise.all([
        window.assalamTiDBApi.listTariffs(),
        window.assalamTiDBApi.listSuppliers(),
        window.assalamTiDBApi.listInventory()
      ]);
      const tariffRows = Array.isArray(tariffsResponse && tariffsResponse.data) ? tariffsResponse.data : [];
      const supplierRows = Array.isArray(suppliersResponse && suppliersResponse.data) ? suppliersResponse.data : [];
      const medicineRows = Array.isArray(inventoryResponse && inventoryResponse.data) ? inventoryResponse.data : [];
      state.tariffs = tariffRows.map(mapTariff);
      state.suppliers = supplierRows.map(mapSupplier);
      state.medicines = medicineRows.map(mapMedicine);
      if (window.clinicStore && window.clinicStore.state) {
        window.clinicStore.state.obat = state.medicines.map(item => ({ ...item }));
      }
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

  async function createMedicine(data) {
    requirePreview();
    await window.assalamTiDBApi.inventoryCommand({
      action: "create_medicine",
      medicine: { name: String(data.name || "").trim(), canonicalUnit: String(data.canonicalUnit || "").trim().toLowerCase(), sellingPrice: String(data.sellingPrice), minimumStock: String(data.minimumStock || "0"), quantityScale: 0, active: true }
    }, newKey());
    await ensureLoaded(true);
    return state.medicines;
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
    state.medicines = [];
  }

  window.assalamTiDBCatalog = Object.freeze({
    enabled, ensureLoaded, isLoaded: () => state.loaded, isLoading: () => state.loading,
    getError: () => state.error,
    getTariffs: () => state.tariffs.slice(),
    getSuppliers: () => state.suppliers.slice(),
    getMedicines: () => state.medicines.slice(),
    findTariff: id => findById(state.tariffs, id),
    findSupplier: id => findById(state.suppliers, id),
    createTariff, updateTariff, deactivateTariff, createMedicine,
    createSupplier, updateSupplier, deactivateSupplier, clear
  });
})();

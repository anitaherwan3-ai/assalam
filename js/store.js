// Store & Local State Management

const DEFAULT_SETTINGS = {
  nama: 'Klinik Assalaam Palembang',
  logo: '🏥',
  logoImg: '',
  alamat: 'Jl. Kemang Manis Lr. Beringin No. 492, Kemang Manis, Kec. Ilir Barat II, Kota Palembang',
  telp: '021-5551234',
  footer: 'Semoga lekas sembuh. Simpan struk ini sebagai bukti pembayaran.',
  warna: '#0f766e',
  tema: 'auto',
  font: '14',
  perHal: 10,
  batasApproval: 1000000,
  tempoPeringatan: 7,     // Hari sebelum jatuh tempo faktur
  edPeringatan: 60,       // Hari sebelum obat kedaluwarsa
  kertasNota: '80mm',     // '58mm', '80mm', 'A4'
  fiturKirimWA: true,     // Saklar fitur kirim struk WA (Pimpinan bisa nonaktifkan)
  waOwner: '081299998888', // Nomor WA Owner/Pimpinan untuk pengiriman otomatis rekap shift
  runningTextDisplay: 'Selamat datang di Klinik Assalaam Palembang. Mohon perhatikan nomor antrean Anda. Melayani dengan sepenuh hati.',
  youtubeVideoId: '',         // Dikosongkan — Admin mengatur via tab Display TV
  enableYoutubeDisplay: true  // Jika youtubeVideoId kosong, layar otomatis tampilkan Slide Edukasi Kesehatan
};

const INITIAL_USERS = [
  { u: 'praktekrose', nama: 'Pimpinan / Dokter Penanggung Jawab', role: 'pimpinan', hp: '081299998888' }
];

const INITIAL_OBAT = [
  { id: 'o1', nama: 'Paracetamol 500mg', satuan: 'tablet', hpp: 3000, jual: 5000, stok: 50, min: 10 },
  { id: 'o2', nama: 'Amoxicillin 500mg', satuan: 'kapsul', hpp: 9000, jual: 15000, stok: 30, min: 10 },
  { id: 'o3', nama: 'Vitamin C 500mg', satuan: 'botol', hpp: 12000, jual: 20000, stok: 20, min: 5 }
];

// Pastikan batch awal tersedia agar FEFO & menu Kedaluwarsa sinkron dengan stok obat!
const INITIAL_BATCH = [
  { id: 'b1', oid: 'o1', no: 'PCT-2026-01', ed: '2027-12-31', qty: 50, sisa: 50, beli: 'init' },
  { id: 'b2', oid: 'o2', no: 'AMX-2026-02', ed: '2027-06-30', qty: 30, sisa: 30, beli: 'init' },
  { id: 'b3', oid: 'o3', no: 'VTC-2026-01', ed: '2027-09-30', qty: 20, sisa: 20, beli: 'init' }
];

const INITIAL_TARIF = [
  { id: 't1', nama: 'Konsultasi Dokter Umum', jenis: 'Konsultasi', harga: 50000 },
  { id: 't2', nama: 'Konsultasi Dokter Gigi', jenis: 'Konsultasi', harga: 80000 },
  { id: 't3', nama: 'Konsultasi Spesialis', jenis: 'Konsultasi', harga: 150000 },
  { id: 't4', nama: 'Tindakan Jahit Luka Ringan', jenis: 'Tindakan', harga: 120000 },
  { id: 't5', nama: 'Nebulizer / Uap', jenis: 'Tindakan', harga: 75000 },
  { id: 't6', nama: 'Cek Gula Darah / Asam Urat', jenis: 'Tindakan', harga: 30000 }
];

const INITIAL_PAKET = [
  {
    id: 'p1',
    nama: 'Paket MCU Sehat (Pemeriksaan Dasar)',
    deskripsi: 'Konsultasi Dokter Umum + Cek Gula Darah/Asam Urat + Suplemen Vitamin C 500mg',
    harga: 85000,
    items: [
      { id: 't1', type: 'tarif', nama: 'Konsultasi Dokter Umum', harga: 50000, qty: 1 },
      { id: 't6', type: 'tarif', nama: 'Cek Gula Darah / Asam Urat', harga: 30000, qty: 1 },
      { id: 'o3', type: 'obat', oid: 'o3', nama: 'Vitamin C 500mg', harga: 20000, qty: 1 }
    ]
  },
  {
    id: 'p2',
    nama: 'Paket Tindakan Khitan / Jahit Ceria',
    deskripsi: 'Tindakan Jahit Medis Ringan + Antibiotik Amoxicillin + Antinyeri Paracetamol',
    harga: 130000,
    items: [
      { id: 't4', type: 'tarif', nama: 'Tindakan Jahit Luka Ringan', harga: 120000, qty: 1 },
      { id: 'o1', type: 'obat', oid: 'o1', nama: 'Paracetamol 500mg', harga: 5000, qty: 2 },
      { id: 'o2', type: 'obat', oid: 'o2', nama: 'Amoxicillin 500mg', harga: 15000, qty: 1 }
    ]
  },
  {
    id: 'p3',
    nama: 'Paket Perawatan Gigi & Mulut',
    deskripsi: 'Konsultasi Dokter Gigi + Perawatan & Terapi Obat',
    harga: 95000,
    items: [
      { id: 't2', type: 'tarif', nama: 'Konsultasi Dokter Gigi', harga: 80000, qty: 1 },
      { id: 'o1', type: 'obat', oid: 'o1', nama: 'Paracetamol 500mg', harga: 5000, qty: 1 }
    ]
  }
];

// Mengalokasikan diskon nota secara proporsional ke seluruh baris bernilai positif.
// Pembulatan sisa rupiah memakai metode largest remainder agar total alokasi tepat.
function calculateNetReturnAmount(trx, itemIndex, qtyReturn, priorQty = 0) {
  const items = Array.isArray(trx && trx.items) ? trx.items : [];
  const target = items[Number(itemIndex)];
  if (!target) throw new Error('Item nota asli tidak ditemukan.');
  const grossRows = [];
  let grossTotal = 0, discountTotal = 0;
  items.forEach((item, index) => {
    const kind = String(item.t || item.jenis || '');
    const qty = Number(item.qty || 0);
    const price = Number(item.harga || 0);
    if (['Diskon', 'Potongan Diskon'].includes(kind) || price < 0) {
      discountTotal += Math.round(Math.abs(price * (Number.isFinite(qty) ? qty : 1)));
      return;
    }
    const gross = Math.round(Math.max(0, qty * price));
    if (gross > 0) {
      grossRows.push({ index, gross, allocated: 0, remainder: 0 });
      grossTotal += gross;
    }
  });
  discountTotal = Math.round(discountTotal);
  if (discountTotal > grossTotal) throw new Error('Diskon nota melebihi nilai barang dan jasa.');
  if (!grossTotal) throw new Error('Nota tidak memiliki nilai yang dapat diretur.');
  let allocated = 0;
  grossRows.forEach(row => {
    const exact = discountTotal * row.gross / grossTotal;
    row.allocated = Math.floor(exact);
    row.remainder = exact - row.allocated;
    allocated += row.allocated;
  });
  let centsLeft = discountTotal - allocated;
  grossRows.slice().sort((a, b) => b.remainder - a.remainder || a.index - b.index)
    .slice(0, centsLeft).forEach(row => { row.allocated += 1; });
  const targetRow = grossRows.find(row => row.index === Number(itemIndex));
  if (!targetRow) throw new Error('Item nota tidak memiliki nilai retur.');
  const lineNet = targetRow.gross - targetRow.allocated;
  const lineQty = Number(target.qty || 0);
  const before = Number(priorQty || 0), requested = Number(qtyReturn || 0);
  if (!Number.isFinite(lineQty) || lineQty <= 0 || before < 0 || requested <= 0 ||
      before + requested > lineQty) throw new Error('Jumlah retur melebihi jumlah pada nota.');
  return Math.round(lineNet * (before + requested) / lineQty) -
    Math.round(lineNet * before / lineQty);
}

class ClinicStore {
  constructor() {
    this.COLLECTIONS = [
      'obat', 'tarif', 'paket', 'pasien', 'trx', 'petty', 'beli', 
      'biaya', 'loss', 'shift', 'batch', 'log', 'users',
      'returJual', 'returBeli', 'batalTrx'
    ];
    this.listeners = [];
    this._saveDebounceTimer = null;
    this.loadLocal();
  }

  loadLocal() {
    let localData = null;
    try {
      const raw = localStorage.getItem('klinik_data');
      if (raw) localData = JSON.parse(raw);
    } catch (e) {
      console.warn('Gagal memuat local data:', e);
    }

    const isTiDBActive = !!(
      (typeof isTiDBCatalogPreview === 'function' && isTiDBCatalogPreview()) ||
      (typeof window !== 'undefined' && window.assalamTiDBCatalog && window.assalamTiDBCatalog.enabled()) ||
      (typeof window !== 'undefined' && window.ASSALAM_TIDB_PREVIEW_BOOTSTRAP)
    );

    this.isCacheOnly = isTiDBActive;
    this.state = localData || {};
    
    // Inisialisasi default collections jika belum ada
    this.COLLECTIONS.forEach(col => {
      if (!Array.isArray(this.state[col])) {
        this.state[col] = [];
      }
    });

    // Pada mode non-TiDB (legacy), isi sampel data jika belum ada.
    // Pada mode TiDB, hindari data tiruan; TiDB adalah satu-satunya sumber kebenaran (SSOT).
    if (!isTiDBActive) {
      if (this.state.obat.length === 0) this.state.obat = [...INITIAL_OBAT];
      if (this.state.batch.length === 0) this.state.batch = [...INITIAL_BATCH];
      if (this.state.tarif.length === 0) this.state.tarif = [...INITIAL_TARIF];
      if (this.state.users.length === 0) this.state.users = [...INITIAL_USERS];
      if (!this.state.paket || this.state.paket.length === 0) this.state.paket = [...INITIAL_PAKET];
    }
    this.state.obat.forEach(o => { if (o && o.satuan === 'strip') o.satuan = 'tablet'; });

    // Pastikan nomor WhatsApp terisi pada user pimpinan jika sebelumnya belum ada
    (this.state.users || []).forEach(u => {
      if (!u.hp) {
        if (u.role === 'pimpinan') u.hp = '081299998888';
        else if (u.role === 'kasir') u.hp = '081234567891';
        else if (u.role === 'admin') u.hp = '081234567892';
      }
    });

    this.state.set = Object.assign({}, DEFAULT_SETTINGS, this.state.set || {});
    // Identitas nama klinik bersifat tetap dan tidak dapat ditimpa data lokal lama.
    this.state.set.nama = 'Klinik Assalaam Palembang';
    if (!this.state.set.waOwner) this.state.set.waOwner = '081299998888';
    this.state.seq = this.state.seq || {};
    this.state.firebaseConfig = this.state.firebaseConfig || null;

    this.saveLocal(false);
  }

  saveLocal(triggerSync = true) {
    const timerFn = (typeof setTimeout === 'function')
      ? setTimeout
      : (typeof globalThis !== 'undefined' && typeof globalThis.setTimeout === 'function')
        ? globalThis.setTimeout
        : null;

    const clearFn = (typeof clearTimeout === 'function')
      ? clearTimeout
      : (typeof globalThis !== 'undefined' && typeof globalThis.clearTimeout === 'function')
        ? globalThis.clearTimeout
        : null;

    if (timerFn) {
      if (this._saveDebounceTimer && clearFn) {
        clearFn(this._saveDebounceTimer);
      }
      this._saveDebounceTimer = timerFn(() => {
        this._flushSave(triggerSync);
      }, 100);
    } else {
      this._flushSave(triggerSync);
    }

    this.notify();
  }

  _flushSave(triggerSync = true) {
    const isTiDBActive = !!(
      (typeof isTiDBCatalogPreview === 'function' && isTiDBCatalogPreview()) ||
      (typeof window !== 'undefined' && window.assalamTiDBCatalog && window.assalamTiDBCatalog.enabled()) ||
      (typeof window !== 'undefined' && window.ASSALAM_TIDB_PREVIEW_BOOTSTRAP)
    );

    try {
      if (isTiDBActive) {
        // Pada mode TiDB, localStorage hanya bertindak sebagai cache lokal sementara (bukan SSOT)
        this.state._cacheMeta = {
          source: 'tidb_cache',
          cachedAt: Date.now()
        };
      }
      localStorage.setItem('klinik_data', JSON.stringify(this.state));
    } catch (e) {
      console.error('LocalStorage write error:', e);
    }

    if (triggerSync && window.firebaseBackend && !isTiDBActive) {
      window.firebaseBackend.pushData(this.state);
    }
  }

  subscribe(listener) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  notify() {
    this.listeners.forEach(fn => {
      try { fn(this.state); } catch (e) { console.error('Listener error:', e); }
    });
  }

  get(collection, id) {
    return (this.state[collection] || []).find(item => item.id === id);
  }

  getAll(collection) {
    return this.state[collection] || [];
  }

  getObat(id) {
    return this.get('obat', id);
  }

  getPaket(id) {
    return this.get('paket', id);
  }

  getOwnerWa() {
    const owner = (this.state.users || []).find(u => u.role === 'pimpinan' && u.hp);
    if (owner && owner.hp) return owner.hp;
    return (this.state.set && this.state.set.waOwner) ? this.state.set.waOwner : '';
  }

  // Audit Logging
  logActivity(action, category, details = '') {
    const user = window.currentUser ? window.currentUser.u : 'Sistem';
    const now = new Date();
    const entry = {
      id: uid(),
      _t: Date.now(),
      _pendingSync: true,
      tgl: now.toISOString().slice(0, 10),
      jam: now.toTimeString().slice(0, 5),
      u: user,
      aksi: action,
      kol: category,
      rinci: details
    };
    this.state.log.unshift(entry);
    if (this.state.log.length > 1000) {
      this.state.log.pop();
    }
    this.saveLocal();
  }

  // FIFO / FEFO Deduction Logic
  deductBatchFEFO(oid, qty) {
    const amount = Number(qty);
    if (!Number.isFinite(amount) || amount <= 0) return { deductions: [], unallocated: amount || 0 };
    const today = new Date().toISOString().slice(0, 10);
    const batches = (this.state.batch || [])
      .filter(b => b.oid === oid && Number(b.sisa) > 0 && b.ed >= today)
      .sort((a, b) => String(a.ed).localeCompare(String(b.ed)));
    const available = batches.reduce((sum, b) => sum + Number(b.sisa || 0), 0);
    if (available < amount) return { deductions: [], unallocated: amount - available };

    const deductions = [];
    let remaining = amount;
    for (const b of batches) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, Number(b.sisa) || 0);
      b.sisa -= take;
      b._t = Date.now();
      remaining -= take;
      deductions.push({ bid: b.id, qty: take, batchNo: b.no, ed: b.ed });
    }
    return { deductions, unallocated: remaining };
  }

  // Weighted Average HPP Calculation on Purchase
  recordPurchase({ supplier, faktur, oid, qty, total, tempo, batchNo, ed, isLunas }) {
    if (this.isCacheOnly) {
      console.warn('recordPurchase lokal dinonaktifkan pada mode TiDB; pencatatan pembelian wajib melalui TiDB API.');
      return false;
    }
    const today = new Date().toISOString().slice(0, 10);
    const obat = this.getObat(oid);
    if (!obat) return false;

    const stokLama = obat.stok || 0;
    const hppLama = obat.hpp || 0;
    const qtyMasuk = Number(qty);
    const totalTagihan = Number(total);

    // Weighted Moving Average HPP
    const totalQty = stokLama + qtyMasuk;
    if (totalQty > 0) {
      const totalNilai = (stokLama * hppLama) + totalTagihan;
      obat.hpp = Math.round(totalNilai / totalQty);
    }
    obat.stok = totalQty;

    const beliId = uid();
    const batchId = uid();

    // Catat batch baru
    this.state.batch.push({
      id: batchId,
      oid: obat.id,
      no: batchNo || '-',
      ed: ed,
      qty: qtyMasuk,
      sisa: qtyMasuk,
      beli: beliId,
      _t: Date.now()
    });

    // Catat faktur pembelian
    this.state.beli.unshift({
      id: beliId,
      tgl: today,
      supplier,
      faktur: faktur || '-',
      oid: obat.id,
      qty: qtyMasuk,
      total: totalTagihan,
      tempo,
      lunas: isLunas,
      tglBayar: isLunas ? today : '',
      // Nilai awal menjaga harga satuan faktur pada retur bertahap.
      qtyAwal: qtyMasuk,
      totalAwal: totalTagihan,
      hargaBeliSatuan: totalTagihan / qtyMasuk,
      batchId,
      _t: Date.now()
    });

    this.logActivity('Tambah', 'Pembelian', `${supplier} - Faktur ${faktur} (${rp(totalTagihan)})`);
    this.saveLocal();
    return true;
  }

  // Lunasi Utang Faktur
  async lunasiBeli(beliId) {
    const beli = this.get('beli', beliId);
    if (!beli) return;
    if (typeof isTiDBCatalogPreview === 'function' && isTiDBCatalogPreview() && window.assalamTiDBApi) {
      try {
        const tidbKey = window.assalamTiDBApi.newIdempotencyKey();
        await window.assalamTiDBApi.recordSupplierPayment({
          payment: {
            sourceType: "supplier_payable",
            sourceId: String(beli.id || beliId),
            amount: String(beli.total || beli.sisa || 0),
            paymentMethod: "bank_transfer",
            paymentStatus: "settled",
            businessDate: new Date().toISOString().slice(0, 10),
            eventAtUtc: new Date().toISOString(),
            evidenceFileId: "evidence-direct-settlement"
          }
        }, tidbKey);
      } catch (err) {
        if (typeof showAlert === 'function') {
          showAlert('Pelunasan utang ke TiDB gagal: ' + (err.message || 'Kesalahan jaringan'), 'Gagal');
        }
        return;
      }
    }
    beli.lunas = true;
    beli.tglBayar = new Date().toISOString().slice(0, 10);
    this.logActivity('Pelunasan', 'Pembelian', `Faktur ${beli.faktur} (${rp(beli.total)})`);
    this.saveLocal();
    if (typeof renderApp === 'function') renderApp();
  }

  // Pembatalan transaksi wajib melalui persetujuan Cloud; tidak ada rollback stok lokal.

  // Panggil pasien. Jalur legacy tetap sinkron; mode TiDB mengembalikan Promise
  // yang hanya berhasil setelah server menerima perintah panggilan.
  callPatient(patientId) {
    const dateParts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    const part = type => (dateParts.find(item => item.type === type) || {}).value || '';
    const today = `${part('year')}-${part('month')}-${part('day')}`;
    const now = Date.now();
    const patient = (this.state.pasien || []).find(p => String(p.id) === String(patientId));
    if (!patient || patient.done || patient.deletedAt || patient.status === 'dihapus' || patient.status === 'batal_berobat') return false;

    if (typeof isTiDBCatalogPreview === 'function' && isTiDBCatalogPreview()) {
      return this.callPatientTiDB(patient, now);
    }

    // Jalur legacy non-TiDB tetap memakai sinkronisasi lokal yang sudah ada.
    (this.state.pasien || []).forEach(p => {
      if (p.tgl === today && p.calling && !p.done && !p.deletedAt &&
          p.status !== 'dihapus' && p.status !== 'batal_berobat') {
        p.calling = false;
        p._t = now;
      }
    });
    patient.calling = true;
    patient._t = now;
    this.logActivity('Panggil', 'Antrean', `${patient.no} - ${patient.nama} (${patient.layanan})`);
    this.saveLocal();
    if (typeof broadcastCall === 'function') broadcastCall(patient, patient.layanan);
    return true;
  }

  async callPatientTiDB(patient, now) {
    const api = window.assalamTiDBApi;
    if (!api || !patient.ticketId || !patient.laneCode) {
      if (typeof showAlert === 'function') showAlert('Data tiket/jalur antrean TiDB tidak lengkap. Muat ulang antrean sebelum memanggil pasien.', 'Panggilan Gagal');
      return false;
    }
    try {
      await api.callQueue({
        ticketId: String(patient.ticketId),
        laneCode: String(patient.laneCode).trim().toUpperCase(),
        eventType: 'call'
      }, api.newIdempotencyKey());
      patient.calling = true;
      patient._t = now;
      this.logActivity('Panggil', 'Antrean', `${patient.no} - ${patient.nama} (${patient.layanan})`);
      this.saveLocal();
      if (typeof syncOperationalDataFromTiDB === 'function') {
        await syncOperationalDataFromTiDB();
      } else if (typeof renderApp === 'function') {
        renderApp();
      }
      return true;
    } catch (err) {
      if (typeof showAlert === 'function') showAlert('Panggilan ke TiDB gagal: ' + (err.message || 'Kesalahan jaringan'), 'Panggilan Gagal');
      return false;
    }
  }
  // Kasir hanya mengajukan retur. Stok berubah setelah Admin menyetujui.
  processReturJual({ trxId, itemIndex, qtyRetur, alasan }) {
    const trx = this.get('trx', trxId);
    if (!trx || trx.status === 'dibatalkan' || !Array.isArray(trx.items) || !trx.items[itemIndex]) return false;
    const item = trx.items[itemIndex], qty = Number(qtyRetur);
    if (!Number.isFinite(qty) || qty <= 0) return false;
    const jenis = item.t || item.jenis || '';
    const directOid = item.oid || (jenis === 'Obat' ? item.id : '');
    const isPackage = jenis === 'Paket' && Array.isArray(item.items);
    // Jasa (konsultasi, tindakan, laboratorium, dan tarif non-obat lain)
    // tidak memiliki stok/batch, tetapi tetap dapat diretur berdasarkan nota.
    const isService = !directOid && !isPackage &&
      !['Diskon', 'Potongan Diskon'].includes(jenis) &&
      Number(item.harga || 0) >= 0;
    if (!directOid && !isPackage && !isService) return false;
    const priorQty = (this.state.returJual || []).filter(r => r.trxId === trx.id &&
      Number(r.itemIndex) === Number(itemIndex) && r.status !== 'ditolak')
      .reduce((sum, r) => sum + Number(r.qty || 0), 0);
    if (qty + priorQty > Number(item.qty || 0)) return false;
    const batchRestores = [];
    const allocate = (oid, deductions, amount, offset) => {
      if (!oid || !Array.isArray(deductions)) return false;
      let skip = offset, left = amount;
      for (const d of deductions) {
        const available = Number(d.qty || 0);
        if (skip >= available) { skip -= available; continue; }
        const take = Math.min(left, available - skip);
        if (take > 0) {
          if (!this.get('batch', d.bid) || !this.getObat(oid)) return false;
          batchRestores.push({ oid, bid: d.bid, qty: take, batchNo: d.batchNo || '', ed: d.ed || '' });
          left -= take;
        }
        skip = 0;
        if (left <= 0) break;
      }
      return left <= 0;
    };
    if (directOid) {
      if (!allocate(directOid, item.batchDeductions, qty, priorQty)) return false;
    } else if (isPackage) {
      for (const part of item.items) {
        const oid = part.type === 'obat' ? (part.oid || part.id) : '';
        if (oid && !allocate(oid, part.batchDeductions, (Number(part.qty) || 1) * qty,
          (Number(part.qty) || 1) * priorQty)) return false;
      }
      // Paket layanan tanpa komponen obat tidak mengubah stok.
    }
    let nilaiRetur;
    try {
      nilaiRetur = calculateNetReturnAmount(trx, itemIndex, qty, priorQty);
    } catch (err) {
      console.warn('Perhitungan nominal retur gagal:', err);
      return false;
    }
    if (!Number.isFinite(nilaiRetur) || nilaiRetur < 0) return false;
    const now = Date.now();
    this.state.returJual.unshift({
      id: uid(), status: 'menunggu', tgl: new Date().toISOString().slice(0, 10),
      trxId: trx.id, itemIndex: Number(itemIndex), quotaId: String(trx.id) + '__' + String(Number(itemIndex)), priorQty,
      noNota: trx.no, namaPasien: trx.nama,
      namaItem: item.nama, oid: directOid || '', jenis, hpp: Number(item.hpp || 0),
      metode: trx.metode || '', qty, harga: Number(item.harga || 0), total: nilaiRetur,
      batchRestores, alasan: alasan || 'Retur Pasien',
      kasir: window.currentUser ? window.currentUser.u : '-', _t: now
    });
    this.logActivity('Ajukan Retur', 'Kasir', `Nota ${trx.no} - ${item.nama} (${qty}x = ${rp(nilaiRetur)}) menunggu verifikasi Admin`);
    this.saveLocal();
    return true;
  }

  approveReturJual(returId) {
    const user = window.currentUser || {};
    if (!['admin', 'pimpinan'].includes(user.role)) return false;
    const retur = this.get('returJual', returId);
    if (!retur || retur.status !== 'menunggu' || !Array.isArray(retur.batchRestores)) return false;
    const returJenis = retur.jenis || '';
    const returIsStock = ['Obat', 'Paket'].includes(returJenis) &&
      (returJenis === 'Obat' || (retur.batchRestores || []).length > 0);
    if (returIsStock && !retur.batchRestores.length) return false;
    for (const item of retur.batchRestores) {
      if (!this.getObat(item.oid) || !this.get('batch', item.bid) || Number(item.qty) <= 0) return false;
    }
    const now = Date.now();
    for (const item of retur.batchRestores) {
      const obat = this.getObat(item.oid), batch = this.get('batch', item.bid);
      obat.stok = Number(obat.stok || 0) + Number(item.qty); obat._t = now;
      batch.sisa = Number(batch.sisa || 0) + Number(item.qty); batch._t = now;
    }
    retur.status = 'disetujui'; retur.diverifikasiOleh = user.u || user.email || '-';
    retur.diverifikasiPada = now; retur._t = now;
    this.logActivity('Setujui Retur', 'Persetujuan Retur', `Nota ${retur.noNota} - ${retur.namaItem} (+${retur.qty})`);
    this.saveLocal(); return true;
  }

  rejectReturJual(returId, alasanTolak) {
    const user = window.currentUser || {};
    if (!['admin', 'pimpinan'].includes(user.role)) return false;
    const retur = this.get('returJual', returId);
    if (!retur || retur.status !== 'menunggu') return false;
    retur.status = 'ditolak'; retur.alasanPenolakan = String(alasanTolak || '').trim() || 'Tidak disetujui Admin';
    retur.diverifikasiOleh = user.u || user.email || '-'; retur.diverifikasiPada = Date.now(); retur._t = Date.now();
    this.logActivity('Tolak Retur', 'Persetujuan Retur', `Nota ${retur.noNota} - ${retur.namaItem}: ${retur.alasanPenolakan}`);
    this.saveLocal(); return true;
  }

  // Proses Retur Pembelian ke Supplier PBF
  processReturBeli({ beliId, qtyRetur, alasan }) {
    const beli = this.get('beli', beliId);
    if (!beli) return false;

    const obat = this.getObat(beli.oid);
    if (!obat) return false;

    // Retur hanya boleh diambil dari batch faktur yang tepat dan jumlah yang tersedia.
    const batch = (this.state.batch || []).find(b => b.beli === beli.id);
    if (!batch) return false;
    const qty = Math.min(Number(qtyRetur), Number(beli.qty) || 0, Number(batch.sisa) || 0, Number(obat.stok) || 0);
    if (!Number.isFinite(qty) || qty <= 0) return false;

    const hargaSatuan = Number(beli.hargaBeliSatuan) ||
      (Number(beli.totalAwal) > 0 && Number(beli.qtyAwal) > 0
        ? Number(beli.totalAwal) / Number(beli.qtyAwal)
        : Number(beli.total) / (Number(beli.qty) || 1));
    const nilaiRetur = Math.round(qty * hargaSatuan);
    // Kunci nilai awal saat retur pertama agar faktur lama juga aman untuk retur bertahap.
    beli.hargaBeliSatuan = hargaSatuan;
    beli.qtyAwal = Number(beli.qtyAwal) || Number(beli.qty);
    beli.totalAwal = Number(beli.totalAwal) || Number(beli.total);
    const stokLama = Number(obat.stok) || 0;
    const hppLama = Number(obat.hpp) || 0;

    // Kurangi stok fisik dan hanya batch milik faktur ini.
    obat.stok = Math.max(0, stokLama - qty);
    batch.sisa = Math.max(0, (Number(batch.sisa) || 0) - qty);
    if (obat.stok > 0) {
      obat.hpp = Math.max(0, Math.round(((stokLama * hppLama) - nilaiRetur) / obat.stok));
    }

    // Faktur lunas mempertahankan nilai historis; utang dikurangi sesuai nilai retur.
    if (!beli.lunas) {
      beli.total = Math.max(0, (Number(beli.total) || 0) - nilaiRetur);
    }
    beli.qty = Math.max(0, (Number(beli.qty) || 0) - qty);
    beli._t = Date.now();
    batch._t = Date.now();
    obat._t = Date.now();

    const returId = uid();
    this.state.returBeli.unshift({
      id: returId,
      tgl: new Date().toISOString().slice(0, 10),
      beliId: beli.id,
      supplier: beli.supplier,
      faktur: beli.faktur,
      namaObat: obat.nama,
      qty: qty,
      nilai: nilaiRetur,
      alasan: alasan || 'Retur ke PBF',
      _t: Date.now()
    });

    this.logActivity('Retur Pembelian', 'Pembelian', `${beli.supplier} - ${obat.nama} (${qty}x = ${rp(nilaiRetur)})`);
    this.saveLocal();
    return true;
  }
}

window.clinicStore = new ClinicStore();

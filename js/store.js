// Store & Local State Management

const DEFAULT_SETTINGS = {
  nama: 'Klinik Sehat Pratama',
  logo: '🏥',
  logoImg: '',
  alamat: 'Jl. Kesehatan Medika No. 123, Jakarta',
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
  runningTextDisplay: 'Selamat datang di Klinik Sehat Pratama. Mohon perhatikan nomor antrean Anda. Melayani dengan sepenuh hati.',
  youtubeVideoId: '',         // Dikosongkan — Admin mengatur via tab Display TV
  enableYoutubeDisplay: true  // Jika youtubeVideoId kosong, layar otomatis tampilkan Slide Edukasi Kesehatan
};

const INITIAL_USERS = [
  { u: 'praktekrose', pw: 'Dinkes123@', nama: 'Pimpinan / Dokter Penanggung Jawab', role: 'pimpinan', hp: '081299998888' }
];

const INITIAL_OBAT = [
  { id: 'o1', nama: 'Paracetamol 500mg', satuan: 'strip', hpp: 3000, jual: 5000, stok: 50, min: 10 },
  { id: 'o2', nama: 'Amoxicillin 500mg', satuan: 'strip', hpp: 9000, jual: 15000, stok: 30, min: 10 },
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

class ClinicStore {
  constructor() {
    this.COLLECTIONS = [
      'obat', 'tarif', 'paket', 'pasien', 'trx', 'petty', 'beli', 
      'biaya', 'loss', 'shift', 'batch', 'log', 'users',
      'returJual', 'returBeli'
    ];
    this.listeners = [];
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

    this.state = localData || {};
    
    // Inisialisasi default collections jika belum ada
    this.COLLECTIONS.forEach(col => {
      if (!Array.isArray(this.state[col])) {
        this.state[col] = [];
      }
    });

    if (this.state.obat.length === 0) this.state.obat = [...INITIAL_OBAT];
    if (this.state.batch.length === 0) this.state.batch = [...INITIAL_BATCH];
    if (this.state.tarif.length === 0) this.state.tarif = [...INITIAL_TARIF];
    if (this.state.users.length === 0) this.state.users = [...INITIAL_USERS];
    if (!this.state.paket || this.state.paket.length === 0) this.state.paket = [...INITIAL_PAKET];

    // Pastikan nomor WhatsApp terisi pada user pimpinan jika sebelumnya belum ada
    (this.state.users || []).forEach(u => {
      if (!u.hp) {
        if (u.role === 'pimpinan') u.hp = '081299998888';
        else if (u.role === 'kasir') u.hp = '081234567891';
        else if (u.role === 'admin') u.hp = '081234567892';
      }
    });

    this.state.set = Object.assign({}, DEFAULT_SETTINGS, this.state.set || {});
    if (!this.state.set.waOwner) this.state.set.waOwner = '081299998888';
    this.state.seq = this.state.seq || {};
    this.state.firebaseConfig = this.state.firebaseConfig || null;

    this.saveLocal(false);
  }

  saveLocal(triggerSync = true) {
    try {
      localStorage.setItem('klinik_data', JSON.stringify(this.state));
    } catch (e) {
      console.error('LocalStorage write error:', e);
    }

    if (triggerSync && window.firebaseBackend) {
      window.firebaseBackend.pushData(this.state);
    }

    this.notify();
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
    const today = new Date().toISOString().slice(0, 10);
    const deductions = [];
    
    // Ambil batch dengan ED terdekat dan sisa > 0, lewatkan yang sudah kedaluwarsa
    const batches = this.state.batch
      .filter(b => b.oid === oid && b.sisa > 0 && b.ed >= today)
      .sort((a, b) => (a.ed < b.ed ? -1 : 1));

    let remaining = qty;
    for (const b of batches) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, b.sisa);
      b.sisa -= take;
      remaining -= take;
      deductions.push({ bid: b.id, qty: take, batchNo: b.no, ed: b.ed });
    }

    return { deductions, unallocated: remaining };
  }

  // Weighted Average HPP Calculation on Purchase
  recordPurchase({ supplier, faktur, oid, qty, total, tempo, batchNo, ed, isLunas }) {
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
      batchId,
      _t: Date.now()
    });

    this.logActivity('Tambah', 'Pembelian', `${supplier} - Faktur ${faktur} (${rp(totalTagihan)})`);
    this.saveLocal();
    return true;
  }

  // Lunasi Utang Faktur
  lunasiBeli(beliId) {
    const beli = this.get('beli', beliId);
    if (!beli) return;
    beli.lunas = true;
    beli.tglBayar = new Date().toISOString().slice(0, 10);
    this.logActivity('Pelunasan', 'Pembelian', `Faktur ${beli.faktur} (${rp(beli.total)})`);
    this.saveLocal();
  }

  // Batalkan Transaksi Kasir (Kembalikan stok obat & sisa batch)
  cancelTransaction(trxId) {
    const trx = this.get('trx', trxId);
    if (!trx) return false;

    // Rollback stok obat dan sisa batch
    (trx.items || []).forEach(item => {
      if (item.oid) {
        const obat = this.getObat(item.oid);
        if (obat) {
          obat.stok += item.qty;
        }
      }
      if (Array.isArray(item.batchDeductions)) {
        item.batchDeductions.forEach(d => {
          const batch = this.get('batch', d.bid);
          if (batch) {
            batch.sisa += d.qty;
          }
        });
      }
    });

    // Reset status pasien jika terhubung
    if (trx.pid) {
      const pasien = this.get('pasien', trx.pid);
      if (pasien) pasien.done = false;
    }

    this.state.trx = this.state.trx.filter(t => t.id !== trxId);
    this.logActivity('Batalkan', 'Transaksi', `Nota ${trx.no} - Pasien ${trx.nama}`);
    this.saveLocal();
    return true;
  }

  // Panggil Pasien ke Layar Display TV
  callPatient(patientId) {
    const today = new Date().toISOString().slice(0, 10);
    const patient = (this.state.pasien || []).find(p => p.id === patientId);
    if (!patient) return false;

    // Reset status calling pasien lain hari ini
    (this.state.pasien || []).forEach(p => {
      if (p.tgl === today) p.calling = false;
    });

    patient.calling = true;
    this.logActivity('Panggil', 'Antrean', `${patient.no} - ${patient.nama} (${patient.layanan})`);
    this.saveLocal();

    // Broadcast ke Layar TV
    if (typeof broadcastCall === 'function') {
      broadcastCall(patient, patient.layanan);
    }

    return true;
  }

  // Proses Retur Penjualan Pasien
  processReturJual({ trxId, itemIndex, qtyRetur, alasan }) {
    const trx = this.get('trx', trxId);
    if (!trx || !trx.items || !trx.items[itemIndex]) return false;

    const item = trx.items[itemIndex];
    const qty = Math.min(Number(qtyRetur), item.qty);
    if (qty <= 0) return false;

    const nilaiRetur = qty * item.harga;

    // Kembalikan stok obat jika item adalah obat
    if (item.oid) {
      const obat = this.getObat(item.oid);
      if (obat) {
        obat.stok += qty;
      }
      // Kembalikan ke batch pertama yang cocok jika ada
      const batch = (this.state.batch || []).find(b => b.oid === item.oid);
      if (batch) {
        batch.sisa += qty;
      }
    }

    // Catat data retur
    const returId = uid();
    this.state.returJual.unshift({
      id: returId,
      tgl: new Date().toISOString().slice(0, 10),
      trxId: trx.id,
      noNota: trx.no,
      namaPasien: trx.nama,
      namaItem: item.nama,
      qty: qty,
      harga: item.harga,
      total: nilaiRetur,
      alasan: alasan || 'Retur Pasien',
      kasir: window.currentUser ? window.currentUser.u : '-',
      _t: Date.now()
    });

    // Update item transaksi atau tandai berkurang
    item.qty -= qty;
    trx.total = Math.max(0, trx.total - nilaiRetur);
    if (item.qty <= 0) {
      trx.items.splice(itemIndex, 1);
    }

    this.logActivity('Retur Penjualan', 'Kasir', `Nota ${trx.no} - ${item.nama} (${qty}x = ${rp(nilaiRetur)})`);
    this.saveLocal();
    return true;
  }

  // Proses Retur Pembelian ke Supplier PBF
  processReturBeli({ beliId, qtyRetur, alasan }) {
    const beli = this.get('beli', beliId);
    if (!beli) return false;

    const obat = this.getObat(beli.oid);
    if (!obat) return false;

    const qty = Math.min(Number(qtyRetur), beli.qty);
    if (qty <= 0) return false;

    const hargaSatuan = beli.total / (beli.qty || 1);
    const nilaiRetur = Math.round(qty * hargaSatuan);

    // Kurangi stok fisik obat
    obat.stok = Math.max(0, obat.stok - qty);

    // Kurangi sisa batch terkait
    const batch = (this.state.batch || []).find(b => b.beli === beli.id || b.oid === obat.id);
    if (batch) {
      batch.sisa = Math.max(0, batch.sisa - qty);
    }

    // Kurangi sisa tagihan jika belum lunas
    if (!beli.lunas) {
      beli.total = Math.max(0, beli.total - nilaiRetur);
    }
    beli.qty = Math.max(0, beli.qty - qty);

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

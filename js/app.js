// Aplikasi Utama Keuangan Klinik (Controller & View Renderer)
// Diperbarui & Disinkronkan: Pencegahan Tumpang Tindih & Akurasi Nominal Keuangan

const store = window.clinicStore;

// State navigasi & form aktif
let currentUser = null;
let currentRole = null;
let activeTab = '';
let cartItems = [];
let cashierSearchQuery = '';
let transactionSearchQuery = '';
let auditSearchQuery = '';
let posFilterCategory = 'Semua';
let selectedKartuStokOid = '';
let kartuStokSearch = '';

// Filter rentang tanggal
const todayStr = new Date().toISOString().slice(0, 10);
let dateFilter = {
  from: todayStr.slice(0, 7) + '-01',
  to: todayStr,
  metode: '',
  kasir: ''
};
// Navigasi Tabs per Role
const ROLE_TABS = {
  kasir: ['Shift', 'Pasien', 'Transaksi', 'Riwayat Transaksi', 'Kas Kecil'],
  admin: ['Obat & Tarif', 'Paket Pelayanan', 'Pembelian', 'Kedaluwarsa', 'Biaya', 'Stok Opname', 'Kartu Stok', 'Riwayat Transaksi', 'Verifikasi', 'Display TV', 'Ekspor'],
  pimpinan: ['Dashboard', 'Data Pasien', 'Stok Obat', 'Kartu Stok', 'Laba Rugi', 'Arus Kas', 'Utang', 'Approval', 'Pengawasan Retur', 'Paket Pelayanan', 'Ekspor', 'Log Aktivitas', 'Pengguna', 'Pengaturan']
};

const TAB_ICONS = {
  'Shift': '⏱️', 'Pasien': '👥', 'Transaksi': '🧾', 'Kas Kecil': '💵',
  'Obat & Tarif': '💊', 'Paket Pelayanan': '🎁', 'Pembelian': '📦', 'Kedaluwarsa': '⏳', 'Biaya': '💸',
  'Stok Opname': '📋', 'Kartu Stok': '📒', 'Riwayat Transaksi': '🗂️', 'Verifikasi': '✅', 'Ekspor': '📤',
  'Display TV': '📺',
  'Dashboard': '📊', 'Data Pasien': '👥', 'Stok Obat': '💊', 'Kartu Stok': '📒', 'Laba Rugi': '📈', 'Arus Kas': '💱', 'Utang': '🧮',
  'Approval': '✍️', 'Pengawasan Retur': '↩️', 'Log Aktivitas': '🕘', 'Pengguna': '👤', 'Pengaturan': '⚙️'
};

// Helper: Cari data dalam filter range
function inFilterRange(list) {
  return (list || []).filter(item => {
    if (!item.tgl) return true;
    return item.tgl >= dateFilter.from && item.tgl <= dateFilter.to;
  });
}

function getFilteredTrx() {
  return inFilterRange(store.state.trx).filter(t => {
    const matchMetode = !dateFilter.metode || t.metode === dateFilter.metode;
    const matchKasir = !dateFilter.kasir || t.kasir === dateFilter.kasir;
    return matchMetode && matchKasir;
  });
}

// Status pembatalan yang disetujui menjadi sumber kebenaran untuk tampilan dan laporan.
// Nilai asli transaksi tetap disimpan sebagai jejak audit.
function isTrxCancelled(trx) {
  if (!trx) return false;
  return trx.status === 'dibatalkan' || (store.state.batalTrx || []).some(r =>
    r && r.trxId === trx.id && r.status === 'disetujui'
  );
}

// Transaksi batal tetap tampil di riwayat, tetapi tidak dihitung sebagai pemasukan.
function getActiveFilteredTrx() {
  return getFilteredTrx().filter(t => !isTrxCancelled(t));
}

// ==========================================
// PERHITUNGAN FINANSIAL & REKAP (SINKRON & AMAN)
// ==========================================
function calculateFinancials() {
  const trxList = getActiveFilteredTrx();
  const allItems = trxList.flatMap(t => t.items || []);
  const allActiveTrx = (store.state.trx || []).filter(t => !isTrxCancelled(t));
  const trxById = new Map(allActiveTrx.map(t => [t.id, t]));
  // Retur dibukukan pada tanggal persetujuan/retur, bukan mengubah tanggal nota asli.
  // Filter metode dan kasir mengikuti transaksi asal agar laporan tidak mencampur kelompok.
  const approvedReturns = inFilterRange(store.state.returJual || []).filter(r => {
    if (!(r.status === 'disetujui' || !r.status)) return false;
    const original = trxById.get(r.trxId);
    if (original && isTrxCancelled(original)) return false;
    const method = original ? original.metode : r.metode;
    const cashier = original ? original.kasir : r.kasir;
    if (dateFilter.metode && method !== dateFilter.metode) return false;
    if (dateFilter.kasir && cashier !== dateFilter.kasir) return false;
    return true;
  });
  const grossRevenue = trxList.reduce((s, t) => s + Number(t.total || 0), 0);
  const returnValue = approvedReturns.reduce((sum, r) => sum + Number(r.total || 0), 0);
  const returnGoods = approvedReturns.filter(r => ['Obat', 'Paket'].includes(r.jenis || ''))
    .reduce((sum, r) => sum + Number(r.total || 0), 0);
  const returnServices = returnValue - returnGoods;
  const returnHpp = approvedReturns.filter(r => ['Obat', 'Paket'].includes(r.jenis || ''))
    .reduce((sum, r) => sum + Number(r.hpp || 0) * Number(r.qty || 0), 0);
  const refundPaid = approvedReturns.filter(r => r.pengembalian && r.pengembalian.status === 'dibayar')
    .reduce((sum, r) => sum + Number(r.pengembalian.nominal || r.total || 0), 0);
  const refundPending = approvedReturns.filter(r => r.pengembalian && r.pengembalian.status === 'menunggu')
    .reduce((sum, r) => sum + Number(r.pengembalian.nominal || r.total || 0), 0);
  const legacyReturnValue = approvedReturns.filter(r => !r.pengembalian)
    .reduce((sum, r) => sum + Number(r.total || 0), 0);
  const sumByJenis = j => allItems.filter(i => (i.t || i.jenis) === j)
    .reduce((s, x) => s + Number(x.harga || 0) * Number(x.qty || 0), 0) -
    approvedReturns.filter(r => (r.jenis || '') === j).reduce((s, r) => s + Number(r.total || 0), 0);
  // Pendapatan bersih = transaksi bruto dikurangi retur yang sudah disetujui.
  const rev = grossRevenue - returnValue;
  const hpp = allItems.filter(i => (i.t || i.jenis) === 'Obat' || (i.t || i.jenis) === 'Paket')
    .reduce((s, x) => s + Number(x.hpp || 0) * Number(x.qty || 0), 0) - returnHpp;

  const loss = inFilterRange(store.state.loss).reduce((s, l) => s + Number(l.nilai || 0), 0);
  const op = inFilterRange(store.state.biaya)
    .filter(b => b.status === 'approved')
    .reduce((s, b) => s + Number(b.jml || 0), 0);
  const pc = inFilterRange(store.state.petty).reduce((s, p) => s + Number(p.jml || 0), 0);

  const kons = sumByJenis('Konsultasi');
  const tind = sumByJenis('Tindakan');
  const obat = sumByJenis('Obat');
  const paket = sumByJenis('Paket');
  const disk = Math.abs(sumByJenis('Diskon'));

  const totalModalAwalShift = inFilterRange(store.state.shift || []).reduce((s, sh) => s + Number(sh.modal || 0), 0);
  const laba = rev - hpp - loss - op - pc;

  return {
    trxList, approvedReturns, grossRevenue, returnValue, returnGoods, returnServices,
    refundPaid, refundPending, legacyReturnValue, rev, hpp, loss, op, pc,
    kons, tind, obat, paket, disk, laba, totalModalAwalShift,
    totalKasDiTangan: totalModalAwalShift +
      trxList.filter(t => t.metode === 'Tunai').reduce((s, t) => s + Number(t.total || 0), 0) -
      approvedReturns.filter(r =>
        (r.metode === 'Tunai' && !r.pengembalian) ||
        (r.pengembalian && r.pengembalian.status === 'dibayar' && r.pengembalian.metode === 'Tunai'))
        .reduce((s, r) => s + Number(r.pengembalian ? (r.pengembalian.nominal || r.total || 0) : (r.total || 0)), 0) - pc
  };
}

// Inisialisasi Aplikasi
function initApp() {
  applyAppSettings();
  store.subscribe(() => {
    applyAppSettings();
    renderApp();
  });
  renderApp();
}

function applyAppSettings() {
  const set = store.state.set || {};
  const root = document.documentElement;
  if (set.warna) root.style.setProperty('--pr', set.warna);
  root.dataset.theme = set.tema === 'auto' ? '' : set.tema;
  document.body.style.fontSize = (set.font || '14') + 'px';
  
  const logoHtml = set.logoImg 
    ? `<img class="lg" src="${esc(set.logoImg)}" alt="Logo">`
    : `<span>${esc(set.logo || '🏥')}</span>`;
  
  $('brand-logo').innerHTML = logoHtml;
  $('brand-title').textContent = set.nama || 'Klinik Sehat';
  $('login-brand-logo').innerHTML = logoHtml;
  $('login-brand-title').textContent = set.nama || 'Klinik Sehat';
  document.title = (set.nama || 'Klinik Sehat') + ' - Sistem Manajemen & Keuangan';
}

// Semua peran masuk melalui Firebase Authentication dan profil Firestore aktif.
function applyFirebaseSession(profile) {
  if (!profile || profile.active !== true || !['pimpinan', 'admin', 'kasir'].includes(profile.role)) return;
  const user = Object.assign({}, profile, { id: profile.u, u: profile.u });
  delete user.pw;
  currentUser = user;
  window.currentUser = user;
  currentRole = profile.role;
  activeTab = (ROLE_TABS[currentRole] || [])[0] || '';
  cartItems = [];
  $('login-error').textContent = '';
  $('login-password').value = '';
  $('login-modal').style.display = 'none';
  renderApp();
}

window.onFirebaseAuthUser = async (firebaseUser, profile) => {
  if (firebaseUser && profile) applyFirebaseSession(profile);
};

async function doLogin() {
  const email = val('login-email').trim().toLowerCase();
  const password = val('login-password');
  const errorEl = $('login-error');
  if (!email || !password) {
    errorEl.textContent = 'Masukkan email dan password.';
    return;
  }
  const backend = window.firebaseBackend;
  if (!backend || !backend.auth) {
    errorEl.textContent = 'Firebase belum siap. Periksa koneksi internet lalu coba lagi.';
    return;
  }
  errorEl.textContent = 'Memeriksa akun melalui Firebase...';
  try {
    const profile = await backend.login(email, password);
    applyFirebaseSession(profile);
    store.logActivity('Masuk', 'Sesi', `${profile.role}: ${profile.nama} login melalui Firebase`);
  } catch (err) {
    console.error('Login Firebase gagal:', err);
    errorEl.textContent = err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential'
      ? 'Email atau password tidak sesuai.'
      : (err.code === 'auth/user-not-found' ? 'Akun belum terdaftar di Firebase Authentication.' : (err.message || 'Login gagal.'));
  }
}

async function activatePimpinanAccount() {
  const email = val('login-email').trim().toLowerCase();
  const password = val('login-password');
  if (!email || !password) {
    $('login-error').textContent = 'Isi email dan password akun Pimpinan, lalu tekan tombol Aktivasi.';
    return;
  }
  await doLogin();
}

async function resetLoginPassword() {
  const email = val('login-email').trim().toLowerCase();
  if (!email) {
    $('login-error').textContent = 'Masukkan email akun Assalam terlebih dahulu.';
    return;
  }
  try {
    await window.firebaseBackend.resetPassword(email);
    $('login-error').textContent = 'Tautan reset password telah dikirim. Periksa kotak masuk email.';
  } catch (err) {
    $('login-error').textContent = err.message || 'Permintaan reset password gagal.';
  }
}

function doLogout() {
  showConfirm('Apakah Anda yakin ingin keluar?', async () => {
    store.logActivity('Keluar', 'Sesi', `User ${currentUser ? currentUser.nama : ''} logout`);
    currentUser = null;
    window.currentUser = null;
    currentRole = null;
    activeTab = '';
    cartItems = [];
    if (window.firebaseBackend && window.firebaseBackend.auth) {
      await window.firebaseBackend.performPush(store.state);
      await window.firebaseBackend.auth.signOut().catch(err => console.warn('Firebase signOut:', err));
    }
    $('login-modal').style.display = 'flex';
    renderApp();
  });
}

function setTab(tabName) {
  activeTab = tabName;
  window.PAGE_STATE = {};
  renderApp();
}

// Filter Bar Renderer
function renderFilterBar() {
  const usersKasir = (store.state.users || []).filter(u => u.role === 'kasir');
  return `
    <div class="card row" style="align-items:center;">
      <label>Dari Tanggal
        <input type="date" value="${dateFilter.from}" onchange="dateFilter.from=this.value;renderApp();">
      </label>
      <label>Sampai Tanggal
        <input type="date" value="${dateFilter.to}" onchange="dateFilter.to=this.value;renderApp();">
      </label>
      <label>Metode Pembayaran
        <select onchange="dateFilter.metode=this.value;renderApp();">
          <option value="">Semua Metode</option>
          ${['Tunai', 'QRIS', 'Transfer', 'Debit/Kredit'].map(m => `<option value="${m}" ${dateFilter.metode === m ? 'selected' : ''}>${m}</option>`).join('')}
        </select>
      </label>
      <label>Kasir
        <select onchange="dateFilter.kasir=this.value;renderApp();">
          <option value="">Semua Kasir</option>
          ${usersKasir.map(u => `<option value="${esc(u.u)}" ${dateFilter.kasir === u.u ? 'selected' : ''}>${esc(u.nama)}</option>`).join('')}
        </select>
      </label>
      <div style="display:flex;gap:4px;margin-top:14px;">
        <button class="s" onclick="applyDatePreset(0)">Hari Ini</button>
        <button class="s" onclick="applyDatePreset(7)">7 Hari</button>
        <button class="s" onclick="applyDatePreset(30)">Bulan Ini</button>
        <button class="s" onclick="applyDatePreset(-1)">Semua</button>
      </div>
    </div>
  `;
}

function applyDatePreset(days) {
  dateFilter.to = todayStr;
  if (days < 0) {
    dateFilter.from = '2020-01-01';
  } else if (days === 0) {
    dateFilter.from = todayStr;
  } else if (days === 30) {
    dateFilter.from = todayStr.slice(0, 7) + '-01';
  } else {
    const d = new Date(Date.now() - (days * 864e5));
    dateFilter.from = d.toISOString().slice(0, 10);
  }
  renderApp();
}

// -------------------------------------------------------------
// MODULE: SHIFT KASIR
// -------------------------------------------------------------
function getCurrentShift() {
  if (!currentUser) return null;
  return (store.state.shift || []).find(s => s.kasir === currentUser.u && s.status === 'buka');
}

function getShiftTrx(shift) {
  return (store.state.trx || []).filter(t => t.sh === shift.id && !isTrxCancelled(t));
}

function calcShiftCash(shift) {
  const trxList = getShiftTrx(shift);
  const tunaiTrx = trxList.filter(t => t.metode === 'Tunai').reduce((s, t) => s + Number(t.total || 0), 0);
  const kasKecil = (store.state.petty || []).filter(p => p.sh === shift.id).reduce((s, p) => s + Number(p.jml || 0), 0);
  return Number(shift.modal || 0) + tunaiTrx - kasKecil;
}

function viewShift() {
  const shift = getCurrentShift();
  const myShifts = (store.state.shift || []).filter(s => s.kasir === (currentUser ? currentUser.u : '')).slice().reverse();

  let activeCard = '';
  if (shift) {
    const trxs = getShiftTrx(shift);
    const nonTunai = trxs.filter(t => t.metode !== 'Tunai').reduce((s, t) => s + Number(t.total || 0), 0);
    const tunaiSistem = calcShiftCash(shift);

    const ownerWa = store.getOwnerWa ? store.getOwnerWa() : (store.state.set && store.state.set.waOwner);
    const waNotice = ownerWa 
      ? `<div style="font-size:12px;color:var(--ok);margin-top:6px;display:flex;align-items:center;gap:6px;"><span>📲</span> <span>Laporan rekap tutup shift akan <b>otomatis terkirim ke WhatsApp Owner</b> (${esc(ownerWa)}).</span></div>`
      : `<div style="font-size:12px;color:var(--rd);margin-top:6px;display:flex;align-items:center;gap:6px;"><span>⚠️</span> <span>Nomor WA Owner belum diatur pada user pimpinan. Atur di menu Pengguna/Pengaturan agar rekap terkirim otomatis.</span></div>`;

    activeCard = `
      <div class="card">
        <h2>Shift Berjalan: ${esc(shift.jam)} (${esc(shift.tgl)})</h2>
        <div class="grid">
          <div class="kpi"><span>Modal Awal Laci</span><b>${rp(shift.modal)}</b></div>
          <div class="kpi"><span>Jumlah Transaksi</span><b>${trxs.length}</b></div>
          <div class="kpi"><span>Pembayaran Non-Tunai</span><b>${rp(nonTunai)}</b></div>
          <div class="kpi"><span>Uang Laci Sistem (Modal + Tunai - Kas Kecil)</span><b>${rp(tunaiSistem)}</b></div>
        </div>
        <div class="row">
          <label>Hitung Kas Fisik di Laci (Rp)
            <input id="input-shift-fisik" type="number" placeholder="Contoh: 750000">
          </label>
          <button class="p btn-danger" onclick="actionTutupShift()">Tutup Shift &amp; Kirim Rekap ke WA Owner</button>
        </div>
        ${waNotice}
      </div>
    `;
  } else {
    activeCard = `
      <div class="card">
        <h2>Buka Shift Kasir Baru</h2>
        <p style="color:var(--mu);margin-bottom:12px;">Masukkan modal awal uang kembalian di laci kasir sebelum memulai transaksi.</p>
        <div class="row">
          <label>Modal Awal Uang Laci (Rp)
            <input id="input-shift-modal" type="number" value="100000">
          </label>
          <button class="p" onclick="actionBukaShift()">Buka Shift Sekarang</button>
        </div>
      </div>
    `;
  }

  const shiftRows = myShifts.map(s => [
    esc(s.tgl),
    esc(s.jam),
    esc(s.jamT || '-'),
    rp(s.modal),
    s.status === 'tutup' ? rp(s.sistem) : '-',
    s.status === 'tutup' ? rp(s.fisik) : '-',
    s.status === 'tutup' 
      ? `<span class="${(s.fisik - s.sistem) !== 0 ? 'badge-bad' : 'badge-ok'}">${rp(s.fisik - s.sistem)}</span>`
      : '<span class="badge-warn">Berjalan</span>',
    s.status === 'buka' 
      ? '<span class="badge-warn">Aktif</span>' 
      : `
        <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;">
          <span class="${s.verif ? 'badge-ok' : 'badge-warn'}">${s.verif ? 'Diverifikasi' : 'Menunggu Admin'}</span>
          <button class="s" style="background:#16a34a;border-color:#16a34a;color:#fff;padding:2px 6px;font-size:11px;" onclick="resendShiftWa('${s.id}')" title="Kirim Rekap ke WA Owner">📲 WA</button>
          <button class="s" style="padding:2px 6px;font-size:11px;" onclick="printShiftSlip('${s.id}')" title="Cetak Berita Acara Kasir">🖨️ Slip</button>
          <button class="s" style="padding:2px 6px;font-size:11px;" onclick="copyShiftWa('${s.id}')" title="Salin Teks Laporan ke Clipboard">📋 Salin</button>
        </div>
      `
  ]);

  return activeCard + `
    <div class="card">
      <h2>Riwayat Shift Saya</h2>
      ${renderTable(['Tanggal', 'Buka', 'Tutup', 'Modal', 'Sistem', 'Fisik', 'Selisih', 'Status'], shiftRows, { key: 'shift_me' })}
    </div>
  `;
}

function actionBukaShift() {
  const modal = numVal('input-shift-modal');
  const now = new Date();
  store.state.shift.push({
    id: uid(),
    tgl: todayStr,
    jam: now.toTimeString().slice(0, 5),
    kasir: currentUser.u,
    nama: currentUser.nama,
    modal: Number(modal) || 0,
    status: 'buka',
    _t: Date.now()
  });
  store.logActivity('Buka Shift', 'Shift', `Modal awal ${rp(modal)}`);
  store.saveLocal();
}

function actionTutupShift() {
  const shift = getCurrentShift();
  if (!shift) return;
  const fisik = numVal('input-shift-fisik');
  if (fisik < 0) {
    showAlert('Nominal fisik kas tidak valid');
    return;
  }

  const ownerWa = store.getOwnerWa ? store.getOwnerWa() : (store.state.set && store.state.set.waOwner);
  const waInfo = ownerWa ? `\n\n📲 Rekap tutup shift akan otomatis dikirimkan ke WhatsApp Owner (${ownerWa}).` : `\n\n⚠️ Nomor WA Owner belum diatur pada user pimpinan.`;

  showConfirm(`Tutup shift dengan kas fisik ${rp(fisik)}?${waInfo}`, () => {
    const sistem = calcShiftCash(shift);
    shift.status = 'tutup';
    shift.jamT = new Date().toTimeString().slice(0, 5);
    shift.sistem = Number(sistem);
    shift.fisik = Number(fisik);
    shift.selisih = Number(fisik) - Number(sistem);
    shift.verif = false;
    shift._t = Date.now();

    store.logActivity('Tutup Shift', 'Shift', `Fisik: ${rp(fisik)}, Sistem: ${rp(sistem)}, Selisih: ${rp(shift.selisih)}`);
    store.saveLocal();

    const waRes = sendShiftRecapWA(shift, store);
    showShiftCloseModal(shift, waRes);
    renderApp();
  });
}

function resendShiftWa(shiftId) {
  const s = store.get('shift', shiftId);
  if (!s) return;
  const waRes = sendShiftRecapWA(s, store);
  if (!waRes.success) {
    showAlert(waRes.reason || 'Gagal mengirim WhatsApp');
  } else {
    showAlert(`Laporan Rekap Tutup Shift telah dibuka untuk dikirimkan ke WhatsApp Owner (${waRes.hp}).`, '📲 WhatsApp Owner');
  }
}

function showShiftCloseModal(shift, waRes) {
  const modal = $('modal-shift-close');
  const body = $('modal-shift-close-body');
  const actions = $('modal-shift-close-actions');
  if (!modal || !body) return;

  const selisih = shift.selisih || 0;
  const statusBadge = selisih === 0 
    ? '<span class="badge-ok">✅ Kas Sesuai / Pas (Rp 0)</span>' 
    : selisih > 0 
      ? `<span class="badge-warn">⚠️ Kas Lebih : +${rp(selisih)}</span>` 
      : `<span class="badge-bad">❌ Kas Kurang : ${rp(selisih)}</span>`;

  body.innerHTML = `
    <div style="text-align:center;margin-bottom:14px;">
      <div style="font-size:38px;margin-bottom:4px;">⏱️</div>
      <h3 style="margin:0;">Shift Kasir Berhasil Ditutup</h3>
      <p style="color:var(--mu);font-size:13px;margin-top:2px;">Shift ${esc(shift.jam)} - ${esc(shift.jamT || '')} (${esc(shift.tgl)})</p>
    </div>

    <div style="background:var(--bg);padding:12px 14px;border-radius:10px;font-size:13px;line-height:1.6;margin-bottom:14px;border:1px solid var(--bdr);">
      <div style="display:flex;justify-content:space-between;"><span>Modal Awal:</span><b>${rp(shift.modal)}</b></div>
      <div style="display:flex;justify-content:space-between;"><span>Uang Laci Sistem:</span><b>${rp(shift.sistem)}</b></div>
      <div style="display:flex;justify-content:space-between;"><span>Uang Fisik Kasir:</span><b>${rp(shift.fisik)}</b></div>
      <div style="display:flex;justify-content:space-between;margin-top:4px;padding-top:4px;border-top:1px dashed var(--bdr);">
        <span>Status Selisih:</span>
        <div>${statusBadge}</div>
      </div>
    </div>

    <div style="padding:12px;border-radius:10px;font-size:12.5px;background:${waRes && waRes.success ? 'rgba(22,163,74,0.1)' : 'rgba(239,68,68,0.1)'};border:1.5px solid ${waRes && waRes.success ? '#16a34a' : '#ef4444'};">
      <div style="display:flex;align-items:center;gap:8px;font-weight:700;color:${waRes && waRes.success ? '#16a34a' : '#ef4444'};">
        <span>${waRes && waRes.success ? '📲' : '⚠️'}</span>
        <span>${waRes && waRes.success ? 'Rekap Otomatis Terkirim ke WA Owner' : 'WhatsApp Owner Belum Siap'}</span>
      </div>
      <div style="margin-top:4px;color:var(--tx);">
        ${waRes && waRes.success 
          ? `Laporan telah dibuka di WhatsApp menuju nomor Owner: <b>${esc(waRes.hp)}</b>` 
          : `${esc(waRes.reason || 'Nomor WA Owner belum diatur pada user pimpinan')}. Anda dapat mengaturnya di menu <b>Pengguna</b> atau <b>Pengaturan</b>.`}
      </div>
    </div>
  `;

  if (actions) {
    actions.innerHTML = `
      <button onclick="closeShiftCloseModal()">Selesai &amp; Tutup</button>
      <button class="s" onclick="copyShiftWa('${shift.id}')" title="Salin teks laporan rekap shift ke clipboard">📋 Salin Teks</button>
      <button class="s" onclick="printShiftSlip('${shift.id}')" title="Cetak slip berita acara tutup kasir">🖨️ Cetak Slip</button>
      <button class="p" style="background:#16a34a;border-color:#16a34a;" onclick="resendShiftWa('${shift.id}')">📲 Buka WA Owner</button>
    `;
  }

  modal.style.display = 'flex';
}

function closeShiftCloseModal() {
  const modal = $('modal-shift-close');
  if (modal) modal.style.display = 'none';
}

function copyShiftWa(shiftId) {
  const shift = store.get('shift', shiftId);
  if (!shift) return;
  const res = sendShiftRecapWA(shift, store);
  if (res && res.message) {
    navigator.clipboard.writeText(res.message).then(() => {
      showAlert('Laporan rekap tutup shift berhasil disalin ke clipboard!\nAnda dapat langsung paste (Ctrl+V) ke WhatsApp Web / Desktop.', '📋 Salin Berhasil');
    }).catch(() => {
      showAlert(res.message, 'Teks Rekap Shift');
    });
  }
}

function printShiftSlip(shiftId) {
  const shift = store.get('shift', shiftId);
  if (!shift) return;
  const set = store.state.set || {};
  const trxList = (store.state.trx || []).filter(t => t.sh === shift.id && t.status !== 'dibatalkan');
  const tunaiTrx = trxList.filter(t => t.metode === 'Tunai').reduce((s, t) => s + Number(t.total || 0), 0);
  const nonTunaiTrx = trxList.filter(t => t.metode !== 'Tunai').reduce((s, t) => s + Number(t.total || 0), 0);
  const pettyList = (store.state.petty || []).filter(p => p.sh === shift.id);
  const kasKecil = pettyList.reduce((s, p) => s + Number(p.jml || 0), 0);
  const modal = Number(shift.modal || 0);
  const sistem = shift.sistem !== undefined ? Number(shift.sistem) : (modal + tunaiTrx - kasKecil);
  const fisik = shift.fisik !== undefined ? Number(shift.fisik) : sistem;
  const selisih = shift.selisih !== undefined ? Number(shift.selisih) : (fisik - sistem);

  const modalEl = $('modal-nota');
  const body = $('modal-nota-body');
  if (!modalEl || !body) return;

  body.innerHTML = `
    <div class="nota-box">
      <div style="text-align:center;">
        <b style="font-size:15px;">${esc(set.nama || 'Klinik Sehat Pratama')}</b><br>
        <span style="font-size:11px;font-weight:700;color:#0f766e;">BERITA ACARA TUTUP SHIFT KASIR</span><br>
        <span style="font-size:10px;color:#64748b;">${esc(set.alamat || '')}</span>
      </div>
      <hr>
      <div style="font-size:11px;line-height:1.5;">
        <div>Tanggal : <b>${esc(shift.tgl)}</b></div>
        <div>Waktu   : <b>${esc(shift.jam)} - ${esc(shift.jamT || '')} WIB</b></div>
        <div>Kasir   : <b>${esc(shift.nama || shift.kasir || '-')}</b></div>
      </div>
      <hr>
      <div style="font-size:11px;line-height:1.6;">
        <div style="display:flex;justify-content:space-between;"><span>Modal Awal Laci:</span><b>${rp(modal)}</b></div>
        <div style="display:flex;justify-content:space-between;"><span>Penjualan Tunai:</span><b>${rp(tunaiTrx)}</b></div>
        <div style="display:flex;justify-content:space-between;"><span>Kas Kecil Keluar:</span><b>-${rp(kasKecil)}</b></div>
        <hr style="border-top:1px dashed #cbd5e1;margin:4px 0;">
        <div style="display:flex;justify-content:space-between;"><span>Kas Laci Sistem:</span><b>${rp(sistem)}</b></div>
        <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:700;"><span>Kas Fisik Dihitung:</span><b>${rp(fisik)}</b></div>
        <div style="display:flex;justify-content:space-between;font-weight:700;color:${selisih < 0 ? '#dc2626' : selisih > 0 ? '#d97706' : '#16a34a'};">
          <span>Status Selisih:</span><b>${selisih > 0 ? '+' : ''}${rp(selisih)}</b>
        </div>
      </div>
      <hr>
      <div style="font-size:11px;line-height:1.5;">
        <div>Non-Tunai (QRIS/Trf) : <b>${rp(nonTunaiTrx)}</b></div>
        <div>Total Transaksi      : <b>${trxList.length} Nota Pasien</b></div>
        <div style="font-size:12px;font-weight:800;margin-top:2px;">TOTAL OMSET SHIFT: ${rp(tunaiTrx + nonTunaiTrx)}</div>
      </div>
      <hr>
      <div style="display:flex;justify-content:space-between;text-align:center;font-size:10px;margin-top:16px;padding-top:4px;">
        <div style="width:45%;">
          Kasir Bertugas,<br><br><br>
          ( <b>${esc(shift.nama || shift.kasir || 'Kasir')}</b> )
        </div>
        <div style="width:45%;">
          Penerima / Supervisor,<br><br><br>
          ( ....................... )
        </div>
      </div>
    </div>
  `;

  const waBtn = $('btn-wa-receipt');
  if (waBtn) waBtn.style.display = 'none';
  const labelBtn = $('btn-label-obat-nota');
  if (labelBtn) labelBtn.style.display = 'none';

  modalEl.style.display = 'flex';
}

// -------------------------------------------------------------
// MODULE: PASIEN & ANTREAN
// -------------------------------------------------------------
function viewPasien() {
  const todayPatients = (store.state.pasien || []).filter(p => p.tgl === todayStr && !p.deletedAt && p.status !== 'dihapus');

  const rows = todayPatients.map(p => [
    esc(p.no),
    esc(p.jam),
    esc(p.nama),
    esc(p.hp || '-'),
    esc(p.layanan),
    p.status === 'batal_berobat' ? '<span class="badge-bad">Batal Berobat</span>' : p.done ? '<span class="badge-ok">Lunas</span>' : p.calling ? '<span class="badge-ok" style="background:#06b6d4;color:#042f2e;">📢 Sedang Dipanggil</span>' : '<span class="badge-warn">Menunggu</span>',
    p.done ? '-' : p.status === 'batal_berobat' ? `
      <button class="s p" onclick="actionPulihkanBatalBerobat('${p.id}')">Aktifkan Kembali</button>
    ` : `
      <button class="s p" onclick="store.callPatient('${p.id}')" title="Panggil ke Layar TV & Bunyikan Bel">📢 Panggil</button>
      <button class="s" onclick="editPasien('${p.id}')">Edit</button>
      <button class="s btn-danger" onclick="actionBatalBerobat('${p.id}')">Batal Berobat</button>
    `
  ]);

  return `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:10px;">
        <h2 style="margin:0;">Registrasi Kedatangan Pasien Hari Ini</h2>
        <button class="btn-tv-header s" onclick="openTvDisplay()">📺 Buka Layar Display TV (HDMI)</button>
      </div>

      <div style="position:relative;margin-bottom:16px;">
        <label style="font-weight:700;font-size:13px;display:block;margin-bottom:5px;color:var(--pr);">🔍 Cari Pasien Lama — Isi Otomatis Nama &amp; HP</label>
        <input id="p-search-lama" type="search" placeholder="Ketik nama atau nomor HP pasien lama..."
          oninput="searchPasienLama()" autocomplete="off"
          style="width:100%;padding:10px 14px;border-radius:10px;border:1.5px solid var(--bdr);background:var(--bg);color:var(--tx);font-size:14px;outline:none;">
        <div id="p-search-results"
          style="display:none;position:absolute;top:calc(100% + 4px);left:0;right:0;background:var(--card);border:1.5px solid var(--pr);border-radius:10px;max-height:230px;overflow-y:auto;z-index:300;box-shadow:0 8px 32px rgba(0,0,0,0.28);">
        </div>
      </div>

      <div class="row">
        <label>Nama Lengkap Pasien *
          <input id="p-nama" placeholder="Contoh: Rina Wahyuni">
        </label>
        <label>Nomor HP / WA (Untuk Struk WA)
          <input id="p-hp" type="tel" placeholder="0812xxxxxxx">
        </label>
        <label>Layanan yang Dituju
          <select id="p-layanan">
            <option>Dokter Umum</option>
            <option>Dokter Gigi</option>
            <option>Dokter Spesialis</option>
            <option>Tindakan Medis</option>
            <option>Laboratorium / Cek Darah</option>
          </select>
        </label>
        <button class="p" onclick="actionAddPasien()">+ Daftarkan Antrean</button>
      </div>
    </div>
    <div class="card">
      <h2>Antrean Pasien Hari Ini (${todayStr})</h2>
      ${renderTable(['No. Antrean', 'Jam', 'Nama Pasien', 'No. HP', 'Layanan', 'Status', 'Aksi'], rows, { key: 'pasien_hari_ini' })}
    </div>
  `;
}

function actionAddPasien() {
  const nama = val('p-nama').trim();
  if (!nama) {
    showAlert('Nama pasien wajib diisi');
    return;
  }
  const shift = getCurrentShift();
  store.state.seq[todayStr] = (store.state.seq[todayStr] || 0) + 1;
  const noAntrean = 'A' + String(store.state.seq[todayStr]).padStart(3, '0');
  
  store.state.pasien.push({
    id: uid(),
    no: noAntrean,
    tgl: todayStr,
    jam: new Date().toTimeString().slice(0, 5),
    nama: nama,
    hp: val('p-hp').trim(),
    layanan: val('p-layanan'),
    done: false,
    kasir: currentUser ? currentUser.u : '-',
    sh: shift ? shift.id : null,
    _t: Date.now()
  });

  store.logActivity('Tambah', 'Pasien', `${noAntrean} - ${nama}`);
  store.saveLocal();
  if (typeof broadcastQueueUpdate === 'function') broadcastQueueUpdate();
  $('p-nama').value = '';
  $('p-hp').value = '';
}

function editPasien(id) {
  const p = store.get('pasien', id);
  if (!p || p.deletedAt || p.status === 'dihapus') return;
  showFormModal('Edit Data Pasien', [
    ['nama', 'Nama Lengkap Pasien', 'text', p.nama],
    ['hp', 'Nomor HP', 'tel', p.hp]
  ], res => {
    p.nama = res.nama;
    p.hp = res.hp;
    p._t = Date.now();
    store.logActivity('Ubah', 'Pasien', `${p.no} - ${p.nama}`);
    store.saveLocal();
  });
}

function actionBatalBerobat(id) {
  if (currentRole !== 'kasir') {
    showAlert('Hanya Kasir yang dapat mencatat pembatalan berobat.', 'Akses Ditolak');
    return;
  }
  const p = store.get('pasien', id);
  if (!p || p.done || p.deletedAt || p.status === 'dihapus' || p.status === 'batal_berobat') return;
  showConfirm('Tandai pasien ini Batal Berobat? Data pasien tetap tersimpan dan tidak masuk antrean transaksi.', () => {
    p.status = 'batal_berobat';
    p.batalBerobatPada = Date.now();
    p.batalBerobatOleh = currentUser ? currentUser.u : 'kasir';
    p.calling = false;
    p._t = Date.now();
    store.logActivity('Batal Berobat', 'Pasien', `${p.no} - ${p.nama}`);
    store.saveLocal();
    if (typeof broadcastQueueUpdate === 'function') broadcastQueueUpdate();
  });
}

function actionPulihkanBatalBerobat(id) {
  if (currentRole !== 'kasir') {
    showAlert('Hanya Kasir yang dapat mengaktifkan kembali antrean.', 'Akses Ditolak');
    return;
  }
  const p = store.get('pasien', id);
  if (!p || p.status !== 'batal_berobat' || p.done || p.tgl !== todayStr) return;
  showConfirm('Aktifkan kembali pasien ini ke antrean hari ini?', () => {
    p.status = 'aktif';
    p.batalBerobatPada = null;
    p.batalBerobatOleh = null;
    p._t = Date.now();
    store.logActivity('Pulihkan Antrean', 'Pasien', `${p.no} - ${p.nama}`);
    store.saveLocal();
    if (typeof broadcastQueueUpdate === 'function') broadcastQueueUpdate();
  });
}

function delPasien(id) {
  if (currentRole !== 'pimpinan') {
    showAlert('Hanya Pimpinan yang dapat mengarsipkan pasien.', 'Akses Ditolak');
    return;
  }
  const p = store.get('pasien', id);
  if (!p || p.done || p.deletedAt || p.status === 'dihapus') {
    showAlert('Pasien tidak dapat diarsipkan. Periksa status pasien dan riwayat pelayanannya.');
    return;
  }
  showConfirm('Arsipkan pasien ini? Data dan riwayatnya tetap disimpan.', () => {
    p.status = 'dihapus';
    p.deletedAt = Date.now();
    p.deletedBy = currentUser ? currentUser.u : 'sistem';
    p._t = Date.now();
    store.logActivity('Arsipkan', 'Pasien', `${p.no} - ${p.nama}`);
    store.saveLocal();
    if (typeof broadcastQueueUpdate === 'function') broadcastQueueUpdate();
  });
}

// -------------------------------------------------------------
// MODULE: TRANSAKSI & KASIR (POS)
// -------------------------------------------------------------
function viewTrx() {
  const waitingPatients = (store.state.pasien || []).filter(p => !p.done && !p.deletedAt && p.status !== 'dihapus' && p.status !== 'batal_berobat');
  const totalCart = cartItems.reduce((s, i) => s + (Number(i.harga || 0) * Number(i.qty || 0)), 0);

  const cartRows = cartItems.map((item, idx) => [
    esc(item.nama),
    `<span class="badge-ok">${esc(item.t || item.jenis)}</span>`,
    rp(item.harga),
    item.qty,
    rp(item.harga * item.qty),
    `<button class="s btn-danger" onclick="cartItems.splice(${idx}, 1); renderApp();">Hapus</button>`
  ]);

  const searchLower = cashierSearchQuery.toLowerCase();
  const filteredObat = (store.state.obat || []).filter(o => 
    o.nama.toLowerCase().includes(searchLower)
  );

  const todayTrx   = (store.state.trx || []).filter(t => t.tgl === todayStr && !isTrxCancelled(t));
  const todayTotal  = todayTrx.reduce((s, t) => s + Number(t.total || 0), 0);
  const todayCount  = todayTrx.length;

  return `
    <div class="pos-layout">

      <!-- KIRI: Menu Produk + Pencarian -->
      <div class="pos-left">

        <div class="pos-top-bar">
          <div style="flex:1;">
            <div style="font-size:11px;color:var(--mu);font-weight:700;letter-spacing:1px;">PILIH PASIEN</div>
            <select id="trx-pasien" style="margin-top:4px;width:100%;padding:9px 12px;border-radius:8px;border:1.5px solid var(--bdr);background:var(--bg);color:var(--tx);font-size:13px;font-weight:600;">
              ${waitingPatients.length === 0 ? '<option value="">-- Belum ada pasien antrean --</option>' : ''}
              ${waitingPatients.map(p => `<option value="${p.id}">${esc(p.no)} — ${esc(p.nama)} (${esc(p.layanan)})</option>`).join('')}
            </select>
          </div>
          <div style="display:flex;gap:8px;align-items:flex-end;flex-shrink:0;">
            <div style="background:var(--bg);padding:8px 14px;border-radius:8px;text-align:center;border:1px solid var(--bdr);">
              <div style="font-size:10px;color:var(--mu);font-weight:700;">TRX HARI INI</div>
              <div style="font-size:18px;font-weight:900;color:var(--pr);">${todayCount}</div>
            </div>
            <div style="background:var(--bg);padding:8px 14px;border-radius:8px;text-align:center;border:1px solid var(--bdr);">
              <div style="font-size:10px;color:var(--mu);font-weight:700;">OMSET</div>
              <div style="font-size:13px;font-weight:800;color:var(--ok);">${rp(todayTotal)}</div>
            </div>
          </div>
        </div>

        <div style="display:flex;gap:8px;align-items:center;padding:10px 14px;background:var(--bg);border-bottom:1px solid var(--bdr);flex-wrap:wrap;">
          <input id="trx-search-input" type="search" placeholder="🔍 Cari obat / jasa / paket... (F2)"
            value="${esc(cashierSearchQuery)}"
            oninput="cashierSearchQuery=this.value;renderApp();"
            style="flex:1;min-width:160px;padding:8px 12px;border-radius:8px;border:1.5px solid var(--bdr);background:var(--card);color:var(--tx);font-size:13px;">
          <div style="display:flex;gap:4px;flex-shrink:0;">
            <button type="button" class="touch-chip ${posFilterCategory === 'Semua' ? 'active' : ''}" onclick="setPosCategory('Semua')">Semua</button>
            <button type="button" class="touch-chip ${posFilterCategory === 'Jasa' ? 'active' : ''}" onclick="setPosCategory('Jasa')">Jasa</button>
            <button type="button" class="touch-chip ${posFilterCategory === 'Obat' ? 'active' : ''}" onclick="setPosCategory('Obat')">Obat</button>
            <button type="button" class="touch-chip ${posFilterCategory === 'Paket' ? 'active' : ''}" style="${posFilterCategory === 'Paket' ? 'background:#a855f7;border-color:#a855f7;' : 'border-color:#a855f7;color:#a855f7;'}" onclick="setPosCategory('Paket')">🎁 Paket</button>
          </div>
        </div>

        <div class="pos-product-grid">
          ${renderTouchCardsPOS()}
        </div>

        <div class="pos-manual-add">
          <details style="width:100%;">
            <summary style="cursor:pointer;font-size:12px;color:var(--mu);font-weight:600;padding:6px 0;">
              ▶ Tambah Manual / Dropdown
            </summary>
            <div style="display:flex;flex-direction:column;gap:8px;padding:10px 0;">
              <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;">
                <label style="flex:1;min-width:200px;font-size:12px;">Tarif / Layanan
                  <select id="trx-tarif" style="margin-top:3px;">
                    ${(store.state.tarif || []).map(t => `<option value="${t.id}">${esc(t.nama)} (${rp(t.harga)})</option>`).join('')}
                  </select>
                </label>
                <button class="p s" onclick="actionAddTarifToCart()">+ Jasa</button>
              </div>
              <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;">
                <label style="flex:1;min-width:200px;font-size:12px;">Pilih Obat
                  <select id="trx-obat" style="margin-top:3px;">
                    ${filteredObat.map(o => `<option value="${o.id}">${esc(o.nama)} | Stok: ${o.stok} (${rp(o.jual)})</option>`).join('')}
                  </select>
                </label>
                <label style="width:72px;font-size:12px;">Qty <input id="trx-obat-qty" type="number" min="1" value="1" style="margin-top:3px;"></label>
                <button class="p s" onclick="actionAddObatToCart()">+ Obat</button>
              </div>
              <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;">
                <label style="flex:1;min-width:200px;font-size:12px;">Paket Pelayanan
                  <select id="trx-paket-select" style="margin-top:3px;">
                    ${(store.state.paket || []).map(p => `<option value="${p.id}">${esc(p.nama)} (${rp(p.harga)})</option>`).join('')}
                  </select>
                </label>
                <button class="p s" style="background:#a855f7;border-color:#a855f7;" onclick="actionAddPaketToCart()">+ Paket</button>
              </div>
            </div>
          </details>
        </div>
      </div>

      <!-- KANAN: Keranjang + Pembayaran -->
      <div class="pos-right">

        <div class="pos-cart-header">
          <span>🛒 Keranjang</span>
          <span style="font-size:12px;color:var(--mu);">${cartItems.length} item</span>
          ${cartItems.length > 0 ? `<button class="s btn-danger" onclick="cartItems=[];renderApp();" style="font-size:11px;padding:3px 10px;">Kosongkan</button>` : ''}
        </div>

        <div class="pos-cart-items">
          ${cartItems.length === 0
            ? `<div style="text-align:center;padding:32px 20px;color:var(--mu);">
                <div style="font-size:36px;margin-bottom:8px;">🛒</div>
                <div>Belum ada item.<br>Ketuk produk di kiri untuk menambahkan.</div>
               </div>`
            : cartItems.map((item, idx) => `
              <div class="pos-cart-row">
                <div class="pos-cart-info">
                  <div class="pos-cart-name">${esc(item.nama)}</div>
                  <div class="pos-cart-sub">${rp(item.harga)} × ${item.qty} = <b>${rp(item.harga * item.qty)}</b></div>
                </div>
                <div class="pos-cart-qty-ctrl">
                  <button onclick="cartQtyAdj(${idx}, -1)" style="width:28px;height:28px;border-radius:50%;border:1.5px solid var(--bdr);background:var(--bg);color:var(--tx);cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;">−</button>
                  <span style="min-width:24px;text-align:center;font-weight:700;">${item.qty}</span>
                  <button onclick="cartQtyAdj(${idx}, 1)" style="width:28px;height:28px;border-radius:50%;border:1.5px solid var(--bdr);background:var(--bg);color:var(--tx);cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;">+</button>
                  <button onclick="cartItems.splice(${idx},1);renderApp();" style="width:28px;height:28px;border-radius:50%;border:1.5px solid var(--danger);background:transparent;color:var(--danger);cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;margin-left:4px;">✕</button>
                </div>
              </div>`).join('')
          }
        </div>

        <div style="padding:8px 14px;border-top:1px solid var(--bdr);display:flex;gap:8px;align-items:flex-end;">
          <label style="flex:1;font-size:12px;">Diskon (Rp)
            <input id="trx-diskon" type="number" min="0" placeholder="0" style="margin-top:3px;">
          </label>
          <button class="s" onclick="actionAddDiskon()" style="white-space:nowrap;">Terapkan</button>
        </div>

        <div class="pos-total-bar">
          <span>TOTAL</span>
          <span style="font-size:22px;font-weight:900;">${rp(totalCart)}</span>
        </div>

        <div style="padding:10px 14px;border-top:1px solid var(--bdr);">
          <div style="font-size:11px;color:var(--mu);font-weight:700;margin-bottom:6px;">METODE PEMBAYARAN</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;">
            <button type="button" class="pay-method-btn active" id="pm-Tunai"      onclick="selectPayMethod('Tunai')">💵 Tunai</button>
            <button type="button" class="pay-method-btn"        id="pm-QRIS"       onclick="selectPayMethod('QRIS')">📱 QRIS</button>
            <button type="button" class="pay-method-btn"        id="pm-Transfer"   onclick="selectPayMethod('Transfer')">🏦 Transfer</button>
            <button type="button" class="pay-method-btn"        id="pm-DebitKredit" onclick="selectPayMethod('Debit/Kredit')">💳 Kartu</button>
          </div>
          <input type="hidden" id="trx-metode" value="Tunai">
        </div>

        <div id="cash-calc-box" style="padding:10px 14px;border-top:1px solid var(--bdr);">
          <div style="font-size:11px;color:var(--mu);font-weight:700;margin-bottom:6px;">UANG DITERIMA <span class="kbd-hint">F4</span></div>
          <input id="trx-bayar-tunai" type="number" value="${totalCart}"
            oninput="calcKembalian(${totalCart})"
            onkeydown="if(event.key==='Enter')actionBayarTrx(${totalCart})"
            style="width:100%;padding:10px;font-size:18px;font-weight:800;border-radius:10px;border:2px solid var(--pr);background:var(--bg);color:var(--tx);text-align:right;margin-bottom:8px;">
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:5px;margin-bottom:8px;">
            <button type="button" class="cash-preset-btn" onclick="setQuickCash(${totalCart},${totalCart})" style="font-size:11px;">Pas</button>
            <button type="button" class="cash-preset-btn" onclick="setQuickCash(20000,${totalCart})">20rb</button>
            <button type="button" class="cash-preset-btn" onclick="setQuickCash(50000,${totalCart})">50rb</button>
            <button type="button" class="cash-preset-btn" onclick="setQuickCash(100000,${totalCart})">100rb</button>
            <button type="button" class="cash-preset-btn" onclick="setQuickCash(200000,${totalCart})">200rb</button>
            <button type="button" class="cash-preset-btn" onclick="setQuickCash(500000,${totalCart})">500rb</button>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;background:var(--bg);border-radius:8px;padding:8px 12px;">
            <span style="font-size:12px;color:var(--mu);">Kembalian:</span>
            <b id="trx-kembalian" style="font-size:18px;color:var(--ok);">Rp 0</b>
          </div>
        </div>

        <div style="padding:12px 14px;">
          <button class="p" style="width:100%;padding:16px;font-size:16px;font-weight:800;border-radius:14px;letter-spacing:0.5px;"
            onclick="actionBayarTrx(${totalCart})">
            ✅ BAYAR &amp; CETAK NOTA
          </button>
        </div>

        <div style="padding:0 14px 14px;">
          <div style="font-size:11px;color:var(--mu);font-weight:700;margin-bottom:6px;padding-top:8px;border-top:1px solid var(--bdr);">TRANSAKSI SELESAI HARI INI (${todayCount})</div>
          <div style="max-height:180px;overflow-y:auto;display:flex;flex-direction:column;gap:4px;">
            ${todayTrx.length === 0
              ? `<div style="color:var(--mu);font-size:12px;">Belum ada transaksi.</div>`
              : todayTrx.slice().reverse().map(t => `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;background:var(--bg);border-radius:8px;font-size:12px;">
                  <div>
                    <span style="font-weight:700;">${esc(t.no)}</span>
                    <span style="color:var(--mu);"> — ${esc(t.nama)}</span>
                  </div>
                  <div style="display:flex;gap:6px;align-items:center;">
                    <span style="font-weight:700;color:var(--ok);">${rp(t.total)}</span>
                    <button class="s" style="font-size:11px;padding:2px 8px;" onclick="printReceipt('${t.id}')">🖨️</button>
                  </div>
                </div>`).join('')
            }
          </div>
        </div>

      </div>
    </div>
  `;
}

function toggleCashCalculator(metode) {
  const box = $('cash-calc-box');
  if (box) {
    box.style.display = (metode === 'Tunai') ? 'flex' : 'none';
  }
}

function selectPayMethod(method) {
  const hidden = $('trx-metode');
  if (hidden) hidden.value = method;
  ['Tunai', 'QRIS', 'Transfer', 'Debit/Kredit'].forEach(m => {
    const id = 'pm-' + m.replace('/', '');
    const btn = $(id);
    if (btn) {
      if (m === method) btn.classList.add('active');
      else btn.classList.remove('active');
    }
  });
  toggleCashCalculator(method);
}

function cartQtyAdj(idx, delta) {
  if (!cartItems[idx]) return;
  const item = cartItems[idx];
  const newQty = item.qty + delta;
  if (newQty <= 0) {
    cartItems.splice(idx, 1);
  } else {
    if (item.oid) {
      const obat = store.getObat(item.oid);
      if (obat && newQty > obat.stok) {
        showAlert(`Stok obat ${obat.nama} tidak mencukupi (Maksimal: ${obat.stok} ${obat.satuan || ''})`);
        return;
      }
    }
    item.qty = newQty;
  }
  renderApp();
}

function renderTouchCardsPOS() {
  const list = [];
  const query = (cashierSearchQuery || '').toLowerCase().trim();

  if (posFilterCategory === 'Semua' || posFilterCategory === 'Jasa') {
    (store.state.tarif || []).forEach(t => {
      if (!query || t.nama.toLowerCase().includes(query) || (t.jenis || '').toLowerCase().includes(query)) {
        list.push(`
          <div class="touch-card" onclick="addTouchItem('tarif', '${t.id}')">
            <div class="touch-card-badge">${esc(t.jenis)}</div>
            <div class="touch-card-name">${esc(t.nama)}</div>
            <div class="touch-card-price">${rp(t.harga)}</div>
          </div>
        `);
      }
    });
  }

  if (posFilterCategory === 'Semua' || posFilterCategory === 'Obat') {
    (store.state.obat || []).forEach(o => {
      if (!query || o.nama.toLowerCase().includes(query)) {
        const isLow = o.stok <= (o.min || 0);
        list.push(`
          <div class="touch-card" onclick="addTouchItem('obat', '${o.id}')" style="${isLow ? 'border-color:var(--danger);' : ''}">
            <div class="touch-card-badge" style="${isLow ? 'color:var(--danger);font-weight:800;' : ''}">
              ${isLow ? '⚠️ Stok Menipis' : 'Obat & Alkes'}
            </div>
            <div class="touch-card-name">${esc(o.nama)}</div>
            <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:auto;">
              <span class="touch-card-price">${rp(o.jual)}</span>
              <span class="touch-card-stock" style="${isLow ? 'color:var(--danger);font-weight:700;' : ''}">${o.stok} ${esc(o.satuan || '')}</span>
            </div>
          </div>
        `);
      }
    });
  }

  if (posFilterCategory === 'Semua' || posFilterCategory === 'Paket') {
    (store.state.paket || []).forEach(p => {
      if (!query || p.nama.toLowerCase().includes(query) || (p.deskripsi || '').toLowerCase().includes(query)) {
        const normal = (p.items || []).reduce((s, it) => s + (Number(it.harga || 0) * Number(it.qty || 1)), 0);
        const hemat = Math.max(0, normal - Number(p.harga || 0));
        const itemsList = (p.items || []).map(i => `${i.nama} (${i.qty}x)`).join(', ');

        list.push(`
          <div class="touch-card" onclick="addTouchItem('paket', '${p.id}')" style="border-left:3.5px solid #a855f7;">
            <div class="touch-card-badge" style="color:#a855f7;background:rgba(168,85,247,0.12);font-weight:700;">🎁 Paket Layanan</div>
            <div class="touch-card-name" style="font-weight:700;">${esc(p.nama)}</div>
            <div style="font-size:10px;color:var(--mu);margin:3px 0 6px 0;line-height:1.2;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">
              ${esc(itemsList)}
            </div>
            <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:auto;">
              <span class="touch-card-price" style="color:#a855f7;">${rp(p.harga)}</span>
              ${hemat > 0 ? `<span style="font-size:10px;color:var(--mu);text-decoration:line-through;">${rp(normal)}</span>` : ''}
            </div>
          </div>
        `);
      }
    });
  }

  return list.length
    ? list.join('')
    : `<div style="grid-column:1/-1;text-align:center;padding:28px 14px;color:var(--mu);">
        <div style="font-size:28px;margin-bottom:6px;">🔍</div>
        <div>Tidak ada item yang sesuai "${esc(query || posFilterCategory)}"</div>
       </div>`;
}

function renderTouchCards() {
  return renderTouchCardsPOS();
}

function setPosCategory(cat) {
  posFilterCategory = cat;
  renderApp();
}

function addTouchItem(type, id) {
  if (type === 'tarif') {
    const tarif = store.get('tarif', id);
    if (!tarif) return;
    const existing = cartItems.find(i => i.nama === tarif.nama && (i.t || i.jenis) === tarif.jenis);
    if (existing) {
      existing.qty += 1;
    } else {
      cartItems.push({
        nama: tarif.nama,
        t: tarif.jenis,
        harga: Number(tarif.harga) || 0,
        qty: 1,
        hpp: 0
      });
    }
    renderApp();
  } else if (type === 'obat') {
    const obat = store.getObat(id);
    if (!obat) return;
    const existing = cartItems.find(i => i.oid === obat.id);
    const curQty = existing ? existing.qty : 0;
    if (curQty + 1 > obat.stok) {
      showAlert(`Stok obat ${obat.nama} tidak mencukupi (Sisa stok: ${obat.stok})`);
      return;
    }
    if (existing) {
      existing.qty += 1;
    } else {
      cartItems.push({
        oid: obat.id,
        nama: obat.nama,
        t: 'Obat',
        harga: Number(obat.jual) || 0,
        qty: 1,
        hpp: Number(obat.hpp) || 0
      });
    }
    renderApp();
  } else if (type === 'paket') {
    const paket = store.get('paket', id);
    if (!paket) return;

    const obatItems = (paket.items || []).filter(i => i.type === 'obat' && (i.oid || i.id));
    for (const oi of obatItems) {
      const obat = store.getObat(oi.oid || oi.id);
      if (obat) {
        const curInCart = cartItems.filter(ci => ci.t === 'Paket' && ci.pid === paket.id).reduce((s, x) => s + x.qty, 0);
        const reqQty = (curInCart + 1) * (oi.qty || 1);
        if (reqQty > obat.stok) {
          showAlert(`Stok obat ${obat.nama} tidak mencukupi untuk menambah paket ini (Sisa stok: ${obat.stok}, dibutuhkan: ${reqQty})`, 'Stok Kurang');
          return;
        }
      }
    }

    const existing = cartItems.find(i => i.pid === paket.id);
    if (existing) {
      existing.qty += 1;
    } else {
      cartItems.push({
        pid: paket.id,
        nama: paket.nama,
        t: 'Paket',
        jenis: 'Paket',
        harga: Number(paket.harga) || 0,
        qty: 1,
        items: (paket.items || []).map(({ batchDeductions, ...component }) => component),
        hpp: (paket.items || []).filter(i => i.type === 'obat').reduce((s, it) => {
          const o = store.getObat(it.oid || it.id);
          return s + ((o ? Number(o.hpp) : 0) * (Number(it.qty) || 1));
        }, 0)
      });
    }
    renderApp();
  }
}

function actionAddPaketToCart() {
  const select = $('trx-paket-select');
  if (!select || !select.value) return;
  addTouchItem('paket', select.value);
}

function calcKembalian(total) {
  const uang = numVal('trx-bayar-tunai');
  const kembalian = Number(uang) - Number(total);
  const el = $('trx-kembalian');
  if (el) {
    el.textContent = rp(Math.max(0, kembalian));
    el.className = kembalian < 0 ? 'badge-bad' : 'badge-ok';
  }
}

function setQuickCash(amt, total) {
  const el = $('trx-bayar-tunai');
  if (el) {
    el.value = amt;
    calcKembalian(total);
  }
}

function actionAddTarifToCart() {
  const tid = val('trx-tarif');
  const tarif = store.get('tarif', tid);
  if (!tarif) return;
  cartItems.push({
    nama: tarif.nama,
    t: tarif.jenis,
    harga: Number(tarif.harga) || 0,
    qty: 1,
    hpp: 0
  });
  renderApp();
}

function actionAddObatToCart() {
  const oid = val('trx-obat');
  const qty = numVal('trx-obat-qty');
  const obat = store.getObat(oid);
  if (!obat || qty <= 0) return;

  const inCartQty = cartItems.filter(i => i.oid === oid).reduce((s, x) => s + x.qty, 0);
  if (inCartQty + qty > obat.stok) {
    showAlert(`Stok obat ${obat.nama} tidak mencukupi! Sisa stok fisik: ${obat.stok - inCartQty}`, 'Stok Kurang');
    return;
  }

  cartItems.push({
    oid: obat.id,
    nama: obat.nama,
    t: 'Obat',
    harga: Number(obat.jual) || 0,
    qty: Number(qty),
    hpp: Number(obat.hpp) || 0
  });
  renderApp();
}

function actionAddDiskon() {
  const disk = numVal('trx-diskon');
  if (disk <= 0) return;
  cartItems = cartItems.filter(i => i.t !== 'Diskon');
  cartItems.push({
    nama: 'Potongan Diskon',
    t: 'Diskon',
    harga: -Math.abs(Number(disk)),
    qty: 1,
    hpp: 0
  });
  renderApp();
}

async function actionBayarTrx(totalCart) {
  const shift = getCurrentShift();
  if (!shift) {
    showAlert('Shift kasir belum dibuka! Silakan buka shift terlebih dahulu di tab Shift.', 'Peringatan');
    return;
  }
  const pid = val('trx-pasien');
  const pasien = store.get('pasien', pid);
  if (!pasien || pasien.deletedAt || pasien.status === 'dihapus' || pasien.status === 'batal_berobat') {
    showAlert('Pasien tidak aktif untuk transaksi. Pilih pasien dari antrean aktif.');
    return;
  }
  if (cartItems.length === 0) {
    showAlert('Keranjang transaksi masih kosong');
    return;
  }
  if (totalCart < 0) {
    showAlert('Nominal diskon tidak boleh melebihi total tagihan');
    return;
  }

  const metode = val('trx-metode');
  let bayarTunai = Number(totalCart);
  let kembalian = 0;

  if (metode === 'Tunai') {
    bayarTunai = numVal('trx-bayar-tunai');
    if (bayarTunai < totalCart) {
      showAlert(`Uang tunai yang diterima (${rp(bayarTunai)}) kurang dari total tagihan (${rp(totalCart)})`, 'Uang Kurang');
      return;
    }
    kembalian = bayarTunai - totalCart;
  }

  // Transaksi Kasir harus tersambung agar stok lintas perangkat tetap konsisten.
  if (currentUser && currentUser.role === 'kasir' &&
      (!window.firebaseBackend || !window.firebaseBackend.isOnline ||
       !window.firebaseBackend.currentProfile || window.firebaseBackend.currentProfile.role !== 'kasir')) {
    showAlert('Transaksi belum dapat disimpan karena koneksi Firebase belum siap. Pastikan status Cloud Tersambung, lalu coba lagi.', 'Koneksi Cloud');
    return;
  }

  // Validasi total stok utama DAN stok batch sebelum mengubah satu pun data.
  const stockDemand = {};
  cartItems.forEach(item => {
    if (item.oid) stockDemand[item.oid] = (stockDemand[item.oid] || 0) + Number(item.qty || 0);
    if ((item.t || item.jenis) === 'Paket' && Array.isArray(item.items)) {
      item.items.forEach(part => {
        const oid = part.type === 'obat' ? (part.oid || part.id) : null;
        if (oid) stockDemand[oid] = (stockDemand[oid] || 0) + (Number(part.qty) || 1) * Number(item.qty || 0);
      });
    }
  });
  for (const [oid, needed] of Object.entries(stockDemand)) {
    const obat = store.getObat(oid);
    const batchAvailable = (store.state.batch || [])
      .filter(b => b.oid === oid && Number(b.sisa) > 0 && b.ed >= todayStr)
      .reduce((sum, b) => sum + Number(b.sisa || 0), 0);
    if (!obat || Number(obat.stok || 0) < needed || batchAvailable < needed) {
      showAlert(`Stok batch obat ${obat ? obat.nama : oid} tidak mencukupi. Stok utama: ${obat ? obat.stok : 0}, stok batch layak: ${batchAvailable}, kebutuhan: ${needed}. Periksa pembelian dan batch terlebih dahulu.`, 'Stok Batch Tidak Cukup');
      return;
    }
  }

  for (const item of cartItems) {
    if (item.oid) {
      const obat = store.getObat(item.oid);
      const result = store.deductBatchFEFO(item.oid, item.qty);
      if (result.unallocated > 0) {
        showAlert('Pengurangan stok dibatalkan karena batch tidak mencukupi. Tidak ada transaksi yang dibuat.');
        return;
      }
      obat.stok = Number(obat.stok || 0) - Number(item.qty);
      obat._t = Date.now();
      item.batchDeductions = result.deductions;
    } else if ((item.t || item.jenis) === 'Paket' && Array.isArray(item.items)) {
      for (const pkgIt of item.items) {
        if (pkgIt.type !== 'obat' || !(pkgIt.oid || pkgIt.id)) continue;
        const oid = pkgIt.oid || pkgIt.id;
        const obat = store.getObat(oid);
        const deductQty = (Number(pkgIt.qty) || 1) * Number(item.qty || 0);
        const result = store.deductBatchFEFO(oid, deductQty);
        if (result.unallocated > 0) {
          showAlert('Pengurangan stok komponen paket dibatalkan karena batch tidak mencukupi.');
          return;
        }
        if (obat) { obat.stok = Number(obat.stok || 0) - deductQty; obat._t = Date.now(); }
        pkgIt.batchDeductions = result.deductions;
      }
    }
  }

  const trxId = uid();
  const seqTrx = (store.state.trx || []).length + 1;
  const noNota = 'N' + todayStr.replace(/-/g, '') + '-' + String(seqTrx).padStart(4, '0');

  const newTrx = {
    id: trxId,
    no: noNota,
    tgl: todayStr,
    jam: new Date().toTimeString().slice(0, 5),
    pid: pasien.id,
    nama: pasien.nama,
    hp: pasien.hp || '',
    kasir: currentUser.u,
    sh: shift.id,
    items: [...cartItems],
    total: Number(totalCart),
    metode: metode,
    bayar: Number(bayarTunai),
    kembalian: Number(kembalian),
    _t: Date.now()
  };

  // Susun pengurangan stok per obat dan batch sesuai alokasi FEFO transaksi.
  if (currentUser && currentUser.role === 'kasir') {
    const stockMap = new Map();
    const addStock = (oid, qty, deductions) => {
      if (!oid || !(Number(qty) > 0)) return;
      if (!stockMap.has(oid)) stockMap.set(oid, { oid, qty: 0, batches: [] });
      const entry = stockMap.get(oid);
      entry.qty += Number(qty);
      (deductions || []).forEach(d => {
        const found = entry.batches.find(x => x.bid === d.bid);
        if (found) found.qty += Number(d.qty) || 0;
        else entry.batches.push({ bid: d.bid, qty: Number(d.qty) || 0 });
      });
    };
    (newTrx.items || []).forEach(item => {
      if (item.oid) addStock(item.oid, item.qty, item.batchDeductions);
      else if ((item.t || item.jenis) === 'Paket' && Array.isArray(item.items)) {
        item.items.forEach(part => {
          const oid = part.type === 'obat' ? (part.oid || part.id) : null;
          if (oid) addStock(oid, (Number(part.qty) || 1) * Number(item.qty || 0), part.batchDeductions);
        });
      }
    });
    try {
      await window.firebaseBackend.commitCashierTransaction(newTrx, pasien.id, Array.from(stockMap.values()));
    } catch (err) {
      // Kembalikan perubahan lokal jika transaksi atomik di server gagal.
      stockMap.forEach(entry => {
        const obat = store.getObat(entry.oid);
        if (obat) { obat.stok = Number(obat.stok || 0) + entry.qty; obat._t = Date.now(); }
        entry.batches.forEach(b => {
          const batch = store.get('batch', b.bid);
          if (batch) { batch.sisa = Number(batch.sisa || 0) + b.qty; batch._t = Date.now(); }
        });
      });
      store.saveLocal(false);
      showAlert(err.message || 'Transaksi gagal disimpan ke Firebase. Stok lokal telah dikembalikan.', 'Transaksi Gagal');
      return;
    }
  }

  store.state.trx.push(newTrx);
  pasien.done = true;
  pasien._t = Date.now();
  cartItems = [];

  store.logActivity('Transaksi', 'Kasir', `Nota ${noNota} - Pasien ${pasien.nama} (${rp(totalCart)})`);
  store.saveLocal();
  renderApp();
  printReceipt(trxId);
}

// Cetak Nota Struk Pasien (Modal Khusus Nota)
function printReceipt(trxId) {
  const trx = store.get('trx', trxId);
  if (!trx) return;
  const cancelled = isTrxCancelled(trx);
  const cancellationRecord = (store.state.batalTrx || []).find(r => r && r.trxId === trx.id && r.status === 'disetujui');
  const receiptReturns = (store.state.returJual || []).filter(r => r && r.trxId === trx.id && r.status !== 'ditolak');
  const returnsHtml = receiptReturns.length ? `
    <hr><div style="font-weight:700;font-size:12px;">RIWAYAT RETUR</div>
    ${receiptReturns.map(r => {
      const paid = r.pengembalian && r.pengembalian.status === 'dibayar';
      return `<div style="font-size:11px;margin:4px 0;">
        <div>${esc(r.namaItem)} — ${Number(r.qty || 0)} x ${rp(r.harga || 0)}</div>
        <div style="display:flex;justify-content:space-between;"><span>Nilai retur (${esc(r.status || 'menunggu')})</span><b>${rp(r.total || 0)}</b></div>
        <div style="font-size:10px;color:#475569;">Uang: ${!r.pengembalian ? 'DATA RETUR LAMA — PERLU VERIFIKASI' : (paid ? 'SUDAH DIKEMBALIKAN (' + esc(r.pengembalian.metode || '-') + ')' : 'BELUM DIKEMBALIKAN')}</div>
      </div>`;
    }).join('')}
    <div style="font-size:11px;font-weight:700;text-align:right;">Nilai transaksi awal tetap: ${rp(trx.total)}</div>
  ` : '';
  window.lastReceiptTrxId = trxId;

  const set = store.state.set || {};
  let itemsHtml = '';
  (trx.items || []).forEach(item => {
    const isPaket = (item.t || item.jenis) === 'Paket';
    const subItems = isPaket && Array.isArray(item.items)
      ? `<div style="font-size:10px;color:#475569;margin-left:6px;line-height:1.3;">↳ Termasuk: ${item.items.map(it => `${esc(it.nama)} (${it.qty}x)`).join(', ')}</div>`
      : '';

    itemsHtml += `
      <div style="display:flex;justify-content:space-between;margin-bottom:2px;">
        <span>${esc(item.nama)} ${isPaket ? '<b style="font-size:10px;color:#0f766e;">[PAKET]</b>' : ''}</span>
        <span>${item.qty} x ${rp(item.harga)}</span>
      </div>
      ${subItems}
      <div style="text-align:right;font-weight:600;margin-bottom:4px;">
        ${rp(item.qty * item.harga)}
      </div>
    `;
  });

  const modal = $('modal-nota');
  const body = $('modal-nota-body');

  body.innerHTML = `
    <div class="nota-box">
      <div style="text-align:center;">
        ${set.logoImg ? `<img src="${esc(set.logoImg)}" style="height:44px;margin-bottom:4px;"><br>` : (set.logo || '🏥') + ' '}
        <b style="font-size:15px;">${esc(set.nama || 'Klinik Sehat')}</b><br>
        <span style="font-size:11px;color:#475569;">${esc(set.alamat || '')}</span><br>
        <span style="font-size:11px;color:#475569;">Telp: ${esc(set.telp || '-')}</span>
      </div>
      ${cancelled ? `<div style="margin:10px 0;padding:10px;text-align:center;border:2px solid #dc2626;color:#dc2626;font-weight:900;font-size:16px;letter-spacing:1px;">NOTA DIBATALKAN<br><span style="font-size:10px;letter-spacing:0;">Tidak berlaku sebagai bukti pembayaran</span></div><div style="font-size:11px;margin:5px 0;"><b>Alasan pembatalan:</b> ${esc(cancellationRecord && cancellationRecord.alasan ? cancellationRecord.alasan : 'Pembatalan disetujui Admin')}</div>` : ''}
      <hr>
      <div style="display:flex;justify-content:space-between;font-size:11px;">
        <span>Nota: ${esc(trx.no)}</span>
        <span>${esc(trx.tgl)} ${esc(trx.jam || '')}</span>
      </div>
      <div style="font-size:11px;">Pasien: <b>${esc(trx.nama)}</b></div>
      <div style="font-size:11px;">Kasir: ${esc(trx.kasir || '-')}</div>
      <hr>
      ${itemsHtml}
      ${returnsHtml}
      <hr>
      <div style="display:flex;justify-content:space-between;font-size:14px;font-weight:700;">
        <span>${cancelled ? 'NOMINAL NOTA (ARSIP):' : 'TOTAL:'}</span>
        <span>${rp(trx.total)}</span>
      </div>
      ${cancelled ? `<div style="text-align:right;font-size:10px;color:#64748b;">Nominal di atas adalah nilai transaksi sebelum pembatalan; bukan tagihan yang masih harus dibayar.</div>` : ''}
      <div style="display:flex;justify-content:space-between;font-size:11px;margin-top:4px;">
        <span>Metode:</span>
        <span>${esc(trx.metode || 'Tunai')}</span>
      </div>
      ${trx.metode === 'Tunai' ? `
        <div style="display:flex;justify-content:space-between;font-size:11px;">
          <span>Uang Diterima:</span>
          <span>${rp(trx.bayar || trx.total)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:11px;">
          <span>Kembalian:</span>
          <span>${rp(trx.kembalian || 0)}</span>
        </div>
      ` : ''}
      <hr>
      <div style="text-align:center;font-size:11px;color:#64748b;margin-top:6px;">
        ${esc(set.footer || 'Semoga lekas sembuh.')}
      </div>
    </div>
  `;

  const waBtn = $('btn-wa-receipt');
  if (waBtn) {
    if (!cancelled && set.fiturKirimWA !== false) {
      waBtn.style.display = 'inline-block';
      waBtn.onclick = () => actionTriggerSendWA(trx);
    } else {
      waBtn.style.display = 'none';
    }
  }

  const labelBtn = $('btn-label-obat-nota');
  if (labelBtn) {
    const hasMed = (trx.items || []).some(i => i.oid || (i.t || i.jenis) === 'Obat' || ((i.t || i.jenis) === 'Paket' && Array.isArray(i.items) && i.items.some(x => x.type === 'obat')));
    if (hasMed && !cancelled) {
      labelBtn.style.display = 'inline-block';
      labelBtn.onclick = () => openModalLabelObat(trx.id);
    } else {
      labelBtn.style.display = 'none';
    }
  }

  modal.style.display = 'flex';
}

function actionTriggerSendWA(trx) {
  if (isTrxCancelled(trx)) { showAlert('Nota sudah dibatalkan. Pengiriman WhatsApp tidak tersedia.', 'Nota Dibatalkan'); return; }
  if (!trx.hp) {
    showFormModal('Kirim Struk via WhatsApp', [
      ['hp', 'Nomor WhatsApp Pasien (Contoh: 08123456789)', 'tel', '']
    ], res => {
      if (res.hp) {
        trx.hp = res.hp;
        sendReceiptWA(trx, store.state.set || {});
      }
    });
  } else {
    sendReceiptWA(trx, store.state.set || {});
  }
}

function closeReceipt() {
  $('modal-nota').style.display = 'none';
}

// -------------------------------------------------------------
// MODULE: KAS KECIL (PETTY CASH)
// -------------------------------------------------------------
function viewPetty() {
  const shift = getCurrentShift();
  const list = inFilterRange(store.state.petty).slice().reverse();
  const totalHariIni = (store.state.petty || []).filter(p => p.tgl === todayStr).reduce((s, p) => s + Number(p.jml || 0), 0);

  const rows = list.map(p => [
    esc(p.tgl),
    esc(p.kasir || '-'),
    esc(p.ket),
    rp(p.jml),
    `
      <button class="s" onclick="editPetty('${p.id}')">Edit</button>
      <button class="s btn-danger" onclick="delPetty('${p.id}')">Hapus</button>
    `
  ]);

  return `
    <div class="card">
      <h2>Catat Pengeluaran Kas Kecil (Petty Cash)</h2>
      <div class="row">
        <label style="flex:1;min-width:240px;">Keperluan Pengeluaran *
          <input id="petty-ket" placeholder="Contoh: Beli air galon & snack pasien">
        </label>
        <label>Nominal (Rp) *
          <input id="petty-jml" type="number" min="0" placeholder="50000">
        </label>
        <button class="p" onclick="actionAddPetty()">Catat Pengeluaran</button>
      </div>
      <p style="font-size:13px;color:var(--mu);">Total kas kecil hari ini: <b>${rp(totalHariIni)}</b></p>
    </div>
    <div class="card">
      <h2>Riwayat Kas Kecil</h2>
      ${renderTable(['Tanggal', 'Petugas Kasir', 'Keterangan', 'Jumlah', 'Aksi'], rows, { key: 'petty_tbl' })}
    </div>
  `;
}

function actionAddPetty() {
  const ket = val('petty-ket').trim();
  const jml = numVal('petty-jml');
  if (!ket || jml <= 0) {
    showAlert('Lengkapi keperluan dan nominal pengeluaran');
    return;
  }
  const shift = getCurrentShift();
  store.state.petty.push({
    id: uid(),
    tgl: todayStr,
    ket: ket,
    jml: Number(jml),
    kasir: currentUser ? currentUser.u : '-',
    sh: shift ? shift.id : null,
    _t: Date.now()
  });

  store.logActivity('Tambah', 'Kas Kecil', `${ket} (${rp(jml)})`);
  store.saveLocal();
  $('petty-ket').value = '';
  $('petty-jml').value = '';
}

function editPetty(id) {
  const p = store.get('petty', id);
  if (!p) return;
  showFormModal('Edit Kas Kecil', [
    ['ket', 'Keperluan Pengeluaran', 'text', p.ket],
    ['jml', 'Nominal (Rp)', 'number', p.jml]
  ], res => {
    p.ket = res.ket;
    p.jml = Number(res.jml);
    p._t = Date.now();
    store.logActivity('Ubah', 'Kas Kecil', `${p.ket} (${rp(p.jml)})`);
    store.saveLocal();
  });
}

function delPetty(id) {
  showConfirm('Hapus catatan kas kecil ini?', () => {
    const p = store.get('petty', id);
    if (p) {
      store.state.petty = store.state.petty.filter(x => x.id !== id);
      store.logActivity('Hapus', 'Kas Kecil', `${p.ket} (${rp(p.jml)})`);
      store.saveLocal();
    }
  });
}

// -------------------------------------------------------------
// MODULE: MASTER OBAT & TARIF (ADMIN)
// -------------------------------------------------------------
function viewMaster() {
  const obatList = store.state.obat || [];
  const tarifList = store.state.tarif || [];

  const obatRows = obatList.map(o => {
    const isLow = (o.stok || 0) <= (o.min || 5);
    return [
      esc(o.nama),
      esc(o.satuan),
      rp(o.hpp),
      rp(o.jual),
      isLow ? `<b class="badge-bad">${o.stok} ⚠ (Min ${o.min || 5})</b>` : o.stok,
      `
        <button class="s" onclick="editObat('${o.id}')">Edit</button>
        <button class="s btn-danger" onclick="delObat('${o.id}')">Hapus</button>
      `
    ];
  });

  const tarifRows = tarifList.map(t => [
    esc(t.nama),
    `<span class="badge-ok">${esc(t.jenis)}</span>`,
    rp(t.harga),
    `
      <button class="s" onclick="editTarif('${t.id}')">Edit</button>
      <button class="s btn-danger" onclick="delTarif('${t.id}')">Hapus</button>
    `
  ]);

  return `
    <div class="card">
      <h2>Master Obat & Alat Kesehatan</h2>
      <div class="row">
        <label style="flex:1;min-width:200px;">Nama Obat / Alkes *
          <input id="m-o-nama" placeholder="Contoh: Paracetamol 500mg">
        </label>
        <label style="width:100px;">Satuan
          <input id="m-o-satuan" value="strip">
        </label>
        <label>Harga Beli (HPP)
          <input id="m-o-hpp" type="number" placeholder="3000">
        </label>
        <label>Harga Jual
          <input id="m-o-jual" type="number" placeholder="5000">
        </label>
        <label style="width:90px;">Stok Min
          <input id="m-o-min" type="number" value="5">
        </label>
        <button class="p" onclick="actionAddObat()">+ Tambah Obat</button>
      </div>
      ${renderTable(['Nama Obat', 'Satuan', 'HPP', 'Harga Jual', 'Stok Saat Ini', 'Aksi'], obatRows, { key: 'm_obat' })}
    </div>

    <div class="card">
      <h2>Tarif Jasa Dokter & Tindakan Medis</h2>
      <div class="row">
        <label style="flex:1;min-width:220px;">Nama Layanan *
          <input id="m-t-nama" placeholder="Contoh: Konsultasi Dokter Umum">
        </label>
        <label>Jenis Layanan
          <select id="m-t-jenis">
            <option>Konsultasi</option>
            <option>Tindakan</option>
            <option>Laboratorium</option>
          </select>
        </label>
        <label>Tarif (Rp)
          <input id="m-t-harga" type="number" placeholder="50000">
        </label>
        <button class="p" onclick="actionAddTarif()">+ Tambah Tarif</button>
      </div>
      ${renderTable(['Nama Layanan', 'Jenis', 'Tarif', 'Aksi'], tarifRows, { key: 'm_tarif' })}
    </div>
  `;
}

function actionAddObat() {
  const nama = val('m-o-nama').trim();
  if (!nama) { showAlert('Nama obat wajib diisi'); return; }
  store.state.obat.push({
    id: uid(),
    nama: nama,
    satuan: val('m-o-satuan').trim() || 'strip',
    hpp: numVal('m-o-hpp'),
    jual: numVal('m-o-jual'),
    stok: 0,
    min: numVal('m-o-min') || 5,
    _t: Date.now()
  });
  store.logActivity('Tambah', 'Master Obat', nama);
  store.saveLocal();
  $('m-o-nama').value = '';
}

function editObat(id) {
  const o = store.getObat(id);
  if (!o) return;
  showFormModal('Edit Obat', [
    ['nama', 'Nama Obat', 'text', o.nama],
    ['satuan', 'Satuan', 'text', o.satuan],
    ['hpp', 'Harga Beli (HPP)', 'number', o.hpp],
    ['jual', 'Harga Jual', 'number', o.jual],
    ['stok', 'Stok Fisik', 'number', o.stok],
    ['min', 'Batas Stok Minimum', 'number', o.min || 5]
  ], res => {
    Object.assign(o, res, {
      hpp: Number(res.hpp),
      jual: Number(res.jual),
      stok: Number(res.stok),
      min: Number(res.min),
      _t: Date.now()
    });
    store.logActivity('Ubah', 'Master Obat', o.nama);
    store.saveLocal();
  });
}

function delObat(id) {
  showConfirm('Hapus data master obat ini?', () => {
    const o = store.getObat(id);
    if (o) {
      store.state.obat = store.state.obat.filter(x => x.id !== id);
      store.logActivity('Hapus', 'Master Obat', o.nama);
      store.saveLocal();
    }
  });
}

function actionAddTarif() {
  const nama = val('m-t-nama').trim();
  if (!nama) { showAlert('Nama tarif wajib diisi'); return; }
  store.state.tarif.push({
    id: uid(),
    nama: nama,
    jenis: val('m-t-jenis'),
    harga: numVal('m-t-harga'),
    _t: Date.now()
  });
  store.logActivity('Tambah', 'Master Tarif', `${nama} (${rp(numVal('m-t-harga'))})`);
  store.saveLocal();
  $('m-t-nama').value = '';
}

function editTarif(id) {
  const t = store.get('tarif', id);
  if (!t) return;
  showFormModal('Edit Tarif Layanan', [
    ['nama', 'Nama Layanan', 'text', t.nama],
    ['jenis', 'Jenis', 'select', t.jenis, [
      { value: 'Konsultasi', label: 'Konsultasi' },
      { value: 'Tindakan', label: 'Tindakan' },
      { value: 'Laboratorium', label: 'Laboratorium' }
    ]],
    ['harga', 'Tarif (Rp)', 'number', t.harga]
  ], res => {
    Object.assign(t, res, {
      harga: Number(res.harga),
      _t: Date.now()
    });
    store.logActivity('Ubah', 'Master Tarif', t.nama);
    store.saveLocal();
  });
}

function delTarif(id) {
  showConfirm('Hapus tarif layanan ini?', () => {
    const t = store.get('tarif', id);
    if (t) {
      store.state.tarif = store.state.tarif.filter(x => x.id !== id);
      store.logActivity('Hapus', 'Master Tarif', t.nama);
      store.saveLocal();
    }
  });
}

// -------------------------------------------------------------
// MODULE: MASTER PAKET PELAYANAN (ADMIN / PIMPINAN)
// -------------------------------------------------------------
window.paketBuilderItems = [];
let editingPaketId = null;

function renderPaketItemOptions(type) {
  if (type === 'obat') {
    return (store.state.obat || []).map(o => `<option value="${o.id}">${esc(o.nama)} (${rp(o.jual)} | Stok: ${o.stok} ${esc(o.satuan)})</option>`).join('');
  }
  return (store.state.tarif || []).map(t => `<option value="${t.id}">${esc(t.nama)} (${rp(t.harga)} - ${esc(t.jenis)})</option>`).join('');
}

function togglePaketItemSource() {
  const typeEl = $('pkg-item-type');
  const selectEl = $('pkg-item-select');
  if (!typeEl || !selectEl) return;
  selectEl.innerHTML = renderPaketItemOptions(typeEl.value);
}

function actionAddPaketBuilderItem() {
  const type = val('pkg-item-type');
  const itemId = val('pkg-item-select');
  const qty = Math.max(1, numVal('pkg-item-qty') || 1);

  if (!itemId) {
    showAlert('Pilih item terlebih dahulu');
    return;
  }

  if (type === 'obat') {
    const obat = store.getObat(itemId);
    if (!obat) return;
    const existing = window.paketBuilderItems.find(i => i.type === 'obat' && (i.oid === obat.id || i.id === obat.id));
    if (existing) {
      existing.qty += qty;
    } else {
      window.paketBuilderItems.push({
        type: 'obat',
        id: obat.id,
        oid: obat.id,
        nama: obat.nama,
        satuan: obat.satuan,
        harga: Number(obat.jual) || 0,
        qty: qty
      });
    }
  } else {
    const tarif = store.get('tarif', itemId);
    if (!tarif) return;
    const existing = window.paketBuilderItems.find(i => i.type === 'tarif' && i.id === tarif.id);
    if (existing) {
      existing.qty += qty;
    } else {
      window.paketBuilderItems.push({
        type: 'tarif',
        id: tarif.id,
        nama: tarif.nama,
        jenis: tarif.jenis,
        harga: Number(tarif.harga) || 0,
        qty: qty
      });
    }
  }

  refreshPaketBuilderView();
}

function removePaketBuilderItem(idx) {
  window.paketBuilderItems.splice(idx, 1);
  refreshPaketBuilderView();
}

function refreshPaketBuilderView() {
  const container = $('pkg-staged-container');
  if (container) {
    container.innerHTML = renderStagedPaketItemsHtml();
  }
  updatePaketBuilderSummary();
}

function renderStagedPaketItemsHtml() {
  if (!window.paketBuilderItems || window.paketBuilderItems.length === 0) {
    return `<div style="color:var(--mu);font-size:12px;font-style:italic;">Belum ada komponen yang ditambahkan ke paket. Pilih jasa/obat di atas lalu klik '+ Masukkan ke Paket'.</div>`;
  }

  return `
    <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;">
      ${window.paketBuilderItems.map((item, idx) => `
        <span class="paket-item-chip" style="background:var(--card);padding:5px 10px;border-radius:8px;border:1.5px solid ${item.type === 'obat' ? 'var(--ok)' : 'var(--pr)'};display:inline-flex;align-items:center;gap:6px;font-size:12px;">
          <span>${item.type === 'obat' ? '💊' : '🩺'}</span>
          <span><b>${esc(item.nama)}</b> (${item.qty}x @ ${rp(item.harga)}) = ${rp(item.harga * item.qty)}</span>
          <button type="button" onclick="removePaketBuilderItem(${idx})" style="background:none;border:none;color:var(--rd);cursor:pointer;font-weight:800;padding:0 2px;margin-left:4px;" title="Hapus dari paket">✕</button>
        </span>
      `).join('')}
    </div>
  `;
}

function updatePaketBuilderSummary() {
  const normal = (window.paketBuilderItems || []).reduce((s, i) => s + (Number(i.harga) * Number(i.qty)), 0);
  const pkgPrice = numVal('pkg-harga') || 0;
  
  const sumNormalEl = $('pkg-sum-normal');
  const sumSavingEl = $('pkg-sum-saving');
  if (sumNormalEl) sumNormalEl.textContent = rp(normal);
  
  if (sumSavingEl) {
    if (pkgPrice > 0 && normal > 0) {
      const diff = normal - pkgPrice;
      if (diff > 0) {
        const pctVal = Math.round((diff / normal) * 100);
        sumSavingEl.innerHTML = `<span class="badge-ok">Hemat ${rp(diff)} (${pctVal}% diskon bundling)</span>`;
      } else if (diff < 0) {
        sumSavingEl.innerHTML = `<span class="badge-warn">Tarif paket lebih tinggi +${rp(Math.abs(diff))}</span>`;
      } else {
        sumSavingEl.innerHTML = `<span class="badge-ok">Tarif paket sama dengan akumulasi normal</span>`;
      }
    } else {
      sumSavingEl.innerHTML = '';
    }
  }
}

function actionSavePaket() {
  const nama = val('pkg-nama').trim();
  const desk = val('pkg-desk').trim();
  const harga = numVal('pkg-harga');

  if (!nama) {
    showAlert('Nama paket pelayanan wajib diisi');
    return;
  }
  if (harga <= 0) {
    showAlert('Tarif harga paket harus lebih besar dari 0');
    return;
  }
  if (!window.paketBuilderItems || window.paketBuilderItems.length === 0) {
    showAlert('Paket harus memiliki minimal 1 komponen tindakan medis atau obat!');
    return;
  }

  if (editingPaketId) {
    const existing = (store.state.paket || []).find(p => p.id === editingPaketId);
    if (existing) {
      existing.nama = nama;
      existing.deskripsi = desk;
      existing.harga = Number(harga);
      existing.items = JSON.parse(JSON.stringify(window.paketBuilderItems));
      existing._t = Date.now();
      store.logActivity('Ubah', 'Paket Pelayanan', `${nama} (${rp(harga)})`);
      showAlert(`Paket pelayanan "${nama}" berhasil diperbarui.`, 'Sukses');
    }
    editingPaketId = null;
  } else {
    store.state.paket.push({
      id: uid(),
      nama: nama,
      deskripsi: desk,
      harga: Number(harga),
      items: JSON.parse(JSON.stringify(window.paketBuilderItems)),
      _t: Date.now()
    });
    store.logActivity('Tambah', 'Paket Pelayanan', `${nama} (${rp(harga)})`);
    showAlert(`Paket pelayanan baru "${nama}" berhasil ditambahkan!`, 'Sukses');
  }

  store.saveLocal();
  window.paketBuilderItems = [];
  renderApp();
}

function openEditPaket(id) {
  const p = store.get('paket', id);
  if (!p) return;
  editingPaketId = id;
  window.paketBuilderItems = JSON.parse(JSON.stringify(p.items || []));
  renderApp();
  setTimeout(() => {
    if ($('pkg-nama')) $('pkg-nama').value = p.nama;
    if ($('pkg-desk')) $('pkg-desk').value = p.deskripsi || '';
    if ($('pkg-harga')) {
      $('pkg-harga').value = p.harga;
      updatePaketBuilderSummary();
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, 50);
}

function cancelEditPaket() {
  editingPaketId = null;
  window.paketBuilderItems = [];
  renderApp();
}

function delPaket(id) {
  showConfirm('Hapus paket pelayanan ini?', () => {
    const p = store.get('paket', id);
    if (p) {
      store.state.paket = (store.state.paket || []).filter(x => x.id !== id);
      store.logActivity('Hapus', 'Paket Pelayanan', p.nama);
      store.saveLocal();
      renderApp();
    }
  });
}

function viewPaketPelayanan() {
  const paketList = store.state.paket || [];

  const rows = paketList.map(p => {
    const normalPrice = (p.items || []).reduce((s, it) => s + (Number(it.harga || 0) * Number(it.qty || 1)), 0);
    const hemat = Math.max(0, normalPrice - Number(p.harga || 0));
    const hematPct = normalPrice > 0 ? Math.round((hemat / normalPrice) * 100) : 0;

    const itemsSummary = (p.items || []).map(it => {
      const isObat = it.type === 'obat';
      return `<span class="paket-item-chip" style="${isObat ? 'border-color:#10b981;color:#10b981;' : 'border-color:#0284c7;color:#0284c7;'}">${isObat ? '💊' : '🩺'} ${esc(it.nama)} <b>(${it.qty}x)</b></span>`;
    }).join(' ');

    return [
      `<b>${esc(p.nama)}</b>${p.deskripsi ? `<div style="font-size:11px;color:var(--mu);margin-top:2px;">${esc(p.deskripsi)}</div>` : ''}`,
      itemsSummary || '<span style="color:var(--mu);">Belum ada item</span>',
      `<span style="text-decoration:${hemat > 0 ? 'line-through' : 'none'};color:${hemat > 0 ? 'var(--mu)' : 'var(--tx)'};">${rp(normalPrice)}</span>`,
      `<b style="color:var(--pr);font-size:14px;">${rp(p.harga)}</b>`,
      hemat > 0 ? `<span class="paket-saving-badge">Hemat ${rp(hemat)} (${hematPct}%)</span>` : '<span style="color:var(--mu);font-size:11px;">Harga Normal</span>',
      `
        <button class="s" onclick="openEditPaket('${p.id}')">Edit</button>
        <button class="s btn-danger" onclick="delPaket('${p.id}')">Hapus</button>
      `
    ];
  });

  const builderNormal = (window.paketBuilderItems || []).reduce((s, i) => s + (Number(i.harga || 0) * Number(i.qty || 0)), 0);

  return `
    <div class="card" style="border-left:4px solid #a855f7;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:10px;">
        <h2 style="margin:0;">${editingPaketId ? '✏️ Edit Paket Pelayanan' : '🎁 Buat Paket Pelayanan Baru (Bundling Layanan &amp; Obat)'}</h2>
        ${editingPaketId ? `<button class="s" onclick="cancelEditPaket()">Batal Edit (Buat Baru)</button>` : ''}
      </div>
      <p style="color:var(--mu);font-size:13px;margin-bottom:14px;">
        Paket pelayanan menggabungkan beberapa tindakan medis (konsultasi/tindakan/lab) dan resep obat sekaligus dalam satu tarif harga bundling. Ketika kasir memilih paket di transaksi POS kasir, sistem otomatis mendokumentasikan rincian paket dan memotong stok obat (FEFO).
      </p>

      <div class="row">
        <label style="flex:2;min-width:220px;">Nama Paket Pelayanan *
          <input id="pkg-nama" placeholder="Contoh: Paket Perawatan Luka Lengkap">
        </label>
        <label style="flex:2;min-width:220px;">Deskripsi / Keterangan Singkat
          <input id="pkg-desk" placeholder="Contoh: Konsultasi + Jahit Luka Ringan + Resep Obat">
        </label>
        <label style="flex:1;min-width:160px;">Tarif Jual Paket (Rp) *
          <input id="pkg-harga" type="number" placeholder="Contoh: 135000" oninput="updatePaketBuilderSummary()">
        </label>
      </div>

      <div style="background:var(--bg);padding:14px;border-radius:10px;border:1px solid var(--bdr);margin:14px 0;">
        <div style="font-size:12.5px;font-weight:700;color:var(--pr);margin-bottom:8px;">
          ➕ Tambahkan Komponen ke Paket (Jasa Tindakan atau Obat Farmasi):
        </div>

        <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;">
          <label style="width:130px;font-size:12px;">Jenis Item
            <select id="pkg-item-type" onchange="togglePaketItemSource()" style="margin-top:3px;">
              <option value="tarif">🩺 Jasa / Tarif</option>
              <option value="obat">💊 Obat / Alkes</option>
            </select>
          </label>
          <label style="flex:2;min-width:220px;font-size:12px;">Pilih Item
            <select id="pkg-item-select" style="margin-top:3px;">
              ${renderPaketItemOptions('tarif')}
            </select>
          </label>
          <label style="width:80px;font-size:12px;">Jumlah
            <input id="pkg-item-qty" type="number" min="1" value="1" style="margin-top:3px;">
          </label>
          <button class="p s" onclick="actionAddPaketBuilderItem()" style="padding:9px 14px;white-space:nowrap;">+ Masukkan ke Paket</button>
        </div>

        <div style="margin-top:12px;" id="pkg-staged-container">
          ${renderStagedPaketItemsHtml()}
        </div>

        <div id="pkg-builder-summary" style="margin-top:12px;padding-top:10px;border-top:1px dashed var(--bdr);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;font-size:13px;">
          <div>Akumulasi Harga Normal: <b id="pkg-sum-normal">${rp(builderNormal)}</b></div>
          <div id="pkg-sum-saving"></div>
        </div>
      </div>

      <button class="p" onclick="actionSavePaket()" style="padding:10px 22px;font-weight:700;">
        💾 ${editingPaketId ? 'Simpan Perubahan Paket' : 'Simpan Paket Pelayanan'}
      </button>
    </div>

    <div class="card">
      <h2>Daftar Paket Pelayanan Tersedia (${paketList.length})</h2>
      ${renderTable(['Nama Paket', 'Komponen Item', 'Harga Normal', 'Tarif Paket', 'Diskon / Hemat', 'Aksi'], rows, { key: 'm_paket' })}
    </div>
  `;
}

// -------------------------------------------------------------
// MODULE: PEMBELIAN OBAT (FAKTUR & SUPPLIER)
// -------------------------------------------------------------
function viewPembelian() {
  const beliList = (store.state.beli || []).slice().reverse();
  const returList = (store.state.returBeli || []).slice().reverse();

  const rows = beliList.map(b => {
    const obat = store.getObat(b.oid);
    return [
      esc(b.tgl),
      esc(b.supplier),
      esc(b.faktur || '-'),
      esc(obat ? obat.nama : '-'),
      b.qty,
      rp(b.total),
      esc(b.tempo || '-'),
      b.lunas 
        ? `<span class="badge-ok">Lunas (${b.tglBayar})</span>` 
        : `<button class="s p" onclick="store.lunasiBeli('${b.id}')">Lunasi Sekarang</button>`,
      `
        <button class="s" style="background:rgba(217,119,6,0.15);border-color:#d97706;color:#d97706;" onclick="openModalReturBeli('${b.id}')" title="Retur ke Supplier">Retur</button>

      `
    ];
  });

  const returRows = returList.map(r => [
    esc(r.tgl),
    esc(r.supplier),
    esc(r.faktur || '-'),
    esc(r.namaObat),
    r.qty,
    rp(r.nilai),
    esc(r.alasan)
  ]);

  return `
    <div class="card">
      <h2>Pencatatan Pembelian Obat dari Supplier / PBF</h2>
      <p style="color:var(--mu);font-size:12px;margin-bottom:12px;">
        💡 Pembelian akan otomatis menghitung <b>HPP Rata-Rata Tertimbang (Weighted Moving Average)</b> dan menambahkan batch untuk sistem FEFO.
      </p>
      <div class="row">
        <label>Supplier / PBF *
          <input id="beli-sup" placeholder="Contoh: PT Kimia Farma">
        </label>
        <label>Nomor Faktur
          <input id="beli-fak" placeholder="INV-2026-001">
        </label>
        <label style="flex:1;min-width:200px;">Pilih Obat *
          <select id="beli-oid">
            ${(store.state.obat || []).map(o => `<option value="${o.id}">${esc(o.nama)} (Stok: ${o.stok} | HPP Saat Ini: ${rp(o.hpp)})</option>`).join('')}
          </select>
        </label>
        <label style="width:90px;">Jumlah Masuk *
          <input id="beli-qty" type="number" min="1" value="10">
        </label>
        <label>Total Tagihan (Rp) *
          <input id="beli-total" type="number" placeholder="Contoh: 150000">
        </label>
      </div>
      <div class="row">
        <label>Nomor Batch
          <input id="beli-batch" placeholder="BCH-12345">
        </label>
        <label>Tgl Kedaluwarsa (ED) *
          <input id="beli-ed" type="date">
        </label>
        <label>Jatuh Tempo Utang
          <input id="beli-tempo" type="date" value="${todayStr}">
        </label>
        <label>Metode Pembayaran
          <select id="beli-lunas">
            <option value="utang">Utang (Belum Lunas)</option>
            <option value="tunai">Lunas Tunai / Transfer</option>
          </select>
        </label>
        <button class="p" onclick="actionAddBeli()">Simpan Pembelian</button>
      </div>
    </div>

    <div class="card">
      <h2>Riwayat Pembelian & Faktur Supplier</h2>
      ${renderTable(['Tanggal', 'Supplier', 'Faktur', 'Obat', 'Qty', 'Tagihan', 'Jatuh Tempo', 'Status Bayar', 'Aksi'], rows, { key: 'beli_tbl' })}
    </div>

    <div class="card">
      <h2>Riwayat Retur Pembelian ke Supplier (PBF)</h2>
      ${renderTable(['Tanggal', 'Supplier', 'No. Faktur', 'Nama Obat', 'Qty Retur', 'Nilai Pengurang', 'Alasan'], returRows, { key: 'retur_beli_tbl' })}
    </div>
  `;
}

function openModalReturBeli(beliId) {
  const b = store.get('beli', beliId);
  if (!b) return;

  showFormModal(`Retur Pembelian - Faktur ${b.faktur || b.supplier}`, [
    ['qty', `Jumlah Qty yang Diretur (Maks ${b.qty})`, 'number', 1],
    ['alasan', 'Alasan Pengembalian ke Supplier', 'text', 'Kemasan rusak / mendekati ED']
  ], res => {
    const success = store.processReturBeli({
      beliId: b.id,
      qtyRetur: Number(res.qty),
      alasan: res.alasan
    });

    if (success) {
      showAlert('Retur ke supplier berhasil diproses. Stok fisik dan tagihan faktur telah disesuaikan.', 'Sukses');
      renderApp();
    } else {
      showAlert('Gagal memproses retur. Periksa kembali jumlah qty retur.');
    }
  });
}

function actionAddBeli() {
  const sup = val('beli-sup').trim();
  const oid = val('beli-oid');
  const qty = numVal('beli-qty');
  const total = numVal('beli-total');
  const ed = val('beli-ed');
  
  if (!sup || !oid || qty <= 0 || total <= 0 || !ed) {
    showAlert('Mohon lengkapi Supplier, Obat, Jumlah, Total Tagihan, dan Tanggal Kedaluwarsa!');
    return;
  }

  const success = store.recordPurchase({
    supplier: sup,
    faktur: val('beli-fak').trim(),
    oid: oid,
    qty: Number(qty),
    total: Number(total),
    tempo: val('beli-tempo') || todayStr,
    batchNo: val('beli-batch').trim(),
    ed: ed,
    isLunas: val('beli-lunas') === 'tunai'
  });

  if (success) {
    showAlert('Pembelian obat berhasil dicatat dan HPP telah diperbarui secara otomatis.', 'Sukses');
    $('beli-sup').value = '';
    $('beli-fak').value = '';
    $('beli-total').value = '';
    $('beli-batch').value = '';
    $('beli-ed').value = '';
  }
}

function delBeli(id) {
  // Faktur pembelian adalah jejak audit stok/HPP; gunakan Retur ke Supplier,
  // bukan penghapusan, agar stok dan nilai persediaan tetap dapat ditelusuri.
  showAlert('Faktur pembelian tidak dapat dihapus agar riwayat stok dan HPP tetap akurat. Gunakan tombol Retur untuk mengoreksi pembelian.', 'Perlindungan Data');
}

// -------------------------------------------------------------
// MODULE: BATCH & KEDALUWARSA (ADMIN)
// -------------------------------------------------------------
function viewKedaluwarsa() {
  const set = store.state.set || {};
  const edLimitDays = set.edPeringatan || 60;
  const list = (store.state.batch || []).filter(b => b.sisa > 0).sort((a, b) => (a.ed < b.ed ? -1 : 1));

  const rows = list.map(b => {
    const obat = store.getObat(b.oid);
    const diffDays = Math.round((new Date(b.ed) - new Date(todayStr)) / 864e5);
    let badge = '<span class="badge-ok">Aman</span>';
    if (diffDays < 0) {
      badge = '<span class="badge-bad">KEDALUWARSA</span>';
    } else if (diffDays <= edLimitDays) {
      badge = `<span class="badge-warn">${diffDays} hari lagi</span>`;
    }

    return [
      esc(obat ? obat.nama : '-'),
      esc(b.no || '-'),
      esc(b.ed),
      b.sisa,
      badge
    ];
  });

  return `
    <div class="card">
      <h2>Pengawasan Batch Obat & Tanggal Kedaluwarsa (FEFO)</h2>
      <p style="color:var(--mu);font-size:13px;">
        Sistem otomatis memprioritaskan penjualan obat dari batch dengan tanggal kedaluwarsa terdekat (<b>First Expired First Out</b>). Peringatan aktif ${edLimitDays} hari sebelum ED.
      </p>
      <div style="margin-bottom:14px;">
        <button class="p btn-danger" onclick="actionBuangAllExpired()">🗑️ Buang Semua Batch yang Kedaluwarsa</button>
      </div>
      ${renderTable(['Nama Obat', 'Nomor Batch', 'Tanggal ED', 'Sisa Stok Fisik', 'Status'], rows, { key: 'batch_ed' })}
    </div>
  `;
}

function actionBuangAllExpired() {
  const expiredList = (store.state.batch || []).filter(b => b.sisa > 0 && b.ed < todayStr);
  if (expiredList.length === 0) {
    showAlert('Tidak ada batch obat yang kedaluwarsa saat ini.', 'Informasi');
    return;
  }

  showConfirm(`Ditemukan ${expiredList.length} batch kedaluwarsa. Buang dan catat sebagai kerugian obat?`, () => {
    expiredList.forEach(b => {
      const obat = store.getObat(b.oid);
      const rugi = b.sisa * (obat ? Number(obat.hpp) : 0);
      if (obat) {
        obat.stok = Math.max(0, obat.stok - b.sisa);
        obat._t = Date.now();
      }
      store.state.loss.push({
        id: uid(),
        tgl: todayStr,
        oid: b.oid,
        bid: b.id,
        qty: b.sisa,
        ket: 'Kedaluwarsa (Expired)',
        nilai: Number(rugi),
        _t: Date.now()
      });
      b.sisa = 0;
      b._t = Date.now();
    });

    store.logActivity('Kerugian', 'Kedaluwarsa', `Buang ${expiredList.length} batch expired`);
    store.saveLocal();
    showAlert('Batch kedaluwarsa berhasil dibuang dan dicatat ke laporan kerugian.', 'Selesai');
  });
}

// -------------------------------------------------------------
// MODULE: BIAYA OPERASIONAL & HONOR (ADMIN)
// -------------------------------------------------------------
function viewBiaya() {
  const set = store.state.set || {};
  const limitAppr = set.batasApproval || 1000000;
  const list = inFilterRange(store.state.biaya).slice().reverse();

  const rows = list.map(b => [
    esc(b.tgl),
    `<span class="badge-ok">${esc(b.kat)}</span>`,
    esc(b.ket),
    rp(b.jml),
    b.status === 'approved' 
      ? '<span class="badge-ok">Disetujui</span>' 
      : b.status === 'pending' 
        ? '<span class="badge-warn">Menunggu Approval Pimpinan</span>' 
        : '<span class="badge-bad">Ditolak</span>',
    `
      <button class="s" onclick="editBiaya('${b.id}')">Edit</button>
      <button class="s btn-danger" onclick="delBiaya('${b.id}')">Hapus</button>
    `
  ]);

  return `
    <div class="card">
      <h2>Catat Biaya Operasional, Gaji & Honor Dokter</h2>
      <p style="color:var(--mu);font-size:12px;">
        💡 Pengeluaran senilai ≥ ${rp(limitAppr)} memerlukan approval (persetujuan) dari Pimpinan sebelum masuk ke laporan keuangan.
      </p>
      <div class="row">
        <label>Kategori Biaya
          <select id="b-kat">
            <option>Honor Dokter</option>
            <option>Gaji Staf & Perawat</option>
            <option>Listrik & Air</option>
            <option>Internet & Komunikasi</option>
            <option>Sewa Gedung</option>
            <option>Alat Medis & Maintenance</option>
            <option>Kebersihan & Keamanan</option>
            <option>Lain-lain</option>
          </select>
        </label>
        <label style="flex:1;min-width:200px;">Keterangan *
          <input id="b-ket" placeholder="Contoh: Honor dr. Hendra (10 pasien)">
        </label>
        <label>Nominal / Satuan (Rp) *
          <input id="b-satuan" type="number" placeholder="50000">
        </label>
        <label style="width:80px;">Jumlah / Qty
          <input id="b-qty" type="number" min="1" value="1">
        </label>
        <button class="p" onclick="actionAddBiaya()">Simpan Biaya</button>
      </div>
    </div>

    <div class="card">
      <h2>Daftar Biaya Operasional</h2>
      ${renderTable(['Tanggal', 'Kategori', 'Keterangan', 'Total', 'Status Approval', 'Aksi'], rows, { key: 'biaya_tbl' })}
    </div>
  `;
}

function actionAddBiaya() {
  const ket = val('b-ket').trim();
  const sat = numVal('b-satuan');
  const qty = numVal('b-qty') || 1;
  const total = sat * qty;
  if (!ket || total <= 0) {
    showAlert('Mohon lengkapi keterangan dan nominal biaya');
    return;
  }

  const set = store.state.set || {};
  const limitAppr = set.batasApproval || 1000000;
  const status = total >= limitAppr ? 'pending' : 'approved';

  store.state.biaya.push({
    id: uid(),
    tgl: todayStr,
    kat: val('b-kat'),
    ket: ket,
    jml: Number(total),
    status: status,
    kasir: currentUser ? currentUser.u : '-',
    _t: Date.now()
  });

  store.logActivity('Tambah', 'Biaya', `${ket} (${rp(total)})`);
  store.saveLocal();
  $('b-ket').value = '';
  $('b-satuan').value = '';
}

function editBiaya(id) {
  const b = store.get('biaya', id);
  if (!b) return;
  showFormModal('Edit Biaya', [
    ['ket', 'Keterangan', 'text', b.ket],
    ['jml', 'Nominal Total (Rp)', 'number', b.jml]
  ], res => {
    b.ket = res.ket;
    b.jml = Number(res.jml);
    b._t = Date.now();
    const set = store.state.set || {};
    const limitAppr = set.batasApproval || 1000000;
    b.status = b.jml >= limitAppr ? 'pending' : 'approved';
    store.logActivity('Ubah', 'Biaya', `${b.ket} (${rp(b.jml)})`);
    store.saveLocal();
  });
}

function delBiaya(id) {
  showConfirm('Hapus data pengeluaran biaya ini?', () => {
    const b = store.get('biaya', id);
    if (b) {
      store.state.biaya = store.state.biaya.filter(x => x.id !== id);
      store.logActivity('Hapus', 'Biaya', `${b.ket} (${rp(b.jml)})`);
      store.saveLocal();
    }
  });
}

// -------------------------------------------------------------
// MODULE: STOK OPNAME & KERUGIAN (ADMIN)
// -------------------------------------------------------------
function viewOpname() {
  const activeBatches = (store.state.batch || []).filter(b => b.sisa > 0);
  const lossList = inFilterRange(store.state.loss).slice().reverse();

  const rows = lossList.map(l => {
    const obat = store.getObat(l.oid);
    return [
      esc(l.tgl),
      esc(obat ? obat.nama : '-'),
      l.qty,
      `<span class="badge-bad">${esc(l.ket)}</span>`,
      rp(l.nilai),
      `<button class="s btn-danger" onclick="delLoss('${l.id}')">Batalkan</button>`
    ];
  });

  return `
    <div class="card">
      <h2>Catat Obat Rusak, Hilang, atau Selisih Stok Opname</h2>
      <div class="row">
        <label style="flex:1;min-width:240px;">Pilih Batch / Obat *
          <select id="op-batch">
            ${activeBatches.map(b => {
              const o = store.getObat(b.oid);
              return `<option value="${b.id}">${esc(o ? o.nama : '-')} | Batch ${esc(b.no)} | ED ${b.ed} | Sisa ${b.sisa}</option>`;
            }).join('')}
          </select>
        </label>
        <label style="width:90px;">Jumlah *
          <input id="op-qty" type="number" min="1" value="1">
        </label>
        <label>Alasan Kerugian
          <select id="op-ket">
            <option>Obat Rusak / Pecah</option>
            <option>Selisih Stok Opname</option>
            <option>Kedaluwarsa (Expired)</option>
            <option>Lainnya</option>
          </select>
        </label>
        <button class="p btn-danger" onclick="actionAddLoss()">Catat Kerugian</button>
      </div>
    </div>

    <div class="card">
      <h2>Riwayat Kerugian Obat</h2>
      ${renderTable(['Tanggal', 'Obat', 'Qty', 'Penyebab', 'Nilai Kerugian', 'Aksi'], rows, { key: 'loss_tbl' })}
    </div>
  `;
}

function actionAddLoss() {
  const bid = val('op-batch');
  const qty = numVal('op-qty');
  const batch = store.get('batch', bid);
  if (!batch || qty <= 0 || qty > batch.sisa) {
    showAlert('Jumlah kerugian melebihi sisa stok batch yang tersedia');
    return;
  }

  const obat = store.getObat(batch.oid);
  const nilai = qty * (obat ? Number(obat.hpp) : 0);

  batch.sisa -= qty;
  batch._t = Date.now();
  if (obat) {
    obat.stok = Math.max(0, obat.stok - qty);
    obat._t = Date.now();
  }

  store.state.loss.push({
    id: uid(),
    tgl: todayStr,
    oid: batch.oid,
    bid: batch.id,
    qty: Number(qty),
    ket: val('op-ket'),
    nilai: Number(nilai),
    _t: Date.now()
  });

  store.logActivity('Kerugian', 'Stok Opname', `${obat ? obat.nama : ''} (${qty} x ${rp(nilai)})`);
  store.saveLocal();
  showAlert('Kerugian stok obat berhasil dicatat.', 'Sukses');
}

function delLoss(id) {
  showConfirm('Batalkan catatan kerugian ini? Stok fisik dan batch akan dikembalikan.', () => {
    const l = store.get('loss', id);
    if (!l) return;
    const obat = store.getObat(l.oid);
    if (obat) {
      obat.stok += l.qty;
      obat._t = Date.now();
    }
    const batch = store.get('batch', l.bid);
    if (batch) {
      batch.sisa += l.qty;
      batch._t = Date.now();
    }

    store.state.loss = store.state.loss.filter(x => x.id !== id);
    store.logActivity('Batalkan Kerugian', 'Stok Opname', `${obat ? obat.nama : ''} (${l.qty})`);
    store.saveLocal();
  });
}

// -------------------------------------------------------------
// MODULE: VERIFIKASI SETORAN SHIFT (ADMIN)
// -------------------------------------------------------------
function viewVerifikasi() {
  const pendingShifts = (store.state.shift || []).filter(s => s.status === 'tutup' && !s.verif);
  const verifiedShifts = (store.state.shift || []).filter(s => s.status === 'tutup' && s.verif).slice().reverse();

  const pendingRows = pendingShifts.map(s => [
    esc(s.tgl),
    esc(s.nama),
    `${esc(s.jam)} - ${esc(s.jamT || '')}`,
    rp(s.sistem),
    rp(s.fisik),
    `<span class="${(s.fisik - s.sistem) !== 0 ? 'badge-bad' : 'badge-ok'}">${rp(s.fisik - s.sistem)}</span>`,
    `
      <div style="display:flex;gap:6px;align-items:center;">
        <button class="p s" onclick="actionVerifShift('${s.id}')">Verifikasi &amp; Terima</button>
        <button class="s" style="background:#16a34a;border-color:#16a34a;color:#fff;" onclick="resendShiftWa('${s.id}')" title="Kirim Rekap Shift ke WA Owner">📲 WA</button>
      </div>
    `
  ]);

  const verifiedRows = verifiedShifts.map(s => [
    esc(s.tgl),
    esc(s.nama),
    rp(s.sistem),
    rp(s.fisik),
    `<span class="${(s.fisik - s.sistem) !== 0 ? 'badge-bad' : 'badge-ok'}">${rp(s.fisik - s.sistem)}</span>`,
    esc(s.oleh || 'Admin'),
    `<button class="s" style="background:#16a34a;border-color:#16a34a;color:#fff;" onclick="resendShiftWa('${s.id}')" title="Kirim Rekap Shift ke WA Owner">📲 Kirim WA Owner</button>`
  ]);

  return `
    <div class="card">
      <h2>Verifikasi Setoran Kasir (Menunggu Approval Admin)</h2>
      <p style="color:var(--mu);font-size:12px;margin-bottom:12px;">
        💡 Uang Sistem Kasir mencakup: <b>Modal Awal + Transaksi Tunai - Kas Kecil</b>.
      </p>
      ${renderTable(['Tanggal', 'Kasir', 'Waktu Shift', 'Uang Sistem', 'Uang Fisik Diterima', 'Selisih', 'Aksi'], pendingRows, { key: 'verif_pending' })}
    </div>

    <div class="card">
      <h2>Riwayat Setoran Shift yang Sudah Diverifikasi</h2>
      ${renderTable(['Tanggal', 'Kasir', 'Sistem', 'Fisik', 'Selisih', 'Diverifikasi Oleh', 'Kirim WA'], verifiedRows, { key: 'verif_done' })}
    </div>
  `;
}

function actionVerifShift(id) {
  const s = store.get('shift', id);
  if (!s) return;
  s.verif = true;
  s.oleh = currentUser ? currentUser.nama : 'Admin';
  s._t = Date.now();
  store.logActivity('Verifikasi', 'Setoran Shift', `Kasir ${s.nama} (${rp(s.fisik)})`);
  store.saveLocal();
  showAlert('Setoran kasir berhasil diverifikasi.', 'Sukses');
}

// -------------------------------------------------------------
// MODULE: RIWAYAT TRANSAKSI (ADMIN / AUDIT)
// -------------------------------------------------------------
function viewRiwayat() {
  const trxList = getFilteredTrx().slice().reverse();
  const returList = (store.state.returJual || []).slice().reverse();
  const cancelList = (store.state.batalTrx || []).slice().reverse();
  const rows = trxList.map(t => {
    const hasMed = (t.items || []).some(i => i.oid || (i.t || i.jenis) === 'Obat' || ((i.t || i.jenis) === 'Paket' && Array.isArray(i.items) && i.items.some(x => x.type === 'obat')));
    const cancelRequest = cancelList.find(r => r.trxId === t.id && r.status !== 'ditolak');
    const cancelled = isTrxCancelled(t);
    const trxStatus = cancelled
      ? '<span class="badge-bad">DIBATALKAN</span>'
      : (cancelRequest ? '<span class="badge-warn">Menunggu Pembatalan</span>' : '<span class="badge-ok">Selesai</span>');
    const actions = `<button class="s" onclick="printReceipt('${t.id}')">Lihat Nota</button>
      ${hasMed ? `<button class="s" style="background:rgba(2,132,199,0.15);border-color:#0284c7;color:#0284c7;" onclick="openModalLabelObat('${t.id}')">🏷️ Label Obat</button>` : ''}
      ${t.status === 'dibatalkan' || currentRole !== 'kasir' || cancelRequest ? '' : `<button class="s" style="background:rgba(217,119,6,0.15);border-color:#d97706;color:#d97706;" onclick="openModalReturJual('${t.id}')">Ajukan Retur</button>
      <button class="s btn-danger" onclick="actionCancelTrx('${t.id}')">Ajukan Pembatalan</button>`}`;
    return [esc(t.tgl), esc(t.no), esc(t.nama), esc(t.kasir || '-'), esc(t.metode), rp(t.total), trxStatus, actions];
  });
  const cancelRows = cancelList.map(r => {
    const status = r.status === 'menunggu' ? '<span class="badge-warn">Menunggu Verifikasi</span>' :
      r.status === 'disetujui' ? '<span class="badge-ok">Disetujui</span>' : '<span class="badge-bad">Ditolak</span>';
    const actions = currentRole === 'admin' && r.status === 'menunggu'
      ? `<button class="p" onclick="actionProcessCancelTrx('${r.id}','disetujui')">Setujui</button>
         <button class="s btn-danger" onclick="actionProcessCancelTrx('${r.id}','ditolak')">Tolak</button>` : '';
    return [esc(r.tgl), esc(r.noNota || r.trxId), esc(r.namaPasien || '-'), esc(r.kasir || '-'),
      esc(r.alasan || '-'), status, actions];
  });
  const returRows = returList.map(r => {
    const status = r.status || 'disetujui';
    const badge = status === 'menunggu' ? '<span class="badge-warn">Menunggu Verifikasi</span>' :
      status === 'disetujui' ? '<span class="badge-ok">Disetujui</span>' : '<span class="badge-bad">Ditolak</span>';
    const refund = r.pengembalian || null;
    const legacyRefund = status === 'disetujui' && !refund;
    const refundBadge = legacyRefund
      ? '<span class="badge-warn">Retur Lama - Perlu Rekonsiliasi</span>'
      : (refund && refund.status === 'dibayar'
        ? '<span class="badge-ok">Uang Sudah Dikembalikan</span>'
        : (status === 'disetujui' ? '<span class="badge-warn">Menunggu Pimpinan</span>' : '-'));
    const actions = status === 'menunggu' && (currentRole === 'admin' || currentRole === 'pimpinan')
      ? `<button class="p" onclick="actionApproveReturJual('${r.id}')">Setujui</button> <button class="s btn-danger" onclick="actionRejectReturJual('${r.id}')">Tolak</button>`
      : (status === 'disetujui' && refund && refund.status === 'menunggu' && currentRole === 'pimpinan'
        ? `<button class="p" onclick="actionPayReturJual('${r.id}')">Catat Uang Kembali</button>` : '');
    const refundDetail = legacyRefund ? 'Periksa catatan lama' : (refund && refund.status === 'dibayar'
      ? esc(refund.metode || '-') + (refund.referensi ? ' / ' + esc(refund.referensi) : '') + ' / ' + esc(refund.dibayarOleh || '-')
      : '-');
    return [esc(r.tgl), esc(r.noNota), esc(r.namaPasien), esc(r.namaItem), Number(r.qty || 0), rp(r.total),
      esc(r.alasan), esc(r.kasir || '-'), badge, refundBadge, refundDetail, actions];
  });
  return renderFilterBar() + `
    <div class="card"><h2>Daftar Semua Transaksi Penjualan</h2>
      ${renderTable(['Tanggal','No. Nota','Pasien','Kasir','Metode','Total Tagihan','Status Nota','Aksi'], rows, { key: 'all_trx' })}</div>
    ${currentRole === 'admin' ? `<div class="card"><h2>Pengajuan Pembatalan Transaksi</h2>
      <p style="color:var(--mu);font-size:13px;">Nota dan stok hanya berubah setelah Admin menyetujui pengajuan.</p>
      ${renderTable(['Tanggal','No. Nota','Pasien','Kasir','Alasan','Status','Tindakan'], cancelRows, { key: 'cancel_trx_tbl' })}</div>` : ''}
    <div class="card"><h2>Riwayat Retur Penjualan Pasien</h2>
      <p style="color:var(--mu);font-size:13px;">Retur disetujui Admin untuk mengembalikan stok. Pengembalian uang dicatat terpisah dan hanya dapat dilakukan Pimpinan.</p>
      ${renderTable(['Tanggal','No. Nota','Nama Pasien','Item Diretur','Qty','Nilai Retur','Alasan','Petugas','Status Retur','Status Uang','Bukti/Metode','Tindakan'], returRows, { key: 'retur_jual_tbl' })}</div>
  `;
}

function actionApproveReturJual(id) {
  if (currentRole !== 'admin' && currentRole !== 'pimpinan') return;
  showConfirm('Setujui retur ini? Stok obat, batch asal, dan status retur akan diperbarui bersama di cloud.', async () => {
    try {
      await window.firebaseBackend.approveReturJual(id);
      showAlert('Retur disetujui. Stok dan batch asal sudah diperbarui di cloud.', 'Retur Disetujui');
    } catch (err) {
      console.error('Persetujuan retur gagal:', err);
      showAlert(err.message || 'Persetujuan gagal. Stok tidak diubah.', 'Gagal');
    }
    renderApp();
  });
}

function actionRejectReturJual(id) {
  if (currentRole !== 'admin' && currentRole !== 'pimpinan') return;
  showFormModal('Alasan Penolakan Retur', [['alasan', 'Alasan penolakan', 'text', 'Barang tidak memenuhi syarat retur']], async res => {
    try {
      await window.firebaseBackend.rejectReturJual(id, res.alasan);
      showAlert('Retur ditolak. Stok dan uang tidak berubah.', 'Retur Ditolak');
    } catch (err) {
      showAlert(err.message || 'Retur tidak dapat ditolak.', 'Gagal');
    }
    renderApp();
  });
}

function actionPayReturJual(id) {
  if (currentRole !== 'pimpinan') {
    showAlert('Hanya Pimpinan yang dapat mencatat pengembalian uang.', 'Akses Ditolak');
    return;
  }
  showFormModal('Catat Pengembalian Uang Retur', [
    ['metode', 'Metode pengembalian', 'select', 'Tunai', [
      { value: 'Tunai', label: 'Tunai' },
      { value: 'Transfer', label: 'Transfer' }
    ]],
    ['referensi', 'Nomor referensi/bukti transfer (wajib untuk transfer)', 'text', '']
  ], async res => {
    try {
      await window.firebaseBackend.payReturJual(id, res.metode, res.referensi);
      showAlert('Pengembalian uang tercatat satu kali. Saldo kas tunai akan diperbarui bila metode Tunai.', 'Pengembalian Tercatat');
    } catch (err) {
      showAlert(err.message || 'Pengembalian uang gagal dicatat.', 'Gagal');
    }
    renderApp();
  });
}

function openModalReturJual(trxId) {
  if (currentRole === 'admin') {
    showAlert('Admin hanya dapat melihat riwayat transaksi. Perubahan transaksi menjadi kewenangan Kasir/Pimpinan.', 'Akses Ditolak');
    return;
  }
  const trx = store.get('trx', trxId);
  if ((store.state.batalTrx || []).some(r => r.trxId === trxId && r.status !== 'ditolak')) {
    showAlert('Nota memiliki pengajuan pembatalan yang belum ditolak. Retur tidak dapat diajukan.', 'Pengajuan Ditahan');
    return;
  }
  if (!trx || trx.status === 'dibatalkan' || !trx.items || !trx.items.length) {
    showAlert('Transaksi tidak ditemukan, sudah dibatalkan, atau tidak memiliki item');
    return;
  }

  // Item yang sudah diretur penuh (menunggu atau disetujui) tidak ditampilkan lagi.
  // Retur yang ditolak tidak mengurangi kuota sehingga item dapat diajukan kembali.
  const itemOptions = trx.items.reduce((options, it, idx) => {
    const jenis = it.t || it.jenis || '';
    const directOid = it.oid || (jenis === 'Obat' ? it.id : '');
    const isPackage = jenis === 'Paket' && Array.isArray(it.items);
    const isService = !directOid && !isPackage &&
      !['Diskon', 'Potongan Diskon'].includes(jenis) &&
      Number(it.harga || 0) >= 0;
    if (!directOid && !isPackage && !isService) return options;

    const priorQty = (store.state.returJual || [])
      .filter(r => r && r.trxId === trx.id &&
        Number(r.itemIndex) === idx && r.status !== 'ditolak')
      .reduce((sum, r) => sum + Number(r.qty || 0), 0);
    const remainingQty = Math.max(0, Number(it.qty || 0) - priorQty);
    if (remainingQty <= 0) return options;

    options.push({
      value: String(idx),
      label: `${it.nama} (Sisa dapat diretur: ${remainingQty} dari ${it.qty})`
    });
    return options;
  }, []);

  if (!itemOptions.length) {
    showAlert('Semua item pada nota ini sudah diretur penuh atau tidak memenuhi syarat retur.', 'Tidak Ada Item Retur');
    return;
  }

  showFormModal(`Retur Penjualan - Nota ${trx.no}`, [
    ['itemIdx', 'Pilih Item yang Ingin Diretur', 'select', itemOptions[0].value, itemOptions],
    ['qty', 'Jumlah Qty Retur', 'number', 1],
    ['alasan', 'Alasan Retur Pasien', 'text', 'Salah beli / obat tidak terpakai']
  ], res => {
    const idx = parseInt(res.itemIdx, 10);
    const success = store.processReturJual({
      trxId: trx.id,
      itemIndex: idx,
      qtyRetur: Number(res.qty),
      alasan: res.alasan
    });

    if (success) {
      showAlert('Pengajuan retur berhasil dikirim dan menunggu verifikasi Admin. Stok belum berubah.', 'Retur Menunggu Verifikasi');
      renderApp();
    } else {
      showAlert('Gagal memproses retur. Periksa kembali jumlah qty retur.');
    }
  });
}

function actionCancelTrx(id) {
  if (currentRole !== 'kasir') {
    showAlert('Pengajuan pembatalan hanya dapat dibuat oleh Kasir.', 'Akses Ditolak');
    return;
  }
  const trx = store.get('trx', id);
  if (!trx || trx.status === 'dibatalkan') { showAlert('Nota tidak ditemukan atau sudah dibatalkan.'); return; }
  if ((store.state.batalTrx || []).some(r => r.trxId === id && r.status !== 'ditolak')) {
    showAlert('Pengajuan pembatalan nota ini sudah ada dan sedang diproses.'); return;
  }
  showFormModal('Ajukan Pembatalan Nota ' + trx.no, [
    ['alasan', 'Alasan pembatalan', 'text', 'Kesalahan input transaksi']
  ], async res => {
    try {
      const request = await window.firebaseBackend.submitCancelRequest(id, res.alasan);
      store.state.batalTrx.unshift(request);
      store.saveLocal(false);
      store.logActivity('Ajukan Pembatalan', 'Transaksi', 'Nota ' + trx.no + ' menunggu persetujuan Admin');
      showAlert('Pengajuan pembatalan terkirim. Nota dan stok belum berubah sampai Admin menyetujui.', 'Menunggu Persetujuan');
    } catch (err) {
      console.error('Pengajuan pembatalan gagal:', err);
      showAlert(err.message || 'Pengajuan pembatalan gagal. Nota dan stok tidak berubah.', 'Gagal');
    }
  });
}

function actionProcessCancelTrx(id, decision) {
  if (currentRole !== 'admin' && currentRole !== 'pimpinan') return;
  const process = async reason => {
    try {
      await window.firebaseBackend.processCancelRequest(id, decision, reason);
      showAlert(decision === 'disetujui'
        ? 'Pembatalan disetujui. Nota dibatalkan dan stok/batch dikembalikan di Cloud.'
        : 'Pengajuan pembatalan ditolak. Nota dan stok tidak berubah.',
        decision === 'disetujui' ? 'Pembatalan Disetujui' : 'Pembatalan Ditolak');
    } catch (err) {
      console.error('Proses pembatalan gagal:', err);
      showAlert(err.message || 'Proses pembatalan gagal. Tidak ada perubahan stok.', 'Gagal');
    }
    renderApp();
  };
  if (decision === 'ditolak') {
    showFormModal('Alasan Penolakan Pembatalan', [
      ['alasan', 'Alasan penolakan', 'text', 'Tidak disetujui Admin']
    ], res => process(res.alasan));
  } else {
    showConfirm('Setujui pembatalan ini? Nota dibatalkan dan stok obat/batch dikembalikan satu kali di Cloud.', () => process(''));
  }
}

// -------------------------------------------------------------
// MODULE: CETAK LABEL OBAT (ETIKET FARMASI)
// -------------------------------------------------------------
window.activeLabelState = null;

function openLabelFromNota() {
  if (window.lastReceiptTrxId) {
    openModalLabelObat(window.lastReceiptTrxId);
  }
}

function openModalLabelObat(trxId) {
  const trx = store.get('trx', trxId);
  if (!trx) {
    showAlert('Data transaksi tidak ditemukan');
    return;
  }

  const labelItems = [];
  (trx.items || []).forEach(it => {
    if (it.oid || (it.t || it.jenis) === 'Obat') {
      const obat = store.getObat(it.oid || it.id);
      labelItems.push({
        id: it.oid || it.id,
        nama: it.nama,
        qty: it.qty,
        satuan: (obat && obat.satuan) ? obat.satuan : 'tablet/strip',
        jenis: 'putih',
        signa: '3 x 1 Tablet Sehari',
        waktu: 'Sesudah Makan',
        catatan: '',
        ed: getObatEdDate(it.oid || it.id)
      });
    } else if ((it.t || it.jenis) === 'Paket' && Array.isArray(itemItemsSafe(it.items))) {
      (it.items || []).forEach(pkgIt => {
        if (pkgIt.type === 'obat' && (pkgIt.oid || pkgIt.id)) {
          const oid = pkgIt.oid || pkgIt.id;
          const obat = store.getObat(oid);
          labelItems.push({
            id: oid,
            nama: pkgIt.nama || (obat ? obat.nama : 'Obat Paket'),
            qty: (pkgIt.qty || 1) * it.qty,
            satuan: (obat && obat.satuan) ? obat.satuan : 'strip',
            jenis: 'putih',
            signa: '3 x 1 Tablet Sehari',
            waktu: 'Sesudah Makan',
            catatan: '',
            ed: getObatEdDate(oid)
          });
        }
      });
    }
  });

  if (labelItems.length === 0) {
    showAlert('Transaksi ini tidak memiliki resep/item obat untuk dicetak labelnya.', 'Informasi');
    return;
  }

  window.activeLabelState = { trx, labels: labelItems };
  renderLabelEditorAndPreview();

  const modal = $('modal-label-obat');
  if (modal) {
    document.body.classList.add('printing-label');
    modal.style.display = 'flex';
  }
}

function itemItemsSafe(arr) {
  return Array.isArray(arr) ? arr : [];
}

function getObatEdDate(oid) {
  const batches = (store.state.batch || []).filter(b => b.oid === oid && b.sisa > 0).sort((a,b) => a.ed.localeCompare(b.ed));
  return batches.length > 0 ? batches[0].ed : '';
}

function closeLabelObatModal() {
  const modal = $('modal-label-obat');
  if (modal) modal.style.display = 'none';
  document.body.classList.remove('printing-label');
}

function updateLabelProperty(idx, prop, value) {
  if (!window.activeLabelState || !window.activeLabelState.labels[idx]) return;
  window.activeLabelState.labels[idx][prop] = value;
  renderLabelEditorAndPreview();
}

function applyQuickSigna(idx, signa, waktu, catatan = '', jenis = null) {
  if (!window.activeLabelState || !window.activeLabelState.labels[idx]) return;
  const item = window.activeLabelState.labels[idx];
  item.signa = signa;
  item.waktu = waktu;
  if (catatan !== undefined) item.catatan = catatan;
  if (jenis) item.jenis = jenis;
  renderLabelEditorAndPreview();
}

function renderLabelEditorAndPreview() {
  if (!window.activeLabelState) return;
  const { trx, labels } = window.activeLabelState;
  const set = store.state.set || {};

  const editorEl = $('modal-label-obat-editor');
  if (editorEl) {
    editorEl.innerHTML = `
      <div style="background:var(--bg);padding:14px;border-radius:12px;border:1px solid var(--bdr);">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid var(--bdr);">
          <div>
            <b>Pasien: ${esc(trx.nama)}</b> &nbsp;|&nbsp;
            <span style="color:var(--mu);">Nota: ${esc(trx.no)} (${esc(trx.tgl)})</span>
          </div>
          <span class="badge-ok">${labels.length} Item Resep Obat</span>
        </div>

        <div style="display:flex;flex-direction:column;gap:12px;">
          ${labels.map((item, idx) => `
            <div style="background:var(--card);padding:12px;border-radius:10px;border:1.5px solid ${item.jenis === 'biru' ? '#0284c7' : 'var(--bdr)'};">
              <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:8px;">
                <div style="font-weight:800;font-size:13.5px;color:var(--tx);">
                  ${idx + 1}. ${esc(item.nama)} <span style="font-size:12px;color:var(--mu);font-weight:600;">(${item.qty} ${esc(item.satuan)})</span>
                </div>
                <div style="display:flex;gap:6px;">
                  <button type="button" class="s ${item.jenis === 'putih' ? 'p' : ''}" style="${item.jenis === 'putih' ? '' : 'background:transparent;'}" onclick="updateLabelProperty(${idx}, 'jenis', 'putih')">⚪ Obat Dalam (Diminum)</button>
                  <button type="button" class="s ${item.jenis === 'biru' ? 'p' : ''}" style="${item.jenis === 'biru' ? 'background:#0284c7;border-color:#0284c7;' : 'background:transparent;border-color:#0284c7;color:#0284c7;'}" onclick="updateLabelProperty(${idx}, 'jenis', 'biru')">🔵 Obat Luar (Tidak Ditelan)</button>
                </div>
              </div>

              <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px;">
                <span style="font-size:11px;color:var(--mu);align-self:center;">Pilihan Cepat:</span>
                <button type="button" class="s" style="font-size:10.5px;padding:2px 8px;" onclick="applyQuickSigna(${idx}, '3 x 1 Tablet Sehari', 'Sesudah Makan', '')">3x1 Sesudah Makan</button>
                <button type="button" class="s" style="font-size:10.5px;padding:2px 8px;" onclick="applyQuickSigna(${idx}, '3 x 1 Tablet Sehari', 'Sesudah Makan', 'Habiskan (Antibiotik)')">3x1 Habiskan</button>
                <button type="button" class="s" style="font-size:10.5px;padding:2px 8px;" onclick="applyQuickSigna(${idx}, '2 x 1 Tablet Sehari', 'Sesudah Makan', '')">2x1 Sesudah Makan</button>
                <button type="button" class="s" style="font-size:10.5px;padding:2px 8px;" onclick="applyQuickSigna(${idx}, '1 x 1 Tablet Sehari', 'Malam Hari / Sebelum Tidur', '')">1x1 Malam</button>
                <button type="button" class="s" style="font-size:10.5px;padding:2px 8px;" onclick="applyQuickSigna(${idx}, '3 x 1 Sendok Teh (5ml)', 'Sesudah Makan', 'Kocok Dahulu')">3x1 Sendok Sirup</button>
                <button type="button" class="s" style="font-size:10.5px;padding:2px 8px;border-color:#0284c7;color:#0284c7;" onclick="applyQuickSigna(${idx}, 'Oleskan Tipis pada Kulit/Luka', '3 Kali Sehari', 'Obat Luar', 'biru')">Oleskan Tipis (Luar)</button>
                <button type="button" class="s" style="font-size:10.5px;padding:2px 8px;border-color:#0284c7;color:#0284c7;" onclick="applyQuickSigna(${idx}, 'Teteskan 2 Tetes', '3 Kali Sehari', 'Mata / Telinga', 'biru')">Tetes 3x (Luar)</button>
              </div>

              <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;">
                <label style="flex:2;min-width:180px;font-size:11.5px;">Aturan Minum / Dosis (Signa)
                  <input style="margin-top:2px;" value="${esc(item.signa)}" oninput="updateLabelProperty(${idx}, 'signa', this.value)" placeholder="Contoh: 3 x 1 Tablet Sehari">
                </label>
                <label style="flex:2;min-width:160px;font-size:11.5px;">Waktu Konsumsi
                  <input style="margin-top:2px;" value="${esc(item.waktu)}" oninput="updateLabelProperty(${idx}, 'waktu', this.value)" placeholder="Contoh: Sesudah Makan">
                </label>
                <label style="flex:1;min-width:140px;font-size:11.5px;">Catatan Khusus
                  <input style="margin-top:2px;" value="${esc(item.catatan)}" oninput="updateLabelProperty(${idx}, 'catatan', this.value)" placeholder="Contoh: Habiskan">
                </label>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  const previewEl = $('modal-label-obat-preview');
  if (previewEl) {
    previewEl.innerHTML = `
      <div style="margin-top:14px;">
        <div style="font-size:12px;font-weight:700;color:var(--mu);margin-bottom:8px;letter-spacing:0.5px;">
          PRATINJAU LABEL OBAT (Ukuran Label Thermal / Stiker):
        </div>
        <div class="etiket-preview-grid">
          ${labels.map((item, idx) => `
            <div class="etiket-card ${item.jenis}" id="etiket-card-${idx}">
              <div class="etiket-header">
                <div class="etiket-header-title">${esc(set.nama || 'Klinik Sehat Pratama')}</div>
                <div class="etiket-header-sub">${esc(set.alamat || 'Pelayanan Kesehatan & Apotek')} ${set.telp ? `• Telp: ${esc(set.telp)}` : ''}</div>
                <div class="etiket-badge-type">${item.jenis === 'biru' ? 'OBAT LUAR - TIDAK BOLEH DITELAN' : 'OBAT DALAM (DIMINUM)'}</div>
              </div>

              <div class="etiket-meta">
                <span>No: <b>${esc(trx.no)}</b></span>
                <span>Tgl: ${esc(trx.tgl)}</span>
              </div>

              <div class="etiket-pasien">
                Pasien: <b>${esc(trx.nama)}</b>
              </div>

              <div class="etiket-obat-box">
                <div class="etiket-obat-nama">${esc(item.nama)}</div>
                <div style="font-size:11px;color:#475569;margin-top:2px;">Jumlah: <b>${item.qty} ${esc(item.satuan)}</b></div>
              </div>

              ${item.jenis === 'biru' ? `<div class="etiket-warning-biru">⚠️ OBAT LUAR — JANGAN DITELAN</div>` : ''}

              <div class="etiket-signa-box">
                <div class="etiket-signa-text">${esc(item.signa || 'Sesuai Petunjuk Dokter')}</div>
                ${item.waktu ? `<div class="etiket-signa-sub">${esc(item.waktu)} ${item.catatan ? `• ${esc(item.catatan)}` : ''}</div>` : ''}
              </div>

              <div class="etiket-footer">
                <span>${esc(set.footer || 'Semoga Lekas Sembuh')}</span>
                <span>${item.ed ? `ED: ${esc(item.ed)}` : ''}</span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }
}

// -------------------------------------------------------------
// MODULE: DASHBOARD EKSEKUTIF (PIMPINAN)
// -------------------------------------------------------------
function viewDashboard() {
  const fin = calculateFinancials();
  const k = fin.trxList.length;
  const avg = k > 0 ? fin.rev / k : 0;

  const set = store.state.set || {};
  const pendingBiaya = (store.state.biaya || []).filter(b => b.status === 'pending').length;
  const utangJatuhTempo = (store.state.beli || []).filter(b => !b.lunas && Math.round((new Date(b.tempo) - new Date(todayStr)) / 864e5) <= (set.tempoPeringatan || 7)).length;
  const lowStok = (store.state.obat || []).filter(o => (o.stok || 0) <= (o.min || 5)).length;
  const edNear = (store.state.batch || []).filter(b => b.sisa > 0 && Math.round((new Date(b.ed) - new Date(todayStr)) / 864e5) <= (set.edPeringatan || 60)).length;

  return renderFilterBar() + `
    <div class="grid">
      <div class="kpi"><span>Transaksi Bruto</span><b>${rp(fin.grossRevenue)}</b></div>
      <div class="kpi"><span>Retur Disetujui</span><b>(-) ${rp(fin.returnValue)}</b></div>
      <div class="kpi"><span>Omzet Bersih</span><b>${rp(fin.rev)}</b></div>
      <div class="kpi"><span>Jumlah Nota Pasien</span><b>${k}</b></div>
      <div class="kpi"><span>Rata-Rata Bersih per Nota</span><b>${rp(avg)}</b></div>
      <div class="kpi"><span>Laba Bersih Operasional</span><b class="${fin.laba < 0 ? 'badge-bad' : 'badge-ok'}">${rp(fin.laba)}</b></div>
    </div>
    <div class="card">
      <h2>Rincian Retur pada Periode Terpilih</h2>
      ${renderTable(['Komponen', 'Nilai'], [
        ['Retur obat/barang', rp(fin.returnGoods)],
        ['Retur jasa/pelayanan', rp(fin.returnServices)],
        ['Total retur disetujui', '<b>' + rp(fin.returnValue) + '</b>'],
        ['Refund sudah dibayarkan', rp(fin.refundPaid)],
        ['Refund menunggu pembayaran', rp(fin.refundPending)],
        ['Retur lama perlu rekonsiliasi', rp(fin.legacyReturnValue)]
      ], { key: 'dashboard_return_summary' })}
    </div>

    <div class="card" style="border-left:4px solid var(--am);">
      <h2>Peringatan & Perhatian Manajemen</h2>
      <div class="row" style="font-size:13px;gap:20px;">
        <span>Approval Pending: <b class="${pendingBiaya ? 'badge-warn' : ''}">${pendingBiaya}</b></span>
        <span>Utang Jatuh Tempo: <b class="${utangJatuhTempo ? 'badge-bad' : ''}">${utangJatuhTempo} Faktur</b></span>
        <span>Stok Menipis: <b class="${lowStok ? 'badge-bad' : ''}">${lowStok} Obat</b></span>
        <span>Mendekati / Lewat ED: <b class="${edNear ? 'badge-bad' : ''}">${edNear} Batch</b></span>
      </div>
    </div>

    <div class="charts-grid">
      <div class="chart-card">
        <h3>📈 Tren Omset Harian (Rp)</h3>
        <div class="chart-wrapper">
          <canvas id="chart-omset"></canvas>
        </div>
      </div>
      <div class="chart-card">
        <h3>💳 Porsi Metode Pembayaran</h3>
        <div class="chart-wrapper">
          <canvas id="chart-metode"></canvas>
        </div>
      </div>
      <div class="chart-card">
        <h3>📊 Ringkasan Finansial</h3>
        <div class="chart-wrapper">
          <canvas id="chart-struktur"></canvas>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>Komposisi Pendapatan Pasien</h2>
      ${renderTable(
        ['Komponen', 'Nominal', 'Persentase terhadap Omset'],
        [
          ['Jasa Konsultasi Dokter', rp(fin.kons), pct(fin.kons, fin.rev)],
          ['Tindakan Medis & Rawat', rp(fin.tind), pct(fin.tind, fin.rev)],
          ['Penjualan Obat & Alkes', rp(fin.obat), pct(fin.obat, fin.rev)],
          ['Potongan Diskon Pasien', `(-) ${rp(fin.disk)}`, pct(fin.disk, fin.rev)]
        ],
        { key: 'komposisi_pendapatan' }
      )}
      <p style="margin-top:10px;font-size:13px;">Margin Kotor Penjualan Obat (Jual - HPP): <b>${rp(fin.obat - fin.hpp)}</b></p>
    </div>
  `;
}

window._activeCharts = [];

function initDashboardCharts(fin) {
  if (typeof Chart === 'undefined') return;

  window._activeCharts.forEach(c => {
    try { c.destroy(); } catch (e) {}
  });
  window._activeCharts = [];

  const trxList = fin.trxList || [];

  const dailyOmset = {};
  trxList.forEach(t => {
    dailyOmset[t.tgl] = (dailyOmset[t.tgl] || 0) + Number(t.total || 0);
  });
  // Kurangi retur pada tanggal retur agar tren harian menunjukkan pendapatan bersih periode berjalan.
  (fin.approvedReturns || []).forEach(r => {
    if (!r.tgl) return;
    dailyOmset[r.tgl] = (dailyOmset[r.tgl] || 0) - Number(r.total || 0);
  });
  const daysSorted = Object.keys(dailyOmset).sort();
  const omsetValues = daysSorted.map(d => dailyOmset[d]);

  const elOmset = document.getElementById('chart-omset');
  if (elOmset) {
    const c1 = new Chart(elOmset, {
      type: 'line',
      data: {
        labels: daysSorted.length ? daysSorted : ['Hari Ini'],
        datasets: [{
          label: 'Omzet Bersih (Rp)',
          data: omsetValues.length ? omsetValues : [0],
          borderColor: '#0f766e',
          backgroundColor: 'rgba(15, 118, 110, 0.15)',
          fill: true,
          tension: 0.35,
          pointRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: {
            ticks: {
              callback: val => 'Rp ' + (val >= 1e6 ? (val / 1e6).toFixed(1) + ' jt' : val.toLocaleString('id-ID'))
            }
          }
        }
      }
    });
    window._activeCharts.push(c1);
  }

  const metodeCount = { Tunai: 0, QRIS: 0, Transfer: 0, 'Debit/Kredit': 0 };
  trxList.forEach(t => {
    const m = t.metode || 'Tunai';
    metodeCount[m] = (metodeCount[m] || 0) + Number(t.total || 0);
  });

  const elMetode = document.getElementById('chart-metode');
  if (elMetode) {
    const c2 = new Chart(elMetode, {
      type: 'doughnut',
      data: {
        labels: Object.keys(metodeCount),
        datasets: [{
          data: Object.values(metodeCount),
          backgroundColor: ['#0f766e', '#06b6d4', '#f59e0b', '#8b5cf6'],
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12 } }
        }
      }
    });
    window._activeCharts.push(c2);
  }

  const elStruktur = document.getElementById('chart-struktur');
  if (elStruktur) {
    const c3 = new Chart(elStruktur, {
      type: 'bar',
      data: {
        labels: ['Omset', 'HPP Obat', 'Beban Operasional', 'Laba Bersih'],
        datasets: [{
          data: [fin.rev, fin.hpp, fin.op + fin.pc, fin.laba],
          backgroundColor: ['#0f766e', '#d97706', '#ef4444', fin.laba >= 0 ? '#10b981' : '#dc2626'],
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: {
            ticks: {
              callback: val => 'Rp ' + (val >= 1e6 ? (val / 1e6).toFixed(1) + ' jt' : val.toLocaleString('id-ID'))
            }
          }
        }
      }
    });
    window._activeCharts.push(c3);
  }
}

// -------------------------------------------------------------
// MODULE: LAPORAN LABA RUGI (PIMPINAN)
// -------------------------------------------------------------
function viewLabaRugi() {
  const fin = calculateFinancials();

  const opGroup = {};
  inFilterRange(store.state.biaya).filter(b => b.status === 'approved').forEach(b => {
    opGroup[b.kat] = (opGroup[b.kat] || 0) + Number(b.jml || 0);
  });

  const pnlRows = [
    ['Total Transaksi Bruto', rp(fin.grossRevenue)],
    ['(-) Retur Obat / Barang Disetujui', `(-) ${rp(fin.returnGoods)}`],
    ['(-) Retur Jasa / Pelayanan Disetujui', `(-) ${rp(fin.returnServices)}`],
    ['<b>PENDAPATAN SETELAH RETUR</b>', `<b>${rp(fin.grossRevenue - fin.returnValue)}</b>`],
    ['Pendapatan Jasa Konsultasi Dokter (rincian nota)', rp(fin.kons)],
    ['Pendapatan Tindakan Medis (rincian nota)', rp(fin.tind)],
    ['Pendapatan Penjualan Obat & Alkes (rincian nota)', rp(fin.obat)],
    ['<b>(-) Potongan Diskon</b>', `<b>(-) ${rp(fin.disk)}</b>`],
    ['<b>TOTAL PENDAPATAN BERSIH</b>', `<b>${rp(fin.rev)}</b>`],
    ['(-) HPP Obat Terjual', `(-) ${rp(fin.hpp)}`],
    ['(-) Kerugian Obat Rusak & Kedaluwarsa', `(-) ${rp(fin.loss)}`],
    ...Object.keys(opGroup).map(kat => [`(-) Beban: ${esc(kat)}`, `(-) ${rp(opGroup[kat])}`]),
    ['(-) Beban Kas Kecil (Petty Cash)', `(-) ${rp(fin.pc)}`],
    ['<b style="font-size:15px;">LABA BERSIH OPERASIONAL</b>', `<b style="font-size:15px;" class="${fin.laba < 0 ? 'badge-bad' : 'badge-ok'}">${rp(fin.laba)}</b>`]
  ];

  return renderFilterBar() + `
    <div class="card">
      <h2>Laporan Laba Rugi Komprehensif</h2>
      ${renderTable(['Akun / Pos Keuangan', 'Nominal (Rp)'], pnlRows, { key: 'pnl_tbl' })}
    </div>
  `;
}

// -------------------------------------------------------------
// MODULE: ARUS KAS (PIMPINAN)
// -------------------------------------------------------------
function viewArusKas() {
  const fin = calculateFinancials();
  const trxList = fin.trxList;
  const totalMasuk = trxList.reduce((s, t) => s + Number(t.total || 0), 0);
  const masukTunai = trxList.filter(t => t.metode === 'Tunai').reduce((s, t) => s + Number(t.total || 0), 0);
  const masukNonTunai = trxList.filter(t => t.metode !== 'Tunai').reduce((s, t) => s + Number(t.total || 0), 0);

  const beliLunas = inFilterRange(store.state.beli).filter(b => b.lunas).reduce((s, b) => s + Number(b.total || 0), 0);
  const biayaOp = inFilterRange(store.state.biaya).filter(b => b.status === 'approved').reduce((s, b) => s + Number(b.jml || 0), 0);
  const pettyOut = inFilterRange(store.state.petty).reduce((s, p) => s + Number(p.jml || 0), 0);
  const refundOut = fin.refundPaid;
  const totalKeluar = beliLunas + biayaOp + pettyOut + refundOut;
  const arusKasBersih = totalMasuk - totalKeluar;

  return renderFilterBar() + `
    <div class="card">
      <h2>Arus Kas Masuk (Penerimaan)</h2>
      ${renderTable(
        ['Keterangan', 'Nominal'],
        [
          ['Penerimaan Tunai', rp(masukTunai)],
          ['Penerimaan Non-Tunai (QRIS / Transfer / Kartu)', rp(masukNonTunai)],
          ['<b>Total Arus Kas Masuk</b>', `<b>${rp(totalMasuk)}</b>`]
        ],
        { key: 'cf_in' }
      )}
    </div>

    <div class="card">
      <h2>Arus Kas Keluar (Pengeluaran)</h2>
      ${renderTable(
        ['Pos Pengeluaran', 'Nominal'],
        [
          ['Pembayaran Faktur Supplier Obat', rp(beliLunas)],
          ['Biaya Operasional & Honor Dokter', rp(biayaOp)],
          ['Kas Kecil', rp(pettyOut)],
          ['Pengembalian uang retur yang sudah dibayar', rp(refundOut)],
          ['Refund disetujui, belum dibayar (belum menjadi kas keluar)', rp(fin.refundPending)],
          ['Retur lama tanpa bukti pembayaran (perlu rekonsiliasi)', rp(fin.legacyReturnValue)],
          ['<b>Total Arus Kas Keluar</b>', `<b>${rp(totalKeluar)}</b>`]
        ],
        { key: 'cf_out' }
      )}
      <div class="cart-total-box" style="margin-top:14px;">
        <span>SURPLUS / DEFISIT KAS BERSIH:</span>
        <b class="${arusKasBersih < 0 ? 'badge-bad' : 'badge-ok'}">${rp(arusKasBersih)}</b>
      </div>
    </div>
  `;
}

// -------------------------------------------------------------
// MODULE: UTANG SUPPLIER (PIMPINAN)
// -------------------------------------------------------------
function viewUtang() {
  const set = store.state.set || {};
  const unpaid = (store.state.beli || []).filter(b => !b.lunas).sort((a, b) => (a.tempo < b.tempo ? -1 : 1));
  const totalUtang = unpaid.reduce((s, b) => s + Number(b.total || 0), 0);

  const rows = unpaid.map(b => {
    const diff = Math.round((new Date(b.tempo) - new Date(todayStr)) / 864e5);
    let badge = `${diff} hari lagi`;
    if (diff < 0) badge = `<span class="badge-bad">Lewat ${Math.abs(diff)} hari!</span>`;
    else if (diff <= (set.tempoPeringatan || 7)) badge = `<span class="badge-warn">${diff} hari lagi</span>`;

    return [
      esc(b.supplier),
      esc(b.faktur || '-'),
      rp(b.total),
      esc(b.tempo),
      badge,
      `<button class="s p" onclick="store.lunasiBeli('${b.id}')">Tandai Lunas</button>`
    ];
  });

  return `
    <div class="card">
      <h2>Daftar Utang Faktur Obat Supplier (PBF)</h2>
      <p style="color:var(--mu);font-size:13px;">Total seluruh utang jatuh tempo: <b class="badge-bad">${rp(totalUtang)}</b></p>
      ${renderTable(['Supplier', 'No. Faktur', 'Tagihan', 'Tgl Jatuh Tempo', 'Sisa Waktu', 'Aksi'], rows, { key: 'utang_tbl' })}
    </div>
  `;
}

// -------------------------------------------------------------
// MODULE: PENGAWASAN RETUR (PIMPINAN)
// -------------------------------------------------------------
function viewPengawasanRetur() {
  if (currentRole !== 'pimpinan') return '<div class="card">Akses hanya untuk Pimpinan.</div>';
  const list = (store.state.returJual || []).slice().sort((a, b) =>
    Number(b.diverifikasiPada || b._t || 0) - Number(a.diverifikasiPada || a._t || 0)
  );
  const pendingPayment = list.filter(r => r.status === 'disetujui' && r.pengembalian && r.pengembalian.status === 'menunggu').length;
  const paid = list.filter(r => r.status === 'disetujui' && r.pengembalian && r.pengembalian.status === 'dibayar').length;
  const legacy = list.filter(r => r.status === 'disetujui' && !r.pengembalian).length;
  const rows = list.map(r => {
    const status = r.status || 'disetujui';
    const refund = r.pengembalian || null;
    const statusRetur = status === 'menunggu' ? '<span class="badge-warn">Menunggu Admin</span>' :
      status === 'disetujui' ? '<span class="badge-ok">Disetujui</span>' : '<span class="badge-bad">Ditolak</span>';
    const statusUang = status !== 'disetujui' ? '-' : (!refund
      ? '<span class="badge-warn">Retur Lama - Perlu Rekonsiliasi</span>'
      : (refund.status === 'dibayar' ? '<span class="badge-ok">Sudah Dikembalikan</span>' :
        '<span class="badge-warn">Menunggu Pimpinan</span>'));
    const detail = refund && refund.status === 'dibayar'
      ? esc(refund.metode || '-') + (refund.referensi ? ' / ' + esc(refund.referensi) : '') +
        ' / ' + esc(refund.dibayarOleh || '-') +
        (refund.dibayarPada ? ' / ' + new Date(refund.dibayarPada).toLocaleString('id-ID') : '')
      : (status === 'ditolak' ? esc(r.alasanPenolakan || '-') : (refund ? '-' : 'Periksa arsip lama'));
    const action = status === 'disetujui' && refund && refund.status === 'menunggu'
      ? '<button class="p" onclick="actionPayReturJual(\'' + esc(r.id) + '\')">Catat Uang Kembali</button>'
      : '';
    return [esc(r.tgl || '-'), esc(r.noNota || '-'), esc(r.namaPasien || '-'),
      esc(r.namaItem || '-'), Number(r.qty || 0), rp(r.total), esc(r.kasir || '-'),
      statusRetur, statusUang, detail, action];
  });
  return `
    <div class="card">
      <h2>Pengawasan Pengembalian Uang Retur</h2>
      <p style="color:var(--mu);font-size:13px;">Pimpinan hanya perlu mencatat pengembalian uang setelah retur disetujui Admin. Persetujuan stok tetap ditangani Admin; setiap pembayaran tercatat satu kali beserta metode, referensi, petugas, dan waktunya.</p>
      <div class="grid">
        <div class="kpi"><span>Menunggu Pengembalian</span><b>${pendingPayment}</b></div>
        <div class="kpi"><span>Sudah Dikembalikan</span><b>${paid}</b></div>
        <div class="kpi"><span>Retur Lama Perlu Rekonsiliasi</span><b>${legacy}</b></div>
      </div>
      ${renderTable(['Tanggal','No. Nota','Pasien','Item','Qty','Nilai Retur','Kasir','Status Retur','Status Uang','Bukti/Metode/Petugas','Tindakan'], rows, { key: 'pimpinan_pengawasan_retur' })}
    </div>
  `;
}

// -------------------------------------------------------------
// MODULE: APPROVAL PENGELUARAN BESAR (PIMPINAN)
// -------------------------------------------------------------
function viewApproval() {
  const pendingBiaya = (store.state.biaya || []).filter(b => b.status === 'pending');

  const rows = pendingBiaya.map(b => [
    esc(b.tgl),
    esc(b.kat),
    esc(b.ket),
    rp(b.jml),
    `
      <button class="s p" onclick="actionApproveBiaya('${b.id}', true)">Setujui (Approve)</button>
      <button class="s btn-danger" onclick="actionApproveBiaya('${b.id}', false)">Tolak</button>
    `
  ]);

  return `
    <div class="card">
      <h2>Persetujuan Pengeluaran Dana Besar (Approval)</h2>
      <p style="color:var(--mu);font-size:13px;">Pengeluaran operasional yang melebihi batas approval memerlukan otorisasi Pimpinan.</p>
      ${renderTable(['Tanggal', 'Kategori', 'Keterangan', 'Nominal', 'Aksi'], rows, { key: 'appr_tbl' })}
    </div>
  `;
}

function actionApproveBiaya(id, isApproved) {
  const b = store.get('biaya', id);
  if (!b) return;
  b.status = isApproved ? 'approved' : 'ditolak';
  b._t = Date.now();
  store.logActivity('Approval', 'Biaya', `${isApproved ? 'Menyetujui' : 'Menolak'} ${b.ket} (${rp(b.jml)})`);
  store.saveLocal();
  showAlert(`Pengeluaran ${isApproved ? 'disetujui' : 'ditolak'}.`, 'Sukses');
}

// -------------------------------------------------------------
// MODULE: EKSPOR LAPORAN (CSV & PDF)
// -------------------------------------------------------------
function viewEkspor() {
  const reports = [
    { key: 'Transaksi', name: 'Laporan Transaksi Kasir & Penjualan' },
    { key: 'Paket Pelayanan', name: 'Laporan Master Paket Pelayanan' },
    { key: 'Pasien', name: 'Laporan Kunjungan Pasien' },
    { key: 'Pembelian', name: 'Laporan Faktur & Pembelian Obat' },
    { key: 'Biaya', name: 'Laporan Biaya Operasional & Gaji' },
    { key: 'Kas Kecil', name: 'Laporan Pengeluaran Kas Kecil' },
    { key: 'Stok Obat', name: 'Laporan Stok Fisik Obat & Alkes' },
    { key: 'Kedaluwarsa', name: 'Laporan Batch & Kedaluwarsa Obat' },
    { key: 'Log Aktivitas', name: 'Laporan Audit Trail / Log Aktivitas' }
  ];

  const rows = reports.map(r => [
    esc(r.name),
    `<button class="s p" onclick="window.exportHelper.exportCSV('${r.key}', dateFilter)">📥 Download CSV (Excel)</button>`,
    `<button class="s" onclick="window.exportHelper.exportPDF('${r.key}', dateFilter)">📄 Cetak / Download PDF</button>`
  ]);

  return renderFilterBar() + `
    <div class="card">
      <h2>Pusat Ekspor Laporan Klinik</h2>
      <p style="color:var(--mu);font-size:13px;">
        File CSV dapat langsung dibuka dengan Microsoft Excel secara rapi. File PDF siap dicetak atau diarsipkan.
      </p>
      ${renderTable(['Nama Laporan', 'Format Excel (CSV)', 'Format Dokumen (PDF)'], rows, { key: 'ekspor_tbl' })}
    </div>
  `;
}

// -------------------------------------------------------------
// MODULE: LOG AKTIVITAS (AUDIT TRAIL)
// -------------------------------------------------------------
function viewLog() {
  const searchLower = auditSearchQuery.toLowerCase();
  const logs = (store.state.log || []).filter(l => 
    (l.u + ' ' + l.aksi + ' ' + l.kol + ' ' + (l.rinci || '')).toLowerCase().includes(searchLower)
  );

  const rows = logs.map(l => [
    `${esc(l.tgl)} ${esc(l.jam)}`,
    `<span class="badge-ok">${esc(l.u)}</span>`,
    esc(l.aksi),
    esc(l.kol),
    esc(l.rinci || '-')
  ]);

  return `
    <div class="card">
      <h2>Log Audit Aktivitas Pengguna</h2>
      <div class="row">
        <label style="flex:1;min-width:240px;">Cari Riwayat
          <input type="search" placeholder="Ketik nama user, aksi, atau data..." value="${esc(auditSearchQuery)}" oninput="auditSearchQuery=this.value;renderApp();">
        </label>
      </div>
      ${renderTable(['Waktu', 'Pengguna', 'Aksi', 'Modul / Data', 'Rincian Perubahan'], rows, { key: 'log_tbl' })}
    </div>
  `;
}

// -------------------------------------------------------------
// MODULE: MANAJEMEN PENGGUNA (PIMPINAN)
// -------------------------------------------------------------
function quickEditOwnerWa() {
  const current = store.getOwnerWa ? store.getOwnerWa() : (store.state.set && store.state.set.waOwner);
  showFormModal('Atur Nomor WhatsApp Owner / Pimpinan', [
    ['waOwner', 'Nomor WhatsApp Owner (Contoh: 081234567890)', 'tel', current || '']
  ], res => {
    const raw = (res.waOwner || '').trim();
    if (store.state.set) store.state.set.waOwner = raw;
    
    const pimpinan = (store.state.users || []).find(u => u.role === 'pimpinan');
    if (pimpinan) {
      pimpinan.hp = raw;
      pimpinan._t = Date.now();
    }
    store.logActivity('Ubah', 'Pengguna', `Nomor WA Owner diubah ke ${raw}`);
    store.saveLocal();
    showAlert(`Nomor WhatsApp Owner berhasil disimpan: ${raw}\n\nRekap tutup shift kasir akan otomatis dikirimkan ke nomor ini.`, 'WhatsApp Owner Tersimpan');
  });
}

function viewPengguna() {
  const users = store.state.users || [];
  const ownerWa = store.getOwnerWa ? store.getOwnerWa() : (store.state.set && store.state.set.waOwner);
  const pimpinanUser = users.find(u => u.role === 'pimpinan');
  const rows = users.map(u => [
    esc(u.nama), `<code>${esc(u.u)}</code>`,
    `<span class="badge-ok">${esc(u.role)}</span>`, esc(u.hp || '-'),
    ['praktekrose', 'pimpinan2'].includes(u.u) ? 'Akun inti terlindungi' : 'Data lokal lama dipertahankan'
  ]);

  return `
    <div class="card" style="border-left:4px solid #16a34a;background:rgba(22,163,74,0.06);">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
        <div>
          <b style="font-size:14px;color:#16a34a;">📱 Pengaturan WhatsApp Owner (Penerima Rekap Tutup Shift Otomatis)</b>
          <div style="font-size:12.5px;color:var(--tx);margin-top:4px;">
            Nomor WA Owner Saat Ini: <b style="color:var(--pr);font-size:14px;">${esc(ownerWa || 'Belum Diatur')}</b>
            ${pimpinanUser ? ` <span style="color:var(--mu);font-size:12px;">(Terhubung ke user: <b>${esc(pimpinanUser.nama)}</b>)</span>` : ''}
          </div>
          <div style="font-size:11.5px;color:var(--mu);margin-top:2px;">
            Setiap kali kasir melakukan Tutup Shift, rincian omset, kas laci, selisih kas, dan rincian transaksi akan otomatis terkirim ke WhatsApp ini.
          </div>
        </div>
        <button class="p s" style="background:#16a34a;border-color:#16a34a;" onclick="quickEditOwnerWa()">✏️ Atur Nomor WA Owner</button>
      </div>
    </div>

    <div class="card">
      <h2>Akun Staf Firebase</h2>
      <p class="muted" style="font-size:12px;">Akun berikut menggunakan Firebase Authentication. Tombol ini membuat profil akses Firestore untuk dua email staf yang sudah didaftarkan. Password tidak disimpan di aplikasi atau Firestore.</p>
      <div style="margin:10px 0 14px;line-height:1.8;">
        <div><b>Admin Gudang & Keuangan:</b> assalamadmin1@gmail.com</div>
        <div><b>Kasir:</b> assalamkasir1@gmail.com</div>
      </div>
      <button class="p" onclick="actionProvisionStaffAccounts()">Aktifkan / Perbarui Profil Akses Staf</button>
      <p class="muted" style="font-size:11px;margin-top:10px;">Jalankan tombol ini dari akun Pimpinan. Akun lokal lama tidak dihapus selama masa pengujian.</p>
      ${renderTable(['Nama Pengguna Lama', 'Username', 'Peran', 'No. WhatsApp', 'Status'], rows, { key: 'user_tbl' })}
    </div>
  `;
}

async function actionProvisionStaffAccounts() {
  const backend = window.firebaseBackend;
  if (!backend || !backend.auth || !backend.auth.currentUser) {
    showAlert('Silakan login sebagai Pimpinan melalui Firebase terlebih dahulu.');
    return;
  }
  showConfirm('Buat profil akses Firestore untuk Admin Gudang & Keuangan dan Kasir? Password tidak akan disimpan. Akun Pimpinan dan data operasional tidak diubah.', async () => {
    try {
      const profiles = await backend.provisionDefaultStaffProfiles(store.state.users || []);
      showAlert('Profil akses staf berhasil disiapkan.\n\nAdmin: ' + profiles[0].email + '\nKasir: ' + profiles[1].email + '\n\nSilakan uji login masing-masing akun pada perangkat terpisah.');
      store.logActivity('Aktivasi', 'Pengguna', 'Profil Firebase staf disiapkan oleh Pimpinan');
    } catch (err) {
      console.error('Provision profil staf gagal:', err);
      showAlert(err.message || 'Gagal menyiapkan profil staf.');
    }
  });
}

// Pengelolaan akun staf lokal dinonaktifkan; autentikasi staf wajib melalui Firebase.
function actionAddUser() {
  showAlert('Pembuatan akun lokal sudah dinonaktifkan. Gunakan akun Firebase staf yang telah disiapkan oleh Pimpinan.');
}

function editUser(username) {
  showAlert('Akun lokal lama hanya dipertahankan sementara untuk menjaga data historis. Pengelolaan akun baru dilakukan melalui Firebase.');
}

function delUser(username) {
  showAlert('Penghapusan akun lokal lama ditahan sampai login Firebase staf selesai diuji. Data lama tidak dihapus otomatis.');
}

// -------------------------------------------------------------
// MODULE: PENGATURAN KLINIK & FIREBASE CLOUD (PIMPINAN)
// -------------------------------------------------------------
function viewPengaturan() {
  const set = store.state.set || {};
  const fbConfig = store.state.firebaseConfig || {};

  return `
    <div class="card">
      <h2>Identitas & Profil Klinik</h2>
      <div class="row">
        <label style="flex:1;min-width:240px;">Nama Klinik
          <input id="set-nama" value="Klinik Assalaam Palembang" readonly aria-readonly="true" title="Nama klinik ditetapkan dan tidak dapat diubah">
        </label>
        <label style="width:120px;">Logo Emoji
          <input id="set-logo" value="${esc(set.logo)}">
        </label>
        <label>Upload Logo (Gambar)
          <input type="file" accept="image/*" onchange="uploadClinicLogo(this.files[0])">
        </label>
        ${set.logoImg ? `<img src="${esc(set.logoImg)}" class="lg"><button class="s btn-danger" onclick="deleteClinicLogo()">Hapus Logo</button>` : ''}
      </div>
      <div class="row">
        <label style="flex:2;min-width:260px;">Alamat Klinik
          <input id="set-alamat" value="${esc(set.alamat)}">
        </label>
        <label style="flex:1;min-width:180px;">Nomor Telepon
          <input id="set-telp" value="${esc(set.telp)}">
        </label>
      </div>
      <div class="row">
        <label style="flex:1;min-width:260px;">Nomor WhatsApp Owner / Pimpinan (Penerima Rekap Tutup Shift Otomatis)
          <input id="set-waOwner" type="tel" placeholder="081234567890" value="${esc(store.getOwnerWa ? store.getOwnerWa() : (set.waOwner || ''))}">
        </label>
        <label style="flex:1;min-width:260px;">Teks Catatan Kaki Nota (Footer Struk)
          <input id="set-footer" value="${esc(set.footer)}">
        </label>
      </div>
      <div style="margin-top:10px;display:flex;flex-direction:column;gap:8px;">
        <div style="background:var(--bg);padding:10px 14px;border-radius:8px;font-size:12px;color:var(--mu);margin-bottom:4px;">
          📺 Pengaturan Video YouTube &amp; Running Text Layar TV dikelola oleh <b>Admin</b> — lihat tab <b>Display TV</b> pada login Admin.
        </div>
        <label style="display:flex;flex-direction:row;align-items:center;gap:8px;font-size:13px;font-weight:600;cursor:pointer;">
          <input id="set-fiturWA" type="checkbox" ${set.fiturKirimWA !== false ? 'checked' : ''} style="width:18px;height:18px;">
          <span>Aktifkan Tombol Kirim Struk Pembayaran ke WhatsApp Pasien</span>
        </label>
      </div>
    </div>

    <div class="card">
      <h2>Tampilan Antarmuka</h2>
      <div class="row">
        <label>Warna Utama
          <input id="set-warna" type="color" value="${set.warna || '#0f766e'}">
        </label>
        <label>Tema Warna
          <select id="set-tema">
            <option value="auto" ${set.tema === 'auto' ? 'selected' : ''}>Ikuti Pengaturan Perangkat</option>
            <option value="light" ${set.tema === 'light' ? 'selected' : ''}>Mode Terang (Light)</option>
            <option value="dark" ${set.tema === 'dark' ? 'selected' : ''}>Mode Gelap (Dark)</option>
          </select>
        </label>
        <label>Ukuran Font
          <select id="set-font">
            <option value="13" ${set.font === '13' ? 'selected' : ''}>Kecil (13px)</option>
            <option value="14" ${set.font === '14' ? 'selected' : ''}>Normal (14px)</option>
            <option value="16" ${set.font === '16' ? 'selected' : ''}>Besar (16px)</option>
          </select>
        </label>
        <label>Jumlah Baris Tabel per Halaman
          <select id="set-perHal">
            <option value="5" ${set.perHal == 5 ? 'selected' : ''}>5</option>
            <option value="10" ${set.perHal == 10 ? 'selected' : ''}>10</option>
            <option value="20" ${set.perHal == 20 ? 'selected' : ''}>20</option>
            <option value="50" ${set.perHal == 50 ? 'selected' : ''}>50</option>
          </select>
        </label>
      </div>
    </div>

    <div class="card">
      <h2>Aturan & Batas Keuangan</h2>
      <div class="row">
        <label>Batas Approval Pengeluaran (Rp)
          <input id="set-batas" type="number" value="${set.batasApproval || 1000000}">
        </label>
        <label>Peringatan Utang Faktur (Hari sebelum jatuh tempo)
          <input id="set-tempo" type="number" value="${set.tempoPeringatan || 7}">
        </label>
        <label>Peringatan Obat Kedaluwarsa (Hari sebelum ED)
          <input id="set-edHari" type="number" value="${set.edPeringatan || 60}">
        </label>
      </div>
      <button class="p" onclick="actionSaveSettings()">💾 Simpan Pengaturan Klinik</button>
    </div>

    <div class="card" style="border-left:4px solid var(--pr);">
      <h2>Sinkronisasi Cloud (Google Firebase - 100% Free Forever)</h2>
      <p style="color:var(--mu);font-size:13px;line-height:1.6;">
        Hubungkan ke <b>Google Cloud Firestore (Spark Plan: Gratis)</b> agar kasir, apoteker, dan pimpinan dapat membuka sistem bersamaan dari berbagai perangkat (laptop, tablet, HP) secara *real-time*.
        <br>Jika kolom ini dikosongkan, sistem tetap berjalan normal dalam <b>Mode Lokal (Tersimpan di Browser)</b>.
      </p>
      <div class="row">
        <label style="flex:1;">API Key
          <input id="fb-apiKey" placeholder="AIzaSy..." value="${esc(fbConfig.apiKey || '')}">
        </label>
        <label style="flex:1;">Project ID
          <input id="fb-projectId" placeholder="klinik-sehat-xxxx" value="${esc(fbConfig.projectId || '')}">
        </label>
      </div>
      <div class="row">
        <label style="flex:1;">Auth Domain
          <input id="fb-authDomain" placeholder="klinik-sehat-xxxx.firebaseapp.com" value="${esc(fbConfig.authDomain || '')}">
        </label>
        <label style="flex:1;">App ID
          <input id="fb-appId" placeholder="1:xxxx:web:xxxx" value="${esc(fbConfig.appId || '')}">
        </label>
      </div>
      <div style="display:flex;gap:10px;margin-top:10px;">
        <button class="p" onclick="actionConnectFirebase()">⚡ Simpan & Hubungkan Firebase</button>
        ${fbConfig.apiKey ? `<button class="btn-danger s" onclick="actionDisconnectFirebase()">Putuskan Koneksi Cloud (Kembali ke Lokal)</button>` : ''}
      </div>
    </div>

    <div class="card">
      <h2>Cadangan & Pemulihan Data Manual (JSON)</h2>
      <p style="color:var(--mu);font-size:13px;">
        Disarankan untuk mengunduh cadangan data klinik secara berkala untuk arsip mandiri di komputer Anda.
      </p>
      <div class="row">
        <button class="p" onclick="window.exportHelper.downloadBackup()">💾 Unduh File Cadangan (JSON)</button>
        <label>Pulihkan Data dari File Cadangan
          <input type="file" accept=".json" onchange="window.exportHelper.restoreBackup(this.files[0])">
        </label>
      </div>
    </div>
  `;
}

function uploadClinicLogo(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      const maxDim = 160;
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      store.state.set.logoImg = canvas.toDataURL('image/png');
      store.saveLocal();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function deleteClinicLogo() {
  store.state.set.logoImg = '';
  store.saveLocal();
}

function actionSaveSettings() {
  const set = store.state.set;
  set.nama = 'Klinik Assalaam Palembang';
  set.logo = val('set-logo');
  set.alamat = val('set-alamat');
  set.telp = val('set-telp');
  set.waOwner = val('set-waOwner').trim();
  set.footer = val('set-footer');
  set.warna = val('set-warna');
  set.tema = val('set-tema');
  set.font = val('set-font');
  set.perHal = parseInt(val('set-perHal'), 10) || 10;
  set.batasApproval = numVal('set-batas') || 1000000;
  set.tempoPeringatan = numVal('set-tempo') || 7;
  set.edPeringatan = numVal('set-edHari') || 60;
  set.fiturKirimWA = $('set-fiturWA') ? $('set-fiturWA').checked : true;

  const pimpinan = (store.state.users || []).find(u => u.role === 'pimpinan');
  if (pimpinan && set.waOwner) {
    pimpinan.hp = set.waOwner;
    pimpinan._t = Date.now();
  }

  store.logActivity('Ubah', 'Pengaturan', 'Pembaruan konfigurasi klinik');
  store.saveLocal();
  if (typeof broadcastQueueUpdate === 'function') broadcastQueueUpdate();
  showAlert('Pengaturan klinik berhasil disimpan!', 'Sukses');
}

function actionConnectFirebase() {
  const cfg = {
    apiKey: val('fb-apiKey').trim(),
    authDomain: val('fb-authDomain').trim(),
    projectId: val('fb-projectId').trim(),
    appId: val('fb-appId').trim()
  };

  if (!cfg.apiKey || !cfg.projectId) {
    showAlert('Mohon isi minimal API Key dan Project ID Firebase');
    return;
  }

  window.firebaseBackend.saveConfig(cfg);
  showAlert('Konfigurasi Firebase disimpan. Sistem sedang mencoba menghubungkan ke cloud Firestore...', 'Koneksi Cloud');
}

function actionDisconnectFirebase() {
  showConfirm('Putuskan koneksi cloud? Aplikasi akan kembali menyimpan data secara lokal di browser ini.', () => {
    window.firebaseBackend.disconnect();
    showAlert('Koneksi Firebase diputuskan. Aplikasi sekarang berjalan dalam Mode Lokal.', 'Mode Lokal');
    renderApp();
  });
}

// -------------------------------------------------------------
// MODULE: PENCARIAN CEPAT PASIEN LAMA (AUTO-COMPLETE)
// -------------------------------------------------------------
function searchPasienLama() {
  const inputEl = document.getElementById('p-search-lama');
  const resultsEl = document.getElementById('p-search-results');
  if (!inputEl || !resultsEl) return;
  const q = inputEl.value.toLowerCase().trim();
  if (!q || q.length < 2) {
    resultsEl.style.display = 'none';
    resultsEl.innerHTML = '';
    return;
  }

  const seen = new Set();
  const unique = [];
  (store.state.pasien || []).forEach(p => {
    if (p.deletedAt || p.status === 'dihapus') return;
    const key = (p.nama + '|' + (p.hp || '')).toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push({ nama: p.nama, hp: p.hp || '' });
    }
  });
  const filtered = unique.filter(p =>
    p.nama.toLowerCase().includes(q) || p.hp.includes(q)
  ).slice(0, 8);

  if (filtered.length === 0) {
    resultsEl.style.display = 'none';
    return;
  }
  resultsEl.style.display = 'block';
  resultsEl.innerHTML = filtered.map(p => {
    const safeName = p.nama.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const safeHp   = p.hp.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return `
      <div onclick="fillPasienLama('${safeName}','${safeHp}')"
        style="padding:10px 16px;cursor:pointer;border-bottom:1px solid var(--bdr);display:flex;gap:12px;align-items:center;transition:background .15s;"
        onmouseover="this.style.background='var(--bg)'" onmouseout="this.style.background=''">
        <span style="font-size:22px;">👤</span>
        <div>
          <div style="font-weight:700;font-size:14px;">${esc(p.nama)}</div>
          <div style="font-size:12px;color:var(--mu);">${p.hp ? esc(p.hp) : 'Tanpa Nomor HP'}</div>
        </div>
      </div>`;
  }).join('');
}

function fillPasienLama(nama, hp) {
  const namaEl  = document.getElementById('p-nama');
  const hpEl    = document.getElementById('p-hp');
  const resEl   = document.getElementById('p-search-results');
  const srchEl  = document.getElementById('p-search-lama');
  if (namaEl)  namaEl.value  = nama;
  if (hpEl)    hpEl.value    = hp;
  if (resEl)   { resEl.style.display = 'none'; resEl.innerHTML = ''; }
  if (srchEl)  srchEl.value = '';
  if (namaEl)  namaEl.focus();
}

document.addEventListener('click', e => {
  const resEl  = document.getElementById('p-search-results');
  const srchEl = document.getElementById('p-search-lama');
  if (resEl && srchEl && !srchEl.contains(e.target) && !resEl.contains(e.target)) {
    resEl.style.display = 'none';
  }
});

// -------------------------------------------------------------
// MODULE: DISPLAY TV — PENGATURAN LAYAR TV (ADMIN)
// -------------------------------------------------------------
function viewDisplayTV() {
  const set = store.state.set || {};
  const currentVideoId  = set.youtubeVideoId    || '';
  const currentText     = set.runningTextDisplay || '';
  const enableVideo     = set.enableYoutubeDisplay !== false;

  return `
    <div class="card" style="border-left:4px solid #06b6d4;">
      <h2>📺 Pengaturan Layar Display TV (HDMI Ruang Tunggu)</h2>
      <p style="color:var(--mu);font-size:13px;line-height:1.7;margin-bottom:6px;">
        Atur konten layar TV ruang tunggu pasien. Buka layar TV via tombol
        <b>📺 Buka Layar Display TV</b> di menu <b>Pasien</b> (kasir), kemudian tampilkan
        window tersebut ke monitor/TV via HDMI secara terpisah.
      </p>
    </div>

    <div class="card">
      <h2>🎬 Video Edukasi Pasien (YouTube / Video MP4)</h2>
      <div class="row" style="margin-bottom:6px;">
        <label style="flex:1;">
          Tautan Video YouTube ATAU URL Video MP4
          <input id="dtv-ytId" value="${esc(currentVideoId)}" placeholder="Contoh: https://www.youtube.com/watch?v=... ATAU https://.../video.mp4">
        </label>
      </div>

      <div style="background:var(--bg);border-left:4px solid var(--warn);padding:14px 16px;border-radius:10px;font-size:12px;color:var(--tx);line-height:1.8;margin-bottom:14px;">
        <b style="color:var(--warn);font-size:13px;">💡 Mengapa YouTube Muncul Error 153 (Meskipun dari Akun Resmi Kemenkes)?</b><br>
        Error 153 terjadi <b>bukan karena videonya rusak</b>, melainkan karena sistem YouTube <b>memblokir pemutaran video jika file HTML dibuka langsung dari harddisk komputer (protokol <code>file:///</code>)</b>.<br>
        <br>
        <b>Pilihan Solusi Terbaik untuk Klinik Anda:</b>
        <ol style="margin:6px 0 6px 18px;padding:0;">
          <li><b>Paling Direkomendasikan (Bebas Error 153 & Bebas Iklan):</b> Gunakan tombol <b>🎬 Video File Lokal</b> di pojok kanan atas Layar TV (<code>display.html</code>) untuk memilih video MP4 langsung dari komputer. Video diputar otomatis terus-menerus secara <b>offline 100% tanpa internet & tanpa iklan</b>!</li>
          <li><b>Jika Ingin Tetap Memutar YouTube:</b> Jalankan aplikasi via file <b><code>Jalankan_Klinik.bat</code></b> di folder aplikasi (klik 2x). Browser akan membuka <code>http://localhost:8080</code> dan semua video YouTube akan berputar lancar tanpa Error 153.</li>
          <li><b>Slide Tips Kesehatan Otomatis:</b> Jika kolom ini dikosongkan atau video gagal dibuka, layar TV akan otomatis menampilkan animasi <b>Slide Edukasi Kesehatan Pasien</b> yang elegan dan bermanfaat.</li>
        </ol>
      </div>

      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px;">
        <label style="display:flex;align-items:center;gap:10px;font-size:13px;font-weight:600;cursor:pointer;">
          <input id="dtv-enableYt" type="checkbox" ${enableVideo ? 'checked' : ''} style="width:18px;height:18px;">
          <span>Tayangkan video edukasi / YouTube di Layar TV Ruang Tunggu</span>
        </label>
      </div>
      <div style="margin-bottom:14px;">
        <label style="font-size:13px;font-weight:600;display:block;margin-bottom:6px;">Pratinjau Video:</label>
        <div style="max-width:440px;aspect-ratio:16/9;background:#000;border-radius:10px;overflow:hidden;position:relative;">
          <iframe id="dtv-preview-iframe" width="100%" height="100%" frameborder="0"
            allowfullscreen allow="autoplay; encrypted-media" style="border:none;display:block;"></iframe>
        </div>
        <button class="s" onclick="previewYoutubeAdmin()" style="margin-top:8px;">👁️ Tes Pratinjau Video</button>
      </div>
    </div>

    <div class="card">
      <h2>📢 Teks Berjalan (Running Text)</h2>
      <label style="display:block;margin-bottom:10px;">
        Isi Teks Berjalan di Bagian Bawah Layar TV
        <input id="dtv-runningText" value="${esc(currentText)}" placeholder="Contoh: Selamat datang di Klinik Sehat... mohon perhatikan nomor antrean Anda.">
      </label>
      <div style="background:var(--bg);padding:10px 20px;border-radius:8px;overflow:hidden;font-size:13px;color:#06b6d4;font-weight:600;">
        <span id="dtv-text-preview" style="white-space:nowrap;">${esc(currentText) || 'Pratinjau teks berjalan...'}</span>
      </div>
      <button class="s" onclick="previewRunningTextAdmin()" style="margin-top:8px;">👁️ Pratinjau Teks</button>
    </div>

    <div class="card">
      <button class="p" style="width:100%;font-size:15px;padding:14px;" onclick="actionSaveDisplayTV()">
        💾 Simpan &amp; Sinkronkan ke Layar TV
      </button>
    </div>
  `;
}

function parseYouTubeIdAdmin(input) {
  if (!input) return '';
  if (input.startsWith('videoseries') || input.startsWith('PL')) return input.trim();
  const m = input.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
  if (m) return m[1];
  if (/^[\w-]{11}$/.test(input.trim())) return input.trim();
  return '';
}

function previewYoutubeAdmin() {
  const input  = document.getElementById('dtv-ytId');
  const iframe = document.getElementById('dtv-preview-iframe');
  if (!input || !iframe) return;
  const raw = input.value.trim();
  if (!raw) { showAlert('Masukkan URL atau ID video YouTube terlebih dahulu.'); return; }
  const vid = parseYouTubeIdAdmin(raw);
  if (!vid) { showAlert('Format URL atau ID YouTube tidak dikenali. Salin URL lengkap dari YouTube.'); return; }
  iframe.src = `https://www.youtube-nocookie.com/embed/${vid}?autoplay=0&controls=1&rel=0&modestbranding=1`;
}

function previewRunningTextAdmin() {
  const input   = document.getElementById('dtv-runningText');
  const preview = document.getElementById('dtv-text-preview');
  if (!input || !preview) return;
  preview.textContent = input.value || 'Pratinjau teks berjalan...';
}

function actionSaveDisplayTV() {
  const set      = store.state.set;
  const rawYt    = document.getElementById('dtv-ytId')        ? document.getElementById('dtv-ytId').value.trim()        : '';
  const enableYt = document.getElementById('dtv-enableYt')    ? document.getElementById('dtv-enableYt').checked          : true;
  const rtxt     = document.getElementById('dtv-runningText') ? document.getElementById('dtv-runningText').value.trim() : '';

  const vid = parseYouTubeIdAdmin(rawYt);
  set.youtubeVideoId      = vid || rawYt;
  set.enableYoutubeDisplay = enableYt;
  set.runningTextDisplay  = rtxt;

  store.logActivity('Ubah', 'Display TV', `YouTube: ${set.youtubeVideoId}, Enable: ${enableYt}`);
  store.saveLocal();
  if (typeof broadcastQueueUpdate === 'function') broadcastQueueUpdate();
  showAlert('Pengaturan Layar TV berhasil disimpan dan disinkronkan!', '📺 Display TV');
}

// -------------------------------------------------------------
// MODULE: KARTU STOK OBAT (MUTASI PER ITEM)
// -------------------------------------------------------------
function viewKartuStok() {
  const obatList = (store.state.obat || []).slice().sort((a, b) => a.nama.localeCompare(b.nama));
  if (obatList.length === 0) {
    return `<div class="card"><p style="color:var(--mu);">Belum ada data obat. Tambahkan di tab <b>Obat &amp; Tarif</b> terlebih dahulu.</p></div>`;
  }
  if (!selectedKartuStokOid || !obatList.find(o => o.id === selectedKartuStokOid)) {
    selectedKartuStokOid = obatList[0].id;
  }
  const obat = obatList.find(o => o.id === selectedKartuStokOid);

  const muts = [];

  (store.state.beli || []).forEach(b => {
    (b.items || []).forEach(it => {
      if (it.oid === obat.id) {
        muts.push({ tgl: b.tgl || '', ket: `📦 Pembelian — ${b.supplier || '-'} / Faktur: ${b.faktur || '-'}`, masuk: Number(it.qty || 0), keluar: 0 });
      }
    });
  });

  (store.state.trx || []).forEach(t => {
    (t.items || []).forEach(it => {
      if (!isTrxCancelled(t) && (it.oid || it.id) === obat.id && (it.t || it.jenis) === 'Obat') {
        muts.push({ tgl: t.tgl || '', ket: `🧾 Penjualan — Nota: ${t.no || '-'} / ${t.nama || '-'}`, masuk: 0, keluar: Number(it.qty || 0) });
      }
    });
  });

  (store.state.returJual || []).forEach(r => {
    if (r.status && r.status !== 'disetujui') return;
    const qty = (r.batchRestores || []).filter(x => x.oid === obat.id).reduce((sum, x) => sum + Number(x.qty || 0), 0);
    if (qty > 0) muts.push({ tgl: r.tgl || '', ket: `↩️ Retur Penjualan — Nota: ${r.noNota || '-'}`, masuk: qty, keluar: 0 });
    (r.items || []).forEach(it => { if ((it.oid || it.id) === obat.id) muts.push({ tgl: r.tgl || '', ket: `↩️ Retur Penjualan — Nota: ${r.noNota || '-'}`, masuk: Number(it.qty || 0), keluar: 0 }); });
  });

  (store.state.returBeli || []).forEach(r => {
    (r.items || []).forEach(it => {
      if ((it.oid || it.id) === obat.id) {
        muts.push({ tgl: r.tgl || '', ket: `↪️ Retur ke Supplier — ${r.supplier || '-'}`, masuk: 0, keluar: Number(it.qty || 0) });
      }
    });
  });

  (store.state.loss || []).forEach(l => {
    if (l.oid === obat.id || l.obatId === obat.id) {
      muts.push({ tgl: l.tgl || '', ket: `⚠️ Kerugian/Opname — ${l.ket || l.keterangan || '-'}`, masuk: 0, keluar: Number(l.qty || 0) });
    }
  });

  muts.sort((a, b) => (a.tgl < b.tgl ? -1 : a.tgl > b.tgl ? 1 : 0));

  let saldo = 0;
  const ledger = muts.map(m => { saldo += m.masuk - m.keluar; return { ...m, saldo }; });

  const tableRows = ledger.length === 0
    ? `<tr><td colspan="5" style="text-align:center;padding:32px;color:var(--mu);">📭 Belum ada riwayat mutasi stok untuk item ini.</td></tr>`
    : ledger.map(m => `
      <tr style="border-bottom:1px solid var(--bdr);">
        <td style="padding:8px 12px;white-space:nowrap;">${esc(m.tgl) || '-'}</td>
        <td style="padding:8px 12px;">${m.ket}</td>
        <td style="padding:8px 12px;text-align:right;">${m.masuk  > 0 ? `<span style="color:var(--ok);font-weight:700;">+${m.masuk}</span>`  : '-'}</td>
        <td style="padding:8px 12px;text-align:right;">${m.keluar > 0 ? `<span style="color:var(--danger);font-weight:700;">-${m.keluar}</span>` : '-'}</td>
        <td style="padding:8px 12px;text-align:right;font-weight:700;">${m.saldo} <span style="font-weight:400;color:var(--mu);font-size:11px;">${esc(obat.satuan)}</span></td>
      </tr>`).join('');

  return `
    <div class="card" style="border-left:4px solid var(--pr);">
      <h2>📒 Kartu Stok Obat / Mutasi Stok</h2>
      <p style="color:var(--mu);font-size:13px;margin-bottom:14px;">
        Riwayat lengkap mutasi stok setiap item: pembelian masuk, penjualan, retur, dan kerugian/opname.
      </p>
      <div class="row" style="align-items:flex-end;gap:10px;flex-wrap:wrap;">
        <label style="flex:1;min-width:240px;">Pilih Obat / Item
          <select onchange="selectedKartuStokOid=this.value;renderApp();" style="margin-top:4px;">
            ${obatList.map(o => `<option value="${o.id}" ${o.id === obat.id ? 'selected' : ''}>${esc(o.nama)} — Stok: ${o.stok} ${esc(o.satuan)}</option>`).join('')}
          </select>
        </label>
        <button class="s" onclick="exportKartuStok()" style="white-space:nowrap;">⬇️ Ekspor CSV</button>
      </div>
    </div>

    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:16px;">
        <div>
          <div style="font-size:18px;font-weight:800;">${esc(obat.nama)}</div>
          <div style="color:var(--mu);font-size:13px;margin-top:2px;">
            HPP: ${rp(obat.hpp)} &nbsp;|&nbsp; Harga Jual: ${rp(obat.jual)} &nbsp;|&nbsp; Satuan: ${esc(obat.satuan)}
            &nbsp;|&nbsp; Stok Minimum: ${obat.min || '-'}
          </div>
        </div>
        <div style="background:var(--bg);padding:10px 24px;border-radius:12px;text-align:center;border:1.5px solid var(--bdr);">
          <div style="font-size:11px;color:var(--mu);font-weight:700;letter-spacing:1px;">STOK SISTEM</div>
          <div style="font-size:30px;font-weight:900;color:${obat.stok <= (obat.min || 0) ? 'var(--danger)' : 'var(--pr)'};">${obat.stok}</div>
          <div style="font-size:11px;color:var(--mu);">${esc(obat.satuan)}</div>
        </div>
      </div>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead>
            <tr style="background:var(--bg);text-align:left;">
              <th style="padding:10px 12px;font-weight:700;border-bottom:2px solid var(--bdr);">Tanggal</th>
              <th style="padding:10px 12px;font-weight:700;border-bottom:2px solid var(--bdr);">Keterangan</th>
              <th style="padding:10px 12px;font-weight:700;border-bottom:2px solid var(--bdr);text-align:right;">Masuk</th>
              <th style="padding:10px 12px;font-weight:700;border-bottom:2px solid var(--bdr);text-align:right;">Keluar</th>
              <th style="padding:10px 12px;font-weight:700;border-bottom:2px solid var(--bdr);text-align:right;">Saldo Stok</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
      ${ledger.length > 0 ? `<div style="margin-top:10px;font-size:12px;color:var(--mu);">Total ${ledger.length} mutasi. Saldo akhir sistem: <b>${obat.stok} ${esc(obat.satuan)}</b>.</div>` : ''}
    </div>
  `;
}

function exportKartuStok() {
  const obat = (store.state.obat || []).find(o => o.id === selectedKartuStokOid);
  if (!obat) return;
  const muts = [];
  (store.state.beli || []).forEach(b => {
    (b.items || []).forEach(it => { if (it.oid === obat.id) muts.push({ tgl: b.tgl, ket: `Pembelian - ${b.supplier||''} / ${b.faktur||''}`, masuk: Number(it.qty||0), keluar: 0 }); });
  });
  (store.state.trx || []).forEach(t => {
    if (!isTrxCancelled(t)) (t.items || []).forEach(it => { if ((it.oid||it.id) === obat.id && (it.t||it.jenis) === 'Obat') muts.push({ tgl: t.tgl, ket: `Penjualan - ${t.no||''} / ${t.nama||''}`, masuk: 0, keluar: Number(it.qty||0) }); });
  });
  (store.state.returJual || []).forEach(r => {
    if (r.status && r.status !== 'disetujui') return;
    const qty = (r.batchRestores || []).filter(x => x.oid === obat.id).reduce((sum, x) => sum + Number(x.qty || 0), 0);
    if (qty > 0) muts.push({ tgl: r.tgl, ket: `Retur Jual - ${r.noNota||''}`, masuk: qty, keluar: 0 });
    (r.items || []).forEach(it => { if ((it.oid||it.id) === obat.id) muts.push({ tgl: r.tgl, ket: `Retur Jual - ${r.noNota||''}`, masuk: Number(it.qty||0), keluar: 0 }); });
  });
  (store.state.returBeli || []).forEach(r => {
    (r.items || []).forEach(it => { if ((it.oid||it.id) === obat.id) muts.push({ tgl: r.tgl, ket: `Retur Beli - ${r.supplier||''}`, masuk: 0, keluar: Number(it.qty||0) }); });
  });
  (store.state.loss || []).forEach(l => {
    if (l.oid === obat.id || l.obatId === obat.id) muts.push({ tgl: l.tgl, ket: `Kerugian/Opname - ${l.ket||l.keterangan||''}`, masuk: 0, keluar: Number(l.qty||0) });
  });
  muts.sort((a, b) => (a.tgl < b.tgl ? -1 : 1));
  let saldo = 0;
  let csv = '\uFEFFTanggal,Keterangan,Masuk,Keluar,Saldo Stok\r\n';
  muts.forEach(m => {
    saldo += m.masuk - m.keluar;
    csv += `${m.tgl},"${(m.ket || '').replace(/"/g, '""')}",${m.masuk},${m.keluar},${saldo}\r\n`;
  });
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `kartu-stok-${obat.nama.replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// -------------------------------------------------------------
// MODULE: TAMPILAN BACA-SAJ A PIMPINAN (TANPA UBAH DATA)
// -------------------------------------------------------------
function viewPimpinanPasien() {
  const allPatients = store.state.pasien || [];
  const archiveMode = window.PAGE_STATE && window.PAGE_STATE.patientArchive === true;
  const patients = allPatients
    .filter(p => (Boolean(p.deletedAt) || p.status === 'dihapus') === archiveMode)
    .slice()
    .sort((a, b) =>
      String(b.tgl || '').localeCompare(String(a.tgl || '')) ||
      String(b.jam || '').localeCompare(String(a.jam || ''))
    );
  const rows = patients.map(p => [
    esc(p.tgl || '-'),
    esc(p.jam || '-'),
    esc(p.no || '-'),
    esc(p.nama || '-'),
    esc(p.hp || '-'),
    esc(p.layanan || '-'),
    p.deletedAt || p.status === 'dihapus' ? '<span class="badge-warn">Diarsipkan</span>' : p.status === 'batal_berobat' ? '<span class="badge-bad">Batal Berobat</span>' : p.done ? '<span class="badge-ok">Lunas</span>' : '<span class="badge-warn">Menunggu</span>',
    esc(p.kasir || '-'),
    archiveMode ? `<button class="s p" onclick="actionRestorePasien('${p.id}')">Pulihkan</button>` : (!p.done && !p.deletedAt ? `<button class="s btn-danger" onclick="delPasien('${p.id}')">Arsipkan</button>` : '-')
  ]);
  return `
    <div class="card">
      <h2>👥 Data Pasien</h2>
      <p style="color:var(--mu);font-size:13px;">Tampilan baca-saja untuk Pimpinan. Catatan arsip tetap tersimpan dan dapat dilihat melalui filter.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
        <button class="${archiveMode ? 's' : 'p'}" onclick="window.PAGE_STATE.patientArchive=false;renderApp()">Pasien Aktif</button>
        <button class="${archiveMode ? 'p' : 's'}" onclick="window.PAGE_STATE.patientArchive=true;renderApp()">Arsip Pasien</button>
      </div>
      <div style="font-weight:700;margin-bottom:10px;">Total catatan: ${patients.length}</div>
      ${renderTable(['Tanggal', 'Jam', 'No. Antrean', 'Nama Pasien', 'No. HP', 'Layanan', 'Status', 'Petugas', 'Aksi'], rows, { key: archiveMode ? 'pimpinan_pasien_arsip' : 'pimpinan_pasien_readonly' })}
    </div>
  `;
}

function actionRestorePasien(id) {
  if (currentRole !== 'pimpinan') {
    showAlert('Hanya Pimpinan yang dapat memulihkan arsip pasien.', 'Akses Ditolak');
    return;
  }
  showConfirm('Pulihkan pasien ini ke daftar pasien aktif?', () => {
    const p = store.get('pasien', id);
    if (!p || (!p.deletedAt && p.status !== 'dihapus')) {
      showAlert('Catatan arsip tidak ditemukan atau sudah aktif.', 'Informasi');
      return;
    }
    p.status = 'aktif';
    p.deletedAt = null;
    p.deletedBy = null;
    p._t = Date.now();
    store.logActivity('Pulihkan', 'Pasien', `${p.no} - ${p.nama}`);
    store.saveLocal();
    window.PAGE_STATE.patientArchive = false;
    renderApp();
  });
}

function viewPimpinanStok() {
  const obatList = (store.state.obat || []).slice().sort((a, b) => String(a.nama || '').localeCompare(String(b.nama || '')));
  const batchList = store.state.batch || [];
  const rows = obatList.map(o => {
    const batches = batchList.filter(b => b.oid === o.id);
    const activeBatches = batches.filter(b => Number(b.sisa || 0) > 0);
    const batchSummary = activeBatches.length
      ? activeBatches.map(b => `${esc(b.no || '-')} (sisa ${Number(b.sisa || 0)}, ED ${esc(b.ed || '-')})`).join('<br>')
      : 'Tidak ada batch aktif';
    const low = Number(o.stok || 0) <= Number(o.min || 0);
    return [
      esc(o.nama || '-'),
      esc(o.satuan || '-'),
      Number(o.stok || 0),
      Number(o.min || 0),
      low ? '<span class="badge-warn">Perlu perhatian</span>' : '<span class="badge-ok">Normal</span>',
      batchSummary
    ];
  });
  const totalItems = obatList.length;
  const lowItems = obatList.filter(o => Number(o.stok || 0) <= Number(o.min || 0)).length;
  return `
    <div class="card">
      <h2>💊 Stok Obat &amp; Batch</h2>
      <p style="color:var(--mu);font-size:13px;">Tampilan baca-saja untuk Pimpinan. Informasi stok berasal dari data inventori yang tersimpan; tidak ada tindakan perubahan stok di halaman ini.</p>
      <div class="row" style="gap:12px;">
        <div class="card" style="flex:1;min-width:130px;"><b>Jenis obat</b><div style="font-size:24px;font-weight:800;">${totalItems}</div></div>
        <div class="card" style="flex:1;min-width:130px;"><b>Stok perlu perhatian</b><div style="font-size:24px;font-weight:800;">${lowItems}</div></div>
      </div>
      ${renderTable(['Nama Obat', 'Satuan', 'Stok', 'Stok Minimum', 'Kondisi', 'Batch Aktif / Kedaluwarsa'], rows, { key: 'pimpinan_stok_readonly' })}
    </div>
  `;
}

// -------------------------------------------------------------
// MAIN RENDERER
// -------------------------------------------------------------
function renderApp() {
  window.renderCurrentTab = renderApp;
  const userHeaderEl = $('header-user-info');

  if (!currentUser) {
    $('login-modal').style.display = 'flex';
    $('nav-bar').innerHTML = '';
    $('main-content').innerHTML = '';
    if (userHeaderEl) userHeaderEl.textContent = '';
    return;
  }

  $('login-modal').style.display = 'none';
  if (userHeaderEl) {
    userHeaderEl.textContent = `${currentUser.nama} (${currentUser.role})`;
  }

  const tabs = ROLE_TABS[currentRole] || [];
  if (!tabs.includes(activeTab)) {
    activeTab = tabs[0];
  }

  $('nav-bar').innerHTML = tabs.map(t => `
    <button class="${t === activeTab ? 'on' : ''}" onclick="setTab('${t}')">
      <span>${TAB_ICONS[t] || '•'}</span>
      <span>${t}</span>
    </button>
  `).join('');

  let content = '';
  switch (activeTab) {
    case 'Shift': content = viewShift(); break;
    case 'Pasien': content = viewPasien(); break;
    case 'Transaksi': 
      if (!getCurrentShift()) {
        content = `
          <div class="card">
            <h2>Shift Kasir Belum Dibuka</h2>
            <p style="color:var(--mu);">Anda harus membuka shift terlebih dahulu sebelum dapat mencatat transaksi.</p>
            <button class="p" onclick="setTab('Shift')">Buka Shift Sekarang</button>
          </div>
        `;
      } else {
        content = viewTrx(); 
      }
      break;
    case 'Kas Kecil': content = viewPetty(); break;

    case 'Obat & Tarif': content = viewMaster(); break;
    case 'Paket Pelayanan': content = viewPaketPelayanan(); break;
    case 'Pembelian': content = viewPembelian(); break;
    case 'Kedaluwarsa': content = viewKedaluwarsa(); break;
    case 'Biaya': content = viewBiaya(); break;
    case 'Stok Opname': content = viewOpname(); break;
    case 'Kartu Stok': content = viewKartuStok(); break;
    case 'Riwayat Transaksi': content = viewRiwayat(); break;
    case 'Verifikasi': content = viewVerifikasi(); break;
    case 'Display TV': content = viewDisplayTV(); break;

    case 'Dashboard': content = viewDashboard(); break;
    case 'Data Pasien': content = viewPimpinanPasien(); break;
    case 'Stok Obat': content = viewPimpinanStok(); break;
    case 'Laba Rugi': content = viewLabaRugi(); break;
    case 'Arus Kas': content = viewArusKas(); break;
    case 'Utang': content = viewUtang(); break;
    case 'Approval': content = viewApproval(); break;
    case 'Pengawasan Retur': content = viewPengawasanRetur(); break;
    case 'Log Aktivitas': content = viewLog(); break;
    case 'Pengguna': content = viewPengguna(); break;
    case 'Pengaturan': content = viewPengaturan(); break;

    case 'Ekspor': content = viewEkspor(); break;

    default:
      content = '<div class="card"><p>Memuat...</p></div>';
  }

  $('main-content').innerHTML = content;

  if (activeTab === 'Dashboard') {
    setTimeout(() => {
      initDashboardCharts(calculateFinancials());
    }, 60);
  }
}

// Pintasan Keyboard Kasir (F1, F2, F3, F4, F8, Esc)
window.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const modals = ['modal-alert', 'modal-confirm', 'modal-form', 'modal-nota', 'modal-label-obat', 'modal-shift-close'];
    modals.forEach(m => {
      const el = $(m);
      if (el && el.style.display === 'flex') el.style.display = 'none';
    });
    document.body.classList.remove('printing-label');
  }

  if (e.key === 'F1') {
    e.preventDefault();
    if (currentRole === 'kasir') setTab('Shift');
  }

  if (e.key === 'F2') {
    e.preventDefault();
    if (activeTab !== 'Transaksi' && currentRole === 'kasir') setTab('Transaksi');
    setTimeout(() => {
      const searchBox = $('trx-search-input') || document.querySelector('input[placeholder="Ketik nama obat..."]');
      if (searchBox) {
        searchBox.focus();
        searchBox.select();
      }
    }, 100);
  }

  if (e.key === 'F3') {
    e.preventDefault();
    if (currentRole === 'kasir') {
      if (activeTab !== 'Pasien') setTab('Pasien');
      setTimeout(() => {
        const pNama = $('p-nama');
        if (pNama) pNama.focus();
      }, 100);
    }
  }

  if (e.key === 'F4') {
    e.preventDefault();
    if (activeTab !== 'Transaksi' && currentRole === 'kasir') setTab('Transaksi');
    setTimeout(() => {
      const payBox = $('trx-bayar-tunai');
      if (payBox) {
        payBox.focus();
        payBox.select();
      }
    }, 100);
  }

  if (e.key === 'F8') {
    e.preventDefault();
    openTvDisplay();
  }
});

// Global start
window.addEventListener('DOMContentLoaded', () => {
  initApp();
});

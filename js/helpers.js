// Dynamic External Script Loader for Lazy Loading Modules
function loadScriptAsync(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (existing.getAttribute('data-loaded') === 'true' || window.jspdf || window.Chart) {
        return resolve();
      }
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', err => reject(err));
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => {
      script.setAttribute('data-loaded', 'true');
      resolve();
    };
    script.onerror = err => reject(err);
    document.head.appendChild(script);
  });
}

async function ensurePdfLibraries() {
  if (window.jspdf && window.jspdf.jsPDF) return true;
  try {
    await loadScriptAsync('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
    await loadScriptAsync('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js');
    return !!(window.jspdf && window.jspdf.jsPDF);
  } catch (e) {
    console.error('Failed to load PDF libraries dynamically:', e);
    return false;
  }
}

async function ensureChartLibrary() {
  if (typeof window.Chart !== 'undefined') return true;
  try {
    await loadScriptAsync('https://cdn.jsdelivr.net/npm/chart.js');
    return typeof window.Chart !== 'undefined';
  } catch (e) {
    console.error('Failed to load Chart.js dynamically:', e);
    return false;
  }
}

// HTML Escaping to prevent XSS attacks
function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));
}

// Rupiah currency formatter
function rp(amount) {
  const num = Number(amount) || 0;
  return 'Rp ' + Math.round(num).toLocaleString('id-ID');
}

// Percent formatter
function pct(val, total) {
  if (!total) return '0%';
  return ((val / total) * 100).toFixed(1) + '%';
}

// Generate unique ID
function uid() {
  return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}

// Standard Browser Download Helper (replaces window.claude.use('downloads'))
function downloadFile(content, filename, mimeType = 'text/plain;charset=utf-8') {
  try {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch (err) {
    console.error('Download error:', err);
    return false;
  }
}

// DOM Selector shortcuts
const $ = id => document.getElementById(id);
const val = id => {
  const el = $(id);
  return el ? el.value : '';
};
const numVal = id => {
  const el = $(id);
  return el ? (parseFloat(el.value) || 0) : 0;
};

// Common Table Generator with pagination, custom perPage selector, and safe escaping
function renderTable(headers, rows, options = {}) {
  const tableKey = options.key || headers.join('_').replace(/\W/g, '');
  const storedPerPage = window.PAGE_STATE[tableKey + '_perPage'];
  const perPage = storedPerPage ? Number(storedPerPage) : (options.perPage || 15);
  const total = rows.length;
  const maxPage = Math.max(1, Math.ceil(total / perPage));
  const currentPage = Math.min(window.PAGE_STATE[tableKey] || 1, maxPage);

  const startIdx = (currentPage - 1) * perPage;
  const currentRows = rows.slice(startIdx, startIdx + perPage);

  let html = '<div class="w"><table><thead><tr>';
  headers.forEach(h => {
    html += `<th>${h}</th>`;
  });
  html += '</tr></thead><tbody>';

  if (currentRows.length === 0) {
    html += `<tr><td colspan="${headers.length}" style="text-align:center;color:var(--mu);padding:24px;">Belum ada data</td></tr>`;
  } else {
    currentRows.forEach(r => {
      html += '<tr>' + r.map(cell => `<td>${cell}</td>`).join('') + '</tr>';
    });
  }
  html += '</tbody></table></div>';

  if (total > 0) {
    html += `
      <div class="row" style="margin-top:12px;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
        <div style="display:flex;align-items:center;gap:12px;">
          <span style="font-size:12px;color:var(--mu)">Menampilkan ${Math.min(startIdx + 1, total)} - ${Math.min(startIdx + perPage, total)} dari ${total} data</span>
          <label style="font-size:12px;color:var(--mu);display:flex;align-items:center;gap:4px;margin:0;">
            Baris:
            <select onchange="changePerPage('${tableKey}', this.value)" style="padding:2px 6px;font-size:12px;border-radius:6px;border:1px solid var(--bdr);background:var(--bg);color:var(--tx);">
              <option value="10" ${perPage === 10 ? 'selected' : ''}>10</option>
              <option value="15" ${perPage === 15 ? 'selected' : ''}>15</option>
              <option value="25" ${perPage === 25 ? 'selected' : ''}>25</option>
              <option value="50" ${perPage === 50 ? 'selected' : ''}>50</option>
            </select>
          </label>
        </div>
        ${maxPage > 1 ? `
        <div style="display:flex;gap:6px;align-items:center;">
          <button class="s" ${currentPage <= 1 ? 'disabled' : ''} onclick="changePage('${tableKey}', 1)" title="Halaman Pertama">«</button>
          <button class="s" ${currentPage <= 1 ? 'disabled' : ''} onclick="changePage('${tableKey}', ${currentPage - 1})">‹ Sebelumnya</button>
          <span style="font-size:12px;font-weight:600;padding:0 4px;">Hal ${currentPage} / ${maxPage}</span>
          <button class="s" ${currentPage >= maxPage ? 'disabled' : ''} onclick="changePage('${tableKey}', ${currentPage + 1})">Berikutnya ›</button>
          <button class="s" ${currentPage >= maxPage ? 'disabled' : ''} onclick="changePage('${tableKey}', ${maxPage})" title="Halaman Terakhir">»</button>
        </div>
        ` : ''}
      </div>
    `;
  }

  return html;
}

window.PAGE_STATE = {};
function changePage(key, newPage) {
  window.PAGE_STATE[key] = newPage;
  if (typeof window.renderCurrentTab === 'function') {
    window.renderCurrentTab();
  }
}

function changePerPage(key, newLimit) {
  window.PAGE_STATE[key + '_perPage'] = Number(newLimit);
  window.PAGE_STATE[key] = 1;
  if (typeof window.renderCurrentTab === 'function') {
    window.renderCurrentTab();
  }
}

// Modal System (Separated from receipt modal)
function showAlert(message, title = 'Informasi') {
  const modal = $('modal-alert');
  $('modal-alert-title').textContent = title;
  $('modal-alert-body').innerHTML = `<p>${esc(message)}</p>`;
  modal.style.display = 'flex';
}

function closeAlert() {
  $('modal-alert').style.display = 'none';
}

function showConfirm(message, onConfirm, title = 'Konfirmasi') {
  const modal = $('modal-confirm');
  $('modal-confirm-title').textContent = title;
  $('modal-confirm-body').innerHTML = `<p>${esc(message)}</p>`;
  
  const btnYes = $('modal-confirm-yes');
  btnYes.onclick = () => {
    modal.style.display = 'none';
    if (typeof onConfirm === 'function') onConfirm();
  };
  
  modal.style.display = 'flex';
}

function closeConfirm() {
  $('modal-confirm').style.display = 'none';
}

// Dynamic Edit Form Modal
function showFormModal(title, fields, onSubmit) {
  const modal = $('modal-form');
  $('modal-form-title').textContent = title;
  
  let html = '';
  fields.forEach(f => {
    // f = [name, label, type, defaultValue, options]
    const id = 'form_' + f[0];
    const type = f[2] || 'text';
    const val = f[3] !== undefined ? f[3] : '';
    
    html += `<label style="display:block;margin-bottom:12px;font-size:12px;font-weight:600;color:var(--mu);">`;
    html += `${esc(f[1])}`;
    
    if (type === 'select') {
      html += `<select id="${id}" style="width:100%;margin-top:4px;">`;
      (f[4] || []).forEach(opt => {
        const selected = opt.value === val ? 'selected' : '';
        html += `<option value="${esc(opt.value)}" ${selected}>${esc(opt.label)}</option>`;
      });
      html += `</select>`;
    } else if (type === 'textarea') {
      html += `<textarea id="${id}" rows="3" style="width:100%;margin-top:4px;">${esc(val)}</textarea>`;
    } else {
      html += `<input id="${id}" type="${type}" value="${esc(val)}" style="width:100%;margin-top:4px;">`;
    }
    html += `</label>`;
  });
  
  $('modal-form-body').innerHTML = html;
  
  const submitBtn = $('modal-form-submit');
  submitBtn.onclick = () => {
    const result = {};
    fields.forEach(f => {
      const id = 'form_' + f[0];
      const el = $(id);
      if (f[2] === 'number') {
        result[f[0]] = parseFloat(el.value) || 0;
      } else {
        result[f[0]] = el ? el.value : '';
      }
    });
    modal.style.display = 'none';
    if (typeof onSubmit === 'function') onSubmit(result);
  };
  
  modal.style.display = 'flex';
}

function closeFormModal() {
  $('modal-form').style.display = 'none';
}


// TV HDMI Display Broadcast Channel
const queueBroadcast = new BroadcastChannel('klinik_queue_channel');

function broadcastCall(patient, poli) {
  try {
    queueBroadcast.postMessage({
      type: 'CALL_PATIENT',
      patient: patient,
      poli: poli || patient.layanan || 'Poli Umum'
    });
  } catch (e) {
    console.warn('BroadcastCall error:', e);
  }
}

function broadcastQueueUpdate() {
  try {
    queueBroadcast.postMessage({ type: 'QUEUE_UPDATE' });
  } catch (e) {
    console.warn('BroadcastQueueUpdate error:', e);
  }
}

function openTvDisplay() {
  window.open('display.html', 'KlinikTvDisplay', 'width=1280,height=720,menubar=no,toolbar=no,status=no');
}

// Format WhatsApp Number Helper
function formatWaNumber(hpRaw) {
  if (!hpRaw) return '';
  let hpClean = String(hpRaw).replace(/[^0-9]/g, '');
  if (hpClean.startsWith('0')) {
    hpClean = '62' + hpClean.slice(1);
  } else if (!hpClean.startsWith('62')) {
    hpClean = '62' + hpClean;
  }
  return hpClean;
}

// WhatsApp Digital Receipt Generator
function sendReceiptWA(trx, settings) {
  if (!trx) return;
  const hpClean = formatWaNumber(trx.hp || '');
  if (!hpClean) return;

  const clinicName = settings.nama || 'Klinik Assalaam Palembang';
  const clinicTelp = settings.telp || '-';
  const clinicAddr = settings.alamat || '';

  let itemsText = '';
  (trx.items || []).forEach(item => {
    itemsText += `• ${item.nama} (${item.qty}x) = ${rp(item.qty * item.harga)}\n`;
  });

  let message = `*BUKTI PEMBAYARAN - ${clinicName.toUpperCase()}*\n`;
  message += `${clinicAddr}\n`;
  message += `Telp: ${clinicTelp}\n`;
  message += `--------------------------------------\n`;
  message += `No. Nota : *${trx.no}*\n`;
  message += `Tanggal  : ${trx.tgl} ${trx.jam || ''}\n`;
  message += `Pasien   : *${trx.nama}*\n`;
  message += `Kasir    : ${trx.kasir || '-'}\n`;
  message += `--------------------------------------\n`;
  message += `*RINCIAN TRANSAKSI:*\n`;
  message += itemsText;
  message += `--------------------------------------\n`;
  message += `*TOTAL BAYAR : ${rp(trx.total)}*\n`;
  message += `Metode       : ${trx.metode || 'Tunai'}\n`;
  if (trx.metode === 'Tunai') {
    message += `Diterima     : ${rp(trx.bayar || trx.total)}\n`;
    message += `Kembalian    : ${rp(trx.kembalian || 0)}\n`;
  }
  message += `--------------------------------------\n`;
  message += `_${settings.footer || 'Terima kasih, semoga lekas sembuh.'}_\n`;

  const waUrl = `https://wa.me/${hpClean}?text=${encodeURIComponent(message)}`;
  window.open(waUrl, '_blank');
}

// Rekap Tutup Shift Kasir Otomatis ke WhatsApp Owner/Pimpinan
function sendShiftRecapWA(shift, store, customHp = null) {
  if (!shift) return { success: false, reason: 'Data shift tidak ditemukan' };
  
  const targetHp = customHp || (store.getOwnerWa ? store.getOwnerWa() : (store.state.set && store.state.set.waOwner));
  if (!targetHp) {
    return { success: false, reason: 'Nomor WhatsApp Owner/Pimpinan belum diatur pada user pimpinan' };
  }
  const hpClean = formatWaNumber(targetHp);
  if (!hpClean || hpClean.length < 9) {
    return { success: false, reason: 'Format nomor WhatsApp Owner tidak valid' };
  }

  const set = store.state.set || {};
  const clinicName = set.nama || 'Klinik Assalaam Palembang';
  const clinicAddr = set.alamat || '';
  
  // Ambil transaksi dalam shift ini
  const trxList = (store.state.trx || []).filter(t => t.sh === shift.id);
  const tunaiTrx = trxList.filter(t => t.metode === 'Tunai').reduce((s, t) => s + (t.total || 0), 0);
  const nonTunaiTrx = trxList.filter(t => t.metode !== 'Tunai').reduce((s, t) => s + (t.total || 0), 0);
  const totalOmset = tunaiTrx + nonTunaiTrx;
  const kasKecilList = (store.state.petty || []).filter(p => p.sh === shift.id);
  const kasKecil = kasKecilList.reduce((s, p) => s + (p.jml || 0), 0);
  const modalAwal = shift.modal || 0;
  const sistem = shift.sistem !== undefined ? shift.sistem : (modalAwal + tunaiTrx - kasKecil);
  const fisik = shift.fisik !== undefined ? shift.fisik : sistem;
  const selisih = shift.selisih !== undefined ? shift.selisih : (fisik - sistem);

  // Hitung per kategori
  const allItems = trxList.flatMap(t => t.items || []);
  const sumByJenis = j => allItems.filter(i => (i.t || i.jenis) === j).reduce((s, x) => s + (x.harga * x.qty), 0);
  const kons = sumByJenis('Konsultasi');
  const tind = sumByJenis('Tindakan');
  const obat = sumByJenis('Obat');
  const paket = sumByJenis('Paket');
  const disk = Math.abs(sumByJenis('Diskon'));

  let statusSelisih = '✅ *SESUAI / BALANCE (Rp 0)*';
  if (selisih > 0) {
    statusSelisih = `⚠️ *LEBIH : +${rp(selisih)}*`;
  } else if (selisih < 0) {
    statusSelisih = `❌ *KURANG : ${rp(selisih)}*`;
  }

  let message = `*📊 LAPORAN REKAP TUTUP KASIR PER SHIFT*\n`;
  message += `*${clinicName.toUpperCase()}*\n`;
  if (clinicAddr) message += `${clinicAddr}\n`;
  message += `====================================\n`;
  message += `🗓️ *Tanggal* : ${shift.tgl}\n`;
  message += `⏱️ *Waktu*   : ${shift.jam} - ${shift.jamT || new Date().toTimeString().slice(0, 5)} WIB\n`;
  message += `👤 *Kasir*   : ${shift.nama || shift.kasir || '-'}\n`;
  message += `====================================\n\n`;

  message += `*💰 REKAP ARUS KAS LACI KASIR:*\n`;
  message += `• Modal Awal Laci     : *${rp(modalAwal)}*\n`;
  message += `• Total Penjualan Tunai: *${rp(tunaiTrx)}*\n`;
  message += `• Pengeluaran Kas Kecil: *${rp(kasKecil)}*\n`;
  message += `------------------------------------\n`;
  message += `👉 *Uang Laci Sistem  : ${rp(sistem)}*\n`;
  message += `👉 *Uang Fisik Kasir  : ${rp(fisik)}*\n`;
  message += `👉 *Status Selisih    : ${statusSelisih}*\n\n`;

  message += `*📈 RINGKASAN OMSET & METODE BAYAR:*\n`;
  message += `• Total Pasien/Nota   : *${trxList.length} Transaksi*\n`;
  message += `• Pembayaran Tunai    : ${rp(tunaiTrx)}\n`;
  message += `• Non-Tunai (QRIS/Trf): ${rp(nonTunaiTrx)}\n`;
  message += `------------------------------------\n`;
  message += `⭐ *TOTAL OMSET SHIFT  : ${rp(totalOmset)}*\n\n`;

  if (kons || tind || obat || paket) {
    message += `*🏥 RINCIAN PENDAPATAN LAYANAN:*\n`;
    if (kons) message += `• Konsultasi Medis : ${rp(kons)}\n`;
    if (tind) message += `• Tindakan Medis   : ${rp(tind)}\n`;
    if (obat) message += `• Obat & Resep     : ${rp(obat)}\n`;
    if (paket) message += `• Paket Pelayanan  : ${rp(paket)}\n`;
    if (disk) message += `• Potongan Diskon  : -${rp(disk)}\n`;
    message += `------------------------------------\n\n`;
  }

  if (kasKecilList.length > 0) {
    message += `*🧾 PENGELUARAN KAS KECIL (${kasKecilList.length}):*\n`;
    kasKecilList.forEach(k => {
      message += `• ${k.ket}: ${rp(k.jml)}\n`;
    });
    message += `------------------------------------\n\n`;
  }

  message += `_Laporan otomatis dikirim oleh Sistem Keuangan Klinik saat Kasir menutup shift._`;

  const waUrl = `https://wa.me/${hpClean}?text=${encodeURIComponent(message)}`;
  window.open(waUrl, '_blank');
  return { success: true, waUrl, hp: targetHp, message };
}

// Export & Reporting Utilities: CSV, PDF, and JSON Backup

class ExportHelper {
  constructor(store) {
    this.store = store;
  }

  toCSV(headers, rows) {
    const formatCell = val => {
      const s = String(val === null || val === undefined ? '' : val).replace(/"/g, '""');
      return `"${s}"`;
    };

    const headerLine = headers.map(formatCell).join(',');
    const rowLines = rows.map(r => r.map(formatCell).join(','));
    // Tambahkan \uFEFF (UTF-8 BOM) agar langsung terbaca rapi dengan aksen/format di Microsoft Excel Windows
    return '\uFEFF' + [headerLine, ...rowLines].join('\r\n');
  }

  // Export Data Generators
  getExportData(type, filterRange = {}) {
    const s = this.store.state;
    const a = filterRange.from || '2000-01-01';
    const b = filterRange.to || '2099-12-31';
    const inRange = item => (!item.tgl || (item.tgl >= a && item.tgl <= b));

    switch (type) {
      case 'Transaksi': {
        const headers = ['Tanggal', 'No. Nota', 'Pasien', 'Kasir', 'Metode', 'Item', 'Jenis', 'Qty', 'Harga', 'Subtotal'];
        const trxList = (s.trx || []).filter(inRange);
        const rows = [];
        trxList.forEach(t => {
          (t.items || []).forEach(item => {
            rows.push([
              t.tgl,
              t.no,
              t.nama,
              t.kasir || '-',
              t.metode || 'Tunai',
              item.nama,
              item.t || item.jenis,
              item.qty,
              item.harga,
              item.qty * item.harga
            ]);
          });
        });
        return { title: 'Laporan Transaksi Kasir', headers, rows };
      }

      case 'Pasien': {
        const headers = ['Tanggal', 'No. Antrean', 'Nama Pasien', 'No. HP', 'Layanan', 'Status'];
        const list = (s.pasien || []).filter(inRange);
        const rows = list.map(p => [
          p.tgl,
          p.no,
          p.nama,
          p.hp || '-',
          p.layanan,
          p.done ? 'Lunas / Selesai' : 'Menunggu'
        ]);
        return { title: 'Laporan Kunjungan Pasien', headers, rows };
      }

      case 'Pembelian': {
        const headers = ['Tanggal', 'Supplier', 'No. Faktur', 'Obat', 'Qty Masuk', 'Total Tagihan', 'Jatuh Tempo', 'Status', 'Tgl Pelunasan'];
        const list = (s.beli || []).filter(inRange);
        const rows = list.map(item => {
          const obat = this.store.getObat(item.oid);
          return [
            item.tgl,
            item.supplier,
            item.faktur || '-',
            obat ? obat.nama : '-',
            item.qty,
            item.total,
            item.tempo || '-',
            item.lunas ? 'Lunas' : 'Belum Lunas',
            item.tglBayar || '-'
          ];
        });
        return { title: 'Laporan Pembelian & Faktur Supplier', headers, rows };
      }

      case 'Biaya': {
        const headers = ['Tanggal', 'Kategori', 'Keterangan', 'Total (Rp)', 'Status Approval'];
        const list = (s.biaya || []).filter(inRange);
        const rows = list.map(b => [
          b.tgl,
          b.kat,
          b.ket,
          b.jml,
          b.status === 'approved' ? 'Disetujui' : b.status === 'pending' ? 'Menunggu Approval' : 'Ditolak'
        ]);
        return { title: 'Laporan Biaya Operasional & Honor', headers, rows };
      }

      case 'Kas Kecil': {
        const headers = ['Tanggal', 'Petugas Kasir', 'Keterangan', 'Jumlah (Rp)'];
        const list = (s.petty || []).filter(inRange);
        const rows = list.map(p => [
          p.tgl,
          p.kasir || '-',
          p.ket,
          p.jml
        ]);
        return { title: 'Laporan Pengeluaran Kas Kecil', headers, rows };
      }

      case 'Stok Obat': {
        const headers = ['Nama Obat / Alkes', 'Satuan', 'HPP (Rp)', 'Harga Jual (Rp)', 'Sisa Stok', 'Stok Minimum', 'Status'];
        const rows = (s.obat || []).map(o => {
          const isLow = (o.stok || 0) <= (o.min || 5);
          return [
            o.nama,
            o.satuan,
            o.hpp,
            o.jual,
            o.stok,
            o.min || 5,
            isLow ? 'Menipis ⚠️' : 'Aman'
          ];
        });
        return { title: 'Laporan Stok Obat & Alkes', headers, rows };
      }

      case 'Kedaluwarsa': {
        const headers = ['Nama Obat', 'No. Batch', 'Tanggal ED', 'Sisa Stok', 'Status'];
        const today = new Date().toISOString().slice(0, 10);
        const list = (s.batch || []).filter(b => b.sisa > 0);
        const rows = list.map(b => {
          const o = this.store.getObat(b.oid);
          const diffDays = Math.round((new Date(b.ed) - new Date(today)) / 864e5);
          let status = 'Aman';
          if (diffDays < 0) status = 'KEDALUWARSA (Expired)';
          else if (diffDays <= (s.set.edPeringatan || 60)) status = `Mendekati ED (${diffDays} hari lagi)`;
          return [
            o ? o.nama : '-',
            b.no || '-',
            b.ed,
            b.sisa,
            status
          ];
        });
        return { title: 'Laporan Batch & Kedaluwarsa Obat', headers, rows };
      }

      case 'Log Aktivitas': {
        const headers = ['Waktu', 'Pengguna', 'Aksi', 'Kategori', 'Rincian'];
        const rows = (s.log || []).map(l => [
          `${l.tgl} ${l.jam}`,
          l.u,
          l.aksi,
          l.kol,
          l.rinci || ''
        ]);
        return { title: 'Laporan Log Aktivitas Audit', headers, rows };
      }

      case 'Paket Pelayanan': {
        const headers = ['Nama Paket', 'Deskripsi', 'Komponen Layanan & Obat', 'Tarif Paket (Rp)'];
        const rows = (s.paket || []).map(p => [
          p.nama,
          p.deskripsi || '-',
          (p.items || []).map(it => `${it.nama} (${it.qty}x)`).join('; '),
          p.harga
        ]);
        return { title: 'Laporan Master Paket Pelayanan', headers, rows };
      }

      default:
        return { title: 'Data Laporan', headers: [], rows: [] };
    }
  }

  exportCSV(type, filterRange) {
    const { title, headers, rows } = this.getExportData(type, filterRange);
    if (!headers.length) {
      showAlert('Tidak ada data untuk diekspor');
      return;
    }
    const csvContent = this.toCSV(headers, rows);
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `klinik-${type.toLowerCase().replace(/\s+/g, '-')}-${dateStr}.csv`;
    downloadFile(csvContent, filename, 'text/csv;charset=utf-8;');
  }

  async exportPDF(type, filterRange) {
    if (typeof window.jspdf === 'undefined') {
      showAlert('Pustaka jsPDF sedang dimuat atau koneksi terputus. Silakan gunakan Ekspor CSV.');
      return;
    }

    const { title, headers, rows } = this.getExportData(type, filterRange);
    if (!headers.length) {
      showAlert('Tidak ada data untuk diekspor');
      return;
    }

    const settings = this.store.state.set || {};
    const isLandscape = headers.length > 5;
    const doc = new window.jspdf.jsPDF({ orientation: isLandscape ? 'l' : 'p', unit: 'mm', format: 'a4' });

    // Header Dokumen
    doc.setFontSize(16);
    doc.setTextColor(15, 118, 110);
    doc.text(settings.nama || 'Klinik Sehat', 14, 15);

    doc.setFontSize(11);
    doc.setTextColor(51, 65, 85);
    doc.text(title, 14, 22);

    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    const peri = (filterRange && filterRange.from && filterRange.to)
      ? `Periode: ${filterRange.from} s/d ${filterRange.to}`
      : `Dicetak pada: ${new Date().toLocaleDateString('id-ID')}`;
    doc.text(peri, 14, 28);

    // Render Tabel jsPDF-autoTable
    doc.autoTable({
      head: [headers],
      body: rows.map(r => r.map(c => (c !== null && c !== undefined ? String(c) : ''))),
      startY: 32,
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [15, 118, 110], textColor: [255, 255, 255], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 250, 252] }
    });

    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `klinik-${type.toLowerCase().replace(/\s+/g, '-')}-${dateStr}.pdf`;
    doc.save(filename);
  }

  // Backup JSON
  downloadBackup() {
    const jsonStr = JSON.stringify(this.store.state, null, 2);
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `cadangan-klinik-lengkap-${dateStr}.json`;
    downloadFile(jsonStr, filename, 'application/json');
  }

  // Restore JSON
  restoreBackup(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const data = JSON.parse(e.target.result);
        if (!data.obat || !data.users) {
          throw new Error('Format file cadangan tidak valid');
        }
        showConfirm('PERINGATAN: Memulihkan cadangan akan menimpa seluruh data yang ada saat ini. Lanjutkan?', () => {
          this.store.state = data;
          this.store.saveLocal(true);
          showAlert('Data berhasil dipulihkan dari cadangan.', 'Sukses');
        });
      } catch (err) {
        showAlert('Gagal memulihkan cadangan: ' + err.message, 'Kesalahan');
      }
    };
    reader.readAsText(file);
  }
}

window.exportHelper = new ExportHelper(window.clinicStore);

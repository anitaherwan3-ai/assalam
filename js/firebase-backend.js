// Firebase Firestore Free Backend Adapter
// Firebase Web SDK v10 Compat - Dioptimalkan untuk Sinkronisasi Pendapatan & Anti Tumpang Tindih
// Hitung nilai bersih baris retur dari nota asli; jangan percaya nominal kiriman Kasir.
function calculateVerifiedReturnAmount(trx, itemIndex, qtyReturn, priorQty = 0) {
  const items = Array.isArray(trx && trx.items) ? trx.items : [];
  const target = items[Number(itemIndex)];
  if (!target) throw new Error('Item nota asli tidak ditemukan.');
  const rows = [];
  let grossTotal = 0, discountTotal = 0;
  items.forEach((item, index) => {
    const kind = String(item.t || item.jenis || '');
    const qty = Number(item.qty || 0), price = Number(item.harga || 0);
    if (['Diskon', 'Potongan Diskon'].includes(kind) || price < 0) {
      discountTotal += Math.round(Math.abs(price * (Number.isFinite(qty) ? qty : 1)));
      return;
    }
    const gross = Math.round(Math.max(0, qty * price));
    if (gross > 0) { rows.push({ index, gross, allocated: 0, remainder: 0 }); grossTotal += gross; }
  });
  discountTotal = Math.round(discountTotal);
  if (discountTotal > grossTotal || grossTotal <= 0) throw new Error('Nilai diskon/nota asli tidak valid.');
  let allocated = 0;
  rows.forEach(row => {
    const exact = discountTotal * row.gross / grossTotal;
    row.allocated = Math.floor(exact);
    row.remainder = exact - row.allocated;
    allocated += row.allocated;
  });
  const left = discountTotal - allocated;
  rows.slice().sort((a, b) => b.remainder - a.remainder || a.index - b.index)
    .slice(0, left).forEach(row => { row.allocated += 1; });
  const row = rows.find(entry => entry.index === Number(itemIndex));
  if (!row) throw new Error('Item nota tidak dapat diretur.');
  const lineQty = Number(target.qty || 0), before = Number(priorQty || 0), requested = Number(qtyReturn || 0);
  if (!Number.isFinite(lineQty) || lineQty <= 0 || before < 0 ||
      requested <= 0 || before + requested > lineQty) {
    throw new Error('Jumlah retur kumulatif melebihi jumlah pada nota asli.');
  }
  const net = row.gross - row.allocated;
  return Math.round(net * (before + requested) / lineQty) - Math.round(net * before / lineQty);
}

class FirebaseBackend {
  constructor(store) {
    this.store = store;
    this.app = null;
    this.db = null;
    this.auth = null;
    this.isOnline = false;
    this.listeners = [];
    this.syncQueue = Promise.resolve();
    this.debounceTimer = null;
    this.authUnsubscribe = null;
    this.currentProfile = null;
    this.init();
  }

  updateBadge(status, text) {
    const el = document.getElementById('sync-badge');
    if (!el) return;
    if (status === 'online') {
      el.className = 'sync-badge online';
      el.innerHTML = `<span>●</span> <span>Cloud: Firebase Tersambung</span>`;
    } else if (status === 'syncing') {
      el.className = 'sync-badge local';
      el.innerHTML = `<span>⏳</span> <span>Menyimpan ke Cloud...</span>`;
    } else if (status === 'error') {
      el.className = 'sync-badge local';
      el.innerHTML = `<span>⚠️</span> <span>Gagal Sinkron (${text || 'Offline'})</span>`;
    } else {
      el.className = 'sync-badge local';
      el.innerHTML = `<span>●</span> <span>Mode Lokal (Offline)</span>`;
    }
  }

  // Konfigurasi Firebase
  static DEFAULT_CONFIG = {
    apiKey: "AIzaSyBjtSu4c6ObHGM9iUHopw4uG-gGjIIswPc",
    authDomain: "assalam-db.firebaseapp.com",
    projectId: "assalam-db",
    storageBucket: "assalam-db.firebasestorage.app",
    messagingSenderId: "735617963454",
    appId: "1:735617963454:web:cea7a5ab29eb398e8855ef"
  };

  init() {
    const isProductionHost = window.location.hostname === 'klinikassalaam.vercel.app';
    let config = isProductionHost
      ? (this.store.state.firebaseConfig || FirebaseBackend.DEFAULT_CONFIG)
      : window.ASSALAM_FIREBASE_CONFIG;
    // Fail closed on Preview/local hosts: never connect to the operational Firebase project.
    if (!config || !config.apiKey || !config.projectId ||
        (!isProductionHost && config.projectId === FirebaseBackend.DEFAULT_CONFIG.projectId)) {
      this.updateBadge('error', 'Firebase khusus Preview belum dikonfigurasi');
      console.warn('Firebase Preview dinonaktifkan sampai konfigurasi database uji tersedia.');
      return;
    }
    if (isProductionHost && (!config.apiKey || !config.projectId)) config = FirebaseBackend.DEFAULT_CONFIG;
    this.store.state.firebaseConfig = config;
    this.store.saveLocal(false);
    try {
      if (typeof firebase === 'undefined') {
        console.warn('Firebase SDK belum termuat dari CDN.');
        this.updateBadge('local');
        return;
      }
      if (!firebase.apps.length) this.app = firebase.initializeApp(config);
      else this.app = firebase.app();
      this.db = firebase.firestore();
      this.auth = firebase.auth();
      // Firestore listeners start only after the Firebase account and Firestore role profile are verified.
      if (this.authUnsubscribe) this.authUnsubscribe();
      this.authUnsubscribe = this.auth.onAuthStateChanged(async user => {
        if (!user) {
          this.stopSync();
          return;
        }
        try {
          const profile = await this.verifyAuthProfile(user);
          this.currentProfile = profile;
          this.setupRealtimeListeners();
          this.isOnline = true;
          this.updateBadge('online');
          if (typeof window.onFirebaseAuthUser === 'function') {
            await window.onFirebaseAuthUser(user, profile);
          }
        } catch (err) {
          console.error('Verifikasi akun Firebase gagal:', err);
          this.stopSync();
          this.updateBadge('error', err.code || err.message);
          await this.auth.signOut().catch(() => {});
        }
      });
      this.isOnline = false;
      this.updateBadge('local');
      console.log('Firebase siap; sinkronisasi menunggu autentikasi.');
    } catch (err) {
      console.error('Inisialisasi Firebase gagal:', err);
      this.isOnline = false;
      this.updateBadge('error', err.message);
    }
  }

  ownerIdentity(email) {
    const owners = {
      'praktekrose@gmail.com': { u: 'praktekrose', nama: 'Pimpinan Utama' },
      'nursalim42@gmail.com': { u: 'pimpinan2', nama: 'Pimpinan Kedua' }
    };
    return owners[String(email || '').toLowerCase()] || null;
  }

  async ensureOwnerProfile(user) {
    if (!user || !user.email || !this.db) throw new Error('Akun Firebase tidak valid.');
    const email = user.email.toLowerCase();
    const identity = this.ownerIdentity(email);
    if (!identity) throw new Error('Email ini belum terdaftar sebagai akun Pimpinan Assalam.');
    const ref = this.db.collection('k_users').doc(identity.u);
    const snap = await ref.get();
    if (snap.exists) {
      const existing = snap.data() || {};
      if (existing.uid && existing.uid !== user.uid) {
        throw new Error('Profil Pimpinan sudah terikat ke UID lain. Demi keamanan, profil tidak diubah.');
      }
      if (existing.email && existing.email.toLowerCase() !== email) {
        throw new Error('Email profil tidak cocok dengan akun yang sedang login.');
      }
      if (existing.role && existing.role !== 'pimpinan') {
        throw new Error('Peran pada profil Firebase tidak sesuai. Profil tidak diubah.');
      }
      if (existing.active === false) {
        throw new Error('Akun Pimpinan ini dinonaktifkan. Hubungi administrator.');
      }
    }
    const profile = {
      uid: user.uid, email, u: identity.u,
      nama: (snap.exists && snap.data().nama) || identity.nama,
      role: 'pimpinan', active: true, _t: Date.now()
    };
    const profileWrite = Object.assign({}, profile);
    if (snap.exists && Object.prototype.hasOwnProperty.call(snap.data() || {}, 'pw')) {
      profileWrite.pw = firebase.firestore.FieldValue.delete();
    }
    await ref.set(profileWrite, { merge: true });
    return profile;
  }

  async verifyAuthProfile(user) {
    if (!user || !user.email || !this.db) throw new Error('Akun Firebase tidak valid.');
    const email = user.email.toLowerCase();
    if (this.ownerIdentity(email)) return this.ensureOwnerProfile(user);
    const snap = await this.db.collection('k_users').doc(email).get();
    if (!snap.exists) throw new Error('Akun belum diaktifkan oleh Pimpinan Assalam.');
    const profile = snap.data() || {};
    if (String(profile.email || '').toLowerCase() !== email) throw new Error('Email profil tidak cocok.');
    if (profile.active !== true) throw new Error('Akun ini dinonaktifkan. Hubungi Pimpinan.');
    if (!['admin', 'kasir'].includes(profile.role)) throw new Error('Hak akses akun tidak valid.');
    return Object.assign({}, profile, { email, uid: user.uid });
  }

  async provisionDefaultStaffProfiles(localUsers) {
    if (!this.auth || !this.auth.currentUser || !this.ownerIdentity(this.auth.currentUser.email)) {
      throw new Error('Hanya Pimpinan yang dapat mengaktifkan akun staf.');
    }
    const local = Array.isArray(localUsers) ? localUsers : [];
    const definitions = [
      { email: 'assalamadmin1@gmail.com', role: 'admin', u: 'admin-gudang', fallbackName: 'Admin Gudang & Keuangan' },
      { email: 'assalamkasir1@gmail.com', role: 'kasir', u: 'kasir', fallbackName: 'Kasir Shift Pagi' },
      { email: 'assalamkasir2@gmail.com', role: 'kasir', u: 'kasir2', fallbackName: 'Kasir Shift Sore' }
    ];
    const results = [];
    for (const item of definitions) {
      const prior = local.find(x => x.u === item.u || x.email === item.email ||
        (item.email === 'assalamadmin1@gmail.com' && x.role === 'admin')) || {};
      const profile = {
        email: item.email, u: item.u,
        nama: prior.nama || item.fallbackName,
        hp: prior.hp || '',
        role: item.role, active: true,
        updatedAt: Date.now()
      };
      const ref = this.db.collection('k_users').doc(item.email);
      const snap = await ref.get();
      if (snap.exists) {
        const existing = snap.data() || {};
        if (String(existing.email || '').toLowerCase() !== item.email ||
            ![item.role].includes(existing.role)) {
          throw new Error('Profil '+item.email+' sudah ada dengan data/peran berbeda. Tidak ditimpa.');
        }
        await ref.set(profile, { merge: true });
      } else {
        await ref.set(profile);
      }
      results.push(profile);
    }
    return results;
  }

  async login(email, password) {
    if (!this.auth) throw new Error('Firebase Authentication belum siap. Periksa koneksi internet.');
    const normalized = String(email || '').trim().toLowerCase();
    const credential = await this.auth.signInWithEmailAndPassword(normalized, password);
    try {
      return await this.verifyAuthProfile(credential.user);
    } catch (err) {
      await this.auth.signOut().catch(() => {});
      throw err;
    }
  }

  async resetPassword(email) {
    if (!this.auth) throw new Error('Firebase Authentication belum siap.');
    const normalized = String(email || '').trim().toLowerCase();
    const allowed = ['praktekrose@gmail.com', 'nursalim42@gmail.com',
      'assalamadmin1@gmail.com', 'assalamkasir1@gmail.com', 'assalamkasir2@gmail.com'];
    if (!allowed.includes(normalized)) throw new Error('Email belum terdaftar sebagai akun Assalam.');
    return this.auth.sendPasswordResetEmail(normalized);
  }

  stopSync() {
    this.listeners.forEach(unsub => { try { unsub(); } catch (e) {} });
    this.listeners = [];
    clearTimeout(this.debounceTimer);
    this.currentProfile = null;
    this.isOnline = false;
    this.updateBadge('local');
  }

  setupRealtimeListeners() {
    if (!this.db || !this.auth || !this.auth.currentUser) return;
    // Bersihkan listener sebelumnya agar tidak terjadi duplikasi listener
    this.listeners.forEach(unsub => {
      try { unsub(); } catch (e) {}
    });
    this.listeners = [];
    const role = this.currentProfile && this.currentProfile.role;
    let allowedCollections = this.store.COLLECTIONS.filter(name => name !== 'users');
    if (role === 'kasir') {
      allowedCollections = ['obat', 'tarif', 'paket', 'batch', 'pasien', 'trx', 'shift', 'petty', 'returJual', 'batalTrx'];
    } else if (role === 'admin') {
      allowedCollections = allowedCollections;
    } else if (role !== 'pimpinan') {
      return;
    }
    const collections = allowedCollections;

    // ==========================================
    // 1. LISTENER PENGATURAN APLIKASI & NOMOR URUT (SEQ)
    // ==========================================
    const settingsRef = this.db.doc('klinik_config/settings');
    const unsubSet = settingsRef.onSnapshot(async doc => {
      try {
        if (doc.exists) {
          const remoteData = doc.data() || {};
          if (remoteData.set && typeof remoteData.set === 'object') {
            this.store.state.set = Object.assign({}, this.store.state.set || {}, remoteData.set);
            // Tolak perubahan nama klinik dari data cloud lama/perangkat lain.
            this.store.state.set.nama = 'Klinik Assalaam Palembang';
            
            // Sinkronisasi nomor urut / sequence agar tidak tumpang tindih antar kasir/perangkat
            if (remoteData.seq && typeof remoteData.seq === 'object') {
              this.store.state.seq = Object.assign({}, this.store.state.seq || {}, remoteData.seq);
            }
            
            this.store.saveLocal(false);
            if (typeof window.renderCurrentTab === 'function') {
              window.renderCurrentTab();
            }
          }
        } else if (this.currentProfile && this.currentProfile.role === 'pimpinan') {
          console.log('Dokumen pengaturan belum tersedia. Inisialisasi oleh Pimpinan.');
          await settingsRef.set({
            set: this.store.state.set || {},
            seq: this.store.state.seq || {}
          }, { merge: true });
        }
      } catch (e) {
        console.warn('Gagal memuat/inisialisasi settings:', e);
        this.updateBadge('error', e.code || e.message);
      }
    }, err => {
      console.warn('Listener settings error:', err);
      this.updateBadge('error', err.code || err.message);
    });
    this.listeners.push(unsubSet);

    // Metadata suara antrean; audio tetap terpisah dari cache data operasional.
    const unsubQueueAudioClips = this.db.collection('klinik_config').where('type', '==', 'queue_audio_clip')
      .onSnapshot(snapshot => {
        const clips = {};
        snapshot.forEach(doc => {
          const data = doc.data() || {};
          clips[doc.id.replace(/^queueAudioClip_/, '')] = { fileName: data.fileName || '', sizeBytes: Number(data.sizeBytes || 0) };
        });
        if (typeof window.onQueueAudioClipMeta === 'function') window.onQueueAudioClipMeta(clips);
      }, err => console.warn('Listener metadata suara antrean gagal:', err));
    this.listeners.push(unsubQueueAudioClips);

    // ==========================================
    // 2. LISTENER SELURUH COLLECTION (DENGAN MERGE TIMESTAMP ANTI TUMPANG TINDIH)
    // ==========================================
    collections.forEach(colName => {
      const unsub = this.db.collection('k_' + colName).onSnapshot({ includeMetadataChanges: true }, snapshot => {
        // Hanya proses jika perubahan bukan berasal dari pending write lokal yang sedang diproses
        if (!snapshot.metadata.hasPendingWrites) {
          const remoteDocs = snapshot.docs.map(d => Object.assign({}, d.data(), { id: d.id }));
          
          if (remoteDocs.length > 0) {
            // Gunakan Map berdasarkan ID unik untuk menggabungkan data lokal dan remote secara aman
            const mergedMap = new Map();
            
            // Masukkan data lokal yang ada saat ini
            (this.store.state[colName] || []).forEach(item => {
              if (item && item.id) mergedMap.set(item.id, item);
            });
            
            // Bandingkan dan timpa dengan data remote menggunakan timestamp (_t) terbaru
            // Ini memastikan data pendapatan/transaksi tidak terhapus atau tertimpa data kosong
            remoteDocs.forEach(remoteItem => {
              if (remoteItem && remoteItem.id) {
                const localItem = mergedMap.get(remoteItem.id);
                if (colName === 'pasien' && localItem) {
                  // Field status/kepemilikan/alur kerja selalu mengikuti Cloud.
                  // Cache lokal yang pernah gagal ditulis tidak boleh menghidupkan
                  // kembali pembatalan atau pelimpahan yang ditolak Rules.
                  const mergedPatient = Object.assign({}, localItem, { id: remoteItem.id });
                  if (localItem._pendingCashierPatientEdit !== true &&
                      localItem._pendingAdminPatientEdit !== true &&
                      Number(remoteItem._t || 0) >= Number(localItem._t || 0)) {
                    if (Object.prototype.hasOwnProperty.call(remoteItem, 'nama')) mergedPatient.nama = remoteItem.nama;
                    if (Object.prototype.hasOwnProperty.call(remoteItem, 'hp')) mergedPatient.hp = remoteItem.hp;
                  }
                  [
                    'kasir', 'sh', 'queuePrefix', 'queueDisplayPrefix', 'done',
                    'status', 'calling', 'batalBerobatPada', 'batalBerobatOleh',
                    'deletedAt', 'deletedBy', 'pelimpahanDari', 'pelimpahanKe',
                    'pelimpahanAlasan', 'pelimpahanPada'
                  ].forEach(key => {
                    if (key === 'calling' && localItem._pendingCallingSync === true) return;
                    if (Object.prototype.hasOwnProperty.call(remoteItem, key)) mergedPatient[key] = remoteItem[key];
                    else delete mergedPatient[key];
                  });
                  mergedPatient._t = Math.max(Number(localItem._t || 0), Number(remoteItem._t || 0));
                  mergedMap.set(remoteItem.id, mergedPatient);
                } else if (!localItem || (remoteItem._t || 0) >= (localItem._t || 0)) {
                  mergedMap.set(remoteItem.id, remoteItem);
                } else if (colName === 'trx' && Object.prototype.hasOwnProperty.call(remoteItem, 'status')) {
                  // Status nota dari Cloud harus selalu menang, terutama status dibatalkan.
                  // Timestamp lokal tidak boleh menghidupkan kembali nota yang sudah dibatalkan.
                  mergedMap.set(remoteItem.id, Object.assign({}, localItem, {
                    status: remoteItem.status,
                    dibatalkanPada: remoteItem.dibatalkanPada,
                    dibatalkanOleh: remoteItem.dibatalkanOleh,
                    _t: Math.max(localItem._t || 0, remoteItem._t || 0)
                  }));
                } else if (colName === 'batalTrx' && Object.prototype.hasOwnProperty.call(remoteItem, 'status')) {
                  // Keputusan pembatalan Cloud harus mengalahkan cache lokal yang lebih baru.
                  mergedMap.set(remoteItem.id, Object.assign({}, localItem, remoteItem, {
                    id: remoteItem.id,
                    _t: Math.max(localItem._t || 0, remoteItem._t || 0)
                  }));
                } else if (colName === 'obat' && Object.prototype.hasOwnProperty.call(remoteItem, 'stok')) {
                  // Stok dari Cloud adalah nilai bersama lintas perangkat.
                  // Metadata lokal yang lebih baru tetap dipertahankan, tetapi angka stok
                  // selalu mengikuti dokumen Cloud agar tidak tertahan oleh _t lokal.
                  mergedMap.set(remoteItem.id, Object.assign({}, localItem, { stok: remoteItem.stok }));
                } else if (colName === 'batch' && Object.prototype.hasOwnProperty.call(remoteItem, 'sisa')) {
                  // Perlakuan yang sama untuk saldo setiap batch obat.
                  mergedMap.set(remoteItem.id, Object.assign({}, localItem, { sisa: remoteItem.sisa }));
                }
              }
            });

            this.store.state[colName] = Array.from(mergedMap.values()).sort(
              (a, b) => (a._t || 0) - (b._t || 0)
            );
            
            this.store.saveLocal(false);
            if (typeof window.renderCurrentTab === 'function') {
              window.renderCurrentTab();
            }
          }
          // =================================ol
          // KHUSUS INISIALISASI USER PERTAMA
          // ==================================
        }
      }, err => {
        console.warn(`Listener ${colName} error:`, err);
        this.updateBadge('error');
      });
      this.listeners.push(unsub);
    });
  }

  // Pengajuan pembatalan dibuat satu kali per nota; stok tidak berubah saat pengajuan.
  async submitCancelRequest(trxId, alasan) {
    const profile = this.currentProfile;
    if (!profile || profile.role !== 'kasir' || !this.db || !this.auth || !this.auth.currentUser) {
      throw new Error('Hanya Kasir yang terhubung ke Firebase dapat mengajukan pembatalan.');
    }
    const id = String(trxId);
    const trxRef = this.db.collection('k_trx').doc(id);
    const requestRef = this.db.collection('k_batalTrx').doc(id);
    const returnQuery = this.db.collection('k_returJual').where('trxId', '==', id);
    const request = {
      id, trxId: id, status: 'menunggu', kasir: profile.u,
      alasan: String(alasan || '').trim(),
      tgl: new Date().toISOString().slice(0, 10), _t: Date.now()
    };
    // Firebase compat Transaction.get hanya menerima DocumentReference, bukan Query.
    // Ambil daftar retur terlebih dahulu; Rules juga menolak retur baru selama
    // pengajuan pembatalan berstatus menunggu.
    const returnSnap = await returnQuery.get();
    await this.db.runTransaction(async transaction => {
      const trxSnap = await transaction.get(trxRef);
      const requestSnap = await transaction.get(requestRef);
      if (!trxSnap.exists) throw new Error('Nota tidak ditemukan di Cloud.');
      const trx = trxSnap.data() || {};
      if (trx.status === 'dibatalkan') throw new Error('Nota sudah dibatalkan.');
      if (requestSnap.exists && (requestSnap.data() || {}).status !== 'ditolak') {
        throw new Error('Nota ini sudah memiliki pengajuan pembatalan yang belum ditolak.');
      }
      if (returnSnap.docs.some(doc => (doc.data() || {}).status !== 'ditolak')) {
        throw new Error('Nota memiliki retur yang sedang diproses atau sudah disetujui. Pembatalan tidak dapat diajukan.');
      }
      request.noNota = trx.no || id;
      request.namaPasien = trx.nama || '-';
      if (requestSnap.exists) {
        request.alasanPenolakan = null;
        request.diverifikasiOleh = null;
        request.diverifikasiPada = null;
        transaction.update(requestRef, request);
      } else {
        transaction.set(requestRef, request);
      }
    });
    return request;
  }

  // Persetujuan/penolakan pembatalan dan pengembalian stok berlangsung atomik.
  async processCancelRequest(trxId, decision, reason) {
    const profile = this.currentProfile;
    if (!profile || !['admin', 'pimpinan'].includes(profile.role) ||
        !this.db || !this.auth || !this.auth.currentUser) {
      throw new Error('Hanya Admin/Pimpinan yang terhubung ke Firebase dapat memproses pembatalan.');
    }
    if (!['disetujui', 'ditolak'].includes(decision)) throw new Error('Keputusan pembatalan tidak valid.');
    const id = String(trxId), now = Date.now();
    const requestRef = this.db.collection('k_batalTrx').doc(id);
    const trxRef = this.db.collection('k_trx').doc(id);
    // Pemeriksaan retur dilakukan di luar transaksi karena Transaction.get
    // pada Firebase compat tidak mendukung Query. Saat request menunggu,
    // Firestore Rules menolak pembuatan retur baru untuk nota tersebut.
    const returnQuery = this.db.collection('k_returJual').where('trxId', '==', id);
    const returnSnap = decision === 'disetujui' ? await returnQuery.get() : null;
    await this.db.runTransaction(async transaction => {
      const requestSnap = await transaction.get(requestRef);
      const trxSnap = await transaction.get(trxRef);
      if (!requestSnap.exists || !trxSnap.exists) throw new Error('Pengajuan atau nota tidak ditemukan di Cloud.');
      const request = requestSnap.data() || {}, trx = trxSnap.data() || {};
      if (request.status !== 'menunggu') throw new Error('Pengajuan sudah pernah diproses.');
      if (trx.status === 'dibatalkan') throw new Error('Nota sudah dibatalkan.');
      if (decision === 'ditolak') {
        transaction.update(requestRef, {
          status: 'ditolak', alasanPenolakan: String(reason || '').trim() || 'Tidak disetujui Admin',
          diverifikasiOleh: profile.u || profile.email || '-', diverifikasiPada: now, _t: now
        });
        return;
      }
      if (returnSnap && returnSnap.docs.some(doc => (doc.data() || {}).status !== 'ditolak')) {
        throw new Error('Nota memiliki retur yang sedang diproses atau sudah disetujui. Pembatalan dibatalkan.');
      }

      const medicineQty = new Map(), batchQty = new Map(), batchOwners = new Map();
      const addMedicine = (oid, qty, deductions) => {
        const amount = Number(qty);
        if (!oid || !Number.isFinite(amount) || amount <= 0) throw new Error('Rincian obat transaksi tidak valid.');
        medicineQty.set(String(oid), (medicineQty.get(String(oid)) || 0) + amount);
        if (!Array.isArray(deductions) || !deductions.length) {
          throw new Error('Alokasi batch pada nota tidak tercatat. Pembatalan ditahan agar stok obat dan batch tidak berbeda.');
        }
        let allocated = 0;
        deductions.forEach(d => {
          const q = Number(d.qty);
          if (!d.bid || !Number.isFinite(q) || q <= 0) throw new Error('Rincian batch transaksi tidak valid.');
          allocated += q;
          const bid = String(d.bid);
          batchQty.set(bid, (batchQty.get(bid) || 0) + q);
          if (batchOwners.has(bid) && batchOwners.get(bid) !== String(oid)) throw new Error('Batch tercatat pada lebih dari satu obat.');
          batchOwners.set(bid, String(oid));
        });
        if (Math.abs(allocated - amount) > 0.000001) {
          throw new Error('Jumlah batch tidak sama dengan jumlah obat pada nota. Stok tidak diubah.');
        }
      };
      (trx.items || []).forEach(item => {
        if (item.oid) addMedicine(item.oid, item.qty, item.batchDeductions);
        else if ((item.t || item.jenis) === 'Obat' && item.id) addMedicine(item.id, item.qty, item.batchDeductions);
        else if ((item.t || item.jenis) === 'Paket' && Array.isArray(item.items)) {
          item.items.forEach(part => {
            const oid = part.type === 'obat' ? (part.oid || part.id) : '';
            if (oid) addMedicine(oid, (Number(part.qty) || 1) * Number(item.qty || 0), part.batchDeductions);
          });
        }
      });

      const medRefs = new Map(), batchRefs = new Map();
      medicineQty.forEach((qty, oid) => medRefs.set(oid, this.db.collection('k_obat').doc(oid)));
      batchQty.forEach((qty, bid) => batchRefs.set(bid, this.db.collection('k_batch').doc(bid)));
      const medSnaps = new Map(), batchSnaps = new Map();
      for (const [oid, ref] of medRefs) medSnaps.set(oid, await transaction.get(ref));
      for (const [bid, ref] of batchRefs) batchSnaps.set(bid, await transaction.get(ref));
      const patientRef = trx.pid ? this.db.collection('k_pasien').doc(String(trx.pid)) : null;
      const patientSnap = patientRef ? await transaction.get(patientRef) : null;

      for (const [oid] of medicineQty) {
        const snap = medSnaps.get(oid);
        if (!snap || !snap.exists) throw new Error('Data obat tidak ditemukan: ' + oid + '. Stok tidak diubah.');
        const stock = Number((snap.data() || {}).stok);
        if (!Number.isFinite(stock) || stock < 0) throw new Error('Saldo stok obat tidak valid: ' + oid);
      }
      for (const [bid] of batchQty) {
        const snap = batchSnaps.get(bid), data = snap && snap.exists ? snap.data() || {} : {};
        if (!snap || !snap.exists) throw new Error('Batch asal tidak ditemukan: ' + bid + '. Stok tidak diubah.');
        if (String(data.oid || '') !== batchOwners.get(bid)) throw new Error('Batch tidak cocok dengan obat pada nota: ' + bid);
        if (!Number.isFinite(Number(data.sisa)) || Number(data.sisa) < 0) throw new Error('Saldo batch tidak valid: ' + bid);
      }

      medicineQty.forEach((qty, oid) => {
        const ref = medRefs.get(oid), data = medSnaps.get(oid).data() || {};
        transaction.update(ref, { stok: Number(data.stok || 0) + qty, _t: now });
      });
      batchQty.forEach((qty, bid) => {
        const ref = batchRefs.get(bid), data = batchSnaps.get(bid).data() || {};
        transaction.update(ref, { sisa: Number(data.sisa || 0) + qty, _t: now });
      });
      if (patientRef && patientSnap && patientSnap.exists) transaction.update(patientRef, { done: false, _t: now });
      transaction.update(trxRef, {
        status: 'dibatalkan', dibatalkanPada: now,
        dibatalkanOleh: profile.u || profile.email || '-', _t: now
      });
      transaction.update(requestRef, {
        status: 'disetujui', diverifikasiOleh: profile.u || profile.email || '-',
        diverifikasiPada: now, _t: now
      });
    });
    return true;
  }

  // Pengajuan retur dan reservasi kuota dilakukan atomik di Cloud.
  returQuotaId(trxId, itemIndex) {
    return String(trxId) + '__' + String(Number(itemIndex));
  }

  async submitReturJual(returInput) {
    const profile = this.currentProfile;
    if (!profile || !['kasir', 'pimpinan'].includes(profile.role) ||
        !this.db || !this.auth || !this.auth.currentUser) {
      throw new Error('Akun Kasir/Pimpinan belum terhubung ke Firebase.');
    }
    const input = Object.assign({}, returInput || {});
    const trxId = String(input.trxId || '');
    const itemIndex = Number(input.itemIndex);
    const qty = Number(input.qty);
    if (!trxId || !Number.isInteger(itemIndex) || itemIndex < 0 ||
        !Number.isFinite(qty) || qty <= 0 || !input.id) {
      throw new Error('Data pengajuan retur tidak lengkap atau tidak valid.');
    }
    if (profile.role === 'kasir' && input.kasir !== profile.u) {
      throw new Error('Kasir hanya dapat mengajukan retur atas identitasnya sendiri.');
    }
    const trxRef = this.db.collection('k_trx').doc(trxId);
    const returRef = this.db.collection('k_returJual').doc(String(input.id));
    const quotaRef = this.db.collection('k_returKuota').doc(this.returQuotaId(trxId, itemIndex));
    const cancelRef = this.db.collection('k_batalTrx').doc(trxId);
    const now = Date.now();
    let saved = null;
    await this.db.runTransaction(async transaction => {
      const trxSnap = await transaction.get(trxRef);
      const quotaSnap = await transaction.get(quotaRef);
      const returSnap = await transaction.get(returRef);
      const cancelSnap = await transaction.get(cancelRef);
      if (!trxSnap.exists) throw new Error('Nota asli tidak ditemukan di Cloud.');
      if (returSnap.exists) throw new Error('ID pengajuan retur sudah pernah digunakan.');
      const trx = trxSnap.data() || {};
      if (trx.status === 'dibatalkan') throw new Error('Nota asli sudah dibatalkan.');
      if (cancelSnap.exists && (cancelSnap.data() || {}).status !== 'ditolak') {
        throw new Error('Nota memiliki pengajuan pembatalan yang belum ditolak.');
      }
      if (!quotaSnap.exists) {
        throw new Error('Kuota retur nota ini belum disiapkan. Minta Pimpinan menjalankan sinkronisasi kuota retur terlebih dahulu.');
      }
      const quota = quotaSnap.data() || {};
      if (String(quota.trxId) !== trxId || Number(quota.itemIndex) !== itemIndex) {
        throw new Error('Data kuota retur tidak cocok dengan nota.');
      }
      const originalItem = Array.isArray(trx.items) ? trx.items[itemIndex] : null;
      if (!originalItem) throw new Error('Item pada nota asli tidak ditemukan.');
      const priorQty = Number(quota.qtyTerpakai || 0);
      const invoiceQty = Number(originalItem.qty || 0);
      if (!Number.isFinite(priorQty) || priorQty < 0 || priorQty + qty > invoiceQty) {
        throw new Error('Jumlah retur melebihi sisa kuota pada nota asli. Muat ulang data retur.');
      }
      const jenis = String(originalItem.t || originalItem.jenis || '');
      if (String(input.namaItem || '') !== String(originalItem.nama || '') ||
          Number(input.harga) !== Number(originalItem.harga) ||
          String(input.jenis || '') !== jenis) {
        throw new Error('Rincian item retur tidak cocok dengan nota asli.');
      }
      const expectedTotal = calculateVerifiedReturnAmount(trx, itemIndex, qty, priorQty);
      if (!Number.isFinite(expectedTotal) || expectedTotal < 0) {
        throw new Error('Nominal retur dari nota asli tidak valid.');
      }
      if (!Array.isArray(input.batchRestores)) throw new Error('Rincian batch retur tidak valid.');
      // Susun ulang batch dari nota asli memakai offset kuota Cloud, bukan offset cache perangkat.
      const verifiedBatchRestores = [];
      const allocateOriginalBatches = (oid, deductions, amount, offset) => {
        if (!oid || !Array.isArray(deductions)) return amount <= 0;
        let skip = offset, left = amount;
        for (const deduction of deductions) {
          const available = Number(deduction.qty || 0);
          if (skip >= available) { skip -= available; continue; }
          const take = Math.min(left, available - skip);
          if (take > 0) {
            verifiedBatchRestores.push({
              oid, bid: String(deduction.bid || ''),
              qty: take, batchNo: deduction.batchNo || '', ed: deduction.ed || ''
            });
            left -= take;
          }
          skip = 0;
          if (left <= 0) break;
        }
        return left <= 0;
      };
      const directOid = originalItem.oid || (jenis === 'Obat' ? originalItem.id : '');
      const isPackage = jenis === 'Paket' && Array.isArray(originalItem.items);
      if (directOid && !allocateOriginalBatches(directOid, originalItem.batchDeductions, qty, priorQty)) {
        throw new Error('Batch asal pada nota tidak cukup untuk jumlah retur. Stok tidak diubah.');
      }
      if (isPackage) {
        for (const part of originalItem.items) {
          const partOid = part.type === 'obat' ? (part.oid || part.id) : '';
          const partQty = (Number(part.qty) || 1) * qty;
          const partOffset = (Number(part.qty) || 1) * priorQty;
          if (partOid && !allocateOriginalBatches(partOid, part.batchDeductions, partQty, partOffset)) {
            throw new Error('Batch obat dalam paket tidak cukup untuk jumlah retur. Stok tidak diubah.');
          }
        }
      }
      const isStockReturn = jenis === 'Obat' || (jenis === 'Paket' && verifiedBatchRestores.length > 0);
      if (isStockReturn && verifiedBatchRestores.length === 0) {
        throw new Error('Rincian batch obat asal tidak tersedia. Retur tidak dikirim.');
      }
      const returnData = Object.assign({}, input, {
        id: String(input.id), trxId, itemIndex, qty, priorQty,
        quotaId: quotaRef.id, status: 'menunggu',
        total: expectedTotal, harga: Number(originalItem.harga),
        namaItem: String(originalItem.nama || ''),
        batchRestores: verifiedBatchRestores,
        jenis, kasir: profile.role === 'kasir' ? profile.u : (input.kasir || profile.u),
        tgl: input.tgl || new Date(now).toISOString().slice(0, 10),
        _t: now
      });
      transaction.update(quotaRef, {
        qtyTerpakai: priorQty + qty,
        lastReturId: String(input.id),
        lastPriorQty: priorQty,
        lastQty: qty,
        _t: now
      });
      transaction.set(returRef, returnData);
      saved = returnData;
    });
    return saved;
  }

  // Inisialisasi kuota untuk nota lama. Dokumen yang sudah ada tidak pernah ditimpa.
  async migrateReturKuota() {
    const profile = this.currentProfile;
    if (!profile || profile.role !== 'pimpinan' ||
        !this.db || !this.auth || !this.auth.currentUser) {
      throw new Error('Hanya Pimpinan yang dapat menyiapkan kuota retur nota lama.');
    }
    const [trxSnapshot, returSnapshot] = await Promise.all([
      this.db.collection('k_trx').get(),
      this.db.collection('k_returJual').get()
    ]);
    const byTrx = new Map();
    returSnapshot.docs.forEach(doc => {
      const r = doc.data() || {};
      if (!r.trxId || r.status === 'ditolak') return;
      const key = String(r.trxId) + '__' + String(Number(r.itemIndex));
      if (!byTrx.has(key)) byTrx.set(key, []);
      byTrx.get(key).push(doc.ref);
    });
    let created = 0, existed = 0;
    for (const trxDoc of trxSnapshot.docs) {
      const trx = trxDoc.data() || {};
      if (trx.status === 'dibatalkan' || !Array.isArray(trx.items)) continue;
      for (let itemIndex = 0; itemIndex < trx.items.length; itemIndex++) {
        const quotaRef = this.db.collection('k_returKuota').doc(this.returQuotaId(trxDoc.id, itemIndex));
        const priorRefs = byTrx.get(this.returQuotaId(trxDoc.id, itemIndex)) || [];
        const didCreate = await this.db.runTransaction(async transaction => {
          const currentQuota = await transaction.get(quotaRef);
          const currentTrx = await transaction.get(trxDoc.ref);
          const priorSnaps = [];
          for (const ref of priorRefs) priorSnaps.push(await transaction.get(ref));
          if (currentQuota.exists) return false;
          if (!currentTrx.exists || (currentTrx.data() || {}).status === 'dibatalkan') return false;
          const qtyUsed = priorSnaps.reduce((sum, snap) => {
            if (!snap.exists) return sum;
            const r = snap.data() || {};
            return r.status !== 'ditolak' ? sum + Number(r.qty || 0) : sum;
          }, 0);
          transaction.set(quotaRef, {
            trxId: trxDoc.id, itemIndex,
            qtyTerpakai: qtyUsed, _t: Date.now(),
            migratedBy: profile.u || profile.email || '-'
          });
          return true;
        });
        if (didCreate) created++; else existed++;
      }
    }
    return { created, existed, invoices: trxSnapshot.size };
  }

  // Tahap pertama: Admin memverifikasi pengajuan. Stok belum disentuh.
  async approveReturJual(returId) {
    const profile = this.currentProfile;
    if (!profile || profile.role !== 'admin') {
      throw new Error('Hanya Admin yang dapat memverifikasi pengajuan retur.');
    }
    if (!this.db || !this.auth || !this.auth.currentUser) {
      throw new Error('Koneksi Firebase belum siap. Pengajuan belum diteruskan.');
    }
    const ref = this.db.collection('k_returJual').doc(String(returId));
    const now = Date.now();
    await this.db.runTransaction(async transaction => {
      const snap = await transaction.get(ref);
      if (!snap.exists || (snap.data() || {}).status !== 'menunggu') {
        throw new Error('Pengajuan tidak ditemukan atau bukan menunggu verifikasi Admin.');
      }
      transaction.update(ref, {
        status: 'menunggu_pimpinan',
        diverifikasiAdminOleh: profile.u || profile.email || '-',
        diverifikasiAdminPada: now,
        _t: now
      });
    });
    return true;
  }

  // Tahap kedua: hanya Pimpinan yang memutuskan akhir dan memulihkan stok/batch.
  async finalizeReturJual(returId) {
    const profile = this.currentProfile;
    if (!profile || profile.role !== 'pimpinan') {
      throw new Error('Hanya Pimpinan yang dapat menyetujui akhir retur dan memulihkan stok.');
    }
    if (!this.db || !this.auth || !this.auth.currentUser) {
      throw new Error('Koneksi Firebase belum siap. Retur belum disetujui.');
    }
    const returRef = this.db.collection('k_returJual').doc(String(returId));
    // Ambil ID pengajuan pada nota yang sama, lalu baca ulang dokumen-dokumennya
    // di dalam transaksi agar nominal bertahap memakai kuantitas yang telah tercatat.
    const initialReturSnap = await returRef.get();
    if (!initialReturSnap.exists) throw new Error('Pengajuan retur tidak ditemukan di cloud.');
    const initialRetur = initialReturSnap.data() || {};
    const trxId = String(initialRetur.trxId || '');
    if (!trxId) throw new Error('Referensi nota pada retur tidak valid.');
    const trxRef = this.db.collection('k_trx').doc(trxId);
    const hasStoredPriorQty = Number.isFinite(Number(initialRetur.priorQty));
    const priorRefs = hasStoredPriorQty ? [] : (await this.db.collection('k_returJual')
      .where('trxId', '==', trxId).get()).docs
      .filter(doc => doc.id !== String(returId) &&
        Number(doc.data().itemIndex) === Number(initialRetur.itemIndex) &&
        doc.data().status !== 'ditolak')
      .map(doc => doc.ref);

    await this.db.runTransaction(async transaction => {
      const returSnap = await transaction.get(returRef);
      const trxSnap = await transaction.get(trxRef);
      if (!returSnap.exists || !trxSnap.exists) throw new Error('Retur atau nota asli tidak ditemukan.');
      const retur = returSnap.data() || {}, trx = trxSnap.data() || {};
      if (retur.status !== 'menunggu_pimpinan') throw new Error('Retur belum diverifikasi Admin atau sudah pernah diproses.');
      if (trx.status === 'dibatalkan') throw new Error('Nota asli sudah dibatalkan.');
      if (!Array.isArray(retur.batchRestores)) {
        throw new Error('Rincian retur tidak valid. Stok tidak diubah.');
      }
      const priorSnaps = [];
      for (const ref of priorRefs) priorSnaps.push(await transaction.get(ref));
      const priorQty = Number.isFinite(Number(retur.priorQty))
        ? Number(retur.priorQty)
        : priorSnaps.reduce((sum, snap) => {
            if (!snap.exists) return sum;
            const prior = snap.data() || {};
            return prior.status !== 'ditolak' ? sum + Number(prior.qty || 0) : sum;
          }, 0);
      const itemIndex = Number(retur.itemIndex), qty = Number(retur.qty);
      const originalItem = Array.isArray(trx.items) ? trx.items[itemIndex] : null;
      if (!originalItem || !Number.isInteger(itemIndex) || qty <= 0 ||
          Number(retur.harga) !== Number(originalItem.harga) ||
          String(retur.namaItem || '') !== String(originalItem.nama || '')) {
        throw new Error('Rincian retur tidak cocok dengan nota asli. Retur ditahan.');
      }
      let expectedTotal;
      try {
        expectedTotal = calculateVerifiedReturnAmount(trx, itemIndex, qty, priorQty);
      } catch (err) {
        throw new Error(err.message || 'Perhitungan nominal retur tidak valid.');
      }
      if (Number(retur.total) !== expectedTotal) {
        throw new Error('Nominal retur tidak sesuai nilai bersih nota setelah diskon. Retur ditahan untuk pemeriksaan.');
      }
      const returJenis = String(retur.jenis || '');
      const originalJenis = String(originalItem.t || originalItem.jenis || '');
      if (returJenis !== originalJenis) {
        throw new Error('Jenis item retur tidak sesuai nota asli.');
      }
      // Jangan percaya batchRestores yang dikirim perangkat. Hitung ulang dari nota
      // asli dan kuota Cloud agar tidak ada stok/batch fiktif yang dapat dipulihkan.
      const verifiedBatchRestores = [];
      const allocateOriginalBatches = (oid, deductions, amount, offset) => {
        if (!oid || !Array.isArray(deductions)) return amount <= 0;
        let skip = offset, left = amount;
        for (const deduction of deductions) {
          const available = Number(deduction.qty || 0);
          if (skip >= available) { skip -= available; continue; }
          const take = Math.min(left, available - skip);
          if (take > 0) {
            verifiedBatchRestores.push({
              oid, bid: String(deduction.bid || ''), qty: take,
              batchNo: deduction.batchNo || '', ed: deduction.ed || ''
            });
            left -= take;
          }
          skip = 0;
          if (left <= 0) break;
        }
        return left <= 0;
      };
      const directOid = originalItem.oid || (returJenis === 'Obat' ? originalItem.id : '');
      const isPackage = returJenis === 'Paket' && Array.isArray(originalItem.items);
      if (directOid && !allocateOriginalBatches(directOid, originalItem.batchDeductions, qty, priorQty)) {
        throw new Error('Batch asal pada nota tidak cukup. Stok tidak diubah.');
      }
      if (isPackage) {
        for (const part of originalItem.items) {
          const partOid = part.type === 'obat' ? (part.oid || part.id) : '';
          const partQty = (Number(part.qty) || 1) * qty;
          const partOffset = (Number(part.qty) || 1) * priorQty;
          if (partOid && !allocateOriginalBatches(partOid, part.batchDeductions, partQty, partOffset)) {
            throw new Error('Batch obat dalam paket tidak cukup. Stok tidak diubah.');
          }
        }
      }
      const isStockReturn = returJenis === 'Obat' ||
        (returJenis === 'Paket' && verifiedBatchRestores.length > 0);
      if (isStockReturn && !verifiedBatchRestores.length) {
        throw new Error('Data batch asal retur obat tidak lengkap. Stok tidak diubah.');
      }
      const obatQty = new Map(), batchQty = new Map(), refs = new Map();
      verifiedBatchRestores.forEach(item => {
        const amount = Number(item.qty);
        if (!item.oid || !item.bid || !Number.isFinite(amount) || amount <= 0) {
          throw new Error('Rincian batch retur tidak valid. Stok tidak diubah.');
        }
        const obatPath = 'k_obat/' + item.oid, batchPath = 'k_batch/' + item.bid;
        obatQty.set(obatPath, (obatQty.get(obatPath) || 0) + amount);
        batchQty.set(batchPath, (batchQty.get(batchPath) || 0) + amount);
        refs.set(obatPath, this.db.doc(obatPath));
        refs.set(batchPath, this.db.doc(batchPath));
      });
      const snapshots = new Map();
      for (const [path, ref] of refs.entries()) snapshots.set(path, await transaction.get(ref));
      // Semua pembacaan selesai sebelum transaksi mulai menulis.
      for (const [path, amount] of obatQty.entries()) {
        const snap = snapshots.get(path);
        if (!snap || !snap.exists) throw new Error('Data obat asal tidak ditemukan: ' + path);
        transaction.update(refs.get(path), { stok: Number(snap.data().stok || 0) + amount, _t: Date.now() });
      }
      for (const [path, amount] of batchQty.entries()) {
        const snap = snapshots.get(path);
        if (!snap || !snap.exists) throw new Error('Batch asal tidak ditemukan: ' + path);
        transaction.update(refs.get(path), { sisa: Number(snap.data().sisa || 0) + amount, _t: Date.now() });
      }
      const approvedAt = Date.now();
      transaction.update(returRef, {
        status: 'disetujui',
        diverifikasiOleh: profile.u || profile.email || '-',
        diverifikasiPada: approvedAt,
        pengembalian: {
          status: 'menunggu',
          nominal: expectedTotal,
          metode: null,
          referensi: '',
          dibayarOleh: null,
          dibayarPada: null
        },
        _t: approvedAt
      });
    });
    return true;
  }

  // Penolakan retur dicatat melalui transaksi Cloud, bukan sinkronisasi cache lokal.
  async rejectReturJual(returId, reason) {
    const profile = this.currentProfile;
    if (!profile || !['admin', 'pimpinan'].includes(profile.role) ||
        !this.db || !this.auth || !this.auth.currentUser) {
      throw new Error('Hanya Admin/Pimpinan yang terhubung ke Firebase dapat menolak retur.');
    }
    const ref = this.db.collection('k_returJual').doc(String(returId));
    const now = Date.now();
    await this.db.runTransaction(async transaction => {
      const snap = await transaction.get(ref);
      if (!snap.exists) throw new Error('Retur tidak ditemukan.');
      const retur = snap.data() || {};
      const expectedStatus = profile.role === 'admin' ? 'menunggu' : 'menunggu_pimpinan';
      if (retur.status !== expectedStatus) {
        throw new Error(profile.role === 'admin'
          ? 'Retur bukan menunggu verifikasi Admin.'
          : 'Retur belum diverifikasi Admin atau sudah pernah diproses.');
      }
      const quotaId = retur.quotaId || (retur.trxId != null && retur.itemIndex != null
        ? this.returQuotaId(retur.trxId, retur.itemIndex) : '');
      const quotaRef = quotaId
        ? this.db.collection('k_returKuota').doc(String(quotaId))
        : null;
      const quotaSnap = quotaRef ? await transaction.get(quotaRef) : null;
      if (quotaSnap && quotaSnap.exists) {
        const quota = quotaSnap.data() || {};
        const nextQty = Number(quota.qtyTerpakai || 0) - Number(retur.qty || 0);
        if (nextQty < 0) throw new Error('Kuota retur tidak konsisten. Minta Pimpinan memeriksa data.');
        transaction.update(quotaRef, {
          qtyTerpakai: nextQty, lastReturId: String(returId),
          lastQty: -Number(retur.qty || 0), _t: now
        });
      }
      transaction.update(ref, {
        status: 'ditolak',
        alasanPenolakan: String(reason || '').trim() || 'Tidak disetujui Admin',
        diverifikasiOleh: profile.u || profile.email || '-',
        diverifikasiPada: now,
        _t: now
      });
    });
    return true;
  }

  // Pengembalian uang hanya dapat dicatat Pimpinan, terpisah dari persetujuan stok.
  async payReturJual(returId, method, reference) {
    const profile = this.currentProfile;
    if (!profile || profile.role !== 'pimpinan' ||
        !this.db || !this.auth || !this.auth.currentUser) {
      throw new Error('Hanya Pimpinan yang dapat mencatat pengembalian uang kepada pasien.');
    }
    if (!['Tunai', 'Transfer'].includes(method)) throw new Error('Metode pengembalian uang tidak valid.');
    const refText = String(reference || '').trim();
    if (method === 'Transfer' && !refText) throw new Error('Nomor referensi/bukti transfer wajib diisi.');
    const ref = this.db.collection('k_returJual').doc(String(returId));
    const now = Date.now();
    await this.db.runTransaction(async transaction => {
      const snap = await transaction.get(ref);
      if (!snap.exists) throw new Error('Data retur tidak ditemukan di Cloud.');
      const retur = snap.data() || {};
      if (retur.status !== 'disetujui') throw new Error('Retur harus mendapat persetujuan akhir Pimpinan sebelum uang dikembalikan.');
      if (!retur.pengembalian || retur.pengembalian.status !== 'menunggu') {
        throw new Error('Data retur lama perlu rekonsiliasi Pimpinan dan tidak dapat dibayar ulang dari tombol ini.');
      }
      if (retur.pengembalian.status === 'dibayar') {
        throw new Error('Pengembalian uang retur ini sudah tercatat. Tidak boleh dibayar dua kali.');
      }
      const nominal = Number(retur.total);
      if (!Number.isFinite(nominal) || nominal <= 0) throw new Error('Nominal retur tidak valid.');
      transaction.update(ref, {
        pengembalian: {
          status: 'dibayar',
          nominal,
          metode: method,
          referensi: refText,
          dibayarOleh: profile.u || profile.email || '-',
          dibayarPada: now
        },
        _t: now
      });
    });
    return true;
  }

  // =========================================================
  // PERUBAHAN STATUS PASIEN WAJIB ATOMIK DI CLOUD (PR13)
  // Cache lokal tidak boleh memindahkan kepemilikan/status pasien.
  // =========================================================
  _assertPatientWorkflowAccess() {
    if (!this.db || !this.auth || !this.auth.currentUser ||
        !this.currentProfile || !['kasir', 'pimpinan'].includes(this.currentProfile.role)) {
      throw new Error('Akun tidak memiliki akses untuk mengubah status pasien.');
    }
    return this.currentProfile;
  }

  async cancelPatientVisit(patientId) {
    const profile = this._assertPatientWorkflowAccess();
    const ref = this.db.collection('k_pasien').doc(String(patientId || ''));
    const now = Date.now();
    let updated = null;
    await this.db.runTransaction(async transaction => {
      const snap = await transaction.get(ref);
      if (!snap.exists) throw new Error('Pasien tidak ditemukan di Cloud.');
      const patient = snap.data() || {};
      if (profile.role === 'kasir' && patient.kasir !== profile.u) {
        throw new Error('Akses ditolak: pasien bukan tanggung jawab Kasir ini.');
      }
      if (patient.done === true || patient.deletedAt != null ||
          patient.status === 'dihapus' || patient.status === 'batal_berobat') {
        throw new Error('Pasien sudah selesai, diarsipkan, atau sudah Batal Berobat.');
      }
      const patch = {
        status: 'batal_berobat',
        batalBerobatPada: now,
        batalBerobatOleh: String(profile.u || profile.email || 'pimpinan'),
        calling: false,
        _t: now
      };
      transaction.update(ref, patch);
      updated = Object.assign({}, patient, patch, { id: String(patientId) });
    });
    return updated;
  }

  async restorePatientVisit(patientId) {
    const profile = this._assertPatientWorkflowAccess();
    const ref = this.db.collection('k_pasien').doc(String(patientId || ''));
    const now = Date.now();
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date(now));
    let updated = null;
    await this.db.runTransaction(async transaction => {
      const snap = await transaction.get(ref);
      if (!snap.exists) throw new Error('Pasien tidak ditemukan di Cloud.');
      const patient = snap.data() || {};
      if (profile.role === 'kasir' && patient.kasir !== profile.u) {
        throw new Error('Akses ditolak: pasien bukan tanggung jawab Kasir ini.');
      }
      if (patient.status !== 'batal_berobat' || patient.done === true || patient.tgl !== today) {
        throw new Error('Hanya pasien Batal Berobat hari ini yang dapat diaktifkan kembali.');
      }
      const patch = {
        status: 'aktif',
        batalBerobatPada: null,
        batalBerobatOleh: null,
        _t: now
      };
      transaction.update(ref, patch);
      updated = Object.assign({}, patient, patch, { id: String(patientId) });
    });
    return updated;
  }

  async handoffPatient(patientId, targetShiftId, reason) {
    const profile = this._assertPatientWorkflowAccess();
    const note = String(reason || '').trim();
    if (!String(targetShiftId || '') || note.length < 5) {
      throw new Error('Shift tujuan dan alasan minimal 5 karakter wajib diisi.');
    }
    const patientRef = this.db.collection('k_pasien').doc(String(patientId || ''));
    const shiftRef = this.db.collection('k_shift').doc(String(targetShiftId));
    const now = Date.now();
    const expectedPrefix = cashierId => {
      const id = String(cashierId || '').trim().toLowerCase();
      return id === 'kasir' ? 'A' : (id === 'kasir2' ? 'B' : '');
    };
    let updated = null;
    await this.db.runTransaction(async transaction => {
      // Semua pembacaan dilakukan sebelum penulisan agar transaksi dapat diulang aman.
      const patientSnap = await transaction.get(patientRef);
      const shiftSnap = await transaction.get(shiftRef);
      if (!patientSnap.exists) throw new Error('Pasien tidak ditemukan di Cloud.');
      if (!shiftSnap.exists) throw new Error('Shift penerima tidak ditemukan di Cloud.');
      const patient = patientSnap.data() || {};
      const target = shiftSnap.data() || {};
      if (profile.role === 'kasir' && patient.kasir !== profile.u) {
        throw new Error('Akses ditolak: pasien bukan tanggung jawab Kasir ini.');
      }
      if (patient.done === true || patient.deletedAt != null ||
          patient.status === 'dihapus' || patient.status === 'batal_berobat') {
        throw new Error('Pasien sudah selesai, diarsipkan, atau Batal Berobat.');
      }
      const targetPrefix = expectedPrefix(target.kasir);
      if (target.status !== 'buka' || !target.kasir ||
          target.kasir === patient.kasir || target.tgl !== patient.tgl) {
        throw new Error('Shift penerima harus aktif, milik Kasir lain, dan tanggalnya sama dengan tanggal pasien.');
      }
      if (!targetPrefix || String(target.queuePrefix || '').toUpperCase() !== targetPrefix) {
        throw new Error('Prefix shift penerima tidak sesuai dengan akun Kasir.');
      }
      const patch = {
        kasir: target.kasir,
        sh: String(targetShiftId),
        calling: false,
        pelimpahanDari: String(patient.kasir || ''),
        pelimpahanKe: String(target.kasir),
        pelimpahanAlasan: note,
        pelimpahanPada: now,
        queueDisplayPrefix: targetPrefix,
        _t: now
      };
      transaction.update(patientRef, patch);
      updated = Object.assign({}, patient, patch, { id: String(patientId) });
    });
    return updated;
  }

  // ==========================================
  // 3. PUSH DATA KE FIREBASE DENGAN ANTREAN AMAN (DEBOUNCE)
  // ==========================================
  // Alokasikan nomor antrean lintas perangkat secara atomik di Firestore.
  async registerPatientWithQueueNumber(patient) {
    if (!this.db || !this.auth || !this.auth.currentUser ||
        !this.currentProfile || !['kasir', 'pimpinan'].includes(this.currentProfile.role)) {
      throw new Error('Firebase belum terhubung. Pendaftaran antrean membutuhkan koneksi aktif.');
    }
    if (!patient || !/^\d{4}-\d{2}-\d{2}$/.test(String(patient.tgl || ''))) {
      throw new Error('Tanggal antrean tidak valid. Silakan muat ulang halaman.');
    }
    const date = String(patient.tgl);
    const cashierId = String(patient.kasir || '').trim().toLowerCase();
    const assignedPrefix = cashierId === 'kasir' ? 'A' : (cashierId === 'kasir2' ? 'B' : '');
    if (this.currentProfile.role === 'kasir' &&
        (patient.kasir !== this.currentProfile.u ||
         !assignedPrefix ||
         String(patient.queuePrefix || '').toUpperCase() !== assignedPrefix)) {
      throw new Error('Shift lama masih memakai prefix antrean yang berbeda. Selesaikan dan tutup shift lama, lalu buka shift baru.');
    }
    const prefix = assignedPrefix || String(patient.queuePrefix || 'A').toUpperCase();
    if (!['A', 'B'].includes(prefix)) throw new Error('Prefix antrean shift harus A atau B.');

    // Data lama tanpa prefix dianggap A agar nomor lama tidak berubah/terpakai ulang.
    const dayPatients = await this.db.collection('k_pasien')
      .where('tgl', '==', date).get({ source: 'server' });
    let existingMax = 0;
    const readQueueNumber = item => {
      const match = String(item && item.no || '').match(/^([AB])-?(\d+)$/i);
      if (!match) return 0;
      const itemPrefix = String(item.queuePrefix || match[1] || 'A').toUpperCase();
      return itemPrefix === prefix ? (Number(match[2]) || 0) : 0;
    };
    dayPatients.forEach(doc => { existingMax = Math.max(existingMax, readQueueNumber(doc.data() || {})); });
    (this.store.state.pasien || []).forEach(item => {
      if (item && item.tgl === date) existingMax = Math.max(existingMax, readQueueNumber(item));
    });
    // Sequence global lama hanya menjadi batas bawah untuk antrean A.
    if (prefix === 'A') existingMax = Math.max(existingMax, Number((this.store.state.seq || {})[date]) || 0);

    let assignedNumber = 0;
    let assignedId = '';
    await this.db.runTransaction(async transaction => {
      let candidate = existingMax + 1;
      assignedNumber = 0;
      assignedId = '';
      for (let attempt = 0; attempt < 100; attempt++, candidate++) {
        if (!Number.isSafeInteger(candidate) || candidate > 999999) break;
        // ID terpisah per tanggal dan prefix: A-001 tidak bertabrakan dengan B-001.
        const candidateId = 'q_' + date.replace(/-/g, '') + '_' + prefix + '_' +
          String(candidate).padStart(6, '0');
        const candidateRef = this.db.collection('k_pasien').doc(candidateId);
        const candidateSnap = await transaction.get(candidateRef);
        if (!candidateSnap.exists) {
          assignedNumber = candidate;
          assignedId = candidateId;
          transaction.set(candidateRef, Object.assign({}, patient, {
            id: candidateId,
            queuePrefix: prefix,
            queueDisplayPrefix: prefix,
            no: prefix + '-' + String(candidate).padStart(3, '0'),
            _t: Date.now()
          }));
          return;
        }
      }
      throw new Error('Tidak dapat memperoleh nomor antrean unik. Silakan coba kembali.');
    });
    if (!assignedId || !assignedNumber) throw new Error('Nomor antrean belum berhasil dialokasikan. Silakan coba kembali.');
    return {
      id: assignedId,
      no: prefix + '-' + String(assignedNumber).padStart(3, '0'),
      number: assignedNumber,
      prefix: prefix
    };
  }

  // Simpan transaksi Kasir dan pengurangan stok/batch dalam satu transaksi Firestore.
  async commitCashierTransaction(trx, patientId, stockChanges) {
    if (!this.db || !this.auth || !this.auth.currentUser ||
        !this.currentProfile || this.currentProfile.role !== 'kasir') {
      throw new Error('Akun Kasir belum terhubung ke Firebase.');
    }
    const trxRef = this.db.collection('k_trx').doc(String(trx.id));
    const patientRef = this.db.collection('k_pasien').doc(String(patientId));
    const changes = Array.isArray(stockChanges) ? stockChanges : [];
    const obatRefs = changes.map(x => ({
      data: x,
      ref: this.db.collection('k_obat').doc(String(x.oid))
    }));
    const batchRefs = [];
    changes.forEach(x => (x.batches || []).forEach(b => {
      batchRefs.push({ data: b, ref: this.db.collection('k_batch').doc(String(b.bid)), oid: x.oid });
    }));

    await this.db.runTransaction(async transaction => {
      const priorTrx = await transaction.get(trxRef);
      if (priorTrx.exists) return; // Idempotent: nota yang sama tidak boleh mengurangi stok dua kali.
      const patientSnap = await transaction.get(patientRef);
      const obatSnaps = [];
      for (const item of obatRefs) obatSnaps.push(await transaction.get(item.ref));
      const batchSnaps = [];
      for (const item of batchRefs) batchSnaps.push(await transaction.get(item.ref));

      for (let i = 0; i < obatRefs.length; i++) {
        const item = obatRefs[i], snap = obatSnaps[i], qty = Number(item.data.qty);
        if (!snap.exists || !Number.isFinite(qty) || qty <= 0 ||
            Number((snap.data() || {}).stok || 0) < qty) {
          throw new Error('Stok obat di server berubah atau tidak mencukupi. Muat ulang data stok sebelum transaksi.');
        }
      }
      for (let i = 0; i < batchRefs.length; i++) {
        const item = batchRefs[i], snap = batchSnaps[i], qty = Number(item.data.qty);
        if (!snap.exists || !Number.isFinite(qty) || qty <= 0 ||
            Number((snap.data() || {}).sisa || 0) < qty) {
          throw new Error('Stok batch di server berubah atau tidak mencukupi. Transaksi tidak disimpan.');
        }
      }

      const now = Date.now();
      obatRefs.forEach((item, i) => {
        const stok = Number((obatSnaps[i].data() || {}).stok || 0);
        transaction.update(item.ref, { stok: stok - Number(item.data.qty), _t: now });
      });
      batchRefs.forEach((item, i) => {
        const sisa = Number((batchSnaps[i].data() || {}).sisa || 0);
        transaction.update(item.ref, { sisa: sisa - Number(item.data.qty), _t: now });
      });
      if (patientSnap.exists) transaction.update(patientRef, { done: true, _t: now });
      transaction.set(trxRef, trx);
      (Array.isArray(trx.items) ? trx.items : []).forEach((item, itemIndex) => {
        const quotaRef = this.db.collection('k_returKuota').doc(this.returQuotaId(trx.id, itemIndex));
        transaction.set(quotaRef, {
          trxId: String(trx.id), itemIndex, qtyTerpakai: 0,
          originTrx: true, _t: now
        });
      });
    });
    return true;
  }

  pushData(state) {
    if (!this.db || !this.isOnline || !this.auth || !this.auth.currentUser) return;
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.performPush(state);
    }, 600);
  }

  async getQueueAudioClips() {
    if (!this.db || !this.auth || !this.auth.currentUser) throw new Error('Firebase belum terhubung.');
    const snap = await this.db.collection('klinik_config').where('type', '==', 'queue_audio_clip').get();
    const clips = {};
    snap.forEach(doc => { const d = doc.data() || {}; if (d.audioData) clips[doc.id.replace(/^queueAudioClip_/, '')] = d.audioData; });
    return clips;
  }

  async saveQueueAudioClip(audio) {
    if (!this.db || !this.auth || !this.auth.currentUser) throw new Error('Firebase belum terhubung.');
    const profile = this.currentProfile;
    if (!profile || !['admin', 'pimpinan'].includes(profile.role)) throw new Error('Hanya Admin atau Pimpinan yang dapat mengelola suara antrean.');
    const id = String(audio && audio.clipId || ''), data = audio && audio.audioData, size = Number(audio && audio.sizeBytes || 0);
    if (!/^(notification|prefix|suffix|letter_[A-Z]|digit_[0-9]|counter_umum|counter_gigi)$/.test(id)) throw new Error('Jenis potongan suara tidak valid.');
    if (typeof data !== 'string' || !/^data:audio\/(mpeg|mp3);base64,/i.test(data) || !Number.isFinite(size) || size <= 0 || size > 600 * 1024 || data.length > 820500) throw new Error('File harus MP3 dan berukuran maksimal 600 KB.');
    await this.db.doc('klinik_config/queueAudioClip_' + id).set({
      type:'queue_audio_clip', clipId:id, audioData:data, sizeBytes:size,
      fileName:String(audio.fileName || 'suara-antrean.mp3').slice(0,120), mimeType:'audio/mpeg',
      updatedAt:Date.now(), updatedBy:String(profile.u || profile.email || '')
    });
    return true;
  }

  async deleteQueueAudioClip(clipId) {
    if (!this.db || !this.auth || !this.auth.currentUser) throw new Error('Firebase belum terhubung.');
    const profile = this.currentProfile, id = String(clipId || '');
    if (!profile || !['admin', 'pimpinan'].includes(profile.role)) throw new Error('Hanya Admin atau Pimpinan yang dapat mengelola suara antrean.');
    if (!/^(notification|prefix|suffix|letter_[A-Z]|digit_[0-9]|counter_umum|counter_gigi)$/.test(id)) throw new Error('Jenis potongan suara tidak valid.');
    await this.db.doc('klinik_config/queueAudioClip_' + id).delete();
    return true;
  }

  async saveQueueDisplayMode(mode) {
    if (!this.db || !this.auth || !this.auth.currentUser) {
      throw new Error('Firebase belum terhubung. Pilihan display tidak disimpan.');
    }
    const profile = this.currentProfile;
    const selected = String(mode || '').toUpperCase();
    if (!profile || !['kasir', 'pimpinan'].includes(profile.role) ||
        !['A', 'B'].includes(selected)) {
      throw new Error('Akses atau pilihan antrean tidak valid.');
    }
    await this.db.doc('klinik_config/settings').update({
      'set.queueDisplayMode': selected
    });
    return true;
  }

  async saveDisplaySettings(settings) {
    if (!this.db || !this.auth || !this.auth.currentUser) {
      throw new Error('Firebase belum terhubung. Pengaturan tidak disimpan.');
    }
    const profile = this.currentProfile;
    if (!profile || !['admin', 'pimpinan'].includes(profile.role)) {
      throw new Error('Hanya Admin atau Pimpinan yang dapat mengubah pengaturan Display TV.');
    }

    this.updateBadge('syncing');
    try {
      // Simpan hanya tiga field Display TV agar konfigurasi lain tidak tertimpa.
      await this.db.doc('klinik_config/settings').set({
        set: {
          youtubeVideoId: String(settings.youtubeVideoId || ''),
          enableYoutubeDisplay: settings.enableYoutubeDisplay !== false,
          runningTextDisplay: String(settings.runningTextDisplay || '')
        }
      }, { merge: true });
      this.updateBadge('online');
      return true;
    } catch (err) {
      console.error('Simpan pengaturan Display TV ke Firebase gagal:', err);
      this.updateBadge('error', err.code || err.message);
      throw err;
    }
  }

  async performPush(state) {
    if (!this.db || !this.auth || !this.auth.currentUser) return;
    this.updateBadge('syncing');

    // Antrean mencegah beberapa proses sinkronisasi menulis bersamaan.
    this.syncQueue = this.syncQueue.then(async () => {
      try {
        const profile = this.currentProfile;
        if (!profile || !['pimpinan', 'admin', 'kasir'].includes(profile.role)) {
          throw new Error('Profil peran Firebase belum terverifikasi; sinkronisasi dibatalkan.');
        }

        // Kumpulkan operasi terlebih dahulu. Batas aman 400 operasi per batch,
        // di bawah batas maksimum Firestore 500 operasi.
        const operations = [];
        let patientSyncHadError = false;
        let patientSyncErrorText = '';

        // Pimpinan mengelola seluruh konfigurasi; Admin hanya field Display TV.
        if (profile.role === 'pimpinan') {
          operations.push({ ref: this.db.doc('klinik_config/settings'),
            data: { set: state.set || {}, seq: state.seq || {} }, merge: true });
        } else if (profile.role === 'admin') {
          const settings = state.set || {};
          operations.push({ ref: this.db.doc('klinik_config/settings'),
            data: { set: { youtubeVideoId: settings.youtubeVideoId || '',
              enableYoutubeDisplay: settings.enableYoutubeDisplay !== false,
              runningTextDisplay: settings.runningTextDisplay || '' } }, merge: true });
        }

        // Batasi penulisan berdasarkan hak akses masing-masing peran.
        let writableCollections = this.store.COLLECTIONS.filter(name => name !== 'users');
        if (profile.role === 'kasir') {
          writableCollections = ['pasien', 'shift', 'petty', 'log']; // Nota Kasir wajib dibuat melalui commitCashierTransaction agar kuota retur ikut dibuat atomik.
        } else if (profile.role === 'admin') {
          // Admin boleh mengoreksi nama/HP pasien melalui patch terbatas,
          // tetapi tidak boleh membuat pasien, transaksi, atau kas kecil.
          writableCollections = writableCollections.filter(name => !['trx', 'petty'].includes(name));
        }

        // Retur hanya ditulis Kasir saat mengajukan; keputusan dan pembayaran memakai transaksi Cloud khusus.\n        // Semua retur harus melalui submit/approve/reject/pay transaction khusus.
        writableCollections = writableCollections.filter(name => name !== 'batalTrx' && name !== 'returJual');

        for (const col of writableCollections) {
          const items = state[col] || [];
          for (const item of items) {
            if (!item) continue;
            // Kasir hanya menyinkronkan shift dan kas kecil miliknya sendiri.
            if (profile.role === 'kasir' && col === 'shift' && item.kasir !== profile.u) continue;
            if (profile.role === 'kasir' && col === 'petty' && item.kasir !== profile.u) continue;
            // Admin hanya meneruskan perubahan verifikasi shift yang sudah disetujui.
            if (profile.role === 'admin' && col === 'shift' && item.verif !== true) continue;
            // Kasir hanya boleh menyinkronkan nota yang dibuat atas identitasnya sendiri.
            // Nota kasir lain tetap tersimpan di cache lokal untuk dibaca, bukan ditulis ulang.
            if (col === 'trx' && profile.role === 'kasir' && item.kasir !== profile.u) continue;
            // Staf hanya mengirim log miliknya sendiri.
            if (col === 'log' && profile.role !== 'pimpinan' && item.u !== profile.u) continue;
            // Kasir hanya mengirim pengajuan retur miliknya yang masih menunggu.
            if (col === 'returJual' && profile.role === 'kasir' &&
                (item.kasir !== profile.u || item.status !== 'menunggu')) continue;

            // Admin hanya boleh mendorong koreksi nama/HP pasien yang sudah ada.
            // Patch terbatas mencegah cache Admin menulis ulang status, panggilan,
            // pemilik kasir, shift, atau data operasional pasien lainnya.
            if (col === 'pasien' && profile.role === 'admin') {
              const patientId = String(item.id || '');
              if (!patientId) continue;
              const editRequested = item._pendingAdminPatientEdit === true;
              const correctionRequested = item._pendingAdminDoneCorrection === true;
              if (!editRequested && !correctionRequested) continue;

              const patientRef = this.db.collection('k_pasien').doc(patientId);
              const remoteSnap = await patientRef.get();
              if (!remoteSnap.exists) continue;
              const remote = remoteSnap.data() || {};
              const localTime = Number(item._t || 0);
              const remoteTime = Number(remote._t || 0);
              if (localTime <= remoteTime) continue;

              const patch = {};
              if (editRequested) {
                ['nama', 'hp'].forEach(key => {
                  if (Object.prototype.hasOwnProperty.call(item, key) &&
                      JSON.stringify(item[key]) !== JSON.stringify(remote[key])) {
                    patch[key] = item[key];
                  }
                });
              }
              // Koreksi done:false hanya dikirim setelah Admin menekan tombol
              // koreksi secara eksplisit dan Cloud masih menunjukkan pasien selesai.
              // Cache lama tidak boleh membuka kembali pasien secara otomatis.
              if (correctionRequested && item.done === false &&
                  remote.done === true && remote.deletedAt == null &&
                  remote.status !== 'batal_berobat' && remote.status !== 'dihapus') {
                patch.done = false;
              }
              if (!Object.keys(patch).length) {
                if (correctionRequested) {
                  delete item._pendingAdminDoneCorrection;
                  this.store.saveLocal(false);
                }
                continue;
              }
              patch._t = Math.max(Date.now(), remoteTime + 1);
              const sourceFlagsToClear = [];
              if (editRequested) sourceFlagsToClear.push('_pendingAdminPatientEdit');
              if (correctionRequested) sourceFlagsToClear.push('_pendingAdminDoneCorrection');
              operations.push({
                ref: patientRef,
                data: patch,
                merge: true,
                sourceItem: item,
                sourceFlagsToClear
              });
              continue;
            }

            // Sinkronisasi umum Kasir hanya boleh membawa identitas (nama/HP)
            // dan panggilan yang secara eksplisit ditandai oleh store.callPatient.
            // Status batal/pulih, done, kepemilikan, shift, dan pelimpahan wajib
            // memakai transaksi Cloud khusus; cache tidak boleh mengirim gabungan field.
            if (col === 'pasien' && profile.role === 'kasir') {
              const patientId = String(item.id || '');
              if (!patientId) continue;
              const patientRef = this.db.collection('k_pasien').doc(patientId);
              const remoteSnap = await patientRef.get();
              if (!remoteSnap.exists) continue;
              const remote = remoteSnap.data() || {};
              if (remote.kasir !== profile.u) continue;

              const localTime = Number(item._t || 0);
              const remoteTime = Number(remote._t || 0);
              const remotePatientActive = remote.done !== true && remote.deletedAt == null &&
                remote.status !== 'dihapus' && remote.status !== 'batal_berobat';
              if (item._pendingCallingSync === true &&
                  (localTime <= remoteTime || !remotePatientActive || item.calling === remote.calling)) {
                item.calling = remote.calling === true;
                delete item._pendingCallingSync;
                this.store.saveLocal(false);
              }
              if (item._pendingCashierPatientEdit === true && localTime <= remoteTime) {
                if (Object.prototype.hasOwnProperty.call(remote, 'nama')) item.nama = remote.nama;
                if (Object.prototype.hasOwnProperty.call(remote, 'hp')) item.hp = remote.hp;
                delete item._pendingCashierPatientEdit;
                this.store.saveLocal(false);
              }
              if (localTime <= remoteTime) continue;

              const identityPatch = {};
              if (item._pendingCashierPatientEdit === true) {
                ['nama', 'hp'].forEach(key => {
                  if (Object.prototype.hasOwnProperty.call(item, key) &&
                      JSON.stringify(item[key]) !== JSON.stringify(remote[key])) {
                    identityPatch[key] = item[key];
                  }
                });
              }
              let nextTime = Math.max(Date.now(), remoteTime + 1);
              try {
                if (item._pendingCashierPatientEdit === true) {
                  if (Object.keys(identityPatch).length && localTime > remoteTime) {
                    await patientRef.update(Object.assign({}, identityPatch, { _t: nextTime }));
                    nextTime++;
                  }
                  delete item._pendingCashierPatientEdit;
                  this.store.saveLocal(false);
                }
                if (item._pendingCallingSync === true &&
                    Object.prototype.hasOwnProperty.call(item, 'calling') &&
                    remotePatientActive && item.calling !== remote.calling) {
                  await patientRef.update({ calling: item.calling === true, _t: nextTime });
                  delete item._pendingCallingSync;
                  this.store.saveLocal(false);
                }
              } catch (patientSyncError) {
                patientSyncHadError = true;
                patientSyncErrorText = patientSyncError && (patientSyncError.code || patientSyncError.message) || 'Sinkronisasi pasien gagal';
                console.error('[SYNC-DIAG] Perubahan identitas/panggilan pasien ditolak', {
                  role: profile.role, path: patientRef.path,
                  fields: [...Object.keys(identityPatch), ...(item._pendingCallingSync ? ['calling'] : [])],
                  errorCode: patientSyncError && patientSyncError.code,
                  errorMessage: patientSyncError && patientSyncError.message
                });
              }

              const workflowFields = [
                'status', 'batalBerobatPada', 'batalBerobatOleh',
                'kasir', 'sh', 'queueDisplayPrefix',
                'pelimpahanDari', 'pelimpahanKe', 'pelimpahanAlasan', 'pelimpahanPada'
              ];
              const skippedWorkflowChanges = workflowFields.filter(key =>
                JSON.stringify(item[key]) !== JSON.stringify(remote[key])
              );
              if (skippedWorkflowChanges.length) {
                console.warn('[SYNC-DIAG] Perubahan status/pelimpahan cache diabaikan; gunakan transaksi pasien khusus', {
                  path: patientRef.path, fields: skippedWorkflowChanges
                });
              }
              continue;
            }

            const payload = JSON.parse(JSON.stringify(item));
            if (!payload._t) payload._t = Date.now();

            const docId = (col === 'users') ? (payload.u || payload.id) : payload.id;

            // Log staf hanya dikirim bila benar-benar dibuat setelah mekanisme
            // penanda pending diterapkan. Kasir/Admin tidak boleh membaca k_log,
            // sehingga sinkronisasi tidak boleh melakukan get() untuk memeriksa ID.
            if (col === 'log' && profile.role !== 'pimpinan') {
              if (item._pendingSync !== true || !docId) continue;
              const logRef = this.db.collection('k_log').doc(String(docId));
              operations.push({ ref: logRef, data: payload, merge: false, sourceItem: item });
              continue;
            }
            if (docId) {
              const docRef = this.db.collection('k_' + col).doc(String(docId));
              // Hindari perangkat Admin/Pimpinan mengirim ulang saldo lokal lama
              // setelah perangkat Kasir lebih dahulu mengurangi stok di Cloud.
              // Jika dokumen Cloud lebih baru, pertahankan saldo Cloud saat push.
              if (profile.role !== 'kasir' && (col === 'obat' || col === 'batch')) {
                const remoteSnap = await docRef.get();
                if (remoteSnap.exists) {
                  const remoteItem = remoteSnap.data() || {};
                  if ((remoteItem._t || 0) >= (payload._t || 0)) {
                    if (col === 'obat' && Object.prototype.hasOwnProperty.call(remoteItem, 'stok')) {
                      payload.stok = remoteItem.stok;
                    }
                    if (col === 'batch' && Object.prototype.hasOwnProperty.call(remoteItem, 'sisa')) {
                      payload.sisa = remoteItem.sisa;
                    }
                    payload._t = Math.max(payload._t || 0, remoteItem._t || 0);
                  }
                }
              }
              operations.push({ ref: docRef, data: payload, merge: true });
            }
          }
        }

        const batchSize = 400;
        // Pisahkan batch berdasarkan koleksi agar satu aturan yang menolak tidak
        // menggagalkan penulisan koleksi lain dan sumber permission-denied terlihat jelas.
        const operationsByCollection = new Map();
        operations.forEach(op => {
          const collectionPath = op.ref && op.ref.parent && op.ref.parent.path || 'unknown';
          if (!operationsByCollection.has(collectionPath)) operationsByCollection.set(collectionPath, []);
          operationsByCollection.get(collectionPath).push(op);
        });
        for (const [collectionPath, collectionOps] of operationsByCollection) {
          for (let i = 0; i < collectionOps.length; i += batchSize) {
            const batch = this.db.batch();
            const chunk = collectionOps.slice(i, i + batchSize);
            for (const op of chunk) {
              batch.set(op.ref, op.data, { merge: op.merge });
            }
            try {
              await batch.commit();
              // Tandai log lokal sudah tersinkron hanya setelah commit Firestore berhasil.
              let syncedLog = false;
              chunk.forEach(op => {
                if (op.sourceItem && op.sourceItem._pendingSync === true) {
                  op.sourceItem._pendingSync = false;
                  syncedLog = true;
                }
                if (op.sourceItem && Array.isArray(op.sourceFlagsToClear)) {
                  op.sourceFlagsToClear.forEach(flag => delete op.sourceItem[flag]);
                  if (op.sourceFlagsToClear.length) syncedLog = true;
                }
              });
              if (syncedLog) this.store.saveLocal(false);
            } catch (batchError) {
              console.error('[SYNC-DIAG] Koleksi Firestore ditolak', {
                role: profile.role,
                collection: collectionPath,
                documentPaths: chunk.map(op => op.ref && op.ref.path).filter(Boolean),
                // Nama field saja: cukup untuk menemukan patch yang tidak cocok
                // dengan whitelist Rules, tanpa membocorkan isi data pasien.
                documentChanges: chunk.map(op => ({
                  path: op.ref && op.ref.path,
                  fields: Object.keys(op.data || {}).sort()
                })),
                errorCode: batchError && batchError.code,
                errorMessage: batchError && batchError.message
              });
              throw batchError;
            }
          }
        }

        if (patientSyncHadError) this.updateBadge('error', patientSyncErrorText);
        else this.updateBadge('online');
      } catch (err) {
        console.error('Push ke Firebase gagal:', err);
        this.updateBadge('error', err.code || err.message);
      }
    });

    return this.syncQueue;
  }
  // ==========================================
  // 4. SIMPAN KONFIGURASI FIREBASE
  // ==========================================
  async saveConfig(cfg) {
    this.stopSync();
    this.store.state.firebaseConfig = cfg;
    this.store.saveLocal(false);
    this.init();
    return true;
  }

  // ==========================================
  // 5. PUTUSKAN KONEKSI FIREBASE
  // ==========================================
  disconnect() {
    this.stopSync();
    if (this.authUnsubscribe) { this.authUnsubscribe(); this.authUnsubscribe = null; }
    if (this.auth) this.auth.signOut().catch(() => {});
    this.auth = null;
    this.db = null;
    this.app = null;
    this.isOnline = false;
    this.store.state.firebaseConfig = null;
    this.store.saveLocal(false);
    this.updateBadge('local');
  }
}

// ==========================================
// INISIALISASI BACKEND
// ==========================================
window.firebaseBackend = new FirebaseBackend(window.clinicStore);

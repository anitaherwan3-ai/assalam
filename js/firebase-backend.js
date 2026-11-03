// Firebase Firestore Free Backend Adapter
// Firebase Web SDK v10 Compat - Dioptimalkan untuk Sinkronisasi Pendapatan & Anti Tumpang Tindih
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
    let config = this.store.state.firebaseConfig;
    if (!config || !config.apiKey || !config.projectId) {
      config = FirebaseBackend.DEFAULT_CONFIG;
      this.store.state.firebaseConfig = config;
      this.store.saveLocal(false);
    }
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
      // Firestore listeners are deliberately deferred until an allowlisted owner is authenticated.
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
      { email: 'assalamkasir1@gmail.com', role: 'kasir', u: 'kasir', fallbackName: 'Kasir' }
    ];
    const results = [];
    for (const item of definitions) {
      const prior = local.find(x => x.role === item.role && x.role !== 'pimpinan') || {};
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
      'assalamadmin1@gmail.com', 'assalamkasir1@gmail.com'];
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
      allowedCollections = ['obat', 'tarif', 'paket', 'batch', 'pasien', 'trx', 'shift', 'petty'];
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

    // ==========================================
    // 2. LISTENER SELURUH COLLECTION (DENGAN MERGE TIMESTAMP ANTI TUMPANG TINDIH)
    // ==========================================
    collections.forEach(colName => {
      const unsub = this.db.collection('k_' + colName).onSnapshot(snapshot => {
        // Hanya proses jika perubahan bukan berasal dari pending write lokal yang sedang diproses
        if (!snapshot.metadata.hasPendingWrites) {
          const remoteDocs = snapshot.docs.map(d => d.data());
          
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
                if (!localItem || (remoteItem._t || 0) >= (localItem._t || 0)) {
                  mergedMap.set(remoteItem.id, remoteItem);
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

  // ==========================================
  // 3. PUSH DATA KE FIREBASE DENGAN ANTREAN AMAN (DEBOUNCE)
  // ==========================================
  pushData(state) {
    if (!this.db || !this.isOnline || !this.auth || !this.auth.currentUser) return;
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.performPush(state);
    }, 600);
  }

  async performPush(state) {
    if (!this.db || !this.auth || !this.auth.currentUser) return;
    this.updateBadge('syncing');
    
    // Gunakan antrean janji (Promise chain) untuk mencegah bentrok penulisan batch secara bersamaan
    this.syncQueue = this.syncQueue.then(async () => {
      try {
        const batch = this.db.batch();
        
        const profile = this.currentProfile;
        if (!profile || !['pimpinan', 'admin', 'kasir'].includes(profile.role)) {
          throw new Error('Profil peran Firebase belum terverifikasi; sinkronisasi dibatalkan.');
        }
        // Hanya Pimpinan yang boleh menulis pengaturan klinik dan sequence global.
        if (profile.role === 'pimpinan') {
          const setRef = this.db.doc('klinik_config/settings');
          batch.set(setRef, {
            set: state.set,
            seq: state.seq || {}
          }, { merge: true });
        }

        // Batasi penulisan berdasarkan hak akses masing-masing peran.
        let writableCollections = this.store.COLLECTIONS.filter(name => name !== 'users');
        if (profile.role === 'kasir') {
          writableCollections = ['pasien', 'trx', 'shift', 'petty', 'log'];
        }
        for (const col of writableCollections) {
          const items = state[col] || [];
          for (const item of items) {
            if (!item) continue;
            // Staf hanya boleh mengirim log aktivitas miliknya sendiri.
            if (col === 'log' && profile.role !== 'pimpinan' && item.u !== profile.u) continue;
            // Pastikan setiap item memiliki properti _t (timestamp) agar sinkronisasi akurat
            if (!item._t) {
              item._t = Date.now();
            }
            
            const docId = (col === 'users') ? (item.u || item.id) : item.id;
            if (docId) {
              const docRef = this.db.collection('k_' + col).doc(String(docId));
              batch.set(docRef, JSON.parse(JSON.stringify(item)), { merge: true });
            }
          }
        }

        await batch.commit();
        this.updateBadge('online');
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

// Firebase Firestore Free Backend Adapter
// Menggunakan Firebase Web SDK v10 Compat (CDN) - 100% Gratis di Google Firebase Spark Plan

class FirebaseBackend {
  constructor(store) {
    this.store = store;
    this.app = null;
    this.db = null;
    this.isOnline = false;
    this.listeners = [];
    this.syncQueue = Promise.resolve();
    this.debounceTimer = null;
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

  init() {
    const config = this.store.state.firebaseConfig;
    if (!config || !config.apiKey || !config.projectId) {
      this.updateBadge('local');
      return;
    }

    try {
      if (typeof firebase === 'undefined') {
        console.warn('Firebase SDK belum termuat dari CDN.');
        this.updateBadge('local');
        return;
      }

      // Inisialisasi Firebase App
      if (!firebase.apps.length) {
        this.app = firebase.initializeApp(config);
      } else {
        this.app = firebase.app();
      }

      this.db = firebase.firestore();
      
      // Setup Realtime Listeners
      this.setupRealtimeListeners();
      this.isOnline = true;
      this.updateBadge('online');
      console.log('Firebase Firestore terhubung!');
    } catch (err) {
      console.error('Koneksi Firebase gagal:', err);
      this.isOnline = false;
      this.updateBadge('error', err.message);
    }
  }

  setupRealtimeListeners() {
    if (!this.db) return;

    // Bersihkan listener sebelumnya
    this.listeners.forEach(unsub => {
      try { unsub(); } catch (e) {}
    });
    this.listeners = [];

    const collections = this.store.COLLECTIONS;

    // Listen settings
    const unsubSet = this.db.doc('klinik_config/settings').onSnapshot(doc => {
      if (doc.exists) {
        const remoteData = doc.data();
        if (remoteData && remoteData.set) {
          this.store.state.set = Object.assign({}, this.store.state.set, remoteData.set);
          this.store.saveLocal(false);
        }
      }
    }, err => {
      console.warn('Listener settings error:', err);
    });
    this.listeners.push(unsubSet);

    // Listen each collection
    collections.forEach(colName => {
      const unsub = this.db.collection('k_' + colName).onSnapshot(snapshot => {
        if (!snapshot.metadata.hasPendingWrites) {
          const docs = snapshot.docs.map(d => d.data());
          if (docs.length > 0 || this.store.state[colName].length > 0) {
            // Urutkan data berdasarkan waktu dibuat
            this.store.state[colName] = docs.sort((a, b) => (a._t || 0) - (b._t || 0));
            this.store.saveLocal(false);
          }
        }
      }, err => {
        console.warn(`Listener ${colName} error:`, err);
        this.updateBadge('error');
      });
      this.listeners.push(unsub);
    });
  }

  pushData(state) {
    if (!this.db || !this.isOnline) return;

    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.performPush(state);
    }, 600);
  }

  async performPush(state) {
    if (!this.db) return;
    this.updateBadge('syncing');

    try {
      const batch = this.db.batch();

      // Sinkron pengaturan
      const setRef = this.db.doc('klinik_config/settings');
      batch.set(setRef, { set: state.set, seq: state.seq || {} }, { merge: true });

      // Sinkron collections penting
      for (const col of this.store.COLLECTIONS) {
        const items = state[col] || [];
        for (const item of items) {
          if (item && item.id) {
            const docRef = this.db.collection('k_' + col).doc(String(item.id));
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
  }

  async saveConfig(cfg) {
    this.store.state.firebaseConfig = cfg;
    this.store.saveLocal(false);
    this.init();
    return true;
  }

  disconnect() {
    this.listeners.forEach(unsub => {
      try { unsub(); } catch (e) {}
    });
    this.listeners = [];
    this.db = null;
    this.app = null;
    this.isOnline = false;
    this.store.state.firebaseConfig = null;
    this.store.saveLocal(false);
    this.updateBadge('local');
  }
}

window.firebaseBackend = new FirebaseBackend(window.clinicStore);

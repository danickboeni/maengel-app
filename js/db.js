// Datenhaltung in IndexedDB. Alle Daten bleiben auf dem Gerät.
// Stores: plaetze, maengel (Index platzId), fotos (Bilddaten getrennt, damit Listen schnell bleiben).

const DB_NAME = 'maengelapp';
const DB_VERSION = 1;

let dbPromise = null;

function oeffnen() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const anfrage = indexedDB.open(DB_NAME, DB_VERSION);
      anfrage.onupgradeneeded = () => {
        const db = anfrage.result;
        if (!db.objectStoreNames.contains('plaetze')) {
          db.createObjectStore('plaetze', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('maengel')) {
          const s = db.createObjectStore('maengel', { keyPath: 'id' });
          s.createIndex('platzId', 'platzId', { unique: false });
        }
        if (!db.objectStoreNames.contains('fotos')) {
          db.createObjectStore('fotos', { keyPath: 'id' });
        }
      };
      anfrage.onsuccess = () => resolve(anfrage.result);
      anfrage.onerror = () => reject(anfrage.error);
      anfrage.onblocked = () => reject(new Error('Datenbank ist blockiert. Bitte andere Fenster der App schliessen.'));
    });
    dbPromise.catch(() => { dbPromise = null; });
  }
  return dbPromise;
}

// Führt fn(transaktion) aus. fn darf nur IndexedDB-Anfragen absetzen (keine anderen await),
// damit die Transaktion nicht vorzeitig endet. Rückgabe: Wert aus fn nach Abschluss.
async function transaktion(stores, modus, fn) {
  const db = await oeffnen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, modus);
    const ergebnis = {};
    try {
      fn(tx, ergebnis);
    } catch (e) {
      try { tx.abort(); } catch (_) { /* schon beendet */ }
      reject(e);
      return;
    }
    tx.oncomplete = () => resolve(ergebnis.wert);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Speichern abgebrochen'));
  });
}

export function neueId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export function alle(store) {
  return transaktion([store], 'readonly', (tx, e) => {
    tx.objectStore(store).getAll().onsuccess = (ev) => { e.wert = ev.target.result; };
  });
}

export function holen(store, id) {
  return transaktion([store], 'readonly', (tx, e) => {
    tx.objectStore(store).get(id).onsuccess = (ev) => { e.wert = ev.target.result || null; };
  });
}

export function maengelVonPlatz(platzId) {
  return transaktion(['maengel'], 'readonly', (tx, e) => {
    tx.objectStore('maengel').index('platzId').getAll(platzId).onsuccess = (ev) => { e.wert = ev.target.result; };
  });
}

export function platzSpeichern(platz) {
  const jetzt = new Date().toISOString();
  const p = { ...platz, geaendert: jetzt };
  if (!p.id) { p.id = neueId(); p.erstellt = jetzt; }
  return transaktion(['plaetze'], 'readwrite', (tx, e) => {
    tx.objectStore('plaetze').put(p);
    e.wert = p;
  }).then(() => p);
}

// Löscht den Platz mit allen Mängeln und deren Fotos.
export function platzLoeschen(platzId) {
  return transaktion(['plaetze', 'maengel', 'fotos'], 'readwrite', (tx) => {
    const maengel = tx.objectStore('maengel');
    const fotos = tx.objectStore('fotos');
    maengel.index('platzId').getAll(platzId).onsuccess = (ev) => {
      for (const m of ev.target.result) {
        if (m.fotoId) fotos.delete(m.fotoId);
        maengel.delete(m.id);
      }
    };
    tx.objectStore('plaetze').delete(platzId);
  });
}

// Speichert einen Mangel. foto = { daten: ArrayBuffer, typ, breite, hoehe } oder null (Foto unverändert).
// fotoEntfernen = true löscht ein bestehendes Foto ohne Ersatz.
export function mangelSpeichern(mangel, foto, fotoEntfernen = false) {
  const jetzt = new Date().toISOString();
  const m = { ...mangel, geaendert: jetzt };
  if (!m.id) { m.id = neueId(); m.erstellt = jetzt; }
  const altesFoto = m.fotoId || null;
  return transaktion(['maengel', 'fotos'], 'readwrite', (tx) => {
    const fotos = tx.objectStore('fotos');
    if (foto) {
      const fotoId = neueId();
      fotos.put({ id: fotoId, ...foto, erstellt: jetzt });
      if (altesFoto) fotos.delete(altesFoto);
      m.fotoId = fotoId;
    } else if (fotoEntfernen && altesFoto) {
      fotos.delete(altesFoto);
      m.fotoId = null;
    }
    tx.objectStore('maengel').put(m);
  }).then(() => m);
}

export function mangelLoeschen(mangel) {
  return transaktion(['maengel', 'fotos'], 'readwrite', (tx) => {
    if (mangel.fotoId) tx.objectStore('fotos').delete(mangel.fotoId);
    tx.objectStore('maengel').delete(mangel.id);
  });
}

// Bittet den Browser, die Daten nicht automatisch zu löschen (wichtig v. a. auf dem iPhone).
export async function dauerhaftAnfragen() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch (_) { /* nicht unterstützt */ }
  return false;
}

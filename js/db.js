// Datenhaltung in IndexedDB. Alle Daten bleiben auf dem Gerät.
// Stores: plaetze, maengel (Index platzId), fotos (Bilddaten getrennt, damit Listen schnell bleiben),
// vorschauen (kleine Bilder für Listen, gleiche id wie das Foto; ab Version 2).

const DB_NAME = 'maengelapp';
const DB_VERSION = 2;

let dbPromise = null;

function oeffnen() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const anfrage = indexedDB.open(DB_NAME, DB_VERSION);
      anfrage.onupgradeneeded = () => {
        // Nur Stores ergänzen, nie bestehende Daten löschen
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
        if (!db.objectStoreNames.contains('vorschauen')) {
          db.createObjectStore('vorschauen', { keyPath: 'id' });
        }
      };
      anfrage.onsuccess = () => {
        const db = anfrage.result;
        // Eine neuere Version der App will umstellen: Verbindung freigeben
        db.onversionchange = () => { db.close(); dbPromise = null; };
        resolve(db);
      };
      anfrage.onerror = () => reject(anfrage.error);
      anfrage.onblocked = () => console.warn('Datenbank-Umstellung wartet, bis andere Fenster der App geschlossen sind.');
    });
    dbPromise.catch(() => { dbPromise = null; });
  }
  return dbPromise;
}

// Führt fn(transaktion) aus. fn darf nur IndexedDB-Anfragen absetzen (keine anderen await),
// damit die Transaktion nicht vorzeitig endet. Rückgabe: ergebnis.wert nach Abschluss.
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

// Zeitpunkt der letzten Änderung (für die Sicherungs-Erinnerung)
export function aenderungMerken() {
  try { localStorage.setItem('letzte-aenderung', new Date().toISOString()); } catch (_) { /* egal */ }
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
  return transaktion(['plaetze'], 'readwrite', (tx) => {
    tx.objectStore('plaetze').put(p);
  }).then(() => { aenderungMerken(); return p; });
}

const FOTO_FELDER = ['fotoId', 'fotoNachherId'];

function fotosEntfernen(tx, mangel) {
  for (const feld of FOTO_FELDER) {
    if (mangel[feld]) {
      tx.objectStore('fotos').delete(mangel[feld]);
      tx.objectStore('vorschauen').delete(mangel[feld]);
    }
  }
}

// Löscht den Platz mit allen Mängeln und deren Fotos.
export function platzLoeschen(platzId) {
  return transaktion(['plaetze', 'maengel', 'fotos', 'vorschauen'], 'readwrite', (tx) => {
    const maengel = tx.objectStore('maengel');
    maengel.index('platzId').getAll(platzId).onsuccess = (ev) => {
      for (const m of ev.target.result) {
        fotosEntfernen(tx, m);
        maengel.delete(m.id);
      }
    };
    tx.objectStore('plaetze').delete(platzId);
  }).then(aenderungMerken);
}

// Speichert einen Mangel samt Fotoänderungen.
// fotos = { fotoId: { neu, entfernen }, fotoNachherId: { neu, entfernen } }
//   neu = { daten: ArrayBuffer, typ, breite, hoehe, groesse, vorschau: { daten, typ } } oder null
//   entfernen = true löscht ein bestehendes Foto ohne Ersatz
export function mangelSpeichern(mangel, fotos = {}) {
  const jetzt = new Date().toISOString();
  const m = { ...mangel, geaendert: jetzt };
  if (!m.id) { m.id = neueId(); m.erstellt = jetzt; }
  return transaktion(['maengel', 'fotos', 'vorschauen'], 'readwrite', (tx) => {
    const fotoStore = tx.objectStore('fotos');
    const vorschauStore = tx.objectStore('vorschauen');
    for (const feld of FOTO_FELDER) {
      const aenderung = fotos[feld];
      if (!aenderung) continue;
      const alt = m[feld] || null;
      if (aenderung.neu) {
        const { vorschau, ...foto } = aenderung.neu;
        const id = neueId();
        fotoStore.put({ id, ...foto, erstellt: jetzt });
        if (vorschau) vorschauStore.put({ id, ...vorschau });
        if (alt) { fotoStore.delete(alt); vorschauStore.delete(alt); }
        m[feld] = id;
      } else if (aenderung.entfernen && alt) {
        fotoStore.delete(alt);
        vorschauStore.delete(alt);
        m[feld] = null;
      }
    }
    tx.objectStore('maengel').put(m);
  }).then(() => { aenderungMerken(); return m; });
}

export function mangelLoeschen(mangel) {
  return transaktion(['maengel', 'fotos', 'vorschauen'], 'readwrite', (tx) => {
    fotosEntfernen(tx, mangel);
    tx.objectStore('maengel').delete(mangel.id);
  }).then(aenderungMerken);
}

// Liefert das kleine Vorschaubild. Fehlt es (Fotos aus Etappe 1), wird es mit erzeugen(foto) erstellt.
export async function vorschauHolen(fotoId, erzeugen) {
  const vorhanden = await holen('vorschauen', fotoId);
  if (vorhanden) return vorhanden;
  const foto = await holen('fotos', fotoId);
  if (!foto) return null;
  const v = { id: fotoId, ...(await erzeugen(foto)) };
  await transaktion(['vorschauen'], 'readwrite', (tx) => { tx.objectStore('vorschauen').put(v); });
  return v;
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

export function schluessel(store) {
  return transaktion([store], 'readonly', (tx, e) => {
    tx.objectStore(store).getAllKeys().onsuccess = (ev) => { e.wert = ev.target.result; };
  });
}

// Übernimmt Daten aus einer Sicherung. Bestehendes bleibt; bei gleicher id gewinnt der neuere Stand.
// Danach werden Fotos gelöscht, die zu keinem Mangel mehr gehören.
export function importieren({ plaetze, maengel, fotos }) {
  return transaktion(['plaetze', 'maengel', 'fotos', 'vorschauen'], 'readwrite', (tx) => {
    const ps = tx.objectStore('plaetze');
    const ms = tx.objectStore('maengel');
    const fs = tx.objectStore('fotos');
    const vs = tx.objectStore('vorschauen');
    const neuer = (alt, neu) => !alt || String(neu.geaendert || '') > String(alt.geaendert || '');
    for (const p of plaetze) {
      ps.get(p.id).onsuccess = (ev) => { if (neuer(ev.target.result, p)) ps.put(p); };
    }
    for (const f of fotos) {
      fs.getKey(f.id).onsuccess = (ev) => { if (ev.target.result === undefined) fs.put(f); };
    }
    let offen = maengel.length;
    const aufraeumen = () => {
      // Alle Mängel lesen und nicht mehr benutzte Fotos entfernen
      ms.getAll().onsuccess = (ev) => {
        const benutzt = new Set();
        for (const m of ev.target.result) for (const feld of FOTO_FELDER) if (m[feld]) benutzt.add(m[feld]);
        fs.getAllKeys().onsuccess = (ev2) => {
          for (const id of ev2.target.result) if (!benutzt.has(id)) { fs.delete(id); vs.delete(id); }
        };
      };
    };
    if (offen === 0) aufraeumen();
    for (const m of maengel) {
      ms.get(m.id).onsuccess = (ev) => {
        if (neuer(ev.target.result, m)) ms.put(m);
        offen -= 1;
        if (offen === 0) aufraeumen();
      };
    }
  }).then(aenderungMerken);
}

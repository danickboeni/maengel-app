// Datenhaltung in IndexedDB. Alle Daten bleiben auf dem Gerät.
// Stores: plaetze, maengel (Index platzId), fotos (Bilddaten getrennt, damit Listen schnell bleiben),
// vorschauen (kleine Bilder für Listen, gleiche id wie das Foto; ab Version 2),
// offerten und positionen (Index offerteId) für die Offerte-Aufnahme (ab Version 3),
// markierungsplaene für den Markierungsplaner (ab Version 4).

const DB_NAME = 'maengelapp';
const DB_VERSION = 4;

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
        if (!db.objectStoreNames.contains('offerten')) {
          db.createObjectStore('offerten', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('positionen')) {
          const s = db.createObjectStore('positionen', { keyPath: 'id' });
          s.createIndex('offerteId', 'offerteId', { unique: false });
        }
        if (!db.objectStoreNames.contains('markierungsplaene')) {
          db.createObjectStore('markierungsplaene', { keyPath: 'id' });
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
// Danach werden Fotos gelöscht, die zu keinem Mangel und keiner Position mehr gehören.
export function importieren({ plaetze = [], maengel = [], fotos = [], offerten = [], positionen = [], markierungsplaene = [] }) {
  const stores = ['plaetze', 'maengel', 'fotos', 'vorschauen', 'offerten', 'positionen', 'markierungsplaene'];
  return transaktion(stores, 'readwrite', (tx) => {
    const fs = tx.objectStore('fotos');
    const vs = tx.objectStore('vorschauen');
    const neuer = (alt, neu) => !alt || String(neu.geaendert || '') > String(alt.geaendert || '');
    for (const f of fotos) {
      fs.getKey(f.id).onsuccess = (ev) => { if (ev.target.result === undefined) fs.put(f); };
    }
    const listen = [['plaetze', plaetze], ['maengel', maengel], ['offerten', offerten], ['positionen', positionen],
      ['markierungsplaene', markierungsplaene]];
    let offen = listen.reduce((summe, [, liste]) => summe + liste.length, 0);
    const aufraeumen = () => {
      // Benutzte Fotos sammeln, alle anderen entfernen
      const benutzt = new Set();
      tx.objectStore('maengel').getAll().onsuccess = (ev) => {
        for (const m of ev.target.result) for (const feld of FOTO_FELDER) if (m[feld]) benutzt.add(m[feld]);
        tx.objectStore('positionen').getAll().onsuccess = (ev2) => {
          for (const p of ev2.target.result) for (const id of p.fotoIds || []) benutzt.add(id);
          fs.getAllKeys().onsuccess = (ev3) => {
            for (const id of ev3.target.result) if (!benutzt.has(id)) { fs.delete(id); vs.delete(id); }
          };
        };
      };
    };
    if (offen === 0) aufraeumen();
    for (const [store, liste] of listen) {
      const st = tx.objectStore(store);
      for (const x of liste) {
        st.get(x.id).onsuccess = (ev) => {
          if (neuer(ev.target.result, x)) st.put(x);
          offen -= 1;
          if (offen === 0) aufraeumen();
        };
      }
    }
  }).then(aenderungMerken);
}

// ---------- Offerten ----------

export function positionenVonOfferte(offerteId) {
  return transaktion(['positionen'], 'readonly', (tx, e) => {
    tx.objectStore('positionen').index('offerteId').getAll(offerteId).onsuccess = (ev) => {
      // Reihenfolge = Erfassung
      e.wert = ev.target.result.sort((a, b) => String(a.erstellt).localeCompare(String(b.erstellt)));
    };
  });
}

export function offerteSpeichern(offerte) {
  const jetzt = new Date().toISOString();
  const o = { ...offerte, geaendert: jetzt };
  if (!o.id) { o.id = neueId(); o.erstellt = jetzt; }
  return transaktion(['offerten'], 'readwrite', (tx) => {
    tx.objectStore('offerten').put(o);
  }).then(() => { aenderungMerken(); return o; });
}

// Löscht die Offerte mit allen Positionen und Fotos
export function offerteLoeschen(offerteId) {
  return transaktion(['offerten', 'positionen', 'fotos', 'vorschauen'], 'readwrite', (tx) => {
    const pos = tx.objectStore('positionen');
    pos.index('offerteId').getAll(offerteId).onsuccess = (ev) => {
      for (const p of ev.target.result) {
        for (const id of p.fotoIds || []) { tx.objectStore('fotos').delete(id); tx.objectStore('vorschauen').delete(id); }
        pos.delete(p.id);
      }
    };
    tx.objectStore('offerten').delete(offerteId);
  }).then(aenderungMerken);
}

// Speichert eine Position. fotos = { neu: [fotoObjekt], entfernen: [fotoId] }
export function positionSpeichern(position, fotos = {}) {
  const jetzt = new Date().toISOString();
  const p = { ...position, geaendert: jetzt, fotoIds: [...(position.fotoIds || [])] };
  if (!p.id) { p.id = neueId(); p.erstellt = jetzt; }
  return transaktion(['positionen', 'fotos', 'vorschauen', 'offerten'], 'readwrite', (tx) => {
    const fotoStore = tx.objectStore('fotos');
    const vorschauStore = tx.objectStore('vorschauen');
    for (const id of fotos.entfernen || []) {
      fotoStore.delete(id);
      vorschauStore.delete(id);
      p.fotoIds = p.fotoIds.filter((x) => x !== id);
    }
    for (const neu of fotos.neu || []) {
      const { vorschau, ...foto } = neu;
      const id = neueId();
      fotoStore.put({ id, ...foto, erstellt: jetzt });
      if (vorschau) vorschauStore.put({ id, ...vorschau });
      p.fotoIds.push(id);
    }
    tx.objectStore('positionen').put(p);
    // Offerte als geändert markieren (für die Sortierung der Liste)
    const offerten = tx.objectStore('offerten');
    offerten.get(p.offerteId).onsuccess = (ev) => {
      const o = ev.target.result;
      if (o) offerten.put({ ...o, geaendert: jetzt });
    };
  }).then(() => { aenderungMerken(); return p; });
}

export function positionLoeschen(position) {
  return transaktion(['positionen', 'fotos', 'vorschauen'], 'readwrite', (tx) => {
    for (const id of position.fotoIds || []) { tx.objectStore('fotos').delete(id); tx.objectStore('vorschauen').delete(id); }
    tx.objectStore('positionen').delete(position.id);
  }).then(aenderungMerken);
}

// ---------- Markierungspläne ----------
// Ein Plan = { id, name, daten (ganzer Planerzustand), unterlage (CAD-Linien, optional), erstellt, geaendert }.
// Kein Bezug zu Plätzen oder Offerten.

export function markierungsplanSpeichern(plan) {
  const jetzt = new Date().toISOString();
  const p = { ...plan, geaendert: jetzt };
  if (!p.id) p.id = neueId();
  return transaktion(['markierungsplaene'], 'readwrite', (tx) => {
    const st = tx.objectStore('markierungsplaene');
    st.get(p.id).onsuccess = (ev) => {
      const alt = ev.target.result;
      // Erstellungsdatum vom bestehenden Plan übernehmen
      p.erstellt = (alt && alt.erstellt) || p.erstellt || jetzt;
      // CAD-Unterlage bleibt, wenn sie beim Speichern nicht mitgegeben wird (null = entfernen)
      if (!('unterlage' in plan) && alt && alt.unterlage) p.unterlage = alt.unterlage;
      if (p.unterlage === null) delete p.unterlage;
      st.put(p);
    };
  }).then(() => { aenderungMerken(); return p; });
}

export function markierungsplanLoeschen(id) {
  return transaktion(['markierungsplaene'], 'readwrite', (tx) => {
    tx.objectStore('markierungsplaene').delete(id);
  }).then(aenderungMerken);
}

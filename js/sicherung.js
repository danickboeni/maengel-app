// Sicherung: alle Daten mit Fotos als eine Datei exportieren und wieder einlesen.
import * as db from './db.js';

// Format 1: Plätze und Mängel. Format 2: zusätzlich Offerten und Positionen. Format 3: zusätzlich Markierungspläne.
// Format 4: Mängel mit mehreren Fotos (fotoIds / fotoNachherIds). Ältere App-Versionen kennen das nicht
// und würden die weiteren Fotos beim Einlesen löschen – darum lehnen sie Format 4 ab.
const FORMAT = 4;
const TAG = 24 * 60 * 60 * 1000;
export const ERINNERUNG_TAGE = 7;

function lesen(name) {
  try { return localStorage.getItem(name); } catch (_) { return null; }
}

export function letzteSicherung() { return lesen('letzte-sicherung'); }

function sicherungMerken() {
  try { localStorage.setItem('letzte-sicherung', new Date().toISOString()); } catch (_) { /* egal */ }
}

// Ist eine Sicherung fällig? Nur wenn seit der letzten Sicherung etwas geändert wurde
// und diese länger als ERINNERUNG_TAGE zurückliegt (oder es noch nie eine gab).
export function sicherungFaellig() {
  const aenderung = lesen('letzte-aenderung');
  const sicherung = letzteSicherung();
  if (!aenderung) return false;
  if (!sicherung) return true;
  if (aenderung <= sicherung) return false;
  return Date.now() - new Date(sicherung).getTime() > ERINNERUNG_TAGE * TAG;
}

function zuBase64(daten, typ) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(new Blob([daten], { type: typ }));
  });
}

async function ausBase64(text, typ) {
  const antwort = await fetch(`data:${typ};base64,${text}`);
  return antwort.arrayBuffer();
}

function zweistellig(n) { return String(n).padStart(2, '0'); }
export function dateiDatum(d = new Date()) {
  return `${d.getFullYear()}-${zweistellig(d.getMonth() + 1)}-${zweistellig(d.getDate())}`;
}

// Erstellt die Sicherungsdatei. Die Fotos werden einzeln angehängt, damit nie ein riesiger Text im Speicher liegt.
export async function sicherungErstellen(fortschritt = () => {}) {
  const [plaetze, maengel, offerten, positionen, markierungsplaene, fotoIds] = await Promise.all([
    db.alle('plaetze'), db.alle('maengel'), db.alle('offerten'), db.alle('positionen'), db.alle('markierungsplaene'),
    db.schluessel('fotos'),
  ]);
  const teile = [];
  const kopf = { app: 'maengelapp', format: FORMAT, erstellt: new Date().toISOString(), plaetze, maengel, offerten, positionen,
    markierungsplaene };
  teile.push(JSON.stringify(kopf).slice(0, -1), ',"fotos":[');
  let i = 0;
  for (const id of fotoIds) {
    const f = await db.holen('fotos', id);
    if (!f) continue;
    const { daten, ...rest } = f;
    const eintrag = { ...rest, daten: await zuBase64(daten, f.typ || 'image/jpeg') };
    teile.push((i > 0 ? ',' : '') + JSON.stringify(eintrag));
    i += 1;
    fortschritt(i, fotoIds.length);
  }
  teile.push(']}');
  const blob = new Blob(teile, { type: 'application/json' });
  const name = `maengel-sicherung-${dateiDatum()}.json`;
  return {
    datei: new File([blob], name, { type: 'application/json' }),
    plaetze: plaetze.length, maengel: maengel.length, offerten: offerten.length,
    markierungsplaene: markierungsplaene.length, fotos: i,
  };
}

// Teilt die Datei (Handy) oder lädt sie herunter (PC). Liefert true, wenn sie weitergegeben wurde.
export async function dateiWeitergeben(datei, { herunterladen = false, titel = '' } = {}) {
  const teilen = !herunterladen && navigator.canShare && navigator.canShare({ files: [datei] });
  if (teilen) {
    try {
      await navigator.share({ files: [datei], title: titel || datei.name });
      return true;
    } catch (e) {
      if (e && e.name === 'AbortError') return false;
      // Teilen nicht möglich: herunterladen
    }
  }
  const url = URL.createObjectURL(datei);
  const a = document.createElement('a');
  a.href = url;
  a.download = datei.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return true;
}

export async function sicherungWeitergeben(datei, optionen) {
  const ok = await dateiWeitergeben(datei, { ...optionen, titel: 'Sicherung Mängel-App' });
  if (ok) sicherungMerken();
  return ok;
}

// Liest eine Sicherungsdatei und vergleicht sie mit den Daten auf dem Gerät.
export async function sicherungPruefen(datei) {
  let daten;
  try {
    daten = JSON.parse(await datei.text());
  } catch (_) {
    throw new Error('Diese Datei ist keine gültige Sicherung.');
  }
  if (!daten || daten.app !== 'maengelapp' || !Array.isArray(daten.plaetze) || !Array.isArray(daten.maengel)) {
    throw new Error('Diese Datei ist keine Sicherung der Mängel-App.');
  }
  if (daten.format > FORMAT) throw new Error('Diese Sicherung stammt aus einer neueren Version der App. Bitte zuerst die App aktualisieren.');
  daten.offerten = Array.isArray(daten.offerten) ? daten.offerten : [];
  daten.positionen = Array.isArray(daten.positionen) ? daten.positionen : [];
  daten.markierungsplaene = Array.isArray(daten.markierungsplaene) ? daten.markierungsplaene : [];
  const [plaetze, maengel, offerten, markierungsplaene] = await Promise.all([
    db.alle('plaetze'), db.alle('maengel'), db.alle('offerten'), db.alle('markierungsplaene'),
  ]);
  const vorhanden = (liste) => new Map(liste.map((x) => [x.id, x]));
  function vergleich(neu, alt) {
    const map = vorhanden(alt);
    let neuAnzahl = 0; let aktueller = 0;
    for (const x of neu) {
      const a = map.get(x.id);
      if (!a) neuAnzahl += 1;
      else if (String(x.geaendert || '') > String(a.geaendert || '')) aktueller += 1;
    }
    return { total: neu.length, neu: neuAnzahl, aktueller };
  }
  return {
    daten,
    erstellt: daten.erstellt,
    plaetze: vergleich(daten.plaetze, plaetze),
    maengel: vergleich(daten.maengel, maengel),
    offerten: vergleich(daten.offerten, offerten),
    markierungsplaene: vergleich(daten.markierungsplaene, markierungsplaene),
    fotos: (daten.fotos || []).length,
  };
}

export async function sicherungEinlesen(daten, fortschritt = () => {}) {
  const fotos = [];
  const liste = daten.fotos || [];
  for (let i = 0; i < liste.length; i += 1) {
    const f = liste[i];
    if (!f || !f.id || typeof f.daten !== 'string') continue;
    fotos.push({ ...f, daten: await ausBase64(f.daten, f.typ || 'image/jpeg') });
    fortschritt(i + 1, liste.length);
  }
  await db.importieren({
    plaetze: daten.plaetze, maengel: daten.maengel, offerten: daten.offerten || [], positionen: daten.positionen || [],
    markierungsplaene: daten.markierungsplaene || [], fotos,
  });
}

export async function speicherInfo() {
  const info = { geschuetzt: null, belegt: null };
  try {
    if (navigator.storage?.persisted) info.geschuetzt = await navigator.storage.persisted();
    if (navigator.storage?.estimate) info.belegt = (await navigator.storage.estimate()).usage ?? null;
  } catch (_) { /* nicht unterstützt */ }
  return info;
}

export function groesseText(bytes) {
  if (bytes == null) return '–';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

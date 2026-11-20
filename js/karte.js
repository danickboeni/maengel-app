// Karte mit Leaflet und swisstopo-Kacheln (WMTS, Web-Mercator).
/* global L */

export const SCHWEIZ = { lat: 46.8, lng: 8.23, zoom: 8 };
const GRENZEN = [[45.6, 5.7], [48.0, 10.7]];

function wmts(ebene, format) {
  return `https://wmts.geo.admin.ch/1.0.0/${ebene}/default/current/3857/{z}/{x}/{y}.${format}`;
}

export function karteErstellen(element, { lat, lng, zoom }, optionen = {}) {
  const { einfach = false, ...leafletOptionen } = optionen;
  const karte = L.map(element, {
    zoomControl: !einfach,
    minZoom: 7,
    maxZoom: 21,
    maxBounds: [[45.4, 5.4], [48.3, 11.0]],
    maxBoundsViscosity: 0.8,
    zoomSnap: 0.5,
    ...leafletOptionen,
  }).setView([lat, lng], zoom);

  // crossOrigin: damit der Service Worker die Kacheln für offline speichern kann
  const gemeinsam = { attribution: '© <a href="https://www.swisstopo.admin.ch" target="_blank" rel="noopener">swisstopo</a>', bounds: GRENZEN, maxZoom: 21, crossOrigin: true };
  const luftbild = L.tileLayer(wmts('ch.swisstopo.swissimage', 'jpeg'), { ...gemeinsam, maxNativeZoom: 20 });
  const landeskarte = L.tileLayer(wmts('ch.swisstopo.pixelkarte-farbe', 'jpeg'), { ...gemeinsam, maxNativeZoom: 19 });
  luftbild.addTo(karte);
  if (!einfach) L.control.layers({ Luftbild: luftbild, Karte: landeskarte }, null, { position: 'topright' }).addTo(karte);
  karte.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');

  // Grösse neu messen, sobald die Ansicht gezeichnet ist (nicht mehr, falls schon verlassen)
  requestAnimationFrame(() => {
    if (!element.isConnected) return;
    try { karte.invalidateSize(); } catch (_) { /* Karte schon entfernt */ }
  });
  return karte;
}

// Karte beim Verlassen einer Ansicht entfernen. Leaflet hat nach einem Zoom oder Verschieben
// noch Abläufe offen; darum erst kurz warten, sonst gibt es Fehler bei schnellem Wechsel.
export function karteEntfernen(karte) {
  try { karte.setMaxBounds(null); karte.stop(); } catch (_) { /* egal */ }
  setTimeout(() => { try { karte.remove(); } catch (_) { /* schon entfernt */ } }, 600);
}

// Fester Pin in der Kartenmitte: Die Karte wird darunter verschoben.
export function pinHtml(klasse = '') {
  return `<div class="pin ${klasse}" aria-hidden="true">
    <svg viewBox="0 0 32 44" width="36" height="50"><path d="M16 1C8 1 2 7 2 15c0 10 14 27 14 27s14-17 14-27C30 7 24 1 16 1z" fill="currentColor" stroke="#fff" stroke-width="2.5"/><circle cx="16" cy="15" r="5" fill="#fff"/></svg>
  </div><div class="pin-mitte" aria-hidden="true"></div>`;
}

export function punktIcon(farbe, erledigt = false) {
  return L.divIcon({
    className: 'punkt-icon',
    html: `<span class="punkt${erledigt ? ' punkt-erledigt' : ''}" style="background:${farbe}"></span>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  });
}

// GPS beobachten, solange die Ansicht offen ist. Meldet nur genauere Positionen.
// Rückgabe: Funktion zum Stoppen.
export function gpsBeobachten(beiPosition, beiFehler) {
  if (!('geolocation' in navigator)) {
    beiFehler('Dieses Gerät hat kein GPS.');
    return () => {};
  }
  let beste = null;
  const id = navigator.geolocation.watchPosition(
    (p) => {
      const pos = { lat: p.coords.latitude, lng: p.coords.longitude, genauigkeit: Math.round(p.coords.accuracy) };
      // Neue Position nehmen, wenn genauer oder die bisherige älter als 15 s ist
      if (!beste || pos.genauigkeit <= beste.genauigkeit || Date.now() - beste.zeit > 15000) {
        beste = { ...pos, zeit: Date.now() };
        beiPosition(pos);
      }
    },
    (f) => {
      const texte = {
        1: 'GPS nicht erlaubt. Erlaube den Standort in den Einstellungen.',
        2: 'Position nicht gefunden.',
        3: 'GPS antwortet nicht.',
      };
      beiFehler(texte[f.code] || 'GPS-Fehler.');
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
  );
  return () => navigator.geolocation.clearWatch(id);
}

// Distanz in Metern (genügend genau für kurze Strecken)
export function distanz(a, b) {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

// ---------- Kacheln: Umrechnung, Offline-Speicher ----------

export const LUFTBILD = wmts('ch.swisstopo.swissimage', 'jpeg');
export const KACHEL_CACHE = 'kacheln-v1'; // gleicher Name wie in sw.js

export function kachelUrl(z, x, y) {
  return LUFTBILD.replace('{z}', z).replace('{x}', x).replace('{y}', y);
}

// Position in Weltpixeln (256er-Kacheln) bei Zoomstufe z
export function weltPixel(lat, lng, z) {
  const n = 256 * 2 ** z;
  const r = (lat * Math.PI) / 180;
  return {
    x: ((lng + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n,
  };
}

// Alle Luftbild-Kacheln im Umkreis (Meter) um einen Punkt, für die Zoomstufen zVon..zBis
export function kachelnUmPunkt(lat, lng, radius, zVon = 13, zBis = 20) {
  const dLat = radius / 111320;
  const dLng = radius / (111320 * Math.cos((lat * Math.PI) / 180));
  const urls = [];
  for (let z = zVon; z <= zBis; z += 1) {
    const a = weltPixel(lat + dLat, lng - dLng, z);
    const b = weltPixel(lat - dLat, lng + dLng, z);
    for (let x = Math.floor(a.x / 256); x <= Math.floor(b.x / 256); x += 1) {
      for (let y = Math.floor(a.y / 256); y <= Math.floor(b.y / 256); y += 1) urls.push(kachelUrl(z, x, y));
    }
  }
  return urls;
}

export const OFFLINE_RADIUS = 300;

// Lädt das Luftbild rund um den Platz in den Offline-Speicher.
// fortschritt(erledigt, total), abbrechen() → true bricht ab. Liefert { total, fehler }.
export async function offlineSpeichern(platz, fortschritt = () => {}, abbrechen = () => false) {
  if (!('caches' in window)) throw new Error('Dieses Gerät kann keine Karten offline speichern.');
  const cache = await caches.open(KACHEL_CACHE);
  const urls = kachelnUmPunkt(platz.lat, platz.lng, OFFLINE_RADIUS);
  let erledigt = 0;
  let fehler = 0;
  let index = 0;
  async function arbeiter() {
    while (index < urls.length && !abbrechen()) {
      const url = urls[index++];
      try {
        if (!(await cache.match(url))) {
          const antwort = await fetch(url, { mode: 'cors' });
          if (antwort.ok) await cache.put(url, antwort);
          else if (antwort.status !== 404 && antwort.status !== 400) fehler += 1;
        }
      } catch (_) {
        fehler += 1;
      }
      erledigt += 1;
      fortschritt(erledigt, urls.length);
    }
  }
  await Promise.all(Array.from({ length: 6 }, arbeiter));
  return { total: urls.length, fehler, abgebrochen: abbrechen() };
}

export async function kachelAnzahl() {
  if (!('caches' in window)) return 0;
  const cache = await caches.open(KACHEL_CACHE);
  return (await cache.keys()).length;
}

export async function kachelnLoeschen() {
  if ('caches' in window) await caches.delete(KACHEL_CACHE);
}

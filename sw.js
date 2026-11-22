// Service Worker: speichert die App-Dateien für den Offline-Start
// und Luftbild-Kacheln von swisstopo für den Einsatz ohne Empfang.
// Bei jeder Änderung an App-Dateien VERSION erhöhen.

const VERSION = 'maengel-v14';
const KACHELN = 'kacheln-v1';       // gleicher Name wie in js/karte.js
const MAX_KACHELN = 6000;           // etwa 100–120 MB
const DATEIEN = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/db.js',
  'js/foto.js',
  'js/karte.js',
  'js/konstanten.js',
  'js/sicherung.js',
  'js/bericht.js',
  'js/messen.js',
  'markierung.html',
  'css/markierung.css',
  'js/markierung/hilfen.js',
  'js/markierung/normen.js',
  'js/markierung/pruefung.js',
  'js/markierung/zeichnen.js',
  'js/markierung/druck.js',
  'js/markierung/planer.js',
  'vendor/leaflet-1.9.4/leaflet.css',
  'vendor/leaflet-1.9.4/leaflet.js',
  'vendor/leaflet-1.9.4/images/layers.png',
  'vendor/leaflet-1.9.4/images/layers-2x.png',
  'vendor/leaflet-1.9.4/images/marker-icon.png',
  'vendor/leaflet-1.9.4/images/marker-icon-2x.png',
  'vendor/leaflet-1.9.4/images/marker-shadow.png',
  'vendor/jspdf-2.5.2/jspdf.umd.min.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (ev) => {
  ev.waitUntil(caches.open(VERSION).then((c) => c.addAll(DATEIEN.map((d) => new Request(d, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches.keys()
      .then((namen) => Promise.all(namen.filter((n) => n !== VERSION && n !== KACHELN).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

// Älteste Kacheln entfernen, wenn der Speicher zu gross wird
let neueKacheln = 0;
async function kachelnBegrenzen(cache) {
  const schluessel = await cache.keys();
  const zuViel = schluessel.length - MAX_KACHELN;
  for (let i = 0; i < zuViel; i += 1) await cache.delete(schluessel[i]);
}

// Kacheln: zuerst aus dem Speicher, sonst übers Netz holen und merken
async function kachel(req) {
  const cache = await caches.open(KACHELN);
  const gespeichert = await cache.match(req.url);
  if (gespeichert) return gespeichert;
  try {
    const antwort = await fetch(req);
    if (antwort.ok && antwort.type === 'cors') {
      await cache.put(req.url, antwort.clone());
      neueKacheln += 1;
      if (neueKacheln % 200 === 0) kachelnBegrenzen(cache);
    }
    return antwort;
  } catch (_) {
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.hostname === 'wmts.geo.admin.ch') {
    ev.respondWith(kachel(req));
    return;
  }
  if (url.origin !== self.location.origin) return;

  // Eigene Dateien: sofort aus dem Speicher, im Hintergrund aktualisieren
  ev.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const gespeichert = await cache.match(req, { ignoreSearch: true });
      const vomNetz = fetch(req)
        .then((antwort) => {
          if (antwort && antwort.ok) cache.put(req, antwort.clone());
          return antwort;
        })
        .catch(() => null);
      if (gespeichert) {
        ev.waitUntil(vomNetz);
        return gespeichert;
      }
      const antwort = await vomNetz;
      if (antwort) return antwort;
      if (req.mode === 'navigate') return cache.match('index.html');
      return new Response('Offline', { status: 503, statusText: 'Offline' });
    }),
  );
});

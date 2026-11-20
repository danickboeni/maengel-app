// Service Worker: speichert die App-Dateien für den Offline-Start.
// Kartenkacheln werden (noch) nicht gespeichert – das folgt in Etappe 3.
// Bei jeder Änderung an App-Dateien VERSION erhöhen.

const VERSION = 'maengel-v1';
const DATEIEN = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/db.js',
  'js/foto.js',
  'js/karte.js',
  'vendor/leaflet-1.9.4/leaflet.css',
  'vendor/leaflet-1.9.4/leaflet.js',
  'vendor/leaflet-1.9.4/images/layers.png',
  'vendor/leaflet-1.9.4/images/layers-2x.png',
  'vendor/leaflet-1.9.4/images/marker-icon.png',
  'vendor/leaflet-1.9.4/images/marker-icon-2x.png',
  'vendor/leaflet-1.9.4/images/marker-shadow.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (ev) => {
  ev.waitUntil(caches.open(VERSION).then((c) => c.addAll(DATEIEN)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches.keys()
      .then((namen) => Promise.all(namen.filter((n) => n !== VERSION).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

// Eigene Dateien: sofort aus dem Speicher, im Hintergrund aktualisieren.
// Fremde Adressen (Kartenkacheln) laufen unverändert über das Netz.
self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

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

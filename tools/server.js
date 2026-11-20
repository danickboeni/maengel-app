// Kleiner Testserver für den PC (gehört nicht zur App).
// Aufruf: node tools/server.js  →  http://localhost:8080
const http = require('http');
const fs = require('fs');
const path = require('path');

const WURZEL = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 8080;
const TYPEN = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

http.createServer((req, res) => {
  let pfad = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (pfad.endsWith('/')) pfad += 'index.html';
  const datei = path.normalize(path.join(WURZEL, pfad));
  if (!datei.startsWith(WURZEL) || /[\\/](\.git|tools)([\\/]|$)/.test(datei.slice(WURZEL.length))) {
    res.writeHead(403); res.end('Verboten'); return;
  }
  fs.readFile(datei, (fehler, daten) => {
    if (fehler) { res.writeHead(404); res.end('Nicht gefunden'); return; }
    res.writeHead(200, { 'Content-Type': TYPEN[path.extname(datei)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(daten);
  });
}).listen(PORT, '127.0.0.1', () => console.log(`Mängel-App läuft auf http://localhost:${PORT}`));

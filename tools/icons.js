// Erzeugt die App-Symbole (PNG) ohne fremde Bibliotheken.
// Aufruf: node tools/icons.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const GRUEN = [31, 111, 58];
const RASEN = [46, 140, 75];
const WEISS = [255, 255, 255];
const ROT = [211, 47, 47];

function crcTabelle() {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
}
const CRC = crcTabelle();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(typ, daten) {
  const len = Buffer.alloc(4); len.writeUInt32BE(daten.length);
  const td = Buffer.concat([Buffer.from(typ), daten]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(groesse, pixel) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(groesse, 0); ihdr.writeUInt32BE(groesse, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const roh = Buffer.alloc((groesse * 3 + 1) * groesse);
  for (let y = 0; y < groesse; y++) {
    roh[y * (groesse * 3 + 1)] = 0;
    pixel.copy(roh, y * (groesse * 3 + 1) + 1, y * groesse * 3, (y + 1) * groesse * 3);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(roh, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Zeichnet mit 4×4-Supersampling für glatte Kanten.
// inhalt: Anteil der Fläche, die das Motiv nutzt (für «maskable» kleiner).
function symbol(groesse, inhalt) {
  const ss = 4;
  const pixel = Buffer.alloc(groesse * groesse * 3);
  const m = 0.5; // Mitte (Einheitskoordinaten 0..1)
  const s = inhalt; // Skalierung des Motivs

  function farbeBei(u, v) {
    // Motivkoordinaten (-0.5..0.5)
    const x = (u - m) / s;
    const y = (v - m) / s;
    // Pin oben rechts (über dem Platz)
    const px = 0.2; const py = -0.06; const pr = 0.13;
    const dx = x - px; const dy = y - py;
    const inKopf = dx * dx + dy * dy <= pr * pr;
    // Spitze: Dreieck unter dem Kreis
    const spitzeY = py + 0.3;
    const inSpitze = y > py && y < spitzeY && Math.abs(dx) <= pr * (spitzeY - y) / (spitzeY - py) * 0.95;
    const rand = 0.025;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (inKopf && dist <= pr * 0.42) return WEISS;
    if (inKopf || inSpitze) return ROT;
    const inKopfRand = dist <= pr + rand;
    const inSpitzeRand = y > py && y < spitzeY + rand * 1.5 && Math.abs(dx) <= (pr + rand) * (spitzeY + rand * 1.5 - y) / (spitzeY + rand * 1.5 - py);
    if (inKopfRand || inSpitzeRand) return WEISS;

    // Spielfeld: Rechteck mit Linien
    const fb = 0.36; const fh = 0.25; const lw = 0.022;
    const ax = Math.abs(x); const ay = Math.abs(y - 0.04);
    if (ax <= fb && ay <= fh) {
      const aussen = ax >= fb - lw || ay >= fh - lw;
      const mittellinie = ax <= lw / 2;
      const r = Math.sqrt(x * x + (y - 0.04) ** 2);
      const kreis = Math.abs(r - 0.09) <= lw / 2;
      const strafraum = (ax >= fb - 0.1 - lw / 2 && ax <= fb - 0.1 + lw / 2 && ay <= 0.12) || (ax >= fb - 0.1 && Math.abs(ay - 0.12) <= lw / 2);
      if (aussen || mittellinie || kreis || strafraum) return WEISS;
      return RASEN;
    }
    return GRUEN;
  }

  for (let py = 0; py < groesse; py++) {
    for (let px = 0; px < groesse; px++) {
      let r = 0; let g = 0; let b = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const f = farbeBei((px + (sx + 0.5) / ss) / groesse, (py + (sy + 0.5) / ss) / groesse);
          r += f[0]; g += f[1]; b += f[2];
        }
      }
      const i = (py * groesse + px) * 3;
      pixel[i] = Math.round(r / (ss * ss));
      pixel[i + 1] = Math.round(g / (ss * ss));
      pixel[i + 2] = Math.round(b / (ss * ss));
    }
  }
  return png(groesse, pixel);
}

const ziel = path.join(__dirname, '..', 'icons');
fs.mkdirSync(ziel, { recursive: true });
fs.writeFileSync(path.join(ziel, 'icon-192.png'), symbol(192, 1));
fs.writeFileSync(path.join(ziel, 'icon-512.png'), symbol(512, 1));
fs.writeFileSync(path.join(ziel, 'icon-maskable-512.png'), symbol(512, 0.78));
fs.writeFileSync(path.join(ziel, 'apple-touch-icon.png'), symbol(180, 0.92));
console.log('Symbole erzeugt in', ziel);

// PDF-Bericht pro Platz: Plan mit nummerierten Punkten, Übersichtsliste, Fotos.
/* global jspdf */
import * as db from './db.js';
import { DRINGLICHKEIT, ERLEDIGT_FARBE, istErledigt, dringlichkeit, maengelSortieren } from './konstanten.js';
import { weltPixel, kachelUrl, KACHEL_CACHE } from './karte.js';
import { dateiDatum } from './sicherung.js';
import { FORM_FARBE, MESS_NAME, beschriftungsPunkt, messText, zahlText } from './messen.js';

// jsPDF erst laden, wenn ein Bericht erstellt wird
let jsPdfVersprechen = null;
function jsPdfLaden() {
  if (window.jspdf) return Promise.resolve(window.jspdf.jsPDF);
  if (!jsPdfVersprechen) {
    jsPdfVersprechen = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'vendor/jspdf-2.5.2/jspdf.umd.min.js';
      s.onload = () => resolve(jspdf.jsPDF);
      s.onerror = () => { jsPdfVersprechen = null; reject(new Error('PDF-Baustein konnte nicht geladen werden.')); };
      document.head.append(s);
    });
  }
  return jsPdfVersprechen;
}

function datum(iso, mitZeit = false) {
  if (!iso) return '';
  const o = { day: '2-digit', month: '2-digit', year: 'numeric' };
  if (mitZeit) Object.assign(o, { hour: '2-digit', minute: '2-digit' });
  return new Date(iso).toLocaleString('de-CH', o);
}

// ---------- Plan (Luftbild mit Punkten) ----------

async function kachelBild(url) {
  let blob = null;
  try {
    if ('caches' in window) {
      const treffer = await (await caches.open(KACHEL_CACHE)).match(url);
      if (treffer) blob = await treffer.blob();
    }
  } catch (_) { /* weiter übers Netz */ }
  if (!blob) {
    const antwort = await fetch(url, { mode: 'cors' });
    if (!antwort.ok) throw new Error('Kachel fehlt');
    blob = await antwort.blob();
  }
  return createImageBitmap(blob);
}

// Schiebt Nummern auseinander, die sich überlappen würden (einfache Abstossung).
function entzerren(marken, abstand, B, H, rand) {
  for (let runde = 0; runde < 60; runde += 1) {
    let bewegt = false;
    for (let i = 0; i < marken.length; i += 1) {
      for (let j = i + 1; j < marken.length; j += 1) {
        const a = marken[i]; const b = marken[j];
        let dx = b.x - a.x; let dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        if (d >= abstand) continue;
        if (d < 0.01) { dx = 1; dy = 0.4; d = Math.hypot(dx, dy); }
        const schub = (abstand - d) / 2 + 0.5;
        a.x -= (dx / d) * schub; a.y -= (dy / d) * schub;
        b.x += (dx / d) * schub; b.y += (dy / d) * schub;
        bewegt = true;
      }
    }
    for (const m of marken) {
      m.x = Math.min(B - rand, Math.max(rand, m.x));
      m.y = Math.min(H - rand, Math.max(rand, m.y));
    }
    if (!bewegt) break;
  }
}

// Zeichnet einen Luftbild-Plan mit Punkten (Mängel) und Formen (Offerte).
//   zentrum: { lat, lng } – Mitte, falls nichts anderes da ist
//   zentrumEinbeziehen: Zentrum auch in den Ausschnitt nehmen (Übersicht ja, Detail nein)
//   punkte: [{ lat, lng, nr, farbe }], formen: [{ messung, nr }]
//   B, H: Bildgrösse in Pixel; s: Grösse der Symbole; einzelZoom: Zoom bei nur einem Punkt
async function planZeichnen({
  zentrum, zentrumEinbeziehen = true, punkte = [], formen = [], B = 1400, H = 1000, s = 1, einzelZoom = 19, qualitaet = 0.82,
}) {
  const canvas = document.createElement('canvas');
  canvas.width = B; canvas.height = H;
  const g = canvas.getContext('2d');
  g.fillStyle = '#dfe5e2';
  g.fillRect(0, 0, B, H);

  const formPunkte = formen.flatMap((f) => f.messung.punkte);
  const alle = [
    ...(zentrumEinbeziehen || (!punkte.length && !formPunkte.length) ? [[zentrum.lat, zentrum.lng]] : []),
    ...punkte.map((p) => [p.lat, p.lng]),
    ...formPunkte,
  ];
  const lats = alle.map((p) => p[0]);
  const lngs = alle.map((p) => p[1]);
  const nord = Math.max(...lats); const sued = Math.min(...lats);
  const west = Math.min(...lngs); const ost = Math.max(...lngs);
  const rand = 110 * s;
  // Grösste Zoomstufe, bei der alles Platz hat (bei nur einem Punkt nicht zu nah)
  let z = alle.length > 1 ? 20 : einzelZoom;
  for (; z > 12; z -= 1) {
    const a = weltPixel(nord, west, z);
    const b = weltPixel(sued, ost, z);
    if (b.x - a.x <= B - 2 * rand && b.y - a.y <= H - 2 * rand) break;
  }
  const mitte = weltPixel((nord + sued) / 2, (west + ost) / 2, z);
  // Ganze Pixel, sonst entstehen feine Linien zwischen den Kartenteilen
  const x0 = Math.round(mitte.x - B / 2);
  const y0 = Math.round(mitte.y - H / 2);

  const aufgaben = [];
  for (let tx = Math.floor(x0 / 256); tx <= Math.floor((x0 + B) / 256); tx += 1) {
    for (let ty = Math.floor(y0 / 256); ty <= Math.floor((y0 + H) / 256); ty += 1) aufgaben.push({ tx, ty });
  }
  let fehlend = 0;
  await Promise.all(aufgaben.map(async ({ tx, ty }) => {
    try {
      const bild = await kachelBild(kachelUrl(z, tx, ty));
      g.drawImage(bild, tx * 256 - x0, ty * 256 - y0);
      if (bild.close) bild.close();
    } catch (_) {
      fehlend += 1;
    }
  }));

  const px = (lat, lng) => { const w = weltPixel(lat, lng, z); return [w.x - x0, w.y - y0]; };

  // Gemessene Formen der Offerte
  g.lineJoin = 'round';
  g.lineCap = 'round';
  for (const { messung } of formen) {
    const farbe = FORM_FARBE[messung.typ] || '#455a64';
    const xy = messung.punkte.map((p) => px(p[0], p[1]));
    if (messung.typ === 'flaeche' && xy.length >= 3) {
      g.beginPath();
      xy.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.closePath();
      g.globalAlpha = 0.28; g.fillStyle = farbe; g.fill();
      g.globalAlpha = 1; g.lineWidth = 5 * s; g.strokeStyle = farbe; g.stroke();
    } else if (messung.typ === 'linie' && xy.length >= 2) {
      g.beginPath();
      xy.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.lineWidth = 9 * s; g.strokeStyle = '#fff'; g.stroke();
      g.lineWidth = 5 * s; g.strokeStyle = farbe; g.stroke();
    } else {
      for (const [x, y] of xy) {
        g.beginPath(); g.arc(x, y, 11 * s, 0, Math.PI * 2);
        g.fillStyle = farbe; g.fill(); g.lineWidth = 4 * s; g.strokeStyle = '#fff'; g.stroke();
      }
    }
  }

  // Nummern sammeln, überlappende auseinanderschieben
  const r = 24 * s;
  const marken = [
    ...formen.map(({ messung, nr }) => {
      const [x, y] = px(...beschriftungsPunkt(messung));
      return { x, y, ox: x, oy: y, nr, art: 'form', farbe: FORM_FARBE[messung.typ] || '#455a64' };
    }),
    ...punkte.map((p) => { const [x, y] = px(p.lat, p.lng); return { x, y, ox: x, oy: y, nr: p.nr, art: 'punkt', farbe: p.farbe }; }),
  ];
  entzerren(marken, 2 * r + 6 * s, B, H, r + 4);

  // Verschobene Nummern: kleiner Punkt an der echten Stelle und Verbindungslinie
  for (const m of marken) {
    if (Math.hypot(m.x - m.ox, m.y - m.oy) < r * 0.5) continue;
    g.beginPath(); g.moveTo(m.ox, m.oy); g.lineTo(m.x, m.y);
    g.lineWidth = 5 * s; g.strokeStyle = '#fff'; g.stroke();
    g.lineWidth = 2.5 * s; g.strokeStyle = '#1b1f1d'; g.stroke();
    if (m.art === 'punkt') {
      g.beginPath(); g.arc(m.ox, m.oy, 7 * s, 0, Math.PI * 2);
      g.fillStyle = m.farbe; g.fill(); g.lineWidth = 3 * s; g.strokeStyle = '#fff'; g.stroke();
    }
  }
  // Hohe Nummern zuerst, damit Nr. 1 oben liegt
  for (const m of [...marken].sort((a, b) => b.nr - a.nr)) {
    g.beginPath();
    g.arc(m.x, m.y, r, 0, Math.PI * 2);
    if (m.art === 'form') {
      g.fillStyle = '#fff'; g.fill();
      g.lineWidth = 5 * s; g.strokeStyle = m.farbe; g.stroke();
      g.fillStyle = '#1b1f1d';
    } else {
      g.fillStyle = m.farbe; g.fill();
      g.lineWidth = 5 * s; g.strokeStyle = '#fff'; g.stroke();
      g.fillStyle = m.farbe === DRINGLICHKEIT.tief.farbe ? '#1b1f1d' : '#fff';
    }
    g.font = `bold ${Math.round((m.nr > 99 ? 20 : 26) * s)}px Helvetica, Arial, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(m.nr), m.x, m.y + s);
  }

  // Massstab unten links
  const meterProPixel = (156543.03392 * Math.cos((zentrum.lat * Math.PI) / 180)) / 2 ** z;
  const stufen = [2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
  const meter = stufen.find((m) => m / meterProPixel >= 120 * s) || 1000;
  const laenge = meter / meterProPixel;
  g.fillStyle = 'rgba(255,255,255,0.88)';
  g.fillRect(20 * s, H - 70 * s, laenge + 40 * s, 50 * s);
  g.fillStyle = '#1b1f1d';
  g.fillRect(40 * s, H - 36 * s, laenge, 6 * s);
  g.fillRect(40 * s, H - 46 * s, 4 * s, 16 * s);
  g.fillRect(40 * s + laenge - 4 * s, H - 46 * s, 4 * s, 16 * s);
  g.font = `bold ${Math.round(22 * s)}px Helvetica, Arial, sans-serif`;
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.fillText(`${meter} m`, 48 * s, H - 44 * s);

  const bild = canvas.toDataURL('image/jpeg', qualitaet);
  canvas.width = 0; canvas.height = 0;
  return { bild, fehlend, gesamt: aufgaben.length, seitenverhaeltnis: H / B };
}

// Übersicht in doppelter Auflösung (schärfer beim Hineinzoomen im PDF)
const UEBERSICHT = { B: 2800, H: 2000, s: 2, qualitaet: 0.72 };
// Detailausschnitt pro Mangel / Position
const DETAIL = { B: 1000, H: 750, s: 1.2, einzelZoom: 20 };

// Bilder (Detailplan, Fotos) zu zweit nebeneinander setzen.
// bilder: [{ daten, verh (Höhe/Breite), titel, alias, rahmen }]
function bildMasse(bilder, BREITE) {
  const bB = (BREITE - 6) / 2;
  const maxH = 75;
  return bilder.map((b) => {
    let w = bB; let h = w * b.verh;
    if (h > maxH) { h = maxH; w = h / b.verh; }
    return { w, h };
  });
}

function ersteReihe(bilder, BREITE) {
  if (!bilder.length) return 0;
  const masse = bildMasse(bilder, BREITE).slice(0, 2);
  return Math.max(...masse.map((m) => m.h)) + (bilder.slice(0, 2).some((b) => b.titel) ? 7 : 4);
}

function bilderRaster(doc, seite, bilder, L, BREITE) {
  const bB = (BREITE - 6) / 2;
  const masse = bildMasse(bilder, BREITE);
  for (let i = 0; i < bilder.length; i += 2) {
    const reihe = masse.slice(i, i + 2);
    const mitTitel = bilder.slice(i, i + 2).some((b) => b.titel);
    const h = Math.max(...reihe.map((m) => m.h)) + (mitTitel ? 7 : 4);
    seite.platzFuer(h);
    reihe.forEach((m, j) => {
      const b = bilder[i + j];
      const x = L + j * (bB + 6);
      doc.addImage(b.daten, 'JPEG', x, seite.y, m.w, m.h, b.alias, 'NONE');
      if (b.rahmen) { doc.setDrawColor(200, 206, 203); doc.rect(x, seite.y, m.w, m.h); }
      if (b.titel) {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90, 102, 96);
        doc.text(b.titel, x, seite.y + m.h + 4);
      }
    });
    seite.y += h;
  }
}

function fotoBild(f, titel) {
  return { daten: new Uint8Array(f.daten), verh: (f.hoehe || 3) / (f.breite || 4), titel, alias: `foto-${f.id}` };
}

// ---------- PDF ----------

function dateiname(platz) {
  const name = platz.name
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
    .replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue')
    .replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')
    .slice(0, 40) || 'Platz';
  return `Maengelbericht_${name}_${dateiDatum()}.pdf`;
}

// auswahl: 'offen' | 'alle'; mitFotos: boolean; meldung(text) für den Fortschritt
export async function berichtErstellen(platz, { auswahl = 'offen', mitFotos = true, meldung = () => {} } = {}) {
  meldung('PDF-Baustein wird geladen …');
  const JsPdf = await jsPdfLaden();
  const alle = await db.maengelVonPlatz(platz.id);
  const liste = maengelSortieren(auswahl === 'alle' ? alle : alle.filter((m) => !istErledigt(m)));
  const nummeriert = liste.map((m, i) => ({ m, nr: i + 1 }));

  const doc = new JsPdf({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
  doc.setProperties({ title: `Mängelbericht ${platz.name}`, creator: 'Mängel-App Sportplatz' });
  const L = 15; const R = 195; const BREITE = R - L; const UNTEN = 280;
  let y = 18;
  const grau = () => doc.setTextColor(90, 102, 96);
  const schwarz = () => doc.setTextColor(27, 31, 29);
  function neueSeite() { doc.addPage(); y = 18; }
  function platzFuer(h) { if (y + h > UNTEN) neueSeite(); }

  // --- Kopf ---
  const offenAnzahl = alle.filter((m) => !istErledigt(m)).length;
  schwarz();
  doc.setFont('helvetica', 'bold'); doc.setFontSize(20);
  doc.text('Mängelbericht', L, y);
  y += 9;
  doc.setFontSize(14);
  doc.text(doc.splitTextToSize(platz.name, BREITE), L, y);
  y += 7;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); grau();
  doc.text([
    `${platz.ort ? `${platz.ort} · ` : ''}Stand ${datum(new Date().toISOString(), true)}`,
    `${offenAnzahl} offen · ${alle.length - offenAnzahl} erledigt · im Bericht: ${auswahl === 'alle' ? 'alle Mängel' : 'offene Mängel'} (${liste.length})`,
  ], L, y);
  y += 12;

  // --- Plan ---
  meldung('Plan wird gezeichnet …');
  const punkte = nummeriert.map(({ m, nr }) => ({
    lat: m.lat, lng: m.lng, nr, farbe: istErledigt(m) ? ERLEDIGT_FARBE : dringlichkeit(m).farbe,
  }));
  const plan = await planZeichnen({ zentrum: platz, punkte, ...UEBERSICHT });
  const planH = BREITE * plan.seitenverhaeltnis;
  doc.addImage(plan.bild, 'JPEG', L, y, BREITE, planH, 'plan', 'NONE');
  doc.setDrawColor(200, 206, 203); doc.rect(L, y, BREITE, planH);
  y += planH + 4;
  doc.setFontSize(8); grau();
  doc.text(`Luftbild © swisstopo${plan.fehlend ? ` – ${plan.fehlend} von ${plan.gesamt} Kartenteilen nicht verfügbar (offline?)` : ''}`, L, y);
  // Legende
  let lx = L + 105;
  const legende = [...Object.values(DRINGLICHKEIT), ...(auswahl === 'alle' ? [{ text: 'erledigt', farbe: ERLEDIGT_FARBE }] : [])];
  for (const d of legende) {
    doc.setFillColor(d.farbe); doc.circle(lx, y - 1, 1.6, 'F');
    doc.text(d.text, lx + 2.8, y);
    lx += 4 + doc.getTextWidth(d.text) + 4;
  }
  y += 10;

  // --- Übersichtstabelle ---
  const spalten = [
    { titel: 'Nr.', b: 10 }, { titel: 'Kategorie', b: 36 }, { titel: 'Dringl.', b: 17 },
    { titel: 'Status', b: 20 }, { titel: 'Erfasst', b: 21 }, { titel: 'Notiz', b: 76 },
  ];
  function tabellenKopf() {
    doc.setFillColor(231, 236, 233);
    doc.rect(L, y - 4.5, BREITE, 7, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); schwarz();
    let x = L + 1.5;
    for (const s of spalten) { doc.text(s.titel, x, y); x += s.b; }
    y += 6;
    doc.setFont('helvetica', 'normal');
  }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); schwarz();
  platzFuer(20);
  doc.text('Übersicht', L, y);
  y += 7;
  if (nummeriert.length === 0) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); grau();
    doc.text('Keine Mängel für diese Auswahl.', L, y);
    y += 8;
  } else {
    tabellenKopf();
    doc.setFontSize(9);
    for (const { m, nr } of nummeriert) {
      const notiz = [m.notiz, istErledigt(m) && m.erledigtNotiz ? `Erledigt: ${m.erledigtNotiz}` : ''].filter(Boolean).join(' – ') || '–';
      const zellen = [
        String(nr), m.kategorie, dringlichkeit(m).text,
        istErledigt(m) ? `erledigt ${datum(m.erledigtAm)}` : 'offen', datum(m.erstellt), notiz,
      ].map((t, i) => doc.splitTextToSize(t, spalten[i].b - 3));
      const h = Math.max(...zellen.map((z) => z.length)) * 3.9 + 2.5;
      if (y + h > UNTEN) { neueSeite(); tabellenKopf(); doc.setFontSize(9); }
      let x = L + 1.5;
      zellen.forEach((z, i) => {
        if (i === 2) { doc.setTextColor(istErledigt(m) ? '#5b6660' : dringlichkeit(m).farbe === DRINGLICHKEIT.tief.farbe ? '#9a7400' : dringlichkeit(m).farbe); doc.setFont('helvetica', 'bold'); } else { schwarz(); doc.setFont('helvetica', 'normal'); }
        doc.text(z, x, y);
        x += spalten[i].b;
      });
      doc.setDrawColor(225, 230, 227);
      doc.line(L, y + h - 4, R, y + h - 4);
      y += h;
    }
  }

  // --- Einzelne Mängel: Detailplan und Fotos ---
  const seite = { get y() { return y; }, set y(w) { y = w; }, platzFuer };
  if (nummeriert.length) {
    neueSeite();
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); schwarz();
    doc.text('Einzelne Mängel', L, y);
    y += 8;
    let i = 0;
    for (const { m, nr } of nummeriert) {
      i += 1;
      meldung(`Detailpläne${mitFotos ? ' und Fotos' : ''} (${i}/${nummeriert.length}) …`);
      const erledigt = istErledigt(m);
      const farbe = punkte[nr - 1].farbe;
      const [detail, vorher, nachher] = await Promise.all([
        planZeichnen({ zentrum: m, zentrumEinbeziehen: false, punkte: [{ lat: m.lat, lng: m.lng, nr, farbe }], ...DETAIL }),
        mitFotos && m.fotoId ? db.holen('fotos', m.fotoId) : null,
        mitFotos && erledigt && m.fotoNachherId ? db.holen('fotos', m.fotoNachherId) : null,
      ]);
      const bilder = [
        { daten: detail.bild, verh: detail.seitenverhaeltnis, titel: 'Lage', alias: `detail-${m.id}`, rahmen: true },
        ...(vorher ? [fotoBild(vorher, nachher ? 'Vorher' : 'Foto')] : []),
        ...(nachher ? [fotoBild(nachher, 'Nachher')] : []),
      ];
      doc.setFontSize(10);
      const textZeilen = [
        `Dringlichkeit ${dringlichkeit(m).text} · ${erledigt ? `erledigt am ${datum(m.erledigtAm)}` : 'offen'} · erfasst ${datum(m.erstellt, true)}`,
        ...(m.notiz ? doc.splitTextToSize(`Notiz: ${m.notiz}`, BREITE) : []),
        ...(erledigt && m.erledigtNotiz ? doc.splitTextToSize(`Gemacht: ${m.erledigtNotiz}`, BREITE) : []),
      ];
      // Kopf zusammen mit der ersten Bildreihe auf einer Seite halten
      platzFuer(8 + textZeilen.length * 4.6 + ersteReihe(bilder, BREITE));
      doc.setFillColor(farbe);
      doc.circle(L + 3.2, y - 1.3, 3.2, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
      doc.setTextColor(farbe === DRINGLICHKEIT.tief.farbe ? '#1b1f1d' : '#ffffff');
      doc.text(String(nr), L + 3.2, y - 0.2, { align: 'center' });
      doc.setFontSize(12); schwarz();
      doc.text(m.kategorie, L + 9, y);
      y += 6;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10); grau();
      doc.text(textZeilen, L, y);
      y += textZeilen.length * 4.6;
      bilderRaster(doc, seite, bilder, L, BREITE);
      doc.setDrawColor(225, 230, 227);
      doc.line(L, y, R, y);
      y += 8;
    }
  }

  // --- Fusszeile ---
  const seiten = doc.getNumberOfPages();
  for (let s = 1; s <= seiten; s += 1) {
    doc.setPage(s);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); grau();
    doc.text(`Mängelbericht · ${platz.name}`.slice(0, 90), L, 290);
    doc.text(`Seite ${s} von ${seiten}`, R, 290, { align: 'right' });
  }

  meldung('PDF wird gespeichert …');
  const blob = doc.output('blob');
  return { datei: new File([blob], dateiname(platz), { type: 'application/pdf' }), anzahl: liste.length, seiten, planFehlend: plan.fehlend };
}

// ---------- PDF «Aufnahme für Offerte» ----------

function offerteDateiname(offerte) {
  const name = offerte.titel
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
    .replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue')
    .replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')
    .slice(0, 40) || 'Offerte';
  return `Aufnahme_Offerte_${name}_${dateiDatum()}.pdf`;
}

function mengeText(p) {
  if (p.einheit === 'pauschal') return 'pauschal';
  if (p.menge == null || p.menge === '') return '–';
  return `${zahlText(p.menge)} ${p.einheit || ''}`.trim();
}

export async function offerteBerichtErstellen(offerte, { mitFotos = true, meldung = () => {} } = {}) {
  meldung('PDF-Baustein wird geladen …');
  const JsPdf = await jsPdfLaden();
  const positionen = await db.positionenVonOfferte(offerte.id);
  const doc = new JsPdf({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
  doc.setProperties({ title: `Aufnahme für Offerte ${offerte.titel}`, creator: 'Mängel-App Sportplatz' });
  const L = 15; const R = 195; const BREITE = R - L; const UNTEN = 280;
  let y = 18;
  const grau = () => doc.setTextColor(90, 102, 96);
  const schwarz = () => doc.setTextColor(27, 31, 29);
  function neueSeite() { doc.addPage(); y = 18; }
  function platzFuer(h) { if (y + h > UNTEN) neueSeite(); }

  // --- Kopf ---
  schwarz();
  doc.setFont('helvetica', 'bold'); doc.setFontSize(20);
  doc.text('Aufnahme für Offerte', L, y);
  y += 9;
  doc.setFontSize(14);
  const titelZeilen = doc.splitTextToSize(offerte.titel, BREITE);
  doc.text(titelZeilen, L, y);
  y += titelZeilen.length * 6 + 2;

  // Kunde und Angaben in zwei Spalten
  const k = offerte.kunde || {};
  const links = [
    ['Auftraggeber', k.firma], ['Ansprechperson', k.person], ['Telefon', k.telefon], ['E-Mail', k.email],
  ].filter(([, w]) => w);
  const rechts = [
    ['Ort', offerte.ort], ['Begehung', offerte.datum ? datum(offerte.datum) : ''],
    ['Stand', datum(new Date().toISOString(), true)], ['Positionen', String(positionen.length)],
  ].filter(([, w]) => w);
  doc.setFontSize(10);
  const zeileH = 5;
  const spalte = (eintraege, x, breite) => {
    let yy = y;
    for (const [titel, wert] of eintraege) {
      doc.setFont('helvetica', 'normal'); grau();
      doc.text(titel, x, yy);
      doc.setFont('helvetica', 'bold'); schwarz();
      const z = doc.splitTextToSize(String(wert), breite - 30);
      doc.text(z, x + 30, yy);
      yy += Math.max(1, z.length) * zeileH;
    }
    return yy;
  };
  y = Math.max(spalte(links, L, 92), spalte(rechts, L + 95, 85)) + 2;
  if (offerte.notiz) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); grau();
    const z = doc.splitTextToSize(`Notiz: ${offerte.notiz}`, BREITE);
    doc.text(z, L, y);
    y += z.length * 4.6 + 2;
  }
  y += 4;

  // --- Plan ---
  meldung('Plan wird gezeichnet …');
  const formen = positionen.map((p, i) => ({ messung: p.messung, nr: i + 1 })).filter((f) => f.messung && f.messung.punkte.length);
  const plan = await planZeichnen({ zentrum: offerte, formen, ...UEBERSICHT });
  const planH = BREITE * plan.seitenverhaeltnis;
  if (y + planH > UNTEN - 10) neueSeite();
  doc.addImage(plan.bild, 'JPEG', L, y, BREITE, planH, 'plan', 'NONE');
  doc.setDrawColor(200, 206, 203); doc.rect(L, y, BREITE, planH);
  y += planH + 4;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); grau();
  doc.text(`Luftbild © swisstopo${plan.fehlend ? ` – ${plan.fehlend} von ${plan.gesamt} Kartenteilen nicht verfügbar (offline?)` : ''}. Messungen ab Luftbild, Genauigkeit etwa 1–2 %.`, L, y);
  y += 10;

  // --- Positionsliste ---
  const spalten = [
    { titel: 'Nr.', b: 10 }, { titel: 'Art', b: 34 }, { titel: 'Menge', b: 26 }, { titel: 'Beschreibung', b: 110 },
  ];
  function tabellenKopf() {
    doc.setFillColor(231, 236, 233);
    doc.rect(L, y - 4.5, BREITE, 7, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); schwarz();
    let x = L + 1.5;
    for (const s of spalten) { doc.text(s.titel, x, y); x += s.b; }
    y += 6;
    doc.setFont('helvetica', 'normal');
  }
  platzFuer(20);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); schwarz();
  doc.text('Positionen', L, y);
  y += 7;
  if (!positionen.length) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); grau();
    doc.text('Noch keine Positionen erfasst.', L, y);
    y += 8;
  } else {
    tabellenKopf();
    doc.setFontSize(9);
    positionen.forEach((p, i) => {
      // Gemessener Wert nur zusätzlich nennen, wenn die Menge von Hand abweicht
      const gemessen = p.messung ? messText(p.messung) : '';
      const zusatz = gemessen && gemessen !== mengeText(p) ? `${MESS_NAME[p.messung.typ]} gemessen: ${gemessen}` : '';
      const beschreibung = [p.beschreibung, zusatz].filter(Boolean).join(' – ') || '–';
      const zellen = [String(i + 1), p.art, mengeText(p), beschreibung].map((t, j) => doc.splitTextToSize(t, spalten[j].b - 3));
      const h = Math.max(...zellen.map((z) => z.length)) * 3.9 + 2.5;
      if (y + h > UNTEN) { neueSeite(); tabellenKopf(); doc.setFontSize(9); }
      let x = L + 1.5;
      zellen.forEach((z, j) => {
        doc.setFont('helvetica', j === 2 ? 'bold' : 'normal'); schwarz();
        doc.text(z, x, y);
        x += spalten[j].b;
      });
      doc.setDrawColor(225, 230, 227);
      doc.line(L, y + h - 4, R, y + h - 4);
      y += h;
    });
  }

  // --- Positionen im Detail: Detailplan und Fotos ---
  const seite = { get y() { return y; }, set y(w) { y = w; }, platzFuer };
  if (positionen.length) {
    neueSeite();
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); schwarz();
    doc.text('Positionen im Detail', L, y);
    y += 8;
    let zaehler = 0;
    for (const [index, p] of positionen.entries()) {
      const nr = index + 1;
      zaehler += 1;
      meldung(`Detailpläne${mitFotos ? ' und Fotos' : ''} (${zaehler}/${positionen.length}) …`);
      const hatMessung = p.messung && p.messung.punkte && p.messung.punkte.length;
      const [detail, fotos] = await Promise.all([
        hatMessung ? (() => {
          const [lat, lng] = beschriftungsPunkt(p.messung);
          return planZeichnen({ zentrum: { lat, lng }, zentrumEinbeziehen: false, formen: [{ messung: p.messung, nr }], ...DETAIL });
        })() : null,
        mitFotos ? Promise.all((p.fotoIds || []).map((id) => db.holen('fotos', id))) : [],
      ]);
      const bilder = [
        ...(detail ? [{ daten: detail.bild, verh: detail.seitenverhaeltnis, titel: `Lage – ${MESS_NAME[p.messung.typ]} ${messText(p.messung)}`, alias: `detail-${p.id}`, rahmen: true }] : []),
        ...fotos.filter(Boolean).map((f, k) => fotoBild(f, `Foto ${k + 1}`)),
      ];
      doc.setFontSize(10);
      const textZeilen = p.beschreibung ? doc.splitTextToSize(p.beschreibung, BREITE) : [];
      platzFuer(8 + textZeilen.length * 4.6 + ersteReihe(bilder, BREITE));
      const farbe = p.messung ? FORM_FARBE[p.messung.typ] : '#78909c';
      doc.setFillColor(farbe);
      doc.circle(L + 3.2, y - 1.3, 3.2, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor('#ffffff');
      doc.text(String(nr), L + 3.2, y - 0.2, { align: 'center' });
      doc.setFontSize(12); schwarz();
      doc.text(`${p.art} – ${mengeText(p)}`, L + 9, y);
      y += 6;
      if (textZeilen.length) {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(10); grau();
        doc.text(textZeilen, L, y);
        y += textZeilen.length * 4.6;
      }
      if (bilder.length) bilderRaster(doc, seite, bilder, L, BREITE);
      else y += 2;
      doc.setDrawColor(225, 230, 227);
      doc.line(L, y, R, y);
      y += 8;
    }
  }

  // --- Fusszeile ---
  const seiten = doc.getNumberOfPages();
  for (let s = 1; s <= seiten; s += 1) {
    doc.setPage(s);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); grau();
    doc.text(`Aufnahme für Offerte · ${offerte.titel}`.slice(0, 90), L, 290);
    doc.text(`Seite ${s} von ${seiten}`, R, 290, { align: 'right' });
  }
  meldung('PDF wird gespeichert …');
  const blob = doc.output('blob');
  return { datei: new File([blob], offerteDateiname(offerte), { type: 'application/pdf' }), anzahl: positionen.length, seiten, planFehlend: plan.fehlend };
}

// PDF-Bericht pro Platz: Plan mit nummerierten Punkten, Übersichtsliste, Fotos.
/* global jspdf */
import * as db from './db.js';
import { DRINGLICHKEIT, ERLEDIGT_FARBE, istErledigt, dringlichkeit, maengelSortieren } from './konstanten.js';
import { weltPixel, kachelUrl, KACHEL_CACHE } from './karte.js';
import { dateiDatum } from './sicherung.js';

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

async function planZeichnen(platz, punkte, B = 1400, H = 1000) {
  const canvas = document.createElement('canvas');
  canvas.width = B; canvas.height = H;
  const g = canvas.getContext('2d');
  g.fillStyle = '#dfe5e2';
  g.fillRect(0, 0, B, H);

  const lats = [platz.lat, ...punkte.map((p) => p.lat)];
  const lngs = [platz.lng, ...punkte.map((p) => p.lng)];
  const nord = Math.max(...lats); const sued = Math.min(...lats);
  const west = Math.min(...lngs); const ost = Math.max(...lngs);
  const rand = 110;
  // Grösste Zoomstufe, bei der alle Punkte Platz haben (bei wenigen Punkten nicht zu nah)
  let z = punkte.length > 1 ? 20 : 19;
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

  // Punkte: hohe Nummern zuerst, damit Nr. 1 oben liegt
  for (const p of [...punkte].reverse()) {
    const w = weltPixel(p.lat, p.lng, z);
    const x = w.x - x0; const y = w.y - y0;
    g.beginPath();
    g.arc(x, y, 24, 0, Math.PI * 2);
    g.fillStyle = p.farbe;
    g.fill();
    g.lineWidth = 5;
    g.strokeStyle = '#fff';
    g.stroke();
    g.fillStyle = p.farbe === DRINGLICHKEIT.tief.farbe ? '#1b1f1d' : '#fff';
    g.font = `bold ${p.nr > 99 ? 20 : 26}px Helvetica, Arial, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(p.nr), x, y + 1);
  }

  // Massstab unten links
  const meterProPixel = (156543.03392 * Math.cos((platz.lat * Math.PI) / 180)) / 2 ** z;
  const stufen = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
  const meter = stufen.find((m) => m / meterProPixel >= 120) || 1000;
  const laenge = meter / meterProPixel;
  g.fillStyle = 'rgba(255,255,255,0.88)';
  g.fillRect(20, H - 70, laenge + 40, 50);
  g.fillStyle = '#1b1f1d';
  g.fillRect(40, H - 36, laenge, 6);
  g.fillRect(40, H - 46, 4, 16);
  g.fillRect(40 + laenge - 4, H - 46, 4, 16);
  g.font = 'bold 22px Helvetica, Arial, sans-serif';
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.fillText(`${meter} m`, 48, H - 44);

  const bild = canvas.toDataURL('image/jpeg', 0.85);
  canvas.width = 0; canvas.height = 0;
  return { bild, fehlend, gesamt: aufgaben.length, seitenverhaeltnis: H / B };
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
  const plan = await planZeichnen(platz, punkte);
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

  // --- Einzelne Mängel mit Fotos ---
  if (mitFotos && nummeriert.length) {
    neueSeite();
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); schwarz();
    doc.text('Einzelne Mängel', L, y);
    y += 8;
    let i = 0;
    for (const { m, nr } of nummeriert) {
      i += 1;
      meldung(`Fotos werden eingefügt (${i}/${nummeriert.length}) …`);
      const erledigt = istErledigt(m);
      const [vorher, nachher] = await Promise.all([
        m.fotoId ? db.holen('fotos', m.fotoId) : null,
        erledigt && m.fotoNachherId ? db.holen('fotos', m.fotoNachherId) : null,
      ]);
      const fotos = [[vorher, 'Vorher'], [nachher, 'Nachher']].filter(([f]) => f);
      // Bildgrössen berechnen
      // So bemessen, dass meist zwei Mängel auf eine Seite passen
      const maxB = fotos.length > 1 ? (BREITE - 6) / 2 : 110;
      const maxH = fotos.length > 1 ? 92 : 95;
      const masse = fotos.map(([f]) => {
        const v = (f.hoehe || 3) / (f.breite || 4);
        let b = maxB; let h = b * v;
        if (h > maxH) { h = maxH; b = h / v; }
        return { b, h };
      });
      const bildH = masse.length ? Math.max(...masse.map((x) => x.h)) + (fotos.length > 1 ? 6 : 2) : 0;
      doc.setFontSize(10);
      const textZeilen = [
        `Dringlichkeit ${dringlichkeit(m).text} · ${erledigt ? `erledigt am ${datum(m.erledigtAm)}` : 'offen'} · erfasst ${datum(m.erstellt, true)}`,
        ...(m.notiz ? doc.splitTextToSize(`Notiz: ${m.notiz}`, BREITE) : []),
        ...(erledigt && m.erledigtNotiz ? doc.splitTextToSize(`Gemacht: ${m.erledigtNotiz}`, BREITE) : []),
      ];
      platzFuer(10 + textZeilen.length * 4.6 + bildH + 8);
      doc.setFillColor(punkte[nr - 1].farbe);
      doc.circle(L + 3.2, y - 1.3, 3.2, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
      doc.setTextColor(punkte[nr - 1].farbe === DRINGLICHKEIT.tief.farbe ? '#1b1f1d' : '#ffffff');
      doc.text(String(nr), L + 3.2, y - 0.2, { align: 'center' });
      doc.setFontSize(12); schwarz();
      doc.text(m.kategorie, L + 9, y);
      y += 6;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10); grau();
      doc.text(textZeilen, L, y);
      y += textZeilen.length * 4.6 + 2;
      if (fotos.length) {
        let x = L;
        fotos.forEach(([f, titel], k) => {
          const { b, h } = masse[k];
          doc.addImage(new Uint8Array(f.daten), 'JPEG', x, y, b, h, `foto-${f.id}`, 'NONE');
          if (fotos.length > 1) {
            doc.setFontSize(9); grau();
            doc.text(titel, x, y + h + 4);
          }
          x += maxB + 6;
        });
        y += bildH;
      } else {
        doc.setFontSize(9); grau();
        doc.text('Kein Foto', L, y + 2);
        y += 6;
      }
      doc.setDrawColor(225, 230, 227);
      doc.line(L, y + 2, R, y + 2);
      y += 9;
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

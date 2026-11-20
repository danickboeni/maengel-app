// Fotos verkleinern, bevor sie gespeichert werden.

const MAX_SEITE = 1600;      // längste Seite in Pixel
const QUALITAET = 0.8;       // JPEG-Qualität
const VORSCHAU_SEITE = 240;  // kleines Bild für Listen
const VORSCHAU_QUALITAET = 0.7;

function bildLaden(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Dieses Bild kann nicht gelesen werden.')); };
    img.src = url;
  });
}

async function bildQuelle(blob) {
  try {
    const quelle = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    return { quelle, breite: quelle.width, hoehe: quelle.height };
  } catch (_) {
    const quelle = await bildLaden(blob);
    return { quelle, breite: quelle.naturalWidth, hoehe: quelle.naturalHeight };
  }
}

async function skalieren({ quelle, breite, hoehe }, maxSeite, qualitaet) {
  const faktor = Math.min(1, maxSeite / Math.max(breite, hoehe));
  const b = Math.round(breite * faktor);
  const h = Math.round(hoehe * faktor);
  const canvas = document.createElement('canvas');
  canvas.width = b; canvas.height = h;
  canvas.getContext('2d').drawImage(quelle, 0, 0, b, h);
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((bl) => (bl ? resolve(bl) : reject(new Error('Foto konnte nicht verarbeitet werden.'))), 'image/jpeg', qualitaet);
  });
  canvas.width = 0; canvas.height = 0; // Speicher freigeben (iOS)
  return { daten: await blob.arrayBuffer(), typ: 'image/jpeg', breite: b, hoehe: h, groesse: blob.size };
}

// Liefert { daten, typ, breite, hoehe, groesse, vorschau: { daten, typ } }.
export async function verkleinern(datei) {
  const bild = await bildQuelle(datei);
  try {
    const gross = await skalieren(bild, MAX_SEITE, QUALITAET);
    const klein = await skalieren(bild, VORSCHAU_SEITE, VORSCHAU_QUALITAET);
    return { ...gross, vorschau: { daten: klein.daten, typ: klein.typ } };
  } finally {
    if (bild.quelle.close) bild.quelle.close();
  }
}

// Erzeugt ein Vorschaubild aus einem gespeicherten Foto (für Fotos aus Etappe 1).
export async function vorschauAusFoto(foto) {
  const bild = await bildQuelle(new Blob([foto.daten], { type: foto.typ || 'image/jpeg' }));
  try {
    const klein = await skalieren(bild, VORSCHAU_SEITE, VORSCHAU_QUALITAET);
    return { daten: klein.daten, typ: klein.typ };
  } finally {
    if (bild.quelle.close) bild.quelle.close();
  }
}

export function alsUrl(foto) {
  return URL.createObjectURL(new Blob([foto.daten], { type: foto.typ || 'image/jpeg' }));
}

// Fotos verkleinern, bevor sie gespeichert werden.

const MAX_SEITE = 1600;   // längste Seite in Pixel
const QUALITAET = 0.8;    // JPEG-Qualität

function bildLaden(datei) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(datei);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Dieses Bild kann nicht gelesen werden.')); };
    img.src = url;
  });
}

// Liefert { daten: ArrayBuffer, typ, breite, hoehe, groesse }.
export async function verkleinern(datei) {
  let quelle; let breite; let hoehe;
  try {
    quelle = await createImageBitmap(datei, { imageOrientation: 'from-image' });
    breite = quelle.width; hoehe = quelle.height;
  } catch (_) {
    quelle = await bildLaden(datei);
    breite = quelle.naturalWidth; hoehe = quelle.naturalHeight;
  }
  const faktor = Math.min(1, MAX_SEITE / Math.max(breite, hoehe));
  const b = Math.round(breite * faktor);
  const h = Math.round(hoehe * faktor);
  const canvas = document.createElement('canvas');
  canvas.width = b; canvas.height = h;
  canvas.getContext('2d').drawImage(quelle, 0, 0, b, h);
  if (quelle.close) quelle.close();
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((bl) => (bl ? resolve(bl) : reject(new Error('Foto konnte nicht verarbeitet werden.'))), 'image/jpeg', QUALITAET);
  });
  canvas.width = 0; canvas.height = 0; // Speicher freigeben (iOS)
  return { daten: await blob.arrayBuffer(), typ: 'image/jpeg', breite: b, hoehe: h, groesse: blob.size };
}

export function alsUrl(foto) {
  return URL.createObjectURL(new Blob([foto.daten], { type: foto.typ || 'image/jpeg' }));
}

// Messen auf dem Luftbild: Fläche (m²), Länge (m) und Punkte (Stk)
/* global L */
import { distanz } from './karte.js';

export const EINHEITEN = ['m²', 'm', 'Stk', 'pauschal'];
export const MESS_EINHEIT = { flaeche: 'm²', linie: 'm', punkt: 'Stk' };
export const MESS_NAME = { flaeche: 'Fläche', linie: 'Länge', punkt: 'Punkte' };
export const FORM_FARBE = { flaeche: '#1565c0', linie: '#e65100', punkt: '#6a1b9a' };

const ERDRADIUS = 6371008.8;

function zuPunkt(p) { return { lat: p[0], lng: p[1] }; }

export function laenge(punkte) {
  let summe = 0;
  for (let i = 1; i < punkte.length; i += 1) summe += distanz(zuPunkt(punkte[i - 1]), zuPunkt(punkte[i]));
  return summe;
}

// Fläche über eine örtliche Projektion in Meter (genau genug für Sportplätze)
export function flaeche(punkte) {
  if (punkte.length < 3) return 0;
  const lat0 = punkte.reduce((s, p) => s + p[0], 0) / punkte.length;
  const lng0 = punkte.reduce((s, p) => s + p[1], 0) / punkte.length;
  const rad = Math.PI / 180;
  const xy = punkte.map(([lat, lng]) => [
    (lng - lng0) * rad * ERDRADIUS * Math.cos(lat0 * rad),
    (lat - lat0) * rad * ERDRADIUS,
  ]);
  let summe = 0;
  for (let i = 0; i < xy.length; i += 1) {
    const [x1, y1] = xy[i];
    const [x2, y2] = xy[(i + 1) % xy.length];
    summe += x1 * y2 - x2 * y1;
  }
  return Math.abs(summe) / 2;
}

export function messwert(messung) {
  if (!messung || !messung.punkte || !messung.punkte.length) return null;
  if (messung.typ === 'flaeche') return messung.punkte.length >= 3 ? flaeche(messung.punkte) : null;
  if (messung.typ === 'linie') return messung.punkte.length >= 2 ? laenge(messung.punkte) : null;
  if (messung.typ === 'punkt') return messung.punkte.length;
  return null;
}

// Für die Menge: Fläche auf ganze m², Länge auf 0.5 m
export function messMenge(messung) {
  const w = messwert(messung);
  if (w == null) return null;
  if (messung.typ === 'linie') return Math.round(w * 2) / 2;
  return Math.round(w);
}

export function zahlText(n) {
  if (n == null || n === '' || Number.isNaN(Number(n))) return '';
  return Number(n).toLocaleString('de-CH', { maximumFractionDigits: 2 });
}

export function messText(messung) {
  const m = messMenge(messung);
  if (m == null) return '';
  return `${zahlText(m)} ${MESS_EINHEIT[messung.typ]}`;
}

// Stelle für die Nummer: Schwerpunkt der Ecken bzw. Mitte der Linie
export function beschriftungsPunkt(messung) {
  const p = messung.punkte;
  if (messung.typ === 'flaeche' && p.length >= 3) {
    return [p.reduce((s, x) => s + x[0], 0) / p.length, p.reduce((s, x) => s + x[1], 0) / p.length];
  }
  if (messung.typ === 'linie' && p.length >= 2) {
    const halbe = laenge(p) / 2;
    let weg = 0;
    for (let i = 1; i < p.length; i += 1) {
      const d = distanz(zuPunkt(p[i - 1]), zuPunkt(p[i]));
      if (weg + d >= halbe) {
        const t = d ? (halbe - weg) / d : 0;
        return [p[i - 1][0] + (p[i][0] - p[i - 1][0]) * t, p[i - 1][1] + (p[i][1] - p[i - 1][1]) * t];
      }
      weg += d;
    }
  }
  return p[0];
}

function nummerIcon(nr, farbe) {
  return L.divIcon({
    className: 'form-nr-icon',
    html: `<span class="form-nr" style="background:${farbe}">${nr}</span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

// Zeichnet eine gespeicherte Messung (nur ansehen). Liefert eine Ebene oder null.
export function formZeichnen(messung, { nr = null, gedimmt = false, klick = null } = {}) {
  if (!messung || !messung.punkte || !messung.punkte.length) return null;
  const farbe = FORM_FARBE[messung.typ] || '#455a64';
  const stil = { color: farbe, weight: 4, opacity: gedimmt ? 0.45 : 1, fillOpacity: gedimmt ? 0.08 : 0.22, interactive: !!klick };
  const ebene = L.layerGroup();
  const p = messung.punkte;
  if (messung.typ === 'flaeche' && p.length >= 3) L.polygon(p, stil).addTo(ebene);
  else if (messung.typ !== 'punkt' && p.length >= 2) L.polyline(p, stil).addTo(ebene);
  if (messung.typ === 'punkt' || p.length === 1) {
    for (const x of p) L.circleMarker(x, { radius: 7, color: '#fff', weight: 2, fillColor: farbe, fillOpacity: gedimmt ? 0.5 : 1, interactive: !!klick }).addTo(ebene);
  }
  if (nr != null) {
    L.marker(beschriftungsPunkt(messung), { icon: nummerIcon(nr, farbe), interactive: !!klick, keyboard: false, opacity: gedimmt ? 0.6 : 1 }).addTo(ebene);
  }
  if (klick) ebene.eachLayer((l) => l.on('click', klick));
  return ebene;
}

// Werkzeug zum Messen: Tippen auf die Karte setzt Punkte, Punkte lassen sich verschieben.
export class Messwerkzeug {
  constructor(karte, { beiAenderung = () => {} } = {}) {
    this.karte = karte;
    this.beiAenderung = beiAenderung;
    this.typ = null;
    this.punkte = [];
    this.ebene = L.layerGroup().addTo(karte);
    this.klick = (ev) => {
      if (!this.typ) return;
      this.punkte.push([ev.latlng.lat, ev.latlng.lng]);
      this.zeichnen();
      this.beiAenderung();
    };
    karte.on('click', this.klick);
  }

  setzen(messung) {
    this.typ = messung ? messung.typ : null;
    this.punkte = messung ? messung.punkte.map((p) => [...p]) : [];
    this.zeichnen();
  }

  typSetzen(typ) {
    this.typ = typ;
    // Doppeltippen soll beim Messen keinen Zoom auslösen
    if (typ) this.karte.doubleClickZoom.disable(); else this.karte.doubleClickZoom.enable();
    this.zeichnen();
    this.beiAenderung();
  }

  rueckgaengig() {
    this.punkte.pop();
    this.zeichnen();
    this.beiAenderung();
  }

  leeren() {
    this.punkte = [];
    this.zeichnen();
    this.beiAenderung();
  }

  messung() {
    return this.typ && this.punkte.length ? { typ: this.typ, punkte: this.punkte.map((p) => [...p]) } : null;
  }

  zeichnen() {
    this.ebene.clearLayers();
    if (!this.typ) return;
    const farbe = FORM_FARBE[this.typ];
    const p = this.punkte;
    if (this.typ === 'flaeche' && p.length >= 3) L.polygon(p, { color: farbe, weight: 3, fillOpacity: 0.25, interactive: false }).addTo(this.ebene);
    else if (this.typ !== 'punkt' && p.length >= 2) L.polyline(p, { color: farbe, weight: 4, interactive: false }).addTo(this.ebene);
    p.forEach((punkt, i) => {
      const m = L.marker(punkt, {
        draggable: true,
        icon: L.divIcon({ className: 'mess-punkt-icon', html: `<span class="mess-punkt" style="border-color:${farbe}"></span>`, iconSize: [30, 30], iconAnchor: [15, 15] }),
      }).addTo(this.ebene);
      m.on('drag', (ev) => {
        const ll = ev.target.getLatLng();
        this.punkte[i] = [ll.lat, ll.lng];
        // Nur die Form neu zeichnen, nicht die Punkte (sonst bricht das Ziehen ab)
        this.ebene.eachLayer((l) => { if (l.setLatLngs) l.setLatLngs(this.punkte); });
      });
      m.on('dragend', () => this.beiAenderung());
    });
  }

  entfernen() {
    this.karte.off('click', this.klick);
    this.ebene.remove();
  }
}

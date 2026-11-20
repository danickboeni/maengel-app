// Mängel-App Sportplatz – Bildschirme und Navigation
/* global L */
import * as db from './db.js';
import { verkleinern, alsUrl } from './foto.js';
import { SCHWEIZ, karteErstellen, karteEntfernen, pinHtml, punktIcon, gpsBeobachten, distanz } from './karte.js';

export const KATEGORIEN = [
  'Belag / Kunstrasen', 'Naturrasen', 'Linierung', 'Tore / Netze', 'Zaun / Ballfang',
  'Entwässerung', 'Beleuchtung', 'Ausstattung', 'Sonstiges',
];

export const DRINGLICHKEIT = {
  hoch: { text: 'hoch', farbe: '#d32f2f' },
  mittel: { text: 'mittel', farbe: '#f57c00' },
  tief: { text: 'tief', farbe: '#f2b600' },
};

const ansicht = document.getElementById('ansicht');
const titelEl = document.getElementById('titel');
const zurueckBtn = document.getElementById('zurueck');
const kopfAktion = document.getElementById('kopf-aktion');

// ---------- Hilfsfunktionen ----------

function esc(text) {
  return String(text ?? '').replace(/[&<>"']/g, (z) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[z]));
}

function datum(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

let meldungTimer = null;
function meldung(text, fehler = false) {
  const el = document.getElementById('meldung');
  el.textContent = text;
  el.classList.toggle('fehler', fehler);
  el.hidden = false;
  clearTimeout(meldungTimer);
  meldungTimer = setTimeout(() => { el.hidden = true; }, fehler ? 5000 : 2500);
}

function anzahlText(n) {
  return n === 1 ? '1 Mangel' : `${n} Mängel`;
}

// ---------- Navigation ----------
// Eigener Verlauf, damit «Zurück» in der App und die Zurück-Geste des Handys zusammenpassen.

const verlauf = [location.hash || '#/'];
let naechsteErsetzt = false;
let aktuelleAnsicht = { aufraeumen: [], schutz: null };

function aktuellerHash() { return location.hash || '#/'; }

export function gehe(hash) { location.hash = hash; }

// Ersetzt den aktuellen Eintrag (z. B. nach dem Speichern eines Formulars).
function ersetze(hash) {
  aktuelleAnsicht.schutz = null;
  naechsteErsetzt = true;
  location.replace(hash);
}

// Geht zu einer übergeordneten Ansicht zurück: über den Verlauf, falls sie dort schon liegt,
// sonst durch Ersetzen. Der Schutz vor ungespeicherten Änderungen wird dabei aufgehoben.
function zurueckZu(hash) {
  aktuelleAnsicht.schutz = null;
  const idx = verlauf.lastIndexOf(hash, verlauf.length - 2);
  if (idx >= 0) {
    history.go(idx - (verlauf.length - 1));
  } else {
    ersetze(hash);
  }
}

function kopf(titel, zurueck, aktion) {
  titelEl.textContent = titel;
  document.title = titel === 'Plätze' ? 'Mängel Sportplatz' : `${titel} – Mängel`;
  zurueckBtn.hidden = !zurueck;
  zurueckBtn.onclick = zurueck ? () => {
    if (aktuelleAnsicht.schutz && !aktuelleAnsicht.schutz()) return;
    zurueckZu(zurueck);
  } : null;
  if (aktion) {
    kopfAktion.hidden = false;
    kopfAktion.textContent = aktion.text;
    kopfAktion.onclick = aktion.klick;
  } else {
    kopfAktion.hidden = true;
    kopfAktion.onclick = null;
  }
}

function beimVerlassen(fn) { aktuelleAnsicht.aufraeumen.push(fn); }
function schutz(fn) { aktuelleAnsicht.schutz = fn; }

const routen = [
  [/^#\/?$/, () => plaetzeListe()],
  [/^#\/platz\/neu$/, () => platzFormular(null)],
  [/^#\/platz\/([\w-]+)\/bearbeiten$/, (m) => platzFormular(m[1])],
  [/^#\/platz\/([\w-]+)\/mangel\/neu$/, (m) => mangelFormular({ platzId: m[1] })],
  [/^#\/platz\/([\w-]+)$/, (m) => platzAnsicht(m[1])],
  [/^#\/mangel\/([\w-]+)\/bearbeiten$/, (m) => mangelFormular({ mangelId: m[1] })],
  [/^#\/mangel\/([\w-]+)$/, (m) => mangelAnsicht(m[1])],
];

async function zeigen() {
  for (const fn of aktuelleAnsicht.aufraeumen) { try { fn(); } catch (_) { /* egal */ } }
  aktuelleAnsicht = { aufraeumen: [], schutz: null };
  ansicht.innerHTML = '';
  ansicht.className = '';
  ansicht.scrollTop = 0;
  const hash = aktuellerHash();
  for (const [muster, fn] of routen) {
    const m = hash.match(muster);
    if (m) {
      try {
        await fn(m);
      } catch (e) {
        console.error(e);
        ansicht.innerHTML = `<div class="leer"><p>Fehler: ${esc(e.message)}</p><a class="knopf" href="#/">Zur Übersicht</a></div>`;
      }
      return;
    }
  }
  ersetze('#/');
}

window.addEventListener('hashchange', (ev) => {
  const neu = aktuellerHash();
  const alt = verlauf[verlauf.length - 1];
  if (aktuelleAnsicht.schutz && !aktuelleAnsicht.schutz()) {
    // Verlassen abgelehnt: alte Adresse wiederherstellen, ohne neu zu zeichnen
    history.pushState(null, '', alt);
    return;
  }
  if (naechsteErsetzt) {
    verlauf[verlauf.length - 1] = neu;
    naechsteErsetzt = false;
  } else {
    // Liegt die Adresse schon im Verlauf, war es ein Schritt zurück
    const idx = verlauf.lastIndexOf(neu, verlauf.length - 2);
    if (idx >= 0) verlauf.length = idx + 1;
    else if (neu !== alt) verlauf.push(neu);
  }
  void ev;
  zeigen();
});

// ---------- Ansicht: Plätze ----------

async function plaetzeListe() {
  kopf('Plätze', null, null);
  const [plaetze, maengel] = await Promise.all([db.alle('plaetze'), db.alle('maengel')]);
  plaetze.sort((a, b) => a.name.localeCompare(b.name, 'de-CH'));
  const zaehler = {};
  for (const m of maengel) {
    const z = zaehler[m.platzId] || (zaehler[m.platzId] = { total: 0, hoch: 0 });
    z.total += 1;
    if (m.dringlichkeit === 'hoch') z.hoch += 1;
  }

  ansicht.className = 'mit-aktionen';
  ansicht.innerHTML = `
    ${plaetze.length === 0 ? `
      <div class="leer">
        <p><strong>Noch keine Plätze.</strong></p>
        <p>Tippe unten auf «+ Platz», um den ersten Sportplatz anzulegen.</p>
      </div>` : `
      <ul class="liste">
        ${plaetze.map((p) => {
          const z = zaehler[p.id] || { total: 0, hoch: 0 };
          return `<li><a class="eintrag" href="#/platz/${p.id}">
            <span class="eintrag-text">
              <span class="eintrag-titel">${esc(p.name)}</span>
              <span class="eintrag-unter">${esc(p.ort || '')}</span>
            </span>
            <span class="eintrag-zahlen">
              <span>${anzahlText(z.total)}</span>
              ${z.hoch ? `<span class="marke" style="background:${DRINGLICHKEIT.hoch.farbe}">${z.hoch} dringend</span>` : ''}
            </span>
          </a></li>`;
        }).join('')}
      </ul>`}
    <div class="aktionen"><a class="knopf haupt" href="#/platz/neu">+ Platz</a></div>`;
}

// ---------- Ansicht: Platz anlegen / bearbeiten ----------

async function platzFormular(platzId) {
  let platz = null;
  if (platzId) {
    platz = await db.holen('plaetze', platzId);
    if (!platz) throw new Error('Platz nicht gefunden.');
  }
  const zurueck = platz ? `#/platz/${platz.id}` : '#/';
  kopf(platz ? 'Platz bearbeiten' : 'Neuer Platz', zurueck, null);

  ansicht.className = 'mit-aktionen';
  ansicht.innerHTML = `
    <form id="platz-form" class="formular" novalidate>
      <label class="feld">Name des Platzes
        <input name="name" required maxlength="80" autocomplete="off" placeholder="z. B. Sportanlage Allmend, Platz 2" value="${esc(platz?.name)}">
      </label>
      <label class="feld">Ort
        <input name="ort" maxlength="80" autocomplete="off" placeholder="z. B. Bern" value="${esc(platz?.ort)}">
      </label>
      <div class="feld">
        <span>Lage auf der Karte</span>
        <span class="hinweis">Schiebe die Karte, bis die Platzmitte unter dem Pin liegt.</span>
        <div class="karte-rahmen">
          <div id="karte" class="karte"></div>
          ${pinHtml('pin-platz')}
          <button type="button" id="gps-knopf" class="karte-knopf">Meine Position</button>
        </div>
        <span id="gps-status" class="hinweis"></span>
      </div>
      ${platz ? '<button type="button" id="loeschen" class="knopf gefahr">Platz löschen</button>' : ''}
    </form>
    <div class="aktionen"><button type="submit" form="platz-form" class="knopf haupt">Speichern</button></div>`;

  const form = document.getElementById('platz-form');
  const start = platz ? { lat: platz.lat, lng: platz.lng, zoom: platz.zoom || 18 } : SCHWEIZ;
  const karte = karteErstellen(document.getElementById('karte'), start);
  beimVerlassen(() => karteEntfernen(karte));

  let geaendert = false;
  form.addEventListener('input', () => { geaendert = true; });
  karte.on('dragstart zoomstart', () => { geaendert = true; });
  schutz(() => !geaendert || confirm('Änderungen verwerfen?'));

  // GPS nur auf Knopfdruck, bei neuem Platz einmal automatisch
  const status = document.getElementById('gps-status');
  let vonHandVerschoben = !!platz;
  karte.on('dragstart', () => { vonHandVerschoben = true; });
  let stopp = null;
  function gpsStarten(springen) {
    if (stopp) stopp();
    status.textContent = 'Suche GPS …';
    let erstes = true;
    stopp = gpsBeobachten((pos) => {
      status.textContent = `GPS gefunden (± ${pos.genauigkeit} m)`;
      if (springen && (erstes || !vonHandVerschoben)) {
        karte.setView([pos.lat, pos.lng], Math.max(karte.getZoom(), 18));
        erstes = false;
      }
    }, (fehler) => { status.textContent = fehler; });
  }
  beimVerlassen(() => { if (stopp) stopp(); });
  document.getElementById('gps-knopf').onclick = () => { vonHandVerschoben = false; gpsStarten(true); };
  if (!platz) gpsStarten(true);

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const name = form.name.value.trim();
    if (!name) { meldung('Bitte einen Namen eingeben.', true); form.name.focus(); return; }
    if (!platz && karte.getZoom() < 15) {
      meldung('Zoome näher an den Platz heran, damit die Lage stimmt.', true);
      return;
    }
    const mitte = karte.getCenter();
    try {
      const gespeichert = await db.platzSpeichern({
        ...(platz || {}),
        name,
        ort: form.ort.value.trim(),
        lat: mitte.lat,
        lng: mitte.lng,
        zoom: karte.getZoom(),
      });
      db.dauerhaftAnfragen();
      meldung('Platz gespeichert');
      if (platz) zurueckZu(`#/platz/${gespeichert.id}`);
      else ersetze(`#/platz/${gespeichert.id}`);
    } catch (e) {
      meldung(`Speichern fehlgeschlagen: ${e.message}`, true);
    }
  });

  if (platz) {
    document.getElementById('loeschen').onclick = async () => {
      const anzahl = (await db.maengelVonPlatz(platz.id)).length;
      const frage = anzahl
        ? `Platz «${platz.name}» mit ${anzahlText(anzahl)} und allen Fotos endgültig löschen?`
        : `Platz «${platz.name}» endgültig löschen?`;
      if (!confirm(frage)) return;
      await db.platzLoeschen(platz.id);
      meldung('Platz gelöscht');
      zurueckZu('#/');
    };
  }
}

// ---------- Ansicht: Platz mit Mängeln auf der Karte ----------

async function platzAnsicht(platzId) {
  const platz = await db.holen('plaetze', platzId);
  if (!platz) throw new Error('Platz nicht gefunden.');
  const maengel = await db.maengelVonPlatz(platzId);
  kopf(platz.name, '#/', { text: 'Bearbeiten', klick: () => gehe(`#/platz/${platz.id}/bearbeiten`) });

  ansicht.className = 'voll mit-aktionen';
  ansicht.innerHTML = `
    <div class="karte-rahmen voll">
      <div id="karte" class="karte"></div>
      <div class="karte-info">
        ${maengel.length ? anzahlText(maengel.length) : 'Noch keine Mängel. Tippe auf «+ Mangel».'}
        ${maengel.length ? `<span class="legende">
          ${Object.values(DRINGLICHKEIT).map((d) => `<span><i style="background:${d.farbe}"></i>${d.text}</span>`).join('')}
        </span>` : ''}
      </div>
    </div>
    <div class="aktionen"><a class="knopf haupt" href="#/platz/${platz.id}/mangel/neu">+ Mangel</a></div>`;

  const karte = karteErstellen(document.getElementById('karte'), { lat: platz.lat, lng: platz.lng, zoom: platz.zoom || 18 });
  beimVerlassen(() => karteEntfernen(karte));

  // Dringende Punkte zuletzt zeichnen, damit sie oben liegen
  const reihenfolge = { tief: 0, mittel: 1, hoch: 2 };
  const sortiert = [...maengel].sort((a, b) => (reihenfolge[a.dringlichkeit] ?? 0) - (reihenfolge[b.dringlichkeit] ?? 0));
  for (const m of sortiert) {
    const farbe = (DRINGLICHKEIT[m.dringlichkeit] || DRINGLICHKEIT.mittel).farbe;
    L.marker([m.lat, m.lng], { icon: punktIcon(farbe, m.status === 'erledigt'), title: m.kategorie, keyboard: true })
      .on('click', () => gehe(`#/mangel/${m.id}`))
      .addTo(karte);
  }
  if (maengel.length) {
    const grenzen = L.latLngBounds(maengel.map((m) => [m.lat, m.lng]));
    grenzen.extend([platz.lat, platz.lng]);
    karte.fitBounds(grenzen, { padding: [40, 40], maxZoom: Math.max(platz.zoom || 18, 19) });
  }
}

// ---------- Ansicht: Mangel erfassen / bearbeiten ----------

async function mangelFormular({ platzId, mangelId }) {
  let mangel = null;
  if (mangelId) {
    mangel = await db.holen('maengel', mangelId);
    if (!mangel) throw new Error('Mangel nicht gefunden.');
    platzId = mangel.platzId;
  }
  const platz = await db.holen('plaetze', platzId);
  if (!platz) throw new Error('Platz nicht gefunden.');
  const zurueck = mangel ? `#/mangel/${mangel.id}` : `#/platz/${platz.id}`;
  kopf(mangel ? 'Mangel bearbeiten' : 'Neuer Mangel', zurueck, null);

  const bestehendesFoto = mangel?.fotoId ? await db.holen('fotos', mangel.fotoId) : null;
  const wahl = { kategorie: mangel?.kategorie || '', dringlichkeit: mangel?.dringlichkeit || 'mittel' };

  ansicht.className = 'mit-aktionen';
  ansicht.innerHTML = `
    <form id="mangel-form" class="formular" novalidate>
      <div class="feld">
        <span>Stelle</span>
        <span class="hinweis">Schiebe die Karte, bis der Pin genau auf der Schadstelle liegt.</span>
        <div class="karte-rahmen gross">
          <div id="karte" class="karte"></div>
          ${pinHtml('pin-mangel')}
          <button type="button" id="gps-knopf" class="karte-knopf">Zum GPS</button>
        </div>
        <span id="gps-status" class="hinweis"></span>
      </div>

      <div class="feld">
        <span>Foto</span>
        <div id="foto-vorschau" class="foto-vorschau" hidden><img alt="Foto des Mangels"><button type="button" id="foto-weg" class="knopf klein">Foto entfernen</button></div>
        <div class="knopf-reihe">
          <label class="knopf">Foto aufnehmen<input type="file" accept="image/*" capture="environment" id="foto-kamera" hidden></label>
          <label class="knopf">Aus Galerie<input type="file" accept="image/*" id="foto-galerie" hidden></label>
        </div>
        <span id="foto-status" class="hinweis"></span>
      </div>

      <fieldset class="feld">
        <legend>Kategorie</legend>
        <div class="chips" id="kategorien">
          ${KATEGORIEN.map((k) => `<button type="button" class="chip${wahl.kategorie === k ? ' aktiv' : ''}" data-wert="${esc(k)}" aria-pressed="${wahl.kategorie === k}">${esc(k)}</button>`).join('')}
        </div>
      </fieldset>

      <fieldset class="feld">
        <legend>Dringlichkeit</legend>
        <div class="segmente" id="dringlichkeit">
          ${Object.entries(DRINGLICHKEIT).map(([wert, d]) => `<button type="button" class="segment${wahl.dringlichkeit === wert ? ' aktiv' : ''}" data-wert="${wert}" style="--farbe:${d.farbe}" aria-pressed="${wahl.dringlichkeit === wert}">${d.text}</button>`).join('')}
        </div>
      </fieldset>

      <label class="feld">Notiz
        <textarea name="notiz" rows="3" maxlength="1000" placeholder="Was ist kaputt? Grösse, Besonderheiten …">${esc(mangel?.notiz)}</textarea>
      </label>
    </form>
    <div class="aktionen"><button type="submit" form="mangel-form" class="knopf haupt" id="speichern">Speichern</button></div>`;

  const form = document.getElementById('mangel-form');
  let geaendert = false;
  const markiere = () => { geaendert = true; };
  form.addEventListener('input', markiere);
  schutz(() => !geaendert || confirm(mangel ? 'Änderungen verwerfen?' : 'Erfassung verwerfen?'));

  // --- Karte und GPS ---
  const start = mangel ? { lat: mangel.lat, lng: mangel.lng, zoom: 20 } : { lat: platz.lat, lng: platz.lng, zoom: Math.max(platz.zoom || 18, 19) };
  const karte = karteErstellen(document.getElementById('karte'), start);
  beimVerlassen(() => karteEntfernen(karte));
  let vonHandVerschoben = !!mangel;
  karte.on('dragstart', () => { vonHandVerschoben = true; markiere(); });

  const status = document.getElementById('gps-status');
  let gps = mangel?.gps || null;
  let kreis = null;
  let stopp = null;
  function gpsStarten() {
    if (stopp) stopp();
    status.textContent = 'Suche GPS …';
    stopp = gpsBeobachten((pos) => {
      gps = pos;
      if (kreis) kreis.setLatLng([pos.lat, pos.lng]).setRadius(pos.genauigkeit);
      else kreis = L.circle([pos.lat, pos.lng], { radius: pos.genauigkeit, color: '#1e88e5', weight: 2, fillOpacity: 0.12, interactive: false }).addTo(karte);
      const weg = distanz(pos, platz);
      if (weg > 500) {
        status.textContent = `GPS ± ${pos.genauigkeit} m – du bist ${(weg / 1000).toFixed(1)} km vom Platz entfernt. Setze den Pin von Hand.`;
        return;
      }
      status.textContent = `GPS ± ${pos.genauigkeit} m${vonHandVerschoben ? ' – Pin von Hand gesetzt' : ''}`;
      if (!vonHandVerschoben) karte.setView([pos.lat, pos.lng], karte.getZoom());
    }, (fehler) => { status.textContent = `${fehler} Setze den Pin von Hand.`; });
  }
  beimVerlassen(() => { if (stopp) stopp(); });
  document.getElementById('gps-knopf').onclick = () => {
    vonHandVerschoben = false;
    if (gps && distanz(gps, platz) <= 500) karte.setView([gps.lat, gps.lng], karte.getZoom());
    gpsStarten();
  };
  if (!mangel) gpsStarten();
  else status.textContent = 'Gespeicherte Stelle. «Zum GPS» springt zu deiner Position.';

  // --- Foto ---
  let neuesFoto = null;
  let fotoEntfernen = false;
  let fotoUrl = null;
  const vorschau = document.getElementById('foto-vorschau');
  const fotoStatus = document.getElementById('foto-status');
  function vorschauZeigen(foto) {
    if (fotoUrl) URL.revokeObjectURL(fotoUrl);
    fotoUrl = foto ? alsUrl(foto) : null;
    vorschau.hidden = !foto;
    if (foto) vorschau.querySelector('img').src = fotoUrl;
  }
  beimVerlassen(() => { if (fotoUrl) URL.revokeObjectURL(fotoUrl); });
  vorschauZeigen(bestehendesFoto);

  async function fotoGewaehlt(ev) {
    const datei = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!datei) return;
    const knopf = document.getElementById('speichern');
    knopf.disabled = true;
    fotoStatus.textContent = 'Foto wird verkleinert …';
    try {
      neuesFoto = await verkleinern(datei);
      fotoEntfernen = false;
      vorschauZeigen(neuesFoto);
      fotoStatus.textContent = `${neuesFoto.breite} × ${neuesFoto.hoehe} px, ${Math.round(neuesFoto.groesse / 1024)} KB`;
      markiere();
    } catch (e) {
      fotoStatus.textContent = '';
      meldung(e.message, true);
    } finally {
      knopf.disabled = false;
    }
  }
  document.getElementById('foto-kamera').addEventListener('change', fotoGewaehlt);
  document.getElementById('foto-galerie').addEventListener('change', fotoGewaehlt);
  document.getElementById('foto-weg').onclick = () => {
    neuesFoto = null;
    fotoEntfernen = true;
    vorschauZeigen(null);
    fotoStatus.textContent = '';
    markiere();
  };

  // --- Auswahl Kategorie / Dringlichkeit ---
  function auswahl(containerId, feld) {
    const c = document.getElementById(containerId);
    c.addEventListener('click', (ev) => {
      const b = ev.target.closest('button[data-wert]');
      if (!b) return;
      wahl[feld] = b.dataset.wert;
      for (const x of c.querySelectorAll('button')) {
        const an = x === b;
        x.classList.toggle('aktiv', an);
        x.setAttribute('aria-pressed', an);
      }
      markiere();
    });
  }
  auswahl('kategorien', 'kategorie');
  auswahl('dringlichkeit', 'dringlichkeit');

  // --- Speichern ---
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!wahl.kategorie) {
      meldung('Bitte eine Kategorie wählen.', true);
      document.getElementById('kategorien').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const mitte = karte.getCenter();
    const knopf = document.getElementById('speichern');
    knopf.disabled = true;
    try {
      const gespeichert = await db.mangelSpeichern({
        ...(mangel || { status: 'offen', platzId: platz.id, fotoId: null }),
        lat: mitte.lat,
        lng: mitte.lng,
        gps: gps ? { lat: gps.lat, lng: gps.lng, genauigkeit: gps.genauigkeit } : (mangel?.gps || null),
        kategorie: wahl.kategorie,
        dringlichkeit: wahl.dringlichkeit,
        notiz: form.notiz.value.trim(),
      }, neuesFoto, fotoEntfernen);
      db.dauerhaftAnfragen();
      meldung('Mangel gespeichert');
      if (mangel) zurueckZu(`#/mangel/${gespeichert.id}`);
      else zurueckZu(`#/platz/${platz.id}`);
    } catch (e) {
      knopf.disabled = false;
      meldung(`Speichern fehlgeschlagen: ${e.message}`, true);
    }
  });
}

// ---------- Ansicht: Mangel ansehen ----------

async function mangelAnsicht(mangelId) {
  const mangel = await db.holen('maengel', mangelId);
  if (!mangel) throw new Error('Mangel nicht gefunden.');
  const platz = await db.holen('plaetze', mangel.platzId);
  const foto = mangel.fotoId ? await db.holen('fotos', mangel.fotoId) : null;
  const d = DRINGLICHKEIT[mangel.dringlichkeit] || DRINGLICHKEIT.mittel;
  kopf(mangel.kategorie, `#/platz/${mangel.platzId}`, null);

  ansicht.className = 'mit-aktionen';
  ansicht.innerHTML = `
    <div class="detail">
      ${foto ? '<img id="foto" class="foto-gross" alt="Foto des Mangels">' : '<div class="kein-foto">Kein Foto</div>'}
      <div class="detail-zeile">
        <span class="marke" style="background:${d.farbe}">Dringlichkeit ${d.text}</span>
        <span class="marke neutral">${mangel.status === 'erledigt' ? 'erledigt' : 'offen'}</span>
      </div>
      <dl class="angaben">
        <dt>Platz</dt><dd>${esc(platz?.name || '–')}</dd>
        <dt>Kategorie</dt><dd>${esc(mangel.kategorie)}</dd>
        <dt>Notiz</dt><dd class="notiz">${mangel.notiz ? esc(mangel.notiz) : '–'}</dd>
        <dt>Erfasst</dt><dd>${datum(mangel.erstellt)}</dd>
        ${mangel.geaendert !== mangel.erstellt ? `<dt>Geändert</dt><dd>${datum(mangel.geaendert)}</dd>` : ''}
        <dt>GPS beim Erfassen</dt><dd>${mangel.gps ? `± ${mangel.gps.genauigkeit} m` : 'keine Position'}</dd>
      </dl>
      <div class="karte-rahmen klein"><div id="karte" class="karte"></div></div>
      <button type="button" id="loeschen" class="knopf gefahr">Mangel löschen</button>
    </div>
    <div class="aktionen"><a class="knopf haupt" href="#/mangel/${mangel.id}/bearbeiten">Bearbeiten</a></div>`;

  if (foto) {
    const url = alsUrl(foto);
    document.getElementById('foto').src = url;
    beimVerlassen(() => URL.revokeObjectURL(url));
  }
  const karte = karteErstellen(document.getElementById('karte'), { lat: mangel.lat, lng: mangel.lng, zoom: 19 }, { einfach: true });
  L.marker([mangel.lat, mangel.lng], { icon: punktIcon(d.farbe), interactive: false }).addTo(karte);
  beimVerlassen(() => karteEntfernen(karte));

  document.getElementById('loeschen').onclick = async () => {
    if (!confirm(foto ? 'Diesen Mangel mit Foto endgültig löschen?' : 'Diesen Mangel endgültig löschen?')) return;
    await db.mangelLoeschen(mangel);
    meldung('Mangel gelöscht');
    zurueckZu(`#/platz/${mangel.platzId}`);
  };
}

// ---------- Start ----------

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service Worker nicht registriert:', e));
  });
}

zeigen();

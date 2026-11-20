// Mängel-App Sportplatz – Bildschirme und Navigation
/* global L */
import * as db from './db.js';
import { verkleinern, vorschauAusFoto, alsUrl } from './foto.js';
import { SCHWEIZ, karteErstellen, karteEntfernen, pinHtml, punktIcon, gpsBeobachten, distanz } from './karte.js';

export const KATEGORIEN = [
  'Belag / Kunstrasen', 'Naturrasen', 'Linierung', 'Tore / Netze', 'Zaun / Ballfang',
  'Entwässerung', 'Beleuchtung', 'Ausstattung', 'Sonstiges',
];

export const DRINGLICHKEIT = {
  hoch: { text: 'hoch', farbe: '#d32f2f', rang: 0 },
  mittel: { text: 'mittel', farbe: '#f57c00', rang: 1 },
  tief: { text: 'tief', farbe: '#f2b600', rang: 2 },
};
const ERLEDIGT_FARBE = '#2e7d32';

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

function kurzdatum(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' });
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

function dringlichkeit(m) {
  return DRINGLICHKEIT[m.dringlichkeit] || DRINGLICHKEIT.mittel;
}

function istErledigt(m) { return m.status === 'erledigt'; }

// Kleine Einstellungen pro Gerät (Filter usw.). Fehlt der Speicher, gelten die Standardwerte.
function einstellungLesen(name, standard) {
  try {
    const wert = localStorage.getItem(name);
    return wert === null ? standard : JSON.parse(wert);
  } catch (_) { return standard; }
}
function einstellungSchreiben(name, wert) {
  try { localStorage.setItem(name, JSON.stringify(wert)); } catch (_) { /* egal */ }
}

// Foto gross anzeigen; Tippen schliesst
function grossAnzeigen(url) {
  const el = document.createElement('div');
  el.className = 'foto-voll';
  el.innerHTML = `<img alt="Foto gross" src="${url}"><span class="foto-voll-hinweis">Tippen zum Schliessen</span>`;
  el.addEventListener('click', () => el.remove());
  document.body.append(el);
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
  if (aktuellerHash() === hash) { zeigen(); return; }
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

// Vorherige Ansicht, falls es eine Mängel-Liste war (dann führt «Zurück» dorthin)
function vorherigeListe() {
  const vorher = verlauf[verlauf.length - 2];
  return vorher && vorher.startsWith('#/maengel') ? vorher : null;
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

// Nach einem await prüfen, ob die Ansicht inzwischen gewechselt hat
function nochAktuell(token) { return token === aktuelleAnsicht; }

const routen = [
  [/^#\/?$/, () => plaetzeListe()],
  [/^#\/maengel(?:\?(.*))?$/, (m) => maengelListe(m[1])],
  [/^#\/platz\/neu$/, () => platzFormular(null)],
  [/^#\/platz\/([\w-]+)\/bearbeiten$/, (m) => platzFormular(m[1])],
  [/^#\/platz\/([\w-]+)\/mangel\/neu$/, (m) => mangelFormular({ platzId: m[1] })],
  [/^#\/platz\/([\w-]+)$/, (m) => platzAnsicht(m[1])],
  [/^#\/mangel\/([\w-]+)\/bearbeiten$/, (m) => mangelFormular({ mangelId: m[1] })],
  [/^#\/mangel\/([\w-]+)\/erledigt$/, (m) => erledigtFormular(m[1])],
  [/^#\/mangel\/([\w-]+)$/, (m) => mangelAnsicht(m[1])],
];

async function zeigen() {
  for (const fn of aktuelleAnsicht.aufraeumen) { try { fn(); } catch (_) { /* egal */ } }
  const token = { aufraeumen: [], schutz: null };
  aktuelleAnsicht = token;
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
        if (nochAktuell(token)) {
          ansicht.innerHTML = `<div class="leer"><p>Fehler: ${esc(e.message)}</p><a class="knopf" href="#/">Zur Übersicht</a></div>`;
        }
      }
      return;
    }
  }
  ersetze('#/');
}

window.addEventListener('hashchange', () => {
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
  zeigen();
});

// Reiter unten (Plätze / Mängel): Wechsel ohne neuen Verlaufseintrag
ansicht.addEventListener('click', (ev) => {
  const a = ev.target.closest('a[data-reiter]');
  if (!a) return;
  ev.preventDefault();
  ersetze(a.getAttribute('href'));
});

function reiterHtml(aktiv, knopf = '') {
  return `<div class="aktionen spalte">
    ${knopf}
    <nav class="reiter" aria-label="Bereiche">
      <a href="#/" data-reiter class="${aktiv === 'plaetze' ? 'aktiv' : ''}" ${aktiv === 'plaetze' ? 'aria-current="page"' : ''}>Plätze</a>
      <a href="#/maengel" data-reiter class="${aktiv === 'maengel' ? 'aktiv' : ''}" ${aktiv === 'maengel' ? 'aria-current="page"' : ''}>Mängel</a>
    </nav>
  </div>`;
}

// ---------- Baustein: Fotofeld (aufnehmen, Galerie, Vorschau, entfernen) ----------

function fotoFeldHtml(titel) {
  return `<div class="feld foto-feld">
    <span>${titel}</span>
    <div class="foto-vorschau" hidden><img alt="Foto"><button type="button" class="knopf klein foto-weg">Foto entfernen</button></div>
    <div class="knopf-reihe">
      <label class="knopf">Foto aufnehmen<input type="file" accept="image/*" capture="environment" class="foto-kamera" hidden></label>
      <label class="knopf">Aus Galerie<input type="file" accept="image/*" class="foto-galerie" hidden></label>
    </div>
    <span class="hinweis foto-status"></span>
  </div>`;
}

// Liefert { aenderung() } → { neu, entfernen } für db.mangelSpeichern
function fotoFeldAktivieren(el, bestehend, { beiAenderung, knopf }) {
  let neu = null;
  let entfernen = false;
  let url = null;
  const vorschau = el.querySelector('.foto-vorschau');
  const status = el.querySelector('.foto-status');
  function zeige(foto) {
    if (url) URL.revokeObjectURL(url);
    url = foto ? alsUrl(foto) : null;
    vorschau.hidden = !foto;
    if (foto) vorschau.querySelector('img').src = url;
  }
  beimVerlassen(() => { if (url) URL.revokeObjectURL(url); });
  zeige(bestehend);

  async function gewaehlt(ev) {
    const datei = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!datei) return;
    knopf.disabled = true;
    status.textContent = 'Foto wird verkleinert …';
    try {
      neu = await verkleinern(datei);
      entfernen = false;
      zeige(neu);
      status.textContent = `${neu.breite} × ${neu.hoehe} px, ${Math.round(neu.groesse / 1024)} KB`;
      beiAenderung();
    } catch (e) {
      status.textContent = '';
      meldung(e.message, true);
    } finally {
      knopf.disabled = false;
    }
  }
  for (const inp of el.querySelectorAll('input[type=file]')) inp.addEventListener('change', gewaehlt);
  el.querySelector('.foto-weg').onclick = () => {
    neu = null;
    entfernen = true;
    zeige(null);
    status.textContent = '';
    beiAenderung();
  };
  return { aenderung: () => ({ neu, entfernen }) };
}

// ---------- Ansicht: Plätze ----------

async function plaetzeListe() {
  const token = aktuelleAnsicht;
  kopf('Plätze', null, null);
  const [plaetze, maengel] = await Promise.all([db.alle('plaetze'), db.alle('maengel')]);
  if (!nochAktuell(token)) return;
  plaetze.sort((a, b) => a.name.localeCompare(b.name, 'de-CH'));
  const zaehler = {};
  for (const m of maengel) {
    const z = zaehler[m.platzId] || (zaehler[m.platzId] = { offen: 0, hoch: 0, erledigt: 0 });
    if (istErledigt(m)) { z.erledigt += 1; continue; }
    z.offen += 1;
    if (m.dringlichkeit === 'hoch') z.hoch += 1;
  }

  ansicht.innerHTML = `
    ${plaetze.length === 0 ? `
      <div class="leer">
        <p><strong>Noch keine Plätze.</strong></p>
        <p>Tippe unten auf «+ Platz», um den ersten Sportplatz anzulegen.</p>
      </div>` : `
      <ul class="liste">
        ${plaetze.map((p) => {
          const z = zaehler[p.id] || { offen: 0, hoch: 0, erledigt: 0 };
          return `<li><a class="eintrag" href="#/platz/${p.id}">
            <span class="eintrag-text">
              <span class="eintrag-titel">${esc(p.name)}</span>
              <span class="eintrag-unter">${esc(p.ort || '')}</span>
            </span>
            <span class="eintrag-zahlen">
              <span>${z.offen} offen${z.erledigt ? ` · ${z.erledigt} erledigt` : ''}</span>
              ${z.hoch ? `<span class="marke" style="background:${DRINGLICHKEIT.hoch.farbe}">${z.hoch} dringend</span>` : ''}
            </span>
          </a></li>`;
        }).join('')}
      </ul>`}
    ${reiterHtml('plaetze', '<a class="knopf haupt" href="#/platz/neu">+ Platz</a>')}`;
}

// ---------- Ansicht: alle Mängel mit Filtern ----------

const FILTER_STANDARD = { status: 'offen', platz: '', kategorie: '' };

async function maengelListe(abfrage) {
  const token = aktuelleAnsicht;
  const vonPlatz = new URLSearchParams(abfrage || '').get('platz');
  const [plaetze, maengel] = await Promise.all([db.alle('plaetze'), db.alle('maengel')]);
  if (!nochAktuell(token)) return;
  plaetze.sort((a, b) => a.name.localeCompare(b.name, 'de-CH'));
  const platzName = Object.fromEntries(plaetze.map((p) => [p.id, p.name]));

  const filter = { ...FILTER_STANDARD, ...einstellungLesen('maengel-filter', {}) };
  if (vonPlatz) filter.platz = vonPlatz;
  if (filter.platz && !platzName[filter.platz]) filter.platz = '';

  kopf('Mängel', vonPlatz ? `#/platz/${vonPlatz}` : null, null);
  ansicht.innerHTML = `
    <div class="filter">
      <div class="segmente klein" id="f-status" role="group" aria-label="Status">
        ${[['offen', 'Offen'], ['erledigt', 'Erledigt'], ['alle', 'Alle']].map(([w, t]) => `<button type="button" class="segment" data-wert="${w}">${t}</button>`).join('')}
      </div>
      <div class="filter-reihe">
        <select id="f-platz" aria-label="Platz">
          <option value="">Alle Plätze</option>
          ${plaetze.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}
        </select>
        <select id="f-kategorie" aria-label="Kategorie">
          <option value="">Alle Kategorien</option>
          ${KATEGORIEN.map((k) => `<option value="${esc(k)}">${esc(k)}</option>`).join('')}
        </select>
      </div>
    </div>
    <div id="treffer" class="treffer" aria-live="polite"></div>
    <ul class="liste" id="liste"></ul>
    ${vonPlatz ? '' : reiterHtml('maengel')}`;

  const statusEl = document.getElementById('f-status');
  const platzEl = document.getElementById('f-platz');
  const kategorieEl = document.getElementById('f-kategorie');
  const listeEl = document.getElementById('liste');
  const trefferEl = document.getElementById('treffer');

  // Vorschaubilder: einmal laden, beim Verlassen freigeben
  const urls = new Map();
  beimVerlassen(() => { for (const u of urls.values()) URL.revokeObjectURL(u); });
  let ladeLauf = 0;
  async function vorschauenLaden() {
    const lauf = ++ladeLauf;
    for (const img of listeEl.querySelectorAll('img[data-foto]')) {
      const id = img.dataset.foto;
      if (!urls.has(id)) {
        try {
          const v = await db.vorschauHolen(id, vorschauAusFoto);
          if (v) urls.set(id, alsUrl(v));
        } catch (e) { console.warn('Vorschau fehlt', e); }
      }
      if (lauf !== ladeLauf || !nochAktuell(token)) return;
      if (urls.has(id)) { img.src = urls.get(id); img.classList.add('geladen'); }
    }
  }

  function zeichnen() {
    for (const b of statusEl.querySelectorAll('button')) {
      const an = b.dataset.wert === filter.status;
      b.classList.toggle('aktiv', an);
      b.setAttribute('aria-pressed', an);
    }
    platzEl.value = filter.platz;
    kategorieEl.value = filter.kategorie;
    platzEl.classList.toggle('gesetzt', !!filter.platz);
    kategorieEl.classList.toggle('gesetzt', !!filter.kategorie);

    const treffer = maengel.filter((m) => {
      if (filter.status === 'offen' && istErledigt(m)) return false;
      if (filter.status === 'erledigt' && !istErledigt(m)) return false;
      if (filter.platz && m.platzId !== filter.platz) return false;
      if (filter.kategorie && m.kategorie !== filter.kategorie) return false;
      return true;
    });
    // Offene zuerst, dann nach Dringlichkeit, dann neueste zuerst
    treffer.sort((a, b) => (istErledigt(a) - istErledigt(b))
      || (istErledigt(a) ? 0 : dringlichkeit(a).rang - dringlichkeit(b).rang)
      || String(b.erledigtAm || b.erstellt).localeCompare(String(a.erledigtAm || a.erstellt)));

    const filterAktiv = filter.platz || filter.kategorie || filter.status !== 'offen';
    trefferEl.innerHTML = `${anzahlText(treffer.length)}${filterAktiv ? ' <button type="button" class="link" id="f-zuruecksetzen">Filter zurücksetzen</button>' : ''}`;
    const reset = document.getElementById('f-zuruecksetzen');
    if (reset) reset.onclick = () => { Object.assign(filter, FILTER_STANDARD); einstellungSchreiben('maengel-filter', filter); zeichnen(); };

    listeEl.innerHTML = treffer.length === 0
      ? '<li class="leer">Keine Mängel für diese Filter.</li>'
      : treffer.map((m) => {
        const d = dringlichkeit(m);
        const erledigt = istErledigt(m);
        const bildId = (erledigt && m.fotoNachherId) || m.fotoId;
        return `<li><a class="eintrag mangel-eintrag" href="#/mangel/${m.id}">
          ${bildId ? `<img class="mini" data-foto="${bildId}" alt="">` : '<span class="mini leer-bild" aria-hidden="true"></span>'}
          <span class="eintrag-text">
            <span class="eintrag-titel">${esc(m.kategorie)}</span>
            <span class="eintrag-unter">${esc(platzName[m.platzId] || '–')} · ${kurzdatum(erledigt ? m.erledigtAm : m.erstellt)}</span>
            ${m.notiz ? `<span class="eintrag-notiz">${esc(m.notiz)}</span>` : ''}
          </span>
          ${erledigt
            ? `<span class="marke" style="background:${ERLEDIGT_FARBE}">erledigt</span>`
            : `<span class="marke" style="background:${d.farbe}">${d.text}</span>`}
        </a></li>`;
      }).join('');
    vorschauenLaden();
  }

  function aendern(neu) {
    Object.assign(filter, neu);
    einstellungSchreiben('maengel-filter', filter);
    zeichnen();
  }
  statusEl.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-wert]');
    if (b) aendern({ status: b.dataset.wert });
  });
  platzEl.addEventListener('change', () => aendern({ platz: platzEl.value }));
  kategorieEl.addEventListener('change', () => aendern({ kategorie: kategorieEl.value }));
  zeichnen();
}

// ---------- Ansicht: Platz anlegen / bearbeiten ----------

async function platzFormular(platzId) {
  const token = aktuelleAnsicht;
  let platz = null;
  if (platzId) {
    platz = await db.holen('plaetze', platzId);
    if (!platz) throw new Error('Platz nicht gefunden.');
  }
  if (!nochAktuell(token)) return;
  const zurueck = platz ? `#/platz/${platz.id}` : '#/';
  kopf(platz ? 'Platz bearbeiten' : 'Neuer Platz', zurueck, null);

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
  const token = aktuelleAnsicht;
  const platz = await db.holen('plaetze', platzId);
  if (!platz) throw new Error('Platz nicht gefunden.');
  const maengel = await db.maengelVonPlatz(platzId);
  if (!nochAktuell(token)) return;
  kopf(platz.name, '#/', { text: 'Bearbeiten', klick: () => gehe(`#/platz/${platz.id}/bearbeiten`) });

  const offen = maengel.filter((m) => !istErledigt(m));
  const erledigtAnzahl = maengel.length - offen.length;
  let alleZeigen = einstellungLesen('karte-alle', false);

  ansicht.className = 'voll';
  ansicht.innerHTML = `
    <div class="karte-rahmen voll">
      <div id="karte" class="karte"></div>
      <div class="karte-umschalter segmente klein" role="group" aria-label="Punkte zeigen">
        <button type="button" class="segment" data-wert="offen">Offen</button>
        <button type="button" class="segment" data-wert="alle">Alle</button>
      </div>
      <div class="karte-info" id="karte-info"></div>
    </div>
    <div class="aktionen">
      <a class="knopf" href="#/maengel?platz=${platz.id}">Liste</a>
      <a class="knopf haupt breit" href="#/platz/${platz.id}/mangel/neu">+ Mangel</a>
    </div>`;

  const karte = karteErstellen(document.getElementById('karte'), { lat: platz.lat, lng: platz.lng, zoom: platz.zoom || 18 });
  beimVerlassen(() => karteEntfernen(karte));
  const ebene = L.layerGroup().addTo(karte);

  function zeichnen() {
    for (const b of ansicht.querySelectorAll('.karte-umschalter button')) {
      const an = (b.dataset.wert === 'alle') === alleZeigen;
      b.classList.toggle('aktiv', an);
      b.setAttribute('aria-pressed', an);
    }
    ebene.clearLayers();
    const sichtbar = alleZeigen ? maengel : offen;
    // Erledigte zuerst, dann nach Dringlichkeit: dringende Punkte liegen oben
    const sortiert = [...sichtbar].sort((a, b) => (istErledigt(b) - istErledigt(a)) || (dringlichkeit(b).rang - dringlichkeit(a).rang));
    for (const m of sortiert) {
      const erledigt = istErledigt(m);
      L.marker([m.lat, m.lng], {
        icon: punktIcon(erledigt ? ERLEDIGT_FARBE : dringlichkeit(m).farbe, erledigt),
        title: `${m.kategorie}${erledigt ? ' (erledigt)' : ''}`,
        keyboard: true,
      }).on('click', () => gehe(`#/mangel/${m.id}`)).addTo(ebene);
    }
    const legende = [...Object.values(DRINGLICHKEIT), ...(alleZeigen ? [{ text: 'erledigt', farbe: ERLEDIGT_FARBE }] : [])];
    document.getElementById('karte-info').innerHTML = maengel.length
      ? `${offen.length} offen${erledigtAnzahl ? ` · ${erledigtAnzahl} erledigt` : ''}
        <span class="legende">${legende.map((d) => `<span><i style="background:${d.farbe}"></i>${d.text}</span>`).join('')}</span>`
      : 'Noch keine Mängel. Tippe auf «+ Mangel».';
  }
  ansicht.querySelector('.karte-umschalter').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-wert]');
    if (!b) return;
    alleZeigen = b.dataset.wert === 'alle';
    einstellungSchreiben('karte-alle', alleZeigen);
    zeichnen();
  });
  zeichnen();

  if (maengel.length) {
    const grenzen = L.latLngBounds(maengel.map((m) => [m.lat, m.lng]));
    grenzen.extend([platz.lat, platz.lng]);
    karte.fitBounds(grenzen, { padding: [50, 50], maxZoom: Math.max(platz.zoom || 18, 19) });
  }
}

// ---------- Ansicht: Mangel erfassen / bearbeiten ----------

async function mangelFormular({ platzId, mangelId }) {
  const token = aktuelleAnsicht;
  let mangel = null;
  if (mangelId) {
    mangel = await db.holen('maengel', mangelId);
    if (!mangel) throw new Error('Mangel nicht gefunden.');
    platzId = mangel.platzId;
  }
  const platz = await db.holen('plaetze', platzId);
  if (!platz) throw new Error('Platz nicht gefunden.');
  const bestehendesFoto = mangel?.fotoId ? await db.holen('fotos', mangel.fotoId) : null;
  if (!nochAktuell(token)) return;
  const zurueck = mangel ? `#/mangel/${mangel.id}` : `#/platz/${platz.id}`;
  kopf(mangel ? 'Mangel bearbeiten' : 'Neuer Mangel', zurueck, null);

  const wahl = { kategorie: mangel?.kategorie || '', dringlichkeit: mangel?.dringlichkeit || 'mittel' };

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

      ${fotoFeldHtml(mangel && istErledigt(mangel) ? 'Foto vorher' : 'Foto')}

      <fieldset class="feld">
        <legend>Kategorie</legend>
        <div class="chips" id="kategorien">
          ${KATEGORIEN.map((k) => `<button type="button" class="chip${wahl.kategorie === k ? ' aktiv' : ''}" data-wert="${esc(k)}" aria-pressed="${wahl.kategorie === k}">${esc(k)}</button>`).join('')}
        </div>
      </fieldset>

      <fieldset class="feld">
        <legend>Dringlichkeit</legend>
        <div class="segmente" id="dringlichkeit">
          ${Object.entries(DRINGLICHKEIT).map(([wert, d]) => `<button type="button" class="segment farbig${wahl.dringlichkeit === wert ? ' aktiv' : ''}" data-wert="${wert}" style="--farbe:${d.farbe}" aria-pressed="${wahl.dringlichkeit === wert}">${d.text}</button>`).join('')}
        </div>
      </fieldset>

      <label class="feld">Notiz
        <textarea name="notiz" rows="3" maxlength="1000" placeholder="Was ist kaputt? Grösse, Besonderheiten …">${esc(mangel?.notiz)}</textarea>
      </label>
    </form>
    <div class="aktionen"><button type="submit" form="mangel-form" class="knopf haupt" id="speichern">Speichern</button></div>`;

  const form = document.getElementById('mangel-form');
  const speichernKnopf = document.getElementById('speichern');
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
  const fotoFeld = fotoFeldAktivieren(form.querySelector('.foto-feld'), bestehendesFoto, { beiAenderung: markiere, knopf: speichernKnopf });

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
    speichernKnopf.disabled = true;
    try {
      const gespeichert = await db.mangelSpeichern({
        ...(mangel || { status: 'offen', platzId: platz.id, fotoId: null }),
        lat: mitte.lat,
        lng: mitte.lng,
        gps: gps ? { lat: gps.lat, lng: gps.lng, genauigkeit: gps.genauigkeit } : (mangel?.gps || null),
        kategorie: wahl.kategorie,
        dringlichkeit: wahl.dringlichkeit,
        notiz: form.notiz.value.trim(),
      }, { fotoId: fotoFeld.aenderung() });
      db.dauerhaftAnfragen();
      meldung('Mangel gespeichert');
      if (mangel) zurueckZu(`#/mangel/${gespeichert.id}`);
      else zurueckZu(`#/platz/${platz.id}`);
    } catch (e) {
      speichernKnopf.disabled = false;
      meldung(`Speichern fehlgeschlagen: ${e.message}`, true);
    }
  });
}

// ---------- Ansicht: Mangel als erledigt melden ----------

async function erledigtFormular(mangelId) {
  const token = aktuelleAnsicht;
  const mangel = await db.holen('maengel', mangelId);
  if (!mangel) throw new Error('Mangel nicht gefunden.');
  const platz = await db.holen('plaetze', mangel.platzId);
  const bestehend = mangel.fotoNachherId ? await db.holen('fotos', mangel.fotoNachherId) : null;
  if (!nochAktuell(token)) return;
  kopf('Erledigt melden', `#/mangel/${mangel.id}`, null);

  ansicht.innerHTML = `
    <form id="erledigt-form" class="formular" novalidate>
      <div class="zusammenfassung">
        <strong>${esc(mangel.kategorie)}</strong>
        <span>${esc(platz?.name || '')}${mangel.notiz ? ` · ${esc(mangel.notiz)}` : ''}</span>
      </div>
      ${fotoFeldHtml('Foto «nachher» (freiwillig)')}
      <label class="feld">Was wurde gemacht? (freiwillig)
        <textarea name="erledigtNotiz" rows="3" maxlength="1000" placeholder="z. B. Belag geflickt, Netz ersetzt …">${esc(mangel.erledigtNotiz)}</textarea>
      </label>
    </form>
    <div class="aktionen"><button type="submit" form="erledigt-form" class="knopf haupt erledigt" id="speichern">Als erledigt speichern</button></div>`;

  const form = document.getElementById('erledigt-form');
  const knopf = document.getElementById('speichern');
  let geaendert = false;
  const markiere = () => { geaendert = true; };
  form.addEventListener('input', markiere);
  schutz(() => !geaendert || confirm('Erledigt-Meldung verwerfen?'));
  const fotoFeld = fotoFeldAktivieren(form.querySelector('.foto-feld'), bestehend, { beiAenderung: markiere, knopf });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    knopf.disabled = true;
    try {
      await db.mangelSpeichern({
        ...mangel,
        status: 'erledigt',
        erledigtAm: new Date().toISOString(),
        erledigtNotiz: form.erledigtNotiz.value.trim(),
      }, { fotoNachherId: fotoFeld.aenderung() });
      meldung('Als erledigt gemeldet');
      zurueckZu(`#/mangel/${mangel.id}`);
    } catch (e) {
      knopf.disabled = false;
      meldung(`Speichern fehlgeschlagen: ${e.message}`, true);
    }
  });
}

// ---------- Ansicht: Mangel ansehen ----------

async function mangelAnsicht(mangelId) {
  const token = aktuelleAnsicht;
  const mangel = await db.holen('maengel', mangelId);
  if (!mangel) throw new Error('Mangel nicht gefunden.');
  const erledigt = istErledigt(mangel);
  const [platz, foto, nachher] = await Promise.all([
    db.holen('plaetze', mangel.platzId),
    mangel.fotoId ? db.holen('fotos', mangel.fotoId) : null,
    erledigt && mangel.fotoNachherId ? db.holen('fotos', mangel.fotoNachherId) : null,
  ]);
  if (!nochAktuell(token)) return;
  const d = dringlichkeit(mangel);
  const zurueck = vorherigeListe() || `#/platz/${mangel.platzId}`;
  kopf(mangel.kategorie, zurueck, null);

  let fotosHtml;
  if (nachher) {
    fotosHtml = `<div class="vorher-nachher">
      <figure>${foto ? '<img data-foto="vorher" alt="Foto vorher">' : '<div class="kein-foto">Kein Foto</div>'}<figcaption>Vorher</figcaption></figure>
      <figure><img data-foto="nachher" alt="Foto nachher"><figcaption>Nachher</figcaption></figure>
    </div>`;
  } else if (foto) {
    fotosHtml = '<img data-foto="vorher" class="foto-gross" alt="Foto des Mangels">';
  } else {
    fotosHtml = '<div class="kein-foto">Kein Foto</div>';
  }

  ansicht.innerHTML = `
    <div class="detail">
      ${fotosHtml}
      <div class="detail-zeile">
        ${erledigt ? `<span class="marke" style="background:${ERLEDIGT_FARBE}">erledigt</span>` : '<span class="marke neutral">offen</span>'}
        <span class="marke" style="background:${d.farbe}">Dringlichkeit ${d.text}</span>
      </div>
      <dl class="angaben">
        <dt>Platz</dt><dd>${esc(platz?.name || '–')}</dd>
        <dt>Kategorie</dt><dd>${esc(mangel.kategorie)}</dd>
        <dt>Notiz</dt><dd class="notiz">${mangel.notiz ? esc(mangel.notiz) : '–'}</dd>
        <dt>Erfasst</dt><dd>${datum(mangel.erstellt)}</dd>
        ${erledigt ? `<dt>Erledigt</dt><dd>${datum(mangel.erledigtAm)}</dd>
          <dt>Gemacht</dt><dd class="notiz">${mangel.erledigtNotiz ? esc(mangel.erledigtNotiz) : '–'}</dd>` : ''}
        <dt>GPS beim Erfassen</dt><dd>${mangel.gps ? `± ${mangel.gps.genauigkeit} m` : 'keine Position'}</dd>
      </dl>
      <div class="karte-rahmen klein"><div id="karte" class="karte"></div></div>
      ${erledigt ? '<button type="button" id="wieder-oeffnen" class="knopf breit">Wieder öffnen</button>' : ''}
      <button type="button" id="loeschen" class="knopf gefahr">Mangel löschen</button>
    </div>
    <div class="aktionen">
      ${erledigt
        ? `<a class="knopf haupt" href="#/mangel/${mangel.id}/bearbeiten">Bearbeiten</a>`
        : `<a class="knopf" href="#/mangel/${mangel.id}/bearbeiten">Bearbeiten</a>
           <a class="knopf haupt erledigt breit" href="#/mangel/${mangel.id}/erledigt">Erledigt melden</a>`}
    </div>`;

  for (const [teil, f] of [['vorher', foto], ['nachher', nachher]]) {
    const img = ansicht.querySelector(`img[data-foto="${teil}"]`);
    if (!img || !f) continue;
    const url = alsUrl(f);
    img.src = url;
    img.addEventListener('click', () => grossAnzeigen(url));
    beimVerlassen(() => URL.revokeObjectURL(url));
  }
  beimVerlassen(() => { for (const el of document.querySelectorAll('.foto-voll')) el.remove(); });

  const farbe = erledigt ? ERLEDIGT_FARBE : d.farbe;
  const karte = karteErstellen(document.getElementById('karte'), { lat: mangel.lat, lng: mangel.lng, zoom: 19 }, { einfach: true });
  L.marker([mangel.lat, mangel.lng], { icon: punktIcon(farbe, erledigt), interactive: false }).addTo(karte);
  beimVerlassen(() => karteEntfernen(karte));

  if (erledigt) {
    document.getElementById('wieder-oeffnen').onclick = async () => {
      if (!confirm('Diesen Mangel wieder als offen markieren?')) return;
      await db.mangelSpeichern({ ...mangel, status: 'offen', erledigtAm: null });
      meldung('Mangel ist wieder offen');
      zeigen();
    };
  }

  document.getElementById('loeschen').onclick = async () => {
    const mitFoto = mangel.fotoId || mangel.fotoNachherId;
    if (!confirm(mitFoto ? 'Diesen Mangel mit Fotos endgültig löschen?' : 'Diesen Mangel endgültig löschen?')) return;
    await db.mangelLoeschen(mangel);
    meldung('Mangel gelöscht');
    zurueckZu(zurueck);
  };
}

// ---------- Neue Version ----------

function updateHinweis() {
  if (document.getElementById('update-hinweis')) return;
  const el = document.createElement('div');
  el.id = 'update-hinweis';
  el.className = 'update-hinweis';
  el.setAttribute('role', 'status');
  el.innerHTML = '<span>Neue Version der App bereit.</span><button type="button" class="knopf klein">Aktualisieren</button>';
  el.querySelector('button').onclick = () => {
    if (aktuelleAnsicht.schutz && !aktuelleAnsicht.schutz()) return;
    location.reload();
  };
  document.body.append(el);
}

if ('serviceWorker' in navigator) {
  // Hatte die Seite schon einen Service Worker, ist ein Wechsel eine neue Version
  const hatteVersion = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hatteVersion) updateHinweis(); });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      // Beim Zurückkehren in die App nach neuer Version fragen
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    }).catch((e) => console.warn('Service Worker nicht registriert:', e));
  });
}

zeigen();

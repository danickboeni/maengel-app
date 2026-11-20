// Mängel-App Sportplatz – Bildschirme und Navigation
/* global L */
import * as db from './db.js';
import { verkleinern, vorschauAusFoto, alsUrl } from './foto.js';
import {
  SCHWEIZ, karteErstellen, karteEntfernen, pinHtml, punktIcon, gpsBeobachten, distanz,
  offlineSpeichern, kachelAnzahl, kachelnLoeschen, OFFLINE_RADIUS,
} from './karte.js';
import {
  KATEGORIEN, DRINGLICHKEIT, ERLEDIGT_FARBE, istErledigt, dringlichkeit, maengelSortieren,
  POSITIONSARTEN, MAX_FOTOS_POSITION,
} from './konstanten.js';
import {
  sicherungErstellen, sicherungWeitergeben, sicherungPruefen, sicherungEinlesen, sicherungFaellig,
  letzteSicherung, speicherInfo, groesseText, dateiWeitergeben, ERINNERUNG_TAGE,
} from './sicherung.js';
import { berichtErstellen, offerteBerichtErstellen } from './bericht.js';
import {
  Messwerkzeug, formZeichnen, messMenge, messText, zahlText, EINHEITEN, MESS_EINHEIT, MESS_NAME, FORM_FARBE,
} from './messen.js';


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
  [/^#\/?$/, () => startAnsicht()],
  [/^#\/plaetze$/, () => plaetzeListe()],
  [/^#\/offerten$/, () => offertenListe()],
  [/^#\/offerte\/neu$/, () => offerteFormular(null)],
  [/^#\/offerte\/([\w-]+)\/bearbeiten$/, (m) => offerteFormular(m[1])],
  [/^#\/offerte\/([\w-]+)\/position\/neu$/, (m) => positionFormular({ offerteId: m[1] })],
  [/^#\/offerte\/([\w-]+)\/pdf$/, (m) => offerteBerichtAnsicht(m[1])],
  [/^#\/offerte\/([\w-]+)$/, (m) => offerteAnsicht(m[1])],
  [/^#\/position\/([\w-]+)$/, (m) => positionFormular({ positionId: m[1] })],
  [/^#\/maengel(?:\?(.*))?$/, (m) => maengelListe(m[1])],
  [/^#\/sicherung$/, () => sicherungAnsicht()],
  [/^#\/platz\/([\w-]+)\/bericht$/, (m) => berichtAnsicht(m[1])],
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
      <a href="#/plaetze" data-reiter class="${aktiv === 'plaetze' ? 'aktiv' : ''}" ${aktiv === 'plaetze' ? 'aria-current="page"' : ''}>Plätze</a>
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
  kopf('Plätze', '#/', null);
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

  kopf('Mängel', vonPlatz ? `#/platz/${vonPlatz}` : '#/', null);
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
    const sortiert = maengelSortieren(treffer);

    const filterAktiv = filter.platz || filter.kategorie || filter.status !== 'offen';
    trefferEl.innerHTML = `${anzahlText(treffer.length)}${filterAktiv ? ' <button type="button" class="link" id="f-zuruecksetzen">Filter zurücksetzen</button>' : ''}`;
    const reset = document.getElementById('f-zuruecksetzen');
    if (reset) reset.onclick = () => { Object.assign(filter, FILTER_STANDARD); einstellungSchreiben('maengel-filter', filter); zeichnen(); };

    listeEl.innerHTML = treffer.length === 0
      ? '<li class="leer">Keine Mängel für diese Filter.</li>'
      : sortiert.map((m) => {
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
  const zurueck = platz ? `#/platz/${platz.id}` : '#/plaetze';
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
      zurueckZu('#/plaetze');
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
  kopf(platz.name, '#/plaetze', { text: 'Bearbeiten', klick: () => gehe(`#/platz/${platz.id}/bearbeiten`) });

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
      <a class="knopf" href="#/platz/${platz.id}/bericht">Bericht</a>
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
    document.getElementById('karte-info').insertAdjacentHTML('beforeend', offlineZeile());
  }

  // Luftbild rund um den Platz für den Einsatz ohne Empfang speichern
  const offlineSchluessel = `offline-${platz.id}`;
  let offlineLaeuft = false;
  let offlineAbbrechen = false;
  beimVerlassen(() => { offlineAbbrechen = true; });
  function offlineZeile() {
    const am = einstellungLesen(offlineSchluessel, null);
    return `<span class="offline-zeile">
      <span id="offline-text">${am ? `Karte offline gespeichert am ${kurzdatum(am)}` : 'Karte noch nicht offline gespeichert'}</span>
      <button type="button" class="link" id="offline-knopf">${am ? 'Neu laden' : 'Offline speichern'}</button>
    </span>`;
  }
  document.getElementById('karte-info').addEventListener('click', async (ev) => {
    if (!ev.target.closest('#offline-knopf')) return;
    if (offlineLaeuft) { offlineAbbrechen = true; return; }
    offlineLaeuft = true;
    offlineAbbrechen = false;
    const knopf = document.getElementById('offline-knopf');
    knopf.textContent = 'Abbrechen';
    const text = () => document.getElementById('offline-text');
    try {
      const ergebnis = await offlineSpeichern(platz, (n, total) => {
        if (text()) text().textContent = `Karte wird gespeichert: ${Math.round((n / total) * 100)} %`;
      }, () => offlineAbbrechen);
      if (!nochAktuell(token)) return;
      if (ergebnis.abgebrochen) {
        meldung('Speichern abgebrochen');
      } else if (ergebnis.fehler > ergebnis.total * 0.1) {
        meldung(`Karte nur teilweise gespeichert (${ergebnis.fehler} Teile fehlen). Später nochmals versuchen.`, true);
      } else {
        einstellungSchreiben(offlineSchluessel, new Date().toISOString());
        meldung(`Karte im Umkreis von ${OFFLINE_RADIUS} m offline gespeichert`);
        db.dauerhaftAnfragen();
      }
    } catch (e) {
      meldung(e.message, true);
    } finally {
      offlineLaeuft = false;
      if (nochAktuell(token)) zeichnen();
    }
  });
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

// ---------- Ansicht: Sicherung ----------

async function sicherungAnsicht() {
  const token = aktuelleAnsicht;
  const [plaetze, maengel, offerten, fotoIds, speicher, kacheln] = await Promise.all([
    db.alle('plaetze'), db.alle('maengel'), db.alle('offerten'), db.schluessel('fotos'), speicherInfo(), kachelAnzahl().catch(() => 0),
  ]);
  if (!nochAktuell(token)) return;
  kopf('Sicherung', '#/', null);
  const letzte = letzteSicherung();
  const faellig = sicherungFaellig();

  ansicht.innerHTML = `
    <div class="formular">
      <section class="karte-block${faellig ? ' warnung' : ''}">
        <h2>Daten sichern</h2>
        <p class="status-zeile">${letzte ? `Letzte Sicherung: <strong>${datum(letzte)}</strong>` : '<strong>Noch keine Sicherung erstellt.</strong>'}</p>
        <p class="hinweis">Auf diesem Gerät: ${plaetze.length} Plätze, ${anzahlText(maengel.length)}, ${offerten.length === 1 ? "1 Offerte" : `${offerten.length} Offerten`}, ${fotoIds.length} Fotos.
          Die Daten liegen nur auf diesem Handy. Sichere sie regelmässig und speichere die Datei an einem sicheren Ort
          (z. B. «In Dateien sichern» → iCloud Drive oder OneDrive, oder per Mail an dich).</p>
        <button type="button" class="knopf haupt" id="sichern">Sicherung erstellen</button>
        <button type="button" class="link" id="herunterladen">Stattdessen als Datei herunterladen</button>
        <span class="hinweis" id="sichern-status"></span>
      </section>

      <section class="karte-block">
        <h2>Sicherung einlesen</h2>
        <p class="hinweis">Liest eine Sicherungsdatei ein. Was auf dem Gerät ist, bleibt erhalten; gibt es einen Eintrag in beiden,
          gilt der neuere Stand. So kannst du auch Daten von einem anderen Handy übernehmen.</p>
        <label class="knopf">Datei auswählen<input type="file" accept=".json,application/json" id="einlesen-datei" hidden></label>
        <span class="hinweis" id="einlesen-status"></span>
      </section>

      <section class="karte-block">
        <h2>Speicher</h2>
        <dl class="angaben einfach">
          <dt>Belegt</dt><dd>${groesseText(speicher.belegt)}</dd>
          <dt>Vor Löschen geschützt</dt><dd>${speicher.geschuetzt == null ? 'unbekannt' : speicher.geschuetzt ? 'ja' : 'nein – App über den Startbildschirm nutzen'}</dd>
          <dt>Offline-Karte</dt><dd>${kacheln} Kartenteile</dd>
        </dl>
        ${kacheln ? '<button type="button" class="knopf" id="kacheln-loeschen">Offline-Karten löschen</button>' : ''}
      </section>
    </div>
`;

  const status = document.getElementById('sichern-status');
  async function sichern(herunterladen) {
    const knopf = document.getElementById('sichern');
    knopf.disabled = true;
    status.textContent = 'Sicherung wird erstellt …';
    try {
      const s = await sicherungErstellen((n, total) => { status.textContent = `Fotos werden verpackt: ${n} von ${total} …`; });
      status.textContent = `Datei bereit (${groesseText(s.datei.size)}).`;
      const ok = await sicherungWeitergeben(s.datei, { herunterladen });
      if (!nochAktuell(token)) return;
      if (ok) {
        meldung('Sicherung erstellt');
        zeigen();
      } else {
        status.textContent = 'Nicht gespeichert. Tippe nochmals auf «Sicherung erstellen».';
      }
    } catch (e) {
      status.textContent = '';
      meldung(`Sicherung fehlgeschlagen: ${e.message}`, true);
    } finally {
      knopf.disabled = false;
    }
  }
  document.getElementById('sichern').onclick = () => sichern(false);
  document.getElementById('herunterladen').onclick = () => sichern(true);

  const einlesenStatus = document.getElementById('einlesen-status');
  document.getElementById('einlesen-datei').addEventListener('change', async (ev) => {
    const datei = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!datei) return;
    einlesenStatus.textContent = 'Datei wird geprüft …';
    try {
      const p = await sicherungPruefen(datei);
      const frage = `Sicherung vom ${datum(p.erstellt)} einlesen?\n\n`
        + `Plätze: ${p.plaetze.total} (neu ${p.plaetze.neu}, aktueller ${p.plaetze.aktueller})\n`
        + `Mängel: ${p.maengel.total} (neu ${p.maengel.neu}, aktueller ${p.maengel.aktueller})\n`
        + `Offerten: ${p.offerten.total} (neu ${p.offerten.neu}, aktueller ${p.offerten.aktueller})\n`
        + `Fotos: ${p.fotos}\n\n`
        + 'Daten auf diesem Gerät bleiben erhalten.';
      if (!confirm(frage)) { einlesenStatus.textContent = ''; return; }
      await sicherungEinlesen(p.daten, (n, total) => { einlesenStatus.textContent = `Fotos werden eingelesen: ${n} von ${total} …`; });
      db.dauerhaftAnfragen();
      meldung('Sicherung eingelesen');
      if (nochAktuell(token)) zeigen();
    } catch (e) {
      einlesenStatus.textContent = '';
      meldung(e.message, true);
    }
  });

  const loeschen = document.getElementById('kacheln-loeschen');
  if (loeschen) {
    loeschen.onclick = async () => {
      if (!confirm('Alle offline gespeicherten Karten löschen? Deine Mängel und Fotos bleiben erhalten.')) return;
      await kachelnLoeschen();
      try {
        for (const k of Object.keys(localStorage)) if (k.startsWith('offline-')) localStorage.removeItem(k);
      } catch (_) { /* egal */ }
      meldung('Offline-Karten gelöscht');
      zeigen();
    };
  }
}

// ---------- Ansicht: PDF-Bericht ----------

async function berichtAnsicht(platzId) {
  const token = aktuelleAnsicht;
  const platz = await db.holen('plaetze', platzId);
  if (!platz) throw new Error('Platz nicht gefunden.');
  const maengel = await db.maengelVonPlatz(platzId);
  if (!nochAktuell(token)) return;
  kopf('Bericht', `#/platz/${platz.id}`, null);
  const offen = maengel.filter((m) => !istErledigt(m)).length;
  const wahl = { auswahl: 'offen', fotos: true };

  ansicht.innerHTML = `
    <div class="formular">
      <div class="zusammenfassung">
        <strong>${esc(platz.name)}</strong>
        <span>${platz.ort ? `${esc(platz.ort)} · ` : ''}${offen} offen · ${maengel.length - offen} erledigt</span>
      </div>
      <fieldset class="feld">
        <legend>Welche Mängel?</legend>
        <div class="segmente klein zwei" id="b-auswahl">
          <button type="button" class="segment" data-wert="offen">Offene (${offen})</button>
          <button type="button" class="segment" data-wert="alle">Alle (${maengel.length})</button>
        </div>
      </fieldset>
      <fieldset class="feld">
        <legend>Fotos im Bericht?</legend>
        <div class="segmente klein zwei" id="b-fotos">
          <button type="button" class="segment" data-wert="ja">Mit Fotos</button>
          <button type="button" class="segment" data-wert="nein">Ohne Fotos</button>
        </div>
      </fieldset>
      <p class="hinweis">Der Bericht enthält einen Plan mit nummerierten Punkten, eine Liste und – falls gewählt – jeden Mangel mit Foto.
        Für das Luftbild im Plan braucht es Empfang oder eine offline gespeicherte Karte.</p>
      <span class="hinweis" id="b-status" aria-live="polite"></span>
      <div id="b-fertig" hidden class="karte-block">
        <strong id="b-fertig-text"></strong>
        <div class="knopf-reihe">
          <button type="button" class="knopf" id="b-teilen">Teilen</button>
          <button type="button" class="knopf" id="b-laden">Herunterladen</button>
        </div>
      </div>
    </div>
    <div class="aktionen"><button type="button" class="knopf haupt" id="b-erstellen">PDF erstellen</button></div>`;

  function zeichnen() {
    for (const [id, wert] of [['b-auswahl', wahl.auswahl], ['b-fotos', wahl.fotos ? 'ja' : 'nein']]) {
      for (const b of document.getElementById(id).querySelectorAll('button')) {
        const an = b.dataset.wert === wert;
        b.classList.toggle('aktiv', an);
        b.setAttribute('aria-pressed', an);
      }
    }
  }
  document.getElementById('b-auswahl').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-wert]');
    if (b) { wahl.auswahl = b.dataset.wert; zeichnen(); }
  });
  document.getElementById('b-fotos').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-wert]');
    if (b) { wahl.fotos = b.dataset.wert === 'ja'; zeichnen(); }
  });
  zeichnen();

  let datei = null;
  const status = document.getElementById('b-status');
  const knopf = document.getElementById('b-erstellen');
  knopf.onclick = async () => {
    knopf.disabled = true;
    document.getElementById('b-fertig').hidden = true;
    try {
      const ergebnis = await berichtErstellen(platz, {
        auswahl: wahl.auswahl,
        mitFotos: wahl.fotos,
        meldung: (t) => { if (nochAktuell(token)) status.textContent = t; },
      });
      if (!nochAktuell(token)) return;
      datei = ergebnis.datei;
      status.textContent = ergebnis.planFehlend ? 'Hinweis: Das Luftbild im Plan ist unvollständig (kein Empfang?).' : '';
      document.getElementById('b-fertig-text').textContent = `PDF bereit: ${ergebnis.anzahl} Mängel, ${ergebnis.seiten} Seiten, ${groesseText(datei.size)}`;
      document.getElementById('b-fertig').hidden = false;
      await dateiWeitergeben(datei, { titel: `Mängelbericht ${platz.name}` });
    } catch (e) {
      console.error(e);
      status.textContent = '';
      meldung(`Bericht fehlgeschlagen: ${e.message}`, true);
    } finally {
      knopf.disabled = false;
    }
  };
  document.getElementById('b-teilen').onclick = () => { if (datei) dateiWeitergeben(datei, { titel: `Mängelbericht ${platz.name}` }); };
  document.getElementById('b-laden').onclick = () => { if (datei) dateiWeitergeben(datei, { herunterladen: true }); };
}

// ---------- Ansicht: Startbildschirm ----------

async function startAnsicht() {
  const token = aktuelleAnsicht;
  kopf('Sportplatz', null, null);
  const [plaetze, maengel, offerten] = await Promise.all([db.alle('plaetze'), db.alle('maengel'), db.alle('offerten')]);
  if (!nochAktuell(token)) return;

  // Daten aus früheren Versionen haben noch keine Änderungszeit: jetzt setzen, damit die Erinnerung greift
  const hatDaten = plaetze.length || maengel.length || offerten.length;
  if (hatDaten && einstellungLesen('letzte-aenderung-gesetzt', null) === null) {
    try { if (!localStorage.getItem('letzte-aenderung')) db.aenderungMerken(); } catch (_) { /* egal */ }
    einstellungSchreiben('letzte-aenderung-gesetzt', true);
  }
  const faellig = hatDaten && sicherungFaellig();
  const letzte = letzteSicherung();
  const offeneMaengel = maengel.filter((m) => !istErledigt(m));
  const dringend = offeneMaengel.filter((m) => m.dringlichkeit === 'hoch').length;
  const offeneOfferten = offerten.filter((o) => o.status !== 'abgeschlossen').length;

  ansicht.innerHTML = `
    ${faellig ? `<a class="erinnerung" href="#/sicherung">
        <strong>Sicherung fällig</strong>
        <span>${letzte ? `Letzte Sicherung am ${kurzdatum(letzte)}.` : 'Du hast noch nie gesichert.'} Tippe hier, um deine Daten zu sichern.</span>
      </a>` : ''}
    <div class="start">
      <a class="start-knopf start-maengel" href="#/plaetze">
        <svg viewBox="0 0 24 24" width="44" height="44" aria-hidden="true"><path d="M12 3 2 20h20L12 3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 10v5M12 17.5v.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>
        <span class="start-titel">Mängel erfassen</span>
        <span class="start-unter">${offeneMaengel.length} offen${dringend ? ` · ${dringend} dringend` : ''} · ${plaetze.length} ${plaetze.length === 1 ? 'Platz' : 'Plätze'}</span>
      </a>
      <a class="start-knopf start-offerte" href="#/offerten">
        <svg viewBox="0 0 24 24" width="44" height="44" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9 3h6v3H9zM8.5 11h7M8.5 15h7M8.5 18h4" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>
        <span class="start-titel">Offerte aufnehmen</span>
        <span class="start-unter">${offeneOfferten} ${offeneOfferten === 1 ? 'offene Offerte' : 'offene Offerten'}</span>
      </a>
      <a class="knopf start-sicherung${faellig ? ' faellig' : ''}" href="#/sicherung">Sicherung</a>
    </div>`;
}

// ---------- Ansicht: Offerten ----------

function offerteUntertitel(o) {
  return [o.kunde?.firma, o.ort].filter(Boolean).map(esc).join(' · ');
}

async function offertenListe() {
  const token = aktuelleAnsicht;
  kopf('Offerten', '#/', null);
  const [offerten, positionen] = await Promise.all([db.alle('offerten'), db.alle('positionen')]);
  if (!nochAktuell(token)) return;
  const anzahl = {};
  for (const p of positionen) anzahl[p.offerteId] = (anzahl[p.offerteId] || 0) + 1;
  let status = einstellungLesen('offerten-filter', 'offen');

  ansicht.innerHTML = `
    <div class="filter">
      <div class="segmente klein" id="o-status" role="group" aria-label="Status">
        <button type="button" class="segment" data-wert="offen">Offen</button>
        <button type="button" class="segment" data-wert="abgeschlossen">Abgeschlossen</button>
        <button type="button" class="segment" data-wert="alle">Alle</button>
      </div>
    </div>
    <ul class="liste" id="o-liste"></ul>
    <div class="aktionen"><a class="knopf haupt" href="#/offerte/neu">+ Offerte</a></div>`;

  function zeichnen() {
    for (const b of document.querySelectorAll('#o-status button')) {
      const an = b.dataset.wert === status;
      b.classList.toggle('aktiv', an);
      b.setAttribute('aria-pressed', an);
    }
    const liste = offerten
      .filter((o) => status === 'alle' || (status === 'abgeschlossen' ? o.status === 'abgeschlossen' : o.status !== 'abgeschlossen'))
      .sort((a, b) => String(b.geaendert).localeCompare(String(a.geaendert)));
    document.getElementById('o-liste').innerHTML = liste.length === 0
      ? `<li class="leer">${offerten.length ? 'Keine Offerten für diesen Filter.' : '<strong>Noch keine Offerten.</strong><br>Tippe unten auf «+ Offerte».'}</li>`
      : liste.map((o) => `<li><a class="eintrag" href="#/offerte/${o.id}">
          <span class="eintrag-text">
            <span class="eintrag-titel">${esc(o.titel)}</span>
            <span class="eintrag-unter">${offerteUntertitel(o) || '–'}</span>
            <span class="eintrag-unter">${o.datum ? `Begehung ${kurzdatum(o.datum)}` : ''}</span>
          </span>
          <span class="eintrag-zahlen">
            <span>${anzahl[o.id] || 0} Pos.</span>
            ${o.status === 'abgeschlossen' ? `<span class="marke" style="background:${ERLEDIGT_FARBE}">abgeschlossen</span>` : ''}
          </span>
        </a></li>`).join('');
  }
  document.getElementById('o-status').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-wert]');
    if (!b) return;
    status = b.dataset.wert;
    einstellungSchreiben('offerten-filter', status);
    zeichnen();
  });
  zeichnen();
}

function heute() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function offerteFormular(offerteId) {
  const token = aktuelleAnsicht;
  let offerte = null;
  if (offerteId) {
    offerte = await db.holen('offerten', offerteId);
    if (!offerte) throw new Error('Offerte nicht gefunden.');
  }
  const plaetze = (await db.alle('plaetze')).sort((a, b) => a.name.localeCompare(b.name, 'de-CH'));
  if (!nochAktuell(token)) return;
  const zurueck = offerte ? `#/offerte/${offerte.id}` : '#/offerten';
  kopf(offerte ? 'Offerte bearbeiten' : 'Neue Offerte', zurueck, null);
  const k = offerte?.kunde || {};

  ansicht.innerHTML = `
    <form id="offerte-form" class="formular" novalidate>
      <label class="feld">Titel der Offerte
        <input name="titel" required maxlength="100" autocomplete="off" placeholder="z. B. Sanierung Kunstrasen" value="${esc(offerte?.titel)}">
      </label>
      <fieldset class="feld gruppe">
        <legend>Kunde</legend>
        <label class="feld">Auftraggeber
          <input name="firma" maxlength="100" autocomplete="organization" placeholder="z. B. Gemeinde, Verein" value="${esc(k.firma)}">
        </label>
        <label class="feld">Ansprechperson
          <input name="person" maxlength="100" autocomplete="name" value="${esc(k.person)}">
        </label>
        <label class="feld">Telefon
          <input name="telefon" type="tel" maxlength="40" autocomplete="tel" value="${esc(k.telefon)}">
        </label>
        <label class="feld">E-Mail
          <input name="email" type="email" maxlength="100" autocomplete="email" value="${esc(k.email)}">
        </label>
      </fieldset>
      ${plaetze.length ? `<label class="feld">Ort von einem Platz übernehmen (freiwillig)
        <select name="platzId" class="auswahl">
          <option value="">– kein Platz –</option>
          ${plaetze.map((p) => `<option value="${p.id}" ${offerte?.platzId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
        </select>
      </label>` : ''}
      <label class="feld">Ort / Adresse
        <input name="ort" maxlength="120" autocomplete="off" placeholder="z. B. Sportanlage Allmend, Bern" value="${esc(offerte?.ort)}">
      </label>
      <div class="feld">
        <span>Lage auf der Karte</span>
        <span class="hinweis">Schiebe die Karte, bis die Anlage unter dem Pin liegt.</span>
        <div class="karte-rahmen">
          <div id="karte" class="karte"></div>
          ${pinHtml('pin-platz')}
          <button type="button" id="gps-knopf" class="karte-knopf">Meine Position</button>
        </div>
        <span id="gps-status" class="hinweis"></span>
      </div>
      <label class="feld">Datum der Begehung
        <input name="datum" type="date" value="${esc(offerte?.datum || heute())}">
      </label>
      <label class="feld">Notiz (freiwillig)
        <textarea name="notiz" rows="3" maxlength="2000" placeholder="Wünsche des Kunden, Zufahrt, Termine …">${esc(offerte?.notiz)}</textarea>
      </label>
      ${offerte ? '<button type="button" id="loeschen" class="knopf gefahr">Offerte löschen</button>' : ''}
    </form>
    <div class="aktionen"><button type="submit" form="offerte-form" class="knopf haupt">Speichern</button></div>`;

  const form = document.getElementById('offerte-form');
  const start = offerte?.lat ? { lat: offerte.lat, lng: offerte.lng, zoom: offerte.zoom || 18 } : SCHWEIZ;
  const karte = karteErstellen(document.getElementById('karte'), start);
  beimVerlassen(() => karteEntfernen(karte));
  let geaendert = false;
  form.addEventListener('input', () => { geaendert = true; });
  karte.on('dragstart zoomstart', () => { geaendert = true; });
  schutz(() => !geaendert || confirm('Änderungen verwerfen?'));

  // Platz übernehmen: Ort und Lage setzen
  if (form.platzId) {
    form.platzId.addEventListener('change', () => {
      const p = plaetze.find((x) => x.id === form.platzId.value);
      if (!p) return;
      if (!form.ort.value.trim()) form.ort.value = [p.name, p.ort].filter(Boolean).join(', ');
      karte.setView([p.lat, p.lng], p.zoom || 18);
      vonHandVerschoben = true;
    });
  }

  const status = document.getElementById('gps-status');
  let vonHandVerschoben = !!offerte?.lat;
  karte.on('dragstart', () => { vonHandVerschoben = true; });
  let stopp = null;
  function gpsStarten() {
    if (stopp) stopp();
    status.textContent = 'Suche GPS …';
    let erstes = true;
    stopp = gpsBeobachten((pos) => {
      status.textContent = `GPS gefunden (± ${pos.genauigkeit} m)`;
      if (erstes || !vonHandVerschoben) {
        karte.setView([pos.lat, pos.lng], Math.max(karte.getZoom(), 18));
        erstes = false;
      }
    }, (fehler) => { status.textContent = fehler; });
  }
  beimVerlassen(() => { if (stopp) stopp(); });
  document.getElementById('gps-knopf').onclick = () => { vonHandVerschoben = false; gpsStarten(); };
  if (!offerte) gpsStarten();

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const titel = form.titel.value.trim();
    if (!titel) { meldung('Bitte einen Titel eingeben.', true); form.titel.focus(); return; }
    if (karte.getZoom() < 15) { meldung('Zoome näher an die Anlage heran, damit die Lage stimmt.', true); return; }
    const mitte = karte.getCenter();
    try {
      const gespeichert = await db.offerteSpeichern({
        status: 'offen',
        ...(offerte || {}),
        titel,
        kunde: {
          firma: form.firma.value.trim(),
          person: form.person.value.trim(),
          telefon: form.telefon.value.trim(),
          email: form.email.value.trim(),
        },
        platzId: form.platzId ? (form.platzId.value || null) : (offerte?.platzId || null),
        ort: form.ort.value.trim(),
        lat: mitte.lat,
        lng: mitte.lng,
        zoom: karte.getZoom(),
        datum: form.datum.value || null,
        notiz: form.notiz.value.trim(),
      });
      db.dauerhaftAnfragen();
      meldung('Offerte gespeichert');
      if (offerte) zurueckZu(`#/offerte/${gespeichert.id}`);
      else ersetze(`#/offerte/${gespeichert.id}`);
    } catch (e) {
      meldung(`Speichern fehlgeschlagen: ${e.message}`, true);
    }
  });

  if (offerte) {
    document.getElementById('loeschen').onclick = async () => {
      const anzahl = (await db.positionenVonOfferte(offerte.id)).length;
      if (!confirm(`Offerte «${offerte.titel}»${anzahl ? ` mit ${anzahl} Positionen und allen Fotos` : ''} endgültig löschen?`)) return;
      await db.offerteLoeschen(offerte.id);
      meldung('Offerte gelöscht');
      zurueckZu('#/offerten');
    };
  }
}

function mengeText(p) {
  if (p.einheit === 'pauschal') return 'pauschal';
  if (p.menge == null || p.menge === '') return '–';
  return `${zahlText(p.menge)} ${p.einheit || ''}`.trim();
}

async function offerteAnsicht(offerteId) {
  const token = aktuelleAnsicht;
  const offerte = await db.holen('offerten', offerteId);
  if (!offerte) throw new Error('Offerte nicht gefunden.');
  const positionen = await db.positionenVonOfferte(offerteId);
  if (!nochAktuell(token)) return;
  kopf(offerte.titel, '#/offerten', { text: 'Bearbeiten', klick: () => gehe(`#/offerte/${offerte.id}/bearbeiten`) });
  const k = offerte.kunde || {};
  const abgeschlossen = offerte.status === 'abgeschlossen';

  ansicht.innerHTML = `
    <div class="karte-rahmen offerte-karte"><div id="karte" class="karte"></div></div>
    <div class="detail">
      <div class="karte-block">
        <div class="kunde">
          <strong>${esc(k.firma || 'Kein Auftraggeber erfasst')}</strong>
          ${k.person ? `<span>${esc(k.person)}</span>` : ''}
          ${k.telefon ? `<a href="tel:${esc(k.telefon.replace(/[^\d+]/g, ''))}">${esc(k.telefon)}</a>` : ''}
          ${k.email ? `<a href="mailto:${esc(k.email)}">${esc(k.email)}</a>` : ''}
        </div>
        <span class="hinweis">${[offerte.ort, offerte.datum ? `Begehung ${kurzdatum(offerte.datum)}` : ''].filter(Boolean).map(esc).join(' · ')}</span>
        ${offerte.notiz ? `<p class="notiz">${esc(offerte.notiz)}</p>` : ''}
        ${abgeschlossen ? `<span class="marke" style="background:${ERLEDIGT_FARBE};justify-self:start">abgeschlossen</span>` : ''}
      </div>
      <h2 class="abschnitt">Positionen (${positionen.length})</h2>
      ${positionen.length === 0 ? '<p class="leer">Noch keine Positionen. Tippe unten auf «+ Position».</p>' : `
      <ul class="liste ohne-rand">
        ${positionen.map((p, i) => `<li><a class="eintrag position-eintrag" href="#/position/${p.id}">
          <span class="pos-nr" style="background:${p.messung ? FORM_FARBE[p.messung.typ] : '#78909c'}">${i + 1}</span>
          <span class="eintrag-text">
            <span class="eintrag-titel">${esc(p.art)}</span>
            ${p.beschreibung ? `<span class="eintrag-notiz">${esc(p.beschreibung)}</span>` : ''}
            <span class="eintrag-unter">${(p.fotoIds || []).length ? `${p.fotoIds.length} Foto${p.fotoIds.length > 1 ? 's' : ''}` : 'ohne Foto'}${p.messung ? ` · ${MESS_NAME[p.messung.typ]} gemessen` : ''}</span>
          </span>
          <span class="menge">${mengeText(p)}</span>
        </a></li>`).join('')}
      </ul>`}
      <button type="button" class="knopf breit" id="status-knopf">${abgeschlossen ? 'Wieder öffnen' : 'Als abgeschlossen markieren'}</button>
    </div>
    <div class="aktionen">
      <a class="knopf" href="#/offerte/${offerte.id}/pdf">PDF</a>
      <a class="knopf haupt breit" href="#/offerte/${offerte.id}/position/neu">+ Position</a>
    </div>`;

  const karte = karteErstellen(document.getElementById('karte'), { lat: offerte.lat, lng: offerte.lng, zoom: offerte.zoom || 18 });
  beimVerlassen(() => karteEntfernen(karte));
  const grenzen = L.latLngBounds([[offerte.lat, offerte.lng]]);
  positionen.forEach((p, i) => {
    const ebene = formZeichnen(p.messung, { nr: i + 1, klick: () => gehe(`#/position/${p.id}`) });
    if (ebene) {
      ebene.addTo(karte);
      for (const x of p.messung.punkte) grenzen.extend(x);
    }
  });
  if (positionen.some((p) => p.messung)) karte.fitBounds(grenzen, { padding: [30, 30], maxZoom: 20 });

  document.getElementById('status-knopf').onclick = async () => {
    await db.offerteSpeichern({ ...offerte, status: abgeschlossen ? 'offen' : 'abgeschlossen' });
    meldung(abgeschlossen ? 'Offerte wieder offen' : 'Offerte abgeschlossen');
    zeigen();
  };
}

// ---------- Baustein: mehrere Fotos ----------

function fotosFeldHtml(titel) {
  return `<div class="feld fotos-feld">
    <span>${titel}</span>
    <div class="foto-raster"></div>
    <div class="knopf-reihe foto-knoepfe">
      <label class="knopf">Foto aufnehmen<input type="file" accept="image/*" capture="environment" class="foto-kamera" hidden></label>
      <label class="knopf">Aus Galerie<input type="file" accept="image/*" multiple class="foto-galerie" hidden></label>
    </div>
    <span class="hinweis foto-status"></span>
  </div>`;
}

// bestehende: Liste von Foto-ids. Liefert { aenderung() } → { neu: [...], entfernen: [...] }
function fotosFeldAktivieren(el, bestehende, { beiAenderung, knopf, max = MAX_FOTOS_POSITION }) {
  const eintraege = bestehende.map((id) => ({ id, url: null }));
  const entfernt = [];
  const raster = el.querySelector('.foto-raster');
  const status = el.querySelector('.foto-status');
  const urls = [];
  beimVerlassen(() => { for (const u of urls) URL.revokeObjectURL(u); });

  async function zeichnen() {
    raster.innerHTML = eintraege.map((e, i) => `<div class="foto-kachel">
      <img alt="Foto ${i + 1}" data-i="${i}">
      <button type="button" class="foto-x" data-i="${i}" aria-label="Foto ${i + 1} entfernen">×</button>
    </div>`).join('');
    el.querySelector('.foto-knoepfe').hidden = eintraege.length >= max;
    for (const [i, e] of eintraege.entries()) {
      if (!e.url) {
        const v = e.neu ? e.neu.vorschau : await db.vorschauHolen(e.id, vorschauAusFoto).catch(() => null);
        if (v) { e.url = alsUrl(v); urls.push(e.url); }
      }
      const img = raster.querySelector(`img[data-i="${i}"]`);
      if (img && e.url) img.src = e.url;
    }
  }
  raster.addEventListener('click', async (ev) => {
    const x = ev.target.closest('.foto-x');
    if (x) {
      const [e] = eintraege.splice(Number(x.dataset.i), 1);
      if (e.id) entfernt.push(e.id);
      beiAenderung();
      zeichnen();
      return;
    }
    const img = ev.target.closest('img[data-i]');
    if (!img) return;
    const e = eintraege[Number(img.dataset.i)];
    const foto = e.neu || await db.holen('fotos', e.id);
    if (foto) {
      const url = alsUrl(foto);
      urls.push(url);
      grossAnzeigen(url);
    }
  });

  async function gewaehlt(ev) {
    const dateien = [...(ev.target.files || [])];
    ev.target.value = '';
    if (!dateien.length) return;
    const platz = max - eintraege.length;
    if (dateien.length > platz) meldung(`Höchstens ${max} Fotos pro Position – ${dateien.length - platz} nicht übernommen.`, true);
    knopf.disabled = true;
    try {
      for (const [i, datei] of dateien.slice(0, platz).entries()) {
        status.textContent = `Foto ${i + 1} wird verkleinert …`;
        eintraege.push({ neu: await verkleinern(datei), url: null });
      }
      beiAenderung();
    } catch (e) {
      meldung(e.message, true);
    } finally {
      status.textContent = '';
      knopf.disabled = false;
      zeichnen();
    }
  }
  for (const inp of el.querySelectorAll('input[type=file]')) inp.addEventListener('change', gewaehlt);
  beimVerlassen(() => { for (const el2 of document.querySelectorAll('.foto-voll')) el2.remove(); });
  zeichnen();
  return { aenderung: () => ({ neu: eintraege.filter((e) => e.neu).map((e) => e.neu), entfernen: [...entfernt] }) };
}

// ---------- Ansicht: Position erfassen / bearbeiten ----------

async function positionFormular({ offerteId, positionId }) {
  const token = aktuelleAnsicht;
  let position = null;
  if (positionId) {
    position = await db.holen('positionen', positionId);
    if (!position) throw new Error('Position nicht gefunden.');
    offerteId = position.offerteId;
  }
  const offerte = await db.holen('offerten', offerteId);
  if (!offerte) throw new Error('Offerte nicht gefunden.');
  const alle = await db.positionenVonOfferte(offerteId);
  if (!nochAktuell(token)) return;
  const nr = position ? alle.findIndex((p) => p.id === position.id) + 1 : alle.length + 1;
  kopf(position ? `Position ${nr}` : 'Neue Position', `#/offerte/${offerte.id}`, null);

  const wahl = { art: position?.art || '', einheit: position?.einheit || 'm²' };
  const messTyp = position?.messung?.typ || '';

  ansicht.innerHTML = `
    <form id="position-form" class="formular" novalidate>
      <fieldset class="feld">
        <legend>Art der Arbeit</legend>
        <div class="chips" id="arten">
          ${POSITIONSARTEN.map((a) => `<button type="button" class="chip${wahl.art === a ? ' aktiv' : ''}" data-wert="${esc(a)}" aria-pressed="${wahl.art === a}">${esc(a)}</button>`).join('')}
        </div>
      </fieldset>

      <div class="feld">
        <span>Messen auf dem Luftbild (freiwillig)</span>
        <div class="segmente klein vier" id="mess-typ" role="group" aria-label="Messart">
          <button type="button" class="segment" data-wert="flaeche">Fläche</button>
          <button type="button" class="segment" data-wert="linie">Länge</button>
          <button type="button" class="segment" data-wert="punkt">Punkte</button>
          <button type="button" class="segment" data-wert="">Ohne</button>
        </div>
        <div class="karte-rahmen gross">
          <div id="karte" class="karte"></div>
          <div class="mess-anzeige" id="mess-anzeige" hidden></div>
        </div>
        <div class="knopf-reihe" id="mess-knoepfe">
          <button type="button" class="knopf klein" id="mess-zurueck">Rückgängig</button>
          <button type="button" class="knopf klein" id="mess-leeren">Alles löschen</button>
        </div>
        <span class="hinweis" id="mess-hinweis"></span>
      </div>

      <div class="feld">
        <span>Menge</span>
        <div class="menge-reihe">
          <input name="menge" inputmode="decimal" autocomplete="off" placeholder="z. B. 1200" value="${position?.menge != null ? esc(String(position.menge)) : ''}" aria-label="Menge">
          <div class="segmente klein vier" id="einheit" role="group" aria-label="Einheit">
            ${EINHEITEN.map((e) => `<button type="button" class="segment" data-wert="${e}">${e}</button>`).join('')}
          </div>
        </div>
        <span class="hinweis" id="menge-hinweis"></span>
      </div>

      <label class="feld">Beschreibung
        <textarea name="beschreibung" rows="3" maxlength="2000" placeholder="Was ist zu tun? Material, Zustand, Besonderheiten …">${esc(position?.beschreibung)}</textarea>
      </label>

      ${fotosFeldHtml(`Fotos (bis ${MAX_FOTOS_POSITION})`)}

      ${position ? '<button type="button" id="loeschen" class="knopf gefahr">Position löschen</button>' : ''}
    </form>
    <div class="aktionen"><button type="submit" form="position-form" class="knopf haupt" id="speichern">Speichern</button></div>`;

  const form = document.getElementById('position-form');
  const speichernKnopf = document.getElementById('speichern');
  let geaendert = false;
  const markiere = () => { geaendert = true; };
  form.addEventListener('input', markiere);
  schutz(() => !geaendert || confirm(position ? 'Änderungen verwerfen?' : 'Position verwerfen?'));

  // --- Karte mit den anderen Positionen (blass) ---
  const karte = karteErstellen(document.getElementById('karte'), { lat: offerte.lat, lng: offerte.lng, zoom: Math.max(offerte.zoom || 18, 19) });
  beimVerlassen(() => karteEntfernen(karte));
  alle.forEach((p, i) => {
    if (position && p.id === position.id) return;
    const ebene = formZeichnen(p.messung, { nr: i + 1, gedimmt: true });
    if (ebene) ebene.addTo(karte);
  });
  if (position?.messung?.punkte?.length) {
    karte.fitBounds(L.latLngBounds(position.messung.punkte), { padding: [40, 40], maxZoom: 20 });
  }

  // --- Messen ---
  const mengeFeld = form.menge;
  const mengeHinweis = document.getElementById('menge-hinweis');
  // Menge von Hand gesetzt? Dann nicht mehr automatisch überschreiben
  let mengeVonHand = !!position && position.menge != null && position.menge !== messMenge(position.messung);
  const hinweise = {
    flaeche: 'Tippe die Ecken der Fläche nacheinander an. Punkte kannst du verschieben.',
    linie: 'Tippe Anfang, Knicke und Ende der Strecke an. Punkte kannst du verschieben.',
    punkt: 'Tippe jede Stelle einmal an, die Anzahl wird gezählt.',
    '': 'Ohne Messung: Menge unten von Hand eingeben.',
  };
  const werkzeug = new Messwerkzeug(karte, { beiAenderung: messungGeaendert });
  beimVerlassen(() => werkzeug.entfernen());
  werkzeug.setzen(position?.messung || null);
  werkzeug.typSetzen(messTyp || null);

  function messAnzeige() {
    const typ = werkzeug.typ || '';
    for (const b of document.querySelectorAll('#mess-typ button')) {
      const an = b.dataset.wert === typ;
      b.classList.toggle('aktiv', an);
      b.setAttribute('aria-pressed', an);
    }
    const m = werkzeug.messung();
    const text = m ? messText(m) : '';
    const anzeige = document.getElementById('mess-anzeige');
    anzeige.hidden = !typ;
    anzeige.textContent = text ? `${MESS_NAME[typ]}: ${text}` : (typ ? `${MESS_NAME[typ]}: Punkte setzen` : '');
    document.getElementById('mess-knoepfe').hidden = !typ;
    document.getElementById('mess-zurueck').disabled = !werkzeug.punkte.length;
    document.getElementById('mess-leeren').disabled = !werkzeug.punkte.length;
    document.getElementById('mess-hinweis').textContent = hinweise[typ];
  }
  function einheitAnzeigen() {
    for (const b of document.querySelectorAll('#einheit button')) {
      const an = b.dataset.wert === wahl.einheit;
      b.classList.toggle('aktiv', an);
      b.setAttribute('aria-pressed', an);
    }
    mengeFeld.disabled = wahl.einheit === 'pauschal';
    if (wahl.einheit === 'pauschal') mengeFeld.value = '';
  }
  function messungGeaendert() {
    markiere();
    const m = werkzeug.messung();
    const menge = messMenge(m);
    if (!mengeVonHand && m && menge != null) {
      mengeFeld.value = String(menge);
      wahl.einheit = MESS_EINHEIT[m.typ];
      einheitAnzeigen();
      mengeHinweis.textContent = 'Menge aus der Messung übernommen.';
    } else if (mengeVonHand && m && menge != null) {
      mengeHinweis.innerHTML = `Gemessen: ${esc(messText(m))}. <button type="button" class="link" id="mess-uebernehmen">Messwert übernehmen</button>`;
    }
    messAnzeige();
  }
  mengeHinweis.addEventListener('click', (ev) => {
    if (!ev.target.closest('#mess-uebernehmen')) return;
    mengeVonHand = false;
    messungGeaendert();
  });
  mengeFeld.addEventListener('input', () => {
    mengeVonHand = mengeFeld.value.trim() !== '';
    mengeHinweis.textContent = '';
  });

  document.getElementById('mess-typ').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-wert]');
    if (!b) return;
    const typ = b.dataset.wert;
    if (!typ && werkzeug.punkte.length && !confirm('Messung verwerfen?')) return;
    if (!typ) werkzeug.leeren();
    werkzeug.typSetzen(typ || null);
    messungGeaendert();
  });
  document.getElementById('mess-zurueck').onclick = () => werkzeug.rueckgaengig();
  document.getElementById('mess-leeren').onclick = () => { if (confirm('Alle Messpunkte löschen?')) werkzeug.leeren(); };
  messAnzeige();
  einheitAnzeigen();
  geaendert = false; // Aufbau der Messung zählt nicht als Änderung

  document.getElementById('einheit').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-wert]');
    if (!b) return;
    wahl.einheit = b.dataset.wert;
    einheitAnzeigen();
    markiere();
  });
  document.getElementById('arten').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-wert]');
    if (!b) return;
    wahl.art = b.dataset.wert;
    for (const x of document.querySelectorAll('#arten button')) {
      const an = x === b;
      x.classList.toggle('aktiv', an);
      x.setAttribute('aria-pressed', an);
    }
    markiere();
  });

  const fotos = fotosFeldAktivieren(form.querySelector('.fotos-feld'), position?.fotoIds || [], { beiAenderung: markiere, knopf: speichernKnopf });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!wahl.art) {
      meldung('Bitte die Art der Arbeit wählen.', true);
      document.getElementById('arten').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const rohMenge = mengeFeld.value.trim().replace(/[’'\s]/g, '').replace(',', '.');
    const menge = wahl.einheit === 'pauschal' || rohMenge === '' ? null : Number(rohMenge);
    if (menge != null && (Number.isNaN(menge) || menge < 0)) {
      meldung('Die Menge ist keine gültige Zahl.', true);
      mengeFeld.focus();
      return;
    }
    const messung = werkzeug.messung();
    if (messung && messung.typ === 'flaeche' && messung.punkte.length < 3) {
      if (!confirm('Für eine Fläche braucht es mindestens 3 Punkte. Ohne Messung speichern?')) return;
    }
    speichernKnopf.disabled = true;
    try {
      await db.positionSpeichern({
        ...(position || { offerteId: offerte.id, fotoIds: [] }),
        art: wahl.art,
        beschreibung: form.beschreibung.value.trim(),
        menge,
        einheit: wahl.einheit,
        messung: messung && (messung.typ !== 'flaeche' || messung.punkte.length >= 3) && (messung.typ !== 'linie' || messung.punkte.length >= 2) ? messung : null,
      }, fotos.aenderung());
      db.dauerhaftAnfragen();
      meldung('Position gespeichert');
      zurueckZu(`#/offerte/${offerte.id}`);
    } catch (e) {
      speichernKnopf.disabled = false;
      meldung(`Speichern fehlgeschlagen: ${e.message}`, true);
    }
  });

  if (position) {
    document.getElementById('loeschen').onclick = async () => {
      if (!confirm(`Position ${nr} «${position.art}»${(position.fotoIds || []).length ? ' mit Fotos' : ''} endgültig löschen?`)) return;
      await db.positionLoeschen(position);
      meldung('Position gelöscht');
      zurueckZu(`#/offerte/${offerte.id}`);
    };
  }
}

// ---------- Ansicht: PDF «Aufnahme für Offerte» ----------

async function offerteBerichtAnsicht(offerteId) {
  const token = aktuelleAnsicht;
  const offerte = await db.holen('offerten', offerteId);
  if (!offerte) throw new Error('Offerte nicht gefunden.');
  const positionen = await db.positionenVonOfferte(offerteId);
  if (!nochAktuell(token)) return;
  kopf('PDF Offerte', `#/offerte/${offerte.id}`, null);
  let mitFotos = true;

  ansicht.innerHTML = `
    <div class="formular">
      <div class="zusammenfassung">
        <strong>${esc(offerte.titel)}</strong>
        <span>${offerteUntertitel(offerte) || '–'} · ${positionen.length} Positionen</span>
      </div>
      <fieldset class="feld">
        <legend>Fotos im PDF?</legend>
        <div class="segmente klein zwei" id="b-fotos">
          <button type="button" class="segment" data-wert="ja">Mit Fotos</button>
          <button type="button" class="segment" data-wert="nein">Ohne Fotos</button>
        </div>
      </fieldset>
      <p class="hinweis">Das PDF «Aufnahme für Offerte» enthält Kunde, einen Plan mit den gemessenen Flächen und Linien,
        die Positionsliste mit Mengen und – falls gewählt – die Fotos. Preise sind keine enthalten.</p>
      <span class="hinweis" id="b-status" aria-live="polite"></span>
      <div id="b-fertig" hidden class="karte-block">
        <strong id="b-fertig-text"></strong>
        <div class="knopf-reihe">
          <button type="button" class="knopf" id="b-teilen">Teilen</button>
          <button type="button" class="knopf" id="b-laden">Herunterladen</button>
        </div>
      </div>
    </div>
    <div class="aktionen"><button type="button" class="knopf haupt" id="b-erstellen">PDF erstellen</button></div>`;

  function zeichnen() {
    for (const b of document.querySelectorAll('#b-fotos button')) {
      const an = (b.dataset.wert === 'ja') === mitFotos;
      b.classList.toggle('aktiv', an);
      b.setAttribute('aria-pressed', an);
    }
  }
  document.getElementById('b-fotos').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-wert]');
    if (b) { mitFotos = b.dataset.wert === 'ja'; zeichnen(); }
  });
  zeichnen();

  let datei = null;
  const status = document.getElementById('b-status');
  const knopf = document.getElementById('b-erstellen');
  const titel = `Aufnahme Offerte ${offerte.titel}`;
  knopf.onclick = async () => {
    knopf.disabled = true;
    document.getElementById('b-fertig').hidden = true;
    try {
      const ergebnis = await offerteBerichtErstellen(offerte, {
        mitFotos,
        meldung: (t) => { if (nochAktuell(token)) status.textContent = t; },
      });
      if (!nochAktuell(token)) return;
      datei = ergebnis.datei;
      status.textContent = ergebnis.planFehlend ? 'Hinweis: Das Luftbild im Plan ist unvollständig (kein Empfang?).' : '';
      document.getElementById('b-fertig-text').textContent = `PDF bereit: ${ergebnis.anzahl} Positionen, ${ergebnis.seiten} Seiten, ${groesseText(datei.size)}`;
      document.getElementById('b-fertig').hidden = false;
      await dateiWeitergeben(datei, { titel });
    } catch (e) {
      console.error(e);
      status.textContent = '';
      meldung(`PDF fehlgeschlagen: ${e.message}`, true);
    } finally {
      knopf.disabled = false;
    }
  };
  document.getElementById('b-teilen').onclick = () => { if (datei) dateiWeitergeben(datei, { titel }); };
  document.getElementById('b-laden').onclick = () => { if (datei) dateiWeitergeben(datei, { herunterladen: true }); };
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

// Gemeinsame Werte und Regeln (Kategorien, Dringlichkeit, Sortierung)

export const KATEGORIEN = [
  'Belag / Kunstrasen', 'Naturrasen', 'Linierung', 'Tore / Netze', 'Zaun / Ballfang',
  'Entwässerung', 'Beleuchtung', 'Ausstattung', 'Sonstiges',
];

export const DRINGLICHKEIT = {
  hoch: { text: 'hoch', farbe: '#d32f2f', rang: 0 },
  mittel: { text: 'mittel', farbe: '#f57c00', rang: 1 },
  tief: { text: 'tief', farbe: '#f2b600', rang: 2 },
};

export const ERLEDIGT_FARBE = '#2e7d32';

export function istErledigt(m) { return m.status === 'erledigt'; }

export function dringlichkeit(m) {
  return DRINGLICHKEIT[m.dringlichkeit] || DRINGLICHKEIT.mittel;
}

// Offene zuerst, dann nach Dringlichkeit, dann neueste zuerst
export function maengelSortieren(liste) {
  return [...liste].sort((a, b) => (istErledigt(a) - istErledigt(b))
    || (istErledigt(a) ? 0 : dringlichkeit(a).rang - dringlichkeit(b).rang)
    || String(b.erledigtAm || b.erstellt).localeCompare(String(a.erledigtAm || a.erstellt)));
}

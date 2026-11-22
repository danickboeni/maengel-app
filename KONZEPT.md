# Mängel-App Sportplatz – Konzept

Freigegeben von Danick am 20.11.2026.

## Ziel
Mitarbeitende erfassen Mängel und Schadstellen auf Sportplätzen mit Foto und genauem Standort. Die Mängel werden auf einem Luftbild angezeigt und lassen sich als PDF-Bericht ausgeben.

## Rahmen (Entscheide)
- Eigenständiges Werkzeug, **keine Verbindung zum BaustellenPlaner**.
- Vorerst nur für die eigene Firma.
- Daten vorerst **nur auf dem Handy** (kein Server, keine Konten).
- Geräte: **iPhone und Android**.

## Funktionen (erste Version)
- **Plätze:** Name, Ort, Lage auf der Karte.
- **Mangel erfassen:** Pin startet an der GPS-Position, Benutzer schiebt ihn auf dem Luftbild an die genaue Stelle; Foto, Kategorie, Dringlichkeit, Notiz.
- **Übersicht:** Karte mit farbigen Punkten (rot = dringend, grün = erledigt) und Liste mit Filtern (Status, Kategorie, Platz).
- **Erledigt melden:** Status setzen, optional Foto «nachher».
- **PDF-Bericht pro Platz:** Plan mit Punkten, Fotos, Liste.
- **Sicherung:** Export/Import aller Daten als Datei; App erinnert regelmässig daran.

## Erweiterung: Offerte aufnehmen (freigegeben am 20.11.2026)
- **Startbildschirm** mit zwei Wegen: «Mängel erfassen» und «Offerte aufnehmen».
- **Offerte:** Titel, Kunde (Auftraggeber, Ansprechperson, Telefon, E-Mail), Ort und Lage auf dem Luftbild (optional von einem Platz übernommen), Datum der Begehung, Notiz, Status offen/abgeschlossen.
- **Positionen:** Art (Vorschlagsliste), Beschreibung, Menge und Einheit (m², m, Stk, pauschal), bis 5 Fotos.
- **Messen auf dem Luftbild:** Fläche (m²), Länge (m) oder Punkte (Stk); die Menge wird übernommen und ist von Hand änderbar. Genauigkeit etwa 1–2 %, genügt für Offerten, nicht für Abrechnungen.
- **Nur Aufnahme, keine Preise** – kalkuliert wird im Büro.
- **PDF «Aufnahme für Offerte»:** Kunde, Plan mit nummerierten Flächen/Linien, Positionsliste, Fotos.
- Offerten sind Teil der Sicherung. Kundendaten bleiben auf dem Handy und in den Sicherungsdateien.

## Erweiterung: Markierungsplan (freigegeben am 21.11.2026)
- Dritter Weg auf dem Startbildschirm: **«Markierungsplan»**, eigene Seite `markierung.html`.
- **Eigenständig:** kein Bezug zu Plätzen, Mängeln oder Offerten.
- **Plan:** Platzgrösse und Belag festlegen, Felder nach Sportart und Normstufe setzen (Badminton, Basketball, Basketball 3x3, Faustball, Fussball inkl. Junioren G–D, Handball, Inline Hockey, Korbball, Landhockey, Rollhockey, Streetball, Tennis, Unihockey, Volleyball, Sprintbahn, Weitsprung, Ballwurf, Kugel), dann alles von Hand verschieben, drehen und anpassen.
- **Normen:** Unter die tiefste Stufe gehen ist erlaubt, gibt aber eine Warnung. Sicherheitszonen nach BASPO bis zum Rand des Belags; Verletzung = Warnung, kein Verbot.
- **Weitsprung:** Nur der Anlauf muss auf dem Platz liegen; die Grube darf über den Platzrand hinaus (keine Meldung). Beim Ändern von Anlauf, Optionen und Drehung bleibt die Grube stehen. Masse und Prüfungen nach Swiss Athletics, Datenblatt Weit- und Dreisprung (8.1.2026): Anlauf mind. 40 m, Balken 1–3 m vor der Grube, Absprunglinie bis Grubenende mind. 10 m, Grube 2.75–3.00 m breit. Option Dreisprung-Absprunglinien 7 / 9 / 11 / 13 m vor der Grube (aufgemalt, 20 cm), ab 13 m mind. 21 m bis Grubenende.
- **Volleyball-Netzpfosten** gelten als mobil: keine Warnung, wenn sie in einem anderen Feld oder dessen Sicherheitszone stehen. Feste Einbauteile (Korbmasten) werden weiter geprüft.
- **Einrasten:** Beim Ziehen rasten Felder kurz am Platzrand, in der Platzmitte und an der Sicherheitszone ein, der Weitsprung zusätzlich mit den Grubenkanten. Schalter «Einrasten», Alt-Taste = ohne.
- **Priorität pro Feld:** Linien des Hauptfelds laufen durch, untergeordnete Felder werden an Kreuzungen unterbrochen. Gleiche Priorität = Linien kreuzen sich ohne Unterbruch. Priorität 1 bis 20, festgelegt durch Ziehen in «Felder im Plan» (zwischen zwei Zeilen = eigene Priorität, auf eine Zeile = gleiche; danach ohne Lücken neu nummeriert) oder über das Zahlenfeld.
- **CAD-Unterlage:** DXF vom Architekten als hellgrauer Hintergrund (eigener DXF-Leser, keine fremde Bibliothek; DWG zuerst als DXF speichern). Gespeichert werden nur die Linien (0.1 mm genau) beim Plan auf dem Gerät, nicht im Rückgängig-Verlauf. Einheit (mm/cm/m), Ebenen, Drehung und Verschiebung einstellbar, «Ausrichten» per Kante und Eckpunkt. Im Druck wahlweise mit.
- **Platzrand als Vieleck:** Geschlossene Linie der Unterlage (oder Linien, die sich treffen) als Platzrand übernehmen. Die längste Kante wird waagrecht gelegt, Länge × Breite = umschliessendes Rechteck. Prüfungen (Platzrand, Sicherheitszonen, Einbauteile), Belag, Einrasten, DXF und Druck nutzen den echten Rand; Lagemasse im Druck ab dem Bezugsrechteck. Felder und Unterlage werden dabei mitbewegt.
- **Ausgabe:** Browserdruck / PDF mit Gesamtplan, Lagemassen, Detailblatt pro Feld zum Einmessen und Mengen; dazu DXF, SVG und CSV.
- **Bedienung:** voll am PC und Tablet. Auf dem Handy nur ansehen (Plan, Warnungen, Mengen, Druck).
- Pläne liegen in IndexedDB (Store `markierungsplaene`) und sind Teil der Sicherung (Format 3). Einzelne Pläne lassen sich zusätzlich als Datei speichern und öffnen.
- Annahmen ohne Quelle sind in der App gekennzeichnet (z. B. Kugelstoss-Masse, Tiefe der Technischen Zone).

## Technik
- Progressive Web-App (zum Startbildschirm hinzufügen), plain HTML/CSS/JavaScript ohne Build-Werkzeuge.
- Daten in IndexedDB; Fotos werden verkleinert.
- Karte: Leaflet mit swisstopo-Orthofoto (WMTS); Kartenkacheln für den Offline-Gebrauch zwischenspeichern.
- Offline-fähig über Service Worker.
- App-Dateien (nicht die Daten) müssen über HTTPS ausgeliefert werden (GPS/Kamera), entschieden: GitHub Pages (https://danickboeni.github.io/maengel-app/, Quelle `main`).

## Risiken / Einschränkungen
- Datenverlust bei Handy-Defekt oder Löschen der App → Export-Sicherung ist Pflicht.
- Kein Austausch zwischen Handys ausser über Exportdatei.
- iPhone: Installation über Safari «Zum Home-Bildschirm» nötig, sonst kann iOS die Daten nach einigen Tagen ohne Nutzung löschen.

## Etappen
1. Plätze und Mängel erfassen mit Karte und Foto
2. Übersicht, Filter und «Erledigt»
3. PDF-Bericht, Sicherung und Offline-Karte
4. Startbildschirm und Offerte aufnehmen (mit Messen und PDF)
5. Markierungsplan (Zeichnen, Prüfen, Druck, Sicherung)

## Tests
- Am PC im Browser (lokal).
- GPS, Kamera und Offline-Betrieb nur auf dem echten Handy auf dem Platz (durch Danick).

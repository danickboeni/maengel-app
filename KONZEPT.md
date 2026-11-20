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

## Technik
- Progressive Web-App (zum Startbildschirm hinzufügen), plain HTML/CSS/JavaScript ohne Build-Werkzeuge.
- Daten in IndexedDB; Fotos werden verkleinert.
- Karte: Leaflet mit swisstopo-Orthofoto (WMTS); Kartenkacheln für den Offline-Gebrauch zwischenspeichern.
- Offline-fähig über Service Worker.
- App-Dateien (nicht die Daten) müssen über HTTPS ausgeliefert werden (GPS/Kamera), z. B. GitHub Pages oder Cloudflare Pages – Entscheid offen.

## Risiken / Einschränkungen
- Datenverlust bei Handy-Defekt oder Löschen der App → Export-Sicherung ist Pflicht.
- Kein Austausch zwischen Handys ausser über Exportdatei.
- iPhone: Installation über Safari «Zum Home-Bildschirm» nötig, sonst kann iOS die Daten nach einigen Tagen ohne Nutzung löschen.

## Etappen
1. Plätze und Mängel erfassen mit Karte und Foto
2. Übersicht, Filter und «Erledigt»
3. PDF-Bericht, Sicherung und Offline-Karte

## Tests
- Am PC im Browser (lokal).
- GPS, Kamera und Offline-Betrieb nur auf dem echten Handy auf dem Platz (durch Danick).

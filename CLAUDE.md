# Wizard online – Projektnotizen für Agenten

Das Kartenspiel Wizard (3–6 Spieler) als Browser-Spiel. Tobi spielt es mit Freunden. Die Oberfläche ist komplett auf Deutsch, und Tobi schreibt auf Deutsch. Er möchte, dass Aufgaben ohne Zwischenfragen zu Ende gebracht werden.

- **Live:** https://wizard-zryw.onrender.com
- **Repo:** https://github.com/Tobi-15/wizard (privat, Branch `main`; `gh` ist als Tobi-15 eingeloggt)
- **Hosting:** Render.com, Free-Plan, per Blueprint (`render.yaml`). **Jeder Push auf `main` deployt automatisch** (dauert ca. 1–2 Minuten).

## Hausregeln (weichen vom Original ab)

- Wird eine **Fehlfarbe** ausgespielt, darf man **immer Trumpf** legen, auch wenn man die Farbe hat.
- Wird **Trumpf** ausgespielt, muss man Trumpf bedienen.
- Zauberer (Z) und Narren (N) gehen immer.
- Option in der Lobby, `noEvenBids`: Der letzte Ansager darf nicht so ansagen, dass die Summe der Ansagen gleich der Kartenzahl ist.
- Sonst Originalregeln:
  - Der erste Zauberer gewinnt den Stich, Narren verlieren.
  - Ist die aufgedeckte Karte ein Zauberer, wählt der Geber Trumpf.
  - In der letzten Runde gibt es keinen Trumpf.
  - Wertung: richtig angesagt 20 + 10 pro Stich, sonst −10 pro Stich Abweichung.

## Aufbau

| Datei | Inhalt |
|---|---|
| `server/game.js` | Reine Spiellogik ohne I/O: `legalCards` (Hausregel!), `trickWinner`, `Game`-Zustandsautomat (`chooseTrump → bidding → playing → roundEnd → … → gameOver`), `viewFor(playerId)` verbirgt fremde Hände |
| `server/game.test.js` | Unit-Tests (`npm test`) |
| `server/rooms.js` | Räume (4-Buchstaben-Code), Beitreten/Reconnect per `token` aus localStorage, Broadcast pro Spieler, volle Stiche werden nach `trickDelayMs` (1500) eingesammelt |
| `server/server.js` | HTTP für `public/` und WebSocket unter `/ws`, Export `startServer()` |
| `server/index.js` | Startpunkt für `npm start`, startet **immer** (siehe Stolperfallen) |
| `public/index.html` | Bildschirme Start/Lobby/Spiel und **SVG-Sprite** (`#i-red`, `#i-yellow`, `#i-green`, `#i-blue`, `#i-Z`, `#i-N`, `#i-crown`, `#i-sound`, `#i-mute`) |
| `public/client.js` | Vanilla JS ohne Build. Rendert nur, was der Server schickt. Enthält Tischlayout, Animationen, Sounds (WebAudio), Konfetti, `CARD_ART` |
| `public/style.css` | Bewusst nur ein dunkles Design (Filz, Holz, Gold), Schriften Cinzel + Nunito Sans (Google Fonts) |
| `public/img/cards/` | Zugeschnittene Bilder für Zauberer/Narren (`z1–z4.jpg`, `n1–n4.jpg`) |
| `scripts/bots.js` | Ende-zu-Ende-Test: N Bots spielen ein ganzes Spiel über echte WebSockets |
| `public/3d/` | 3D-Client unter `/3d` (siehe Abschnitt unten) |

**Protokoll** (JSON über WebSocket):
- Client → Server: `create`, `join`, `leave`, `setOption`, `start`, `chooseTrump`, `bid`, `play`, `nextRound`, `backToLobby`
- Server → Client: `state` (`{me, room, game}`), `error`, `left`

Der Server ist die einzige Wahrheit. Spielzustand liegt **nur im Arbeitsspeicher**.

## Befehle

```bash
npm install
npm start                        # http://localhost:3000 (PORT, TRICK_DELAY_MS einstellbar)
npm test                         # Regeltests
node scripts/bots.js 6 --even    # 6 Bots, mit noEvenBids
URL=wss://wizard-zryw.onrender.com/ws TIMEOUT_MS=240000 node scripts/bots.js 6   # gegen Live-Server
```

**Oberfläche testen:** Chromium liegt unter `/usr/bin/chromium`. `puppeteer-core` ist nicht im Projekt, sondern wird bei Bedarf in einen temporären Ordner installiert. Jeder Spieler braucht einen eigenen `browser.createBrowserContext()`, weil das localStorage-Token sonst geteilt wird. Sinnvoll ist, Screenshots in Desktop-Größe (1200×860) und Handy-Größe (390×844) anzusehen.

## 3D-Client (`/3d`, Branch `3d-client`)

Wizard in einer stilisierten Low-Poly-Kneipe („Liar's Bar“-Stil, aber komplett eigene Assets). Nur für Desktop gedacht (Entscheidung von Tobi).

- Liegt in `public/3d/`, ES-Module ohne Build. Three.js kommt per Importmap gepinnt vom CDN (`three@0.180.0`, jsDelivr). Kneipe, Tisch und Figuren werden im Code aus Grundkörpern gebaut, Texturen per Canvas – es gibt keine 3D-Dateien.
- Gleiches Protokoll und gleiche localStorage-Schlüssel (`wizard.token`, `wizard.name`, `wizard.room`) wie der 2D-Client. Man kann jederzeit wechseln, auch mitten im Spiel (Knöpfe „2D“ bzw. „3D“).
- `main.js`: Verbindung, HUD-Overlays (Lobby, Ansage, Trumpfwahl, Ergebnis, Dialoge), Namensschilder, Maus/Tastatur, Renderloop. `table.js`: gleicht den Serverzustand mit der Szene ab und animiert die Unterschiede (Austeilen, Ausspielen, Stich einsammeln, Stichstapel), eigene Hand mit Raycasting, Kamera-Fitting. `characters.js`: 8 Figurentypen mit IK-Armen, Idle-Animation und Reaktionen; die Zuordnung Spieler → Figur hängt nur von Id und Sitzreihenfolge ab, alle sehen also dieselben Figuren. `scene.js`: Raum, Licht, Nebel, Staub, Rauch, Pixelratio-Anpassung. `cards.js`: Kartenbilder. `layout.js`: Tischgeometrie. `util.js`: Tweens.
- `CARD_ART` steht doppelt in `public/client.js` und `public/3d/cards.js`. Bei neuen Kartenbildern beide anpassen.
- Server: `server.js` liefert für Verzeichnisse die `index.html` und leitet `/3d` auf `/3d/` um. Spiellogik und Protokoll sind unverändert.
- Leistung: Auf Tobis MacBook (Iris Plus 650) 60 FPS bei 1200×860. Bei Retina-Pixelratio 2 wird es eng, deshalb senkt `scene.js` die Pixelratio schrittweise, wenn die Bildrate dauerhaft unter 40 FPS liegt (`?hq` schaltet das ab). Schatten und Effekte bleiben immer an.
- **Testen:** Chromium headless mit echter GPU starten: `--enable-gpu --use-angle=gl --ignore-gpu-blocklist`. Mit SwiftShader gibt es nur ~2 FPS, dann laufen die Animationen nicht sauber. `window.wizard3d.handPoints()` liefert die Bildschirmpositionen der eigenen Karten, so lassen sich echte Mausklicks (Raycasting) testen.
- **Stolperfalle Runde:** Alles, was zu einer Runde gehört, hängt an `table.roundRoot`. Sonst bleiben Karten liegen, wenn die nächste Runde startet, während noch ein Stich zum Gewinner fliegt.
- **Stolperfalle Kamera:** Die Kamera darf nicht über die Deckenbalken (3,25 m). Ist der Bildbereich schmal (Lobby mit Panel links), wird der Blick flacher statt höher.

## Kartenbilder ändern

1. Tobi legt Originale in `public/img/` ab. Die sind per `.gitignore` vom Repo ausgeschlossen.
2. Zuschnitt auf Kopf und Schultern, 4:5, damit die Person auch auf kleinen Karten erkennbar ist:
   ```bash
   magick ORIGINAL -crop BxH+X+Y +repage -resize 360x450^ -gravity center -extent 360x450 \
     -modulate 100,106 -unsharp 0x0.8 -quality 86 public/img/cards/z1.jpg
   ```
   Den Ausschnitt vorher am Bild abschätzen und das Ergebnis ansehen.
3. Die Zuordnung Karte → Bild steht in `CARD_ART` in `public/client.js` und `public/3d/cards.js` (Karten-IDs `Z1–Z4`, `N1–N4`). Karten ohne Eintrag zeigen den goldenen Stern bzw. die Narrenkappe.

Aktuelle Belegung: Z1 Epstein, Z2 Charlie Kirk, Z3 Mann mit Burger-King-Krone, Z4 Netanyahu, N1–N4 Freunde von Tobi bzw. eine Asterix-Figur (N2).

**Inhaltliche Entscheidung:** Ein Hitler-Bild als Zauberer wurde abgelehnt, und Tobi hat zugestimmt („geschmacklos“). Solche Bilder nicht einbauen.

## Stolperfallen

- **Nicht pushen, während gespielt wird.** Ein Push startet den Server bei Render neu, und laufende Spiele gehen verloren.
- **Startdatei:** Kein „nur starten, wenn direkt aufgerufen“-Check (`import.meta.url === process.argv[1]`) in `server/index.js`. Render startet aus einem Symlink-Pfad, dann beendet sich der Prozess still, und Render liefert 502.
- `npm test` muss auf `server/*.test.js` eingeschränkt bleiben. `node --test server/` würde `index.js` ausführen und einen Server starten.
- `el.replaceChildren(a && b, …)` schreibt `false` als Text. Vorher `.filter(Boolean)` anwenden. Der `h()`-Helfer überspringt `false` selbst.
- Free-Plan: Der Server schläft nach 15 Minuten ohne Besucher ein, das erste Laden dauert dann ca. 1 Minute.

## Git

Commits laufen mit der No-Reply-Adresse, die in der Repo-Config steht (`337437820+Tobi-15@users.noreply.github.com`). Commit-Nachrichten schreiben wir auf Deutsch.

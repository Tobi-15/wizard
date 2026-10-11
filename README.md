# Wizard online

Das Stichspiel Wizard für 3–6 Spieler im Browser. Spielen geht ohne Account: Einer erstellt einen Raum und schickt den Link, die anderen treten bei.

Unter `/3d` gibt es dieselbe Partie als 3D-Kneipe mit Low-Poly-Figuren (für Desktop). Beide Ansichten spielen im selben Raum zusammen, man kann jederzeit wechseln.

In der Lobby wählt jeder seine **Spielfigur** (Zauberer, Pirat, Goblin, Zwerg, Hexe, Gentleman, Cowboy, Ork sowie sechs Figuren aus 3D-Modellen), jede gibt es pro Tisch nur einmal. In der 2D-Ansicht geht das über eine Auswahlliste. In der Kneipe sitzt man dann in der **Ego-Perspektive** am Tisch: Der Kopf folgt der Maus, und die anderen sehen, wohin man schaut. Mit **V** wechselt man in die Übersicht von oben. Mit den Tasten **1–6** (oder dem Krug-Knopf) gibt es Emotes: Winken, Prost, auf den Tisch klopfen, Jubeln, Lachen, Facepalm. Spieler in der 2D-Ansicht sehen die Emotes als Sprechblase.

## Hausregel

Wird eine **Fehlfarbe** ausgespielt, darf man **immer Trumpf** legen, auch wenn man die ausgespielte Farbe auf der Hand hat. Wird **Trumpf** ausgespielt, muss man Trumpf bedienen. Zauberer und Narren dürfen wie immer jederzeit gespielt werden. Liegt ein **Zauberer** im Stich (egal an welcher Stelle), darf jede Karte gelegt werden.

In der Lobby lässt sich zusätzlich **„Ansagen dürfen nicht aufgehen“** einschalten. Dann darf der letzte Ansager keine Zahl wählen, mit der die Summe aller Ansagen gleich der Kartenzahl ist.

Alle anderen Regeln entsprechen dem Original:
- Der erste Zauberer gewinnt den Stich, Narren verlieren immer.
- Ist die aufgedeckte Karte ein Zauberer, wählt der Geber Trumpf. In der letzten Runde gibt es keinen Trumpf.
- Richtig angesagt: 20 + 10 pro Stich. Daneben: −10 pro Stich Abweichung.

## Lokal starten

```bash
npm install
npm start            # http://localhost:3000
```

Zum Ausprobieren auf einem Rechner brauchst du für jeden Spieler ein **eigenes privates Fenster** oder einen anderen Browser. Jedes Fenster merkt sich seinen Spieler per localStorage, und normale Tabs teilen sich diesen Speicher.

Umgebungsvariablen:
- `PORT` (Standard: 3000)
- `TRICK_DELAY_MS`: wie lange ein voller Stich sichtbar bleibt (Standard: 1500)

## Mit Freunden spielen (online stellen)

### Variante A: Render.com (dauerhafter Link, kostenlos)
1. Den Ordner als Repo zu GitHub pushen.
2. Auf [render.com](https://render.com) „New → Blueprint“ wählen und das Repo auswählen. Die Datei `render.yaml` richtet alles ein. Alternativ: „New → Web Service“ mit Build `npm install` und Start `npm start`.
3. Die URL `https://<name>.onrender.com` an Freunde schicken.

Hinweis: Der kostenlose Plan schläft nach 15 Minuten ohne Besucher ein. Der erste Aufruf dauert dann etwa eine Minute. Laufende Spiele liegen im Arbeitsspeicher und gehen bei einem Neustart verloren.

### Variante B: vom eigenen Rechner (schnell, temporär)
```bash
npm start
cloudflared tunnel --url http://localhost:3000   # gibt eine https://….trycloudflare.com-URL aus
```
`cloudflared` lässt sich unter Arch/Omarchy mit `sudo pacman -S cloudflared` installieren. Ein Account ist nicht nötig. Dein Rechner muss während des Spiels laufen.

### Variante C: Docker / eigener Server
```bash
docker build -t wizard . && docker run -p 3000:3000 wizard
```
Hinter einem Reverse Proxy muss WebSocket-Upgrade auf `/ws` erlaubt sein.

## Tests

```bash
npm test                     # Unit-Tests der Spielregeln
node scripts/bots.js 4       # 4 Bots spielen ein ganzes Spiel über echte WebSockets
node scripts/bots.js 6 --even  # … mit „Ansagen dürfen nicht aufgehen“
```

## Aufbau

| Datei | Inhalt |
|---|---|
| `server/game.js` | Spielregeln als reine Logik (Bedienregel, Stichgewinner, Wertung, Phasen) |
| `server/rooms.js` | Räume, Beitreten, Reconnect, Sicht pro Spieler (fremde Karten bleiben auf dem Server), Weiterreichen von Blick und Emotes der 3D-Ansicht |
| `server/server.js` | HTTP für die statischen Dateien und WebSocket unter `/ws` |
| `server/index.js` | Startpunkt für `npm start` |
| `public/` | Oberfläche (Vanilla JS, kein Build-Schritt) |
| `public/3d/` | 3D-Ansicht mit Three.js (per Importmap vom CDN, kein Build-Schritt) |

## 3D-Modelle

Die Modell-Figuren beruhen auf Modellen von Sketchfab unter CC BY 4.0:
„Benjamin Netanyahu“ von Sebastian.BA, „Charlie kirk (FREEDOM Shirt)“ von 1PlayerChryyzz, „Jeffrey Epstein“ von SigmaGrindsetMog, „Mike Wazowski Monsters Inc (KH3)“ von Guilherme Navarro und „bugs bunny: big chungus (MEME)“ von L3gap4. Tung Tung Tung Sahur: Quelle wird nachgetragen. Links und Details stehen in `public/3d/models/LICENSES.md`.

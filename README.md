# Wizard online

Das Stichspiel Wizard für 3–6 Spieler im Browser. Spielen geht ohne Account: Einer erstellt einen Raum und schickt den Link, die anderen treten bei.

## Hausregel

Wird eine **Fehlfarbe** ausgespielt, darf man **immer Trumpf** legen, auch wenn man die ausgespielte Farbe auf der Hand hat. Wird **Trumpf** ausgespielt, muss man Trumpf bedienen. Zauberer und Narren dürfen wie immer jederzeit gespielt werden.

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
| `server/rooms.js` | Räume, Beitreten, Reconnect, Sicht pro Spieler (fremde Karten bleiben auf dem Server) |
| `server/index.js` | HTTP für die statischen Dateien und WebSocket unter `/ws` |
| `public/` | Oberfläche (Vanilla JS, kein Build-Schritt) |

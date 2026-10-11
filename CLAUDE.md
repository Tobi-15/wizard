# Wizard online – Projektnotizen für Agenten

Das Kartenspiel Wizard (3–6 Spieler) als Browser-Spiel. Tobi spielt es mit Freunden. Die Oberfläche ist komplett auf Deutsch, und Tobi schreibt auf Deutsch. Er möchte, dass Aufgaben ohne Zwischenfragen zu Ende gebracht werden.

- **Live:** https://wizard-zryw.onrender.com
- **Repo:** https://github.com/Tobi-15/wizard (privat, Branch `main`; `gh` ist als Tobi-15 eingeloggt)
- **Hosting:** Render.com, Free-Plan, per Blueprint (`render.yaml`). **Jeder Push auf `main` deployt automatisch** (dauert ca. 1–2 Minuten).

## Hausregeln (weichen vom Original ab)

- Wird eine **Fehlfarbe** ausgespielt, darf man **immer Trumpf** legen, auch wenn man die Farbe hat.
- Wird **Trumpf** ausgespielt, muss man Trumpf bedienen.
- Zauberer (Z) und Narren (N) gehen immer.
- Liegt ein **Zauberer** im Stich (egal an welcher Stelle, auch nach Farb- oder Trumpf-Ausspiel), darf jede Karte gelegt werden.
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
| `server/rooms.js` | Räume (4-Buchstaben-Code), Beitreten/Reconnect per `token` aus localStorage, Broadcast pro Spieler, volle Stiche werden nach `trickDelayMs` (1500) eingesammelt. Reicht außerdem Blick und Emotes des 3D-Clients weiter (`relayLook`, `relayEmote`) |
| `server/bot.js` | Computer-Gegner: `botMove(game, seat)` wählt Trumpf, schätzt die Ansage (Zauberer, hohe Trümpfe, Asse) und spielt billigsten Gewinner bzw. höchste Verliererkarte |
| `server/rooms.test.js` | Tests für das Weiterreichen von Blick und Emotes (Drosselung, Prüfung der Werte) |
| `server/server.js` | HTTP für `public/` und WebSocket unter `/ws`, Export `startServer()` |
| `server/index.js` | Startpunkt für `npm start`, startet **immer** (siehe Stolperfallen) |
| `public/index.html` | Bildschirme Start/Lobby/Spiel und **SVG-Sprite** (`#i-red`, `#i-yellow`, `#i-green`, `#i-blue`, `#i-Z`, `#i-N`, `#i-crown`, `#i-sound`, `#i-mute`) |
| `public/client.js` | Vanilla JS ohne Build. Rendert nur, was der Server schickt. Enthält Tischlayout, Animationen, Sounds (WebAudio), Konfetti, `CARD_ART` |
| `public/style.css` | Bewusst nur ein dunkles Design (Filz, Holz, Gold), Schriften Cinzel + Nunito Sans (Google Fonts) |
| `public/img/cards/` | Zugeschnittene Bilder für Zauberer/Narren (`z1–z4.jpg`, `n1–n4.jpg`) |
| `scripts/bots.js` | Ende-zu-Ende-Test: N Bots spielen ein ganzes Spiel über echte WebSockets |
| `public/3d/` | 3D-Client unter `/3d` (siehe Abschnitt unten) |
| `public/vices.js` | Theke-Regeln (Zeiten, Zigarre ab 4 richtigen Stichen), von Server und 3D-Client genutzt |
| `public/figures.js` | Liste der Spielfiguren (Schlüssel, Name, Spruch) und `assignFigures()` – von 2D- und 3D-Client gemeinsam genutzt |

**Protokoll** (JSON über WebSocket):
- Client → Server: `create`, `join`, `leave`, `setOption`, `setCharacter`, `start`, `chooseTrump`, `bid`, `play`, `nextRound`, `backToLobby`, `abortGame`, `order`, `addBot`, `removeBot`
- Server → Client: `state` (`{me, room, game}`), `error`, `left`
- **Spielfigur:** `room.players[].character` (Schlüssel aus `public/figures.js` oder `null` = automatisch). `create`/`join` dürfen `character` mitbringen (wird übernommen, wenn frei), `setCharacter {character}` geht nur ohne laufende Partie (oder bei `gameOver`). Der Server kennt die Figurenliste nicht, er prüft nur das Format und dass niemand eine Figur doppelt hat.
- Nur Darstellung (3D-Client), ändert keinen Spielzustand und löst keinen `state` aus:
  - `look` `{yaw, pitch, at}`: Blickrichtung relativ zum eigenen Platz (`yaw` > 0 = nach links), `at` = Id des Spielers, den man ansieht, oder `null`. `yaw: null` gibt den Blick frei. Der Server begrenzt die Werte, drosselt auf ~12/s pro Verbindung und schickt `{type: 'look', id, …}` an alle **anderen** Spieler im Raum.
  - `emote` `{kind}` mit `kind` aus `EMOTES` in `rooms.js` (`wave`, `cheers`, `knock`, `cheer`, `facepalm`, `laugh`, dazu von der Theke `sip` = Schluck und `puff` = Zug), höchstens eins pro Sekunde und Spieler, weitergereicht als `{type: 'emote', id, kind}`.
  - Der 2D-Client ignoriert `look` und zeigt Emotes als Sprechblase am Platz bzw. in der Lobby-Liste an (senden kann er keine).

- **Theke** (`order {item}` mit `beer`, `cigarette`, `cigar`, `putout`; Regeln und Zeiten in `public/vices.js`, gemeinsam für Server und 3D-Client): Bier geht erst wieder, wenn das alte höchstens noch ein Viertel voll ist. **Leer wird ein Bier nur durchs Trinken** (Wunsch von Tobi, nicht mit der Zeit): 8 Schlucke (`VICE.beerSips`); jedes `sip`- oder `cheers`-Emote zählt beim Server einen Schluck (`drink`, `vice.sips`) und schickt dann `state` an alle (ohne die Bots neu zu takten). Bots nehmen nach ihren Zügen ab und zu einen Schluck. Zigarette 3 min, Zigarre 7 min, dann landet sie als Kippe im Aschenbecher. **Zigarre** nur mit verdienter Zigarre: Nach jeder Runde (`awardCigars` nach `collectTrick`) bekommt jeder, der **mehr als 3 Stiche** (also ≥ 4) angesagt und genau bekommen hat, eine Zigarre gutgeschrieben (`player.vice.cigars`, bleibt im Raum über Partien hinweg). Der Server schickt pro Spieler in `room.players[].vice` `{beer: {age, n, sips} | null, smoke: {kind, age} | null, cigars, butts}` – Alter in ms statt Uhrzeit. Ändert nichts am Spiel.

- **Beenden** (Knopf „Beenden“ im Spiel, 2D und 3D): `abortGame` (nur Host) bricht die laufende Partie ab, alle landen in der Lobby. `leave` geht jederzeit: Während einer Partie übernimmt ein Bot den Platz (neues Token, der alte Browser kommt nicht zurück), ist kein Mensch mehr da, wird der Raum gelöscht. Vorher konnte man eine laufende Partie nicht verlassen und landete beim Neuladen immer wieder darin.
- **Bots** (zum Allein-Testen, Knopf „🤖 Bot hinzufügen“ in der Lobby, nur Host, × entfernt sie wieder): Server-Spieler mit `bot: true` ohne Verbindung. `scheduleBots` (am Ende von `broadcast`) lässt den Bot am Zug nach `botDelayMs` (~1,1 s) ziehen. Bots gelten als online, werden nie Host und beim Aufräumen der Lobby nicht entfernt; geht der letzte Mensch, wird der Raum gelöscht. Sie bestellen zum Start und nach Runden manchmal Bier/Zigarette und zünden verdiente Zigarren an. `nextRound` drückt immer ein Mensch.

Der Server ist die einzige Wahrheit. Spielzustand liegt **nur im Arbeitsspeicher**.

## Befehle

```bash
npm install
npm start                        # http://localhost:3000 (PORT, TRICK_DELAY_MS einstellbar)
npm test                         # Regeltests
node scripts/bots.js 6 --even    # 6 Bots, mit noEvenBids
URL=wss://wizard-zryw.onrender.com/ws TIMEOUT_MS=240000 node scripts/bots.js 6   # gegen Live-Server (6 Spieler: wenige Stiche, passt ins Zeitlimit)
```

**Oberfläche testen:** Chromium liegt unter `/usr/bin/chromium`. `puppeteer-core` ist nicht im Projekt, sondern wird bei Bedarf in einen temporären Ordner installiert. Jeder Spieler braucht einen eigenen `browser.createBrowserContext()`, weil das localStorage-Token sonst geteilt wird. Sinnvoll ist, Screenshots in Desktop-Größe (1200×860) und Handy-Größe (390×844) anzusehen.

## 3D-Client (`/3d`, Branch `3d-client`)

Wizard in einer stilisierten Low-Poly-Kneipe („Liar's Bar“-Stil, aber komplett eigene Assets). Nur für Desktop gedacht (Entscheidung von Tobi).

- Liegt in `public/3d/`, ES-Module ohne Build. Three.js kommt per Importmap gepinnt vom CDN (`three@0.180.0`, jsDelivr). Kneipe, Tisch und Figuren werden im Code aus Grundkörpern gebaut, Texturen per Canvas – es gibt keine 3D-Dateien.
- Gleiches Protokoll und gleiche localStorage-Schlüssel (`wizard.token`, `wizard.name`, `wizard.room`) wie der 2D-Client. Man kann jederzeit wechseln, auch mitten im Spiel (Knöpfe „2D“ bzw. „3D“).
- `main.js`: Verbindung, HUD-Overlays (Lobby, Ansage, Trumpfwahl, Ergebnis, Dialoge), Namensschilder, Emotes, Senden des eigenen Blicks, Töne und Kneipen-Geräusche (WebAudio), Maus/Tastatur, Renderloop. `table.js`: gleicht den Serverzustand mit der Szene ab und animiert die Unterschiede (Austeilen, Ausspielen, Stich einsammeln, Stichstapel), eigene Hand mit Raycasting, Kamera (Übersicht und Ego-Perspektive), Blick/Emotes der Mitspieler. `characters.js`: 8 Figurentypen mit IK-Armen, Bierkrug, Idle-Animation (inkl. ab und zu trinken) und Reaktionen/Emotes; die Zuordnung Spieler → Figur hängt nur von Id und Sitzreihenfolge ab, alle sehen also dieselben Figuren. `scene.js`: Raum, Licht, Lichthöfe, Nebel, Staub, Rauch, Qualitätsanpassung. `merge.js`: fasst unbewegte Meshes gleichen Materials zusammen (Figuren und Raum: ~480 → ~260 Meshes). `cards.js`: Kartenbilder. `layout.js`: Tischgeometrie. `util.js`: Tweens.
- **Figurenauswahl (Lobby):** Die eigene Figur sitzt in der Lobby am Platz, die Kamera (`SHOWCASE` in `table.js`) schaut von über der Tischmitte auf sie, das Fülllicht kommt dann von vorn. Unten rechts blättert man mit ‹ › oder ←/→, die Punkte zeigen alle Figuren (vergebene gesperrt). Die Wahl wird unter `wizard.character` gespeichert und beim Beitreten mitgeschickt. Wer nichts wählt, bekommt per `assignFigures()` automatisch eine; gewählte Figuren gehen vor. Im 2D-Client gibt es dafür eine Auswahlliste in der Lobby. **Neue Figur:** Eintrag in `public/figures.js` und gleichnamiger `key` in `ARCHETYPES` (`characters.js`) mit Aufbau in `buildBody`/`buildHead`.
- **Figuren aus 3D-Modellen** (`public/3d/models/*.glb`, Code in `models.js` und `ModelCharacter` in `characters.js`):
  - Tobi sucht Modelle auf Sketchfab aus und lädt sie als glTF herunter (ZIP landet in `~/Downloads`; Sketchfab-Download braucht Login, Blender ist hier nicht installiert). Lizenz steht in der `license.txt` im ZIP.
  - Verkleinern mit `scripts/model.mjs` (Anleitung im Kopf der Datei): Normal-/PBR-Maps raus, Texturen 1024 px WebP, Geometrie vereinfacht, Meshopt-komprimiert. Ziel < ~35k Dreiecke und < 1 MB pro Modell. Danach in `public/figures.js` mit `model`, `fallback` (eingebaute Figur, bis das Modell geladen ist), `height` und `credit` eintragen und in `public/3d/models/LICENSES.md` sowie der README nennen (CC BY verlangt Namensnennung; die Auswahl zeigt den Urheber auch an).
  - `ModelCharacter` ist eine normale `Character`-Figur, deren Körper unsichtbar bleibt („Puppe“). Sie rechnet weiter Blick, Reaktionen, Emotes und Handziele; `drive()` überträgt das jeden Frame auf die Knochen des Modells: Vorbeugen auf die Wirbel verteilt, Kopfdrehung zu 35 % in den Hals, Arme per Zwei-Knochen-IK zu den Handzielen der Puppe. Stuhl, Krug und Kartenfächer der Puppe bleiben sichtbar. Gesichter haben keine Mimik (die Sketchfab-Modelle haben keine Morph-Targets).
  - Knochen werden über Namen gefunden (`findBones`: Mixamo/Ready-Player-Me wie `LeftArm`, aber auch `upper_arm_L`; Sketchfab-Nummern wie `_013` werden ignoriert). Fehlen Knochen, bleibt die Ersatzfigur.
  - Modelle **ohne Skelett** (Netanyahu, Tung, Chungus) bekommen beim Laden automatisch eins (`autoRig`): Gelenke aus Körperproportionen und Geometrie (T- oder A-Pose), jeder Vertex hängt an den zwei nächsten Knochen derselben Körperseite.
  - Optionen pro Figur in `public/figures.js`: `bones` (Rolle → Knochenname, wenn die Namen exotisch sind, z. B. Mike: „arm left elbow“; three.js macht aus Leerzeichen Unterstriche, das wird abgefangen), `rig` (Proportionen fürs Auto-Rig als Anteil der Höhe, z. B. `shoulderY`, `hips`, `knee`; Standardwerte in `RIG` in `models.js` – am Frontbild des Modells abmessen), `pose: 'blob'` (Figur ohne richtige Beine wird nur auf den Stuhl gesetzt, z. B. Chungus), `hide` (Teile nach Materialname weglassen, z. B. Mikes Augen-Schattenschicht ohne Alphakanal, die das Auge schwarz abdeckt), `hands` (Ruhehaltung der Hände verschieben, z. B. damit Mike die Karten nicht vor dem Auge hält).
  - Neue Modelle prüfen: in der Lobby auswählen und ansehen (`?slow=0.25` für Emotes in Zeitlupe). Typische Fehler: schwarze Figur (Normalen fehlen), schwarze Flächen im Gesicht (Overlay-Material ohne Alpha → `hide`), Ersatzfigur bleibt (Knochen nicht gefunden → `bones`; die Warnung steht in der Browser-Konsole).
  - Stolperfalle: gltf-transform entfernt bei „unlit“-Materialien die Normalen; `prepare()` berechnet fehlende Normalen neu, sonst ist die Figur unter Lambert-Licht schwarz. Alle Modell-Materialien werden zu `MeshLambertMaterial`.
  - Der Server liefert `.glb` mit `cache-control: max-age=86400` aus.
- **Ansichten im Spiel** (Knopf „Übersicht“/„Am Tisch“, Taste **V**, gespeichert unter `wizard.view3d`):
  - **Ego-Perspektive** (Standard, wie Liar's Bar): Augenhöhe am eigenen Platz, der Kopf folgt der Maus (Mitte ruhig, zum Rand bis ~50° Drehung, unten = auf den Tisch beugen). Bildwinkel und Sitzposition passen sich der Spielerzahl an (`egoFit`: die Gegenüber sollen ganz im Bild sein, bei 3 Spielern lehnt man sich zurück). Sitznachbarn außerhalb des Bildes bekommen ihr Namensschild am Rand mit Pfeil. Der Leuchtring vor dem eigenen Platz ist hier ausgeblendet.
  - **Übersicht**: die bisherige Kamera von hinten oben, alle im Bild. Lobby und Startbildschirm nutzen immer diese Kamera. Bei `prefers-reduced-motion` ist sie Standard.
  - Die Hand hängt an der Kamera und wird in Pixeln geführt (`upp()` rechnet um), damit sie beim Wechsel des Bildwinkels ruhig bleibt.
- **Mitspieler-Präsenz:** In der Ego-Perspektive schickt der Client gedrosselt, wohin der Mausstrahl zeigt (`table.myGaze()`), inklusive des angesehenen Spielers. Bei den anderen dreht die Figur den Kopf dorthin; schaut jemand mich an, schaut die Figur in meine Kamera (Blickkontakt). Ohne Update für 6 s fällt die Figur in ihr normales Umherschauen zurück.
- **Tastenleiste** oben rechts im Spiel (`#hotkeys`): immer sichtbar, alle Emotes (1–6) und Theke-Aktionen (B/T/Z/R/C) mit Taste, anklickbar. Wunsch von Tobi: keine Aufklappmenüs. Namensschilder bleiben darunter (`TOP` in `positionPlates`).
- **Emotes** (Tasten **1–6**, Tastenleiste, in der Lobby als Leiste): Winken, Prost (Krug in die Hand, anstoßen, trinken, zurückstellen), Klopfen, Jubeln, Lachen, Facepalm. Die anderen sehen die Animation mit Sprechblase und Ton; man selbst sieht eine Sprechblase und einen Ich-Effekt (eigener Krug beim Prost, Kamerawackeln beim Klopfen).
- **Optik:** Lichthöfe als additive Sprites um Kerzen, Lampe und Kamin, Filmkorn und Vignette in `post.js` (Vignette in der Ego-Perspektive stärker). **Kein `backdrop-filter`** im HUD: der kostete auf dem Iris-Chip in der Ego-Ansicht rund ein Drittel der Bildrate, deshalb fast deckende Hintergründe (`--wood-glass`).
- **Theke im 3D-Client** (Tastenleiste, in der Lobby als Leiste; Tasten **B** Bier, **T** Schluck, **Z** Zigarette an/aus, **R** Zug, **C** Zigarre; Klick auf das eigene Bier bzw. den Aschenbecher in der Ego-Perspektive):
  - `props.js`: `SeatProps` pro Platz (Stuhl-Koordinaten): Glas-Maßkrug mit Füllstand (`setBeerLevel`), Bierdeckel mit Strichliste (Anzahl Biere), Aschenbecher mit Kippen, Zigarette/Zigarre mit Glut (brennt ab), Schachtel. Dazu `smoke`: ein gemeinsames Partikelsystem (Points-Shader) für Rauchfäden und Ausatmen. Jede Figur hat `char.props`; meine Sachen liegen im Spiel an `table.myAnchor` (`table.myProps`), in der Lobby an meiner Figur.
  - `waiter.js`: der Wirt hinter der Theke (poliert Gläser). Neue Bestellungen von Bier und Zigarre bringt er auf dem Tablett an den Platz (Weg: um die Theke, dann auf einer Ellipse hinter den Stühlen). Zigaretten zündet man selbst an (Feuerzeug-Animation `light`).
  - `table.syncVices()` gleicht `room.players[].vice` ab: Beim ersten Mal (Neuladen) liegt alles sofort da, später kommt der Wirt bzw. wird angezündet. Figuren trinken nur auf einen echten Schluck hin (kein zufälliges Trinken mehr, weil das den Füllstand senken müsste); `SeatProps.level` ist der Füllstand laut Server, `shown` der angezeigte, der beim Schluck passend zur Animation langsam absinkt (`drinking`, `setSips`). Sie rauchen ab und zu (`puff`: Hand → Aschenbecher → Mund, Glut hell, ausatmen). Eigene Schlucke/Züge sieht man aus der Ego-Perspektive (Krug bzw. Zigarette an der Kamera, Rauchwolke vors Gesicht).
- **Grafik (Richtung Liar's Bar):** `post.js` – EffectComposer mit MSAA-HalfFloat-Ziel, Bloom (Schwelle 1,7: nur Glut, Flammen, Neon, Glühbirnen sind „heller als weiß“, siehe `hdr()` in `scene.js`), dann Farbgebung, Vignette, leichte Farbsäume, Filmkorn im Shader. **Handkarten** liegen auf Ebene `HAND_LAYER` und werden danach ohne Nachbearbeitung darübergezeichnet (sonst würden sie getönt und unscharf); gespielte Karten kommen zurück auf Ebene 0. `?nofx` schaltet die Nachbearbeitung ab (dann CSS-Vignette). **Karten auf dem Tisch** haben ein mattes Material (Grundfarbe 0,32 + gleichmäßiger Eigenanteil), weil weiße Karten unter der Lampe sonst weit über „weiß“ liegen und blenden – nicht wieder heller machen, ohne es unter der Lampe anzusehen.
- **Reaktionen auf Stiche:** gefreut wird nur, wenn der Stich hilft (`win` beim Erreichen der Ansage, `happy` darunter); wer sich damit überreizt, macht `facepalm` bzw. `sad`.
- **Rauch-Geräusche** (`main.js`, `SMOKE_T`): Feuerzeug (Reibrad, Zünden, Flamme), Ziehen mit Tabakknistern (Zigarre in Paffs mit Lippen-Plopp), langes Ausatmen. Zeitpunkte passen zu den Animationen; Mitspieler leiser und später, alles zusammen mit `SMOKE_VOL` (0,85) gedämpft. Zum Probehören: `wizard3d.sounds.light({ cigar: true })` in der Browser-Konsole. Raum: Neon „Zum Zauberer“/„BIER“ (flackern ab und zu), Kreidetafel mit der Zigarren-Regel, Plakate, Jukebox, Dartscheibe, Zapfanlage, Hängelampen, Schmutz-/Bierrand-Texturen, lackierter Tisch mit Spiegelungen (`scene.environment` per PMREM einmal aus der Szene). Figuren sind unverändert (Entscheidung von Tobi, Oktober 2026).
- `CARD_ART` steht doppelt in `public/client.js` und `public/3d/cards.js`. Bei neuen Kartenbildern beide anpassen.
- Server: `server.js` liefert für Verzeichnisse die `index.html` und leitet `/3d` auf `/3d/` um. Die Spiellogik ist unverändert; das Protokoll hat nur die Darstellungs-Nachrichten `look` und `emote` dazubekommen (siehe oben).
- Leistung: Auf Tobis MacBook (Iris Plus 650) 45–60 FPS bei 1200×860 (schwankt stark mit Akku/Last). Liegt die Bildrate dauerhaft unter 40 FPS, schaltet `scene.js` zuerst Extras ab (`world.cheapSteps`, derzeit den Bloom) und senkt danach die Pixelratio schrittweise (`?hq` schaltet das ab). Schatten und Lichteffekte bleiben immer an. Der Engpass ist die Pixel-Arbeit, nicht die Draw Calls.
- **Testen:** Chromium headless mit echter GPU starten: `--enable-gpu --use-angle=gl --ignore-gpu-blocklist`. Mit SwiftShader gibt es nur ~2 FPS, dann laufen die Animationen nicht sauber. Helfer in `window.wizard3d`: `handPoints()` (Bildschirmpositionen der eigenen Karten für echte Mausklicks), `headPoint(id)` (Kopf eines Spielers, z. B. um ihn mit der Maus „anzusehen“), `table`, `state()`. Mit `?slow=0.25` läuft die ganze Darstellung in Zeitlupe – praktisch, um Animationen per Screenshot zu prüfen (Screenshots brauchen bis zu 1 s). Für Blick und Emotes braucht es zwei Browser-Kontexte mit dem 3D-Client.
- **Trumpfwahl testen:** Kommt zufällig selten vor. Im Testskript `Game.prototype.startRound` aus `server/game.js` umhüllen (gleicher Modulpfad wie der Server) und in Runde 1 Geber 0, einen freien Zauberer als `trumpCard` und `phase = 'chooseTrump'` setzen.
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

**Inhaltliche Entscheidung:** Ein Hitler-Bild als Zauberer wurde abgelehnt, und Tobi hat zugestimmt („geschmacklos“). Solche Bilder nicht einbauen. Aus demselben Grund wurde ein Osama-bin-Laden-Modell als Spielfigur nicht eingebaut (Oktober 2026).

## Stolperfallen

- **Nicht pushen, während gespielt wird.** Ein Push startet den Server bei Render neu, und laufende Spiele gehen verloren.
- **Startdatei:** Kein „nur starten, wenn direkt aufgerufen“-Check (`import.meta.url === process.argv[1]`) in `server/index.js`. Render startet aus einem Symlink-Pfad, dann beendet sich der Prozess still, und Render liefert 502.
- `npm test` muss auf `server/*.test.js` eingeschränkt bleiben. `node --test server/` würde `index.js` ausführen und einen Server starten.
- `el.replaceChildren(a && b, …)` schreibt `false` als Text. Vorher `.filter(Boolean)` anwenden. Der `h()`-Helfer überspringt `false` selbst.
- Free-Plan: Der Server schläft nach 15 Minuten ohne Besucher ein, das erste Laden dauert dann ca. 1 Minute.

## Git

Commits laufen mit der No-Reply-Adresse, die in der Repo-Config steht (`337437820+Tobi-15@users.noreply.github.com`). Commit-Nachrichten schreiben wir auf Deutsch.

// Startpunkt für `npm start`. Die eigentliche Server-Logik liegt in server.js,
// damit Tests und Bots sie importieren können, ohne einen Server zu starten.
import { startServer } from './server.js';

const port = Number(process.env.PORT) || 3000;
const trickDelayMs = process.env.TRICK_DELAY_MS ? Number(process.env.TRICK_DELAY_MS) : undefined;
const { port: actual } = await startServer({ port, trickDelayMs });
console.log(`Wizard läuft auf http://localhost:${actual}`);

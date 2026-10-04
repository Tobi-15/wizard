import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Rooms } from './rooms.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

async function serveStatic(req, res) {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
    return;
  }
  const path = decodeURIComponent(url.pathname);
  // Verzeichnisse liefern ihre index.html (z. B. /3d/ für den 3D-Client)
  const rel = (path.endsWith('/') ? `${path}index.html` : path).replace(/^\/+/, '');
  const file = normalize(join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR.endsWith(sep) ? PUBLIC_DIR : PUBLIC_DIR + sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(body);
  } catch (err) {
    if (err.code === 'EISDIR') {
      // /3d → /3d/, damit relative Pfade im Verzeichnis auflösen
      res.writeHead(301, { location: `${encodeURI(`/${rel}/`)}${url.search}` }).end();
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Nicht gefunden');
  }
}

export function startServer({ port = 3000, trickDelayMs = 1500 } = {}) {
  const rooms = new Rooms({ trickDelayMs });
  const server = http.createServer((req, res) => {
    serveStatic(req, res).catch(() => res.writeHead(500).end());
  });
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => (ws.isAlive = true));
    const conn = {
      ctx: null,
      send(obj) {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
      },
    };
    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return conn.send({ type: 'error', message: 'Ungültige Nachricht.' });
      }
      rooms.handle(conn, msg);
    });
    ws.on('close', () => rooms.detach(conn));
  });

  // Tote Verbindungen erkennen (z. B. Handy im Standby)
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 25 * 1000);
  heartbeat.unref();

  return new Promise((resolve) => {
    server.listen(port, () => {
      resolve({
        port: server.address().port,
        close() {
          clearInterval(heartbeat);
          rooms.close();
          for (const ws of wss.clients) ws.terminate();
          wss.close();
          return new Promise((r) => server.close(r));
        },
      });
    });
  });
}

/**
 * GT7 team sync server (v2 — optional, self-hosted). Minimal Node HTTP API over
 * server/sync-store.js, ZERO dependencies. Run on a small VPS so each driver
 * uploads their recorded capture to the team GROUP and the strategist fetches a
 * race's captures — no shared folder, no accounts (a per-group join code gates
 * access). Multi-team: every team is an isolated group.
 *
 *   npm run sync            # PORT=8787 DATA_DIR=./sync-data by default
 *
 * Put it behind Caddy (auto-HTTPS) for production — see docs/SYNC_SERVER.md.
 * Routes (all JSON):
 *   GET  /api/health
 *   POST /api/groups                                   { name } → { code, name }
 *   GET  /api/groups/:code                             → { code, name }
 *   POST /api/groups/:code/races                       { name } → { id, name }
 *   GET  /api/groups/:code/races                       → [ races ]
 *   POST /api/groups/:code/races/:raceId/sessions      { driver, capture } → { sessionId }
 *   GET  /api/groups/:code/races/:raceId/sessions      → [ { driver, capture, uploadedAt } ]
 */

import http from 'http';
import * as store from './sync-store.js';

const PORT = Number(process.env.PORT) || 8787;
const DATA_DIR = process.env.DATA_DIR || './sync-data';
const MAX_BODY = Number(process.env.MAX_BODY) || 2 * 1024 * 1024; // 2 MB / upload
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

function send(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': CORS_ORIGIN,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('too-large'));
        req.destroy();
      } else {
        chunks.push(c);
      }
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(new Error('bad-json'));
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  const seg = new URL(req.url, 'http://x').pathname.split('/').filter(Boolean);
  try {
    if (req.method === 'GET' && seg[0] === 'api' && seg[1] === 'health') return send(res, 200, { ok: true });
    if (seg[0] !== 'api' || seg[1] !== 'groups') return send(res, 404, { error: 'not-found' });

    // POST /api/groups
    if (seg.length === 2 && req.method === 'POST') {
      const b = await readBody(req);
      return send(res, 200, store.createGroup(DATA_DIR, b.name));
    }

    const code = seg[2];

    // GET /api/groups/:code
    if (seg.length === 3 && req.method === 'GET') {
      const g = store.getGroup(DATA_DIR, code);
      return g ? send(res, 200, { code: g.code, name: g.name }) : send(res, 404, { error: 'group' });
    }

    // /api/groups/:code/races
    if (seg.length === 4 && seg[3] === 'races') {
      if (req.method === 'GET') {
        const r = store.listRaces(DATA_DIR, code);
        return r ? send(res, 200, r) : send(res, 404, { error: 'group' });
      }
      if (req.method === 'POST') {
        const b = await readBody(req);
        const r = store.addRace(DATA_DIR, code, b.name);
        return r ? send(res, 200, r) : send(res, 404, { error: 'group' });
      }
    }

    // /api/groups/:code/races/:raceId/sessions
    if (seg.length === 6 && seg[3] === 'races' && seg[5] === 'sessions') {
      const raceId = seg[4];
      if (req.method === 'GET') {
        const s = store.listSessions(DATA_DIR, code, raceId);
        return s ? send(res, 200, s) : send(res, 404, { error: 'race' });
      }
      if (req.method === 'POST') {
        const b = await readBody(req);
        const r = store.putSession(DATA_DIR, code, raceId, b.driver, b.capture);
        return r ? send(res, 200, r) : send(res, 400, { error: 'bad-session' });
      }
    }

    return send(res, 404, { error: 'not-found' });
  } catch (e) {
    return send(res, e.message === 'too-large' ? 413 : 400, { error: e.message });
  }
});

server.listen(PORT, () => console.log(`GT7 sync server on :${PORT}  (data: ${DATA_DIR})`));

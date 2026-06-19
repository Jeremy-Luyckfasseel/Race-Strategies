/**
 * Sync store (v2 — at-home team file sharing). PURE Node + filesystem, no deps.
 *
 * The storage layer for the optional sync server: each driver records at home and
 * uploads their capture to a shared GROUP (their team); the strategist fetches a
 * race's captures. Multi-team from day one — a group is identified by a random
 * join CODE that doubles as the access secret, so many teams = many isolated
 * groups with zero rework. No accounts, no database; captures are plain files:
 *
 *   <root>/<code>/group.json
 *   <root>/<code>/<raceId>/race.json
 *   <root>/<code>/<raceId>/s_<driver>.json   (one current session per driver)
 *
 * All inputs are validated against path traversal — `code` / `raceId` must match a
 * strict token pattern, and driver names are sanitised into safe filenames.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const TOKEN_RE = /^[A-Za-z0-9_-]{4,64}$/;
const token = (bytes = 9) => crypto.randomBytes(bytes).toString('base64url');
const validCode = (c) => typeof c === 'string' && TOKEN_RE.test(c);
const sanitizeDriver = (s) => (String(s || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40) || 'driver');
const clampName = (s, n = 60) => String(s || '').slice(0, n);
const nowIso = () => new Date().toISOString();

export function createGroup(root, name) {
  const code = token(9);
  const dir = path.join(root, code);
  fs.mkdirSync(dir, { recursive: true });
  const group = { code, name: clampName(name) || 'Group', createdAt: nowIso() };
  fs.writeFileSync(path.join(dir, 'group.json'), JSON.stringify(group));
  return group;
}

export function getGroup(root, code) {
  if (!validCode(code)) return null;
  const f = path.join(root, code, 'group.json');
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
}

export function addRace(root, code, name) {
  if (!getGroup(root, code)) return null;
  const raceId = token(6);
  const dir = path.join(root, code, raceId);
  fs.mkdirSync(dir, { recursive: true });
  const race = { id: raceId, name: clampName(name) || 'Race', createdAt: nowIso() };
  fs.writeFileSync(path.join(dir, 'race.json'), JSON.stringify(race));
  return race;
}

export function listRaces(root, code) {
  if (!getGroup(root, code)) return null;
  const gdir = path.join(root, code);
  return fs
    .readdirSync(gdir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && validCode(d.name))
    .map((d) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(gdir, d.name, 'race.json'), 'utf8'));
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

function raceDir(root, code, raceId) {
  if (!getGroup(root, code) || !validCode(raceId)) return null;
  const dir = path.join(root, code, raceId);
  return fs.existsSync(path.join(dir, 'race.json')) ? dir : null;
}

/** Upload (or overwrite) one driver's current session for a race. */
export function putSession(root, code, raceId, driver, capture) {
  const dir = raceDir(root, code, raceId);
  if (!dir) return null;
  if (!capture || !Array.isArray(capture.laps) || capture.laps.length === 0) return null;
  const safe = sanitizeDriver(driver);
  const rec = { driver: clampName(driver, 40) || 'Driver', capture, uploadedAt: nowIso() };
  fs.writeFileSync(path.join(dir, `s_${safe}.json`), JSON.stringify(rec));
  return { sessionId: safe, driver: rec.driver, uploadedAt: rec.uploadedAt };
}

/** All current sessions for a race: [{ driver, capture, uploadedAt }]. */
export function listSessions(root, code, raceId) {
  const dir = raceDir(root, code, raceId);
  if (!dir) return null;
  return fs
    .readdirSync(dir)
    .filter((f) => f.startsWith('s_') && f.endsWith('.json'))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

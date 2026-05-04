/**
 * GT7 Telemetry Server
 * ====================
 * Receives UDP telemetry from one or more PS5s on the local network,
 * decrypts each packet with Salsa20, and broadcasts parsed data to any
 * browser tab connected via WebSocket.
 *
 * Usage:
 *   node telemetry-server.js
 *
 * PS5 IP addresses are managed from the browser UI — no CLI args needed.
 * You can still pass IPs as CLI args for a quick start:
 *   node telemetry-server.js 192.168.1.10 192.168.1.11
 *
 * Requirements:
 *   npm install ws   (already in package.json)
 *
 * How it works:
 *   1. The browser sends { type: 'setIPs', ips: ['192.168.1.10', ...] } over
 *      WebSocket.  The server starts sending heartbeat packets ("A") to those
 *      IPs on port 33739.  GT7 then streams UDP telemetry to this machine on
 *      port 33740.
 *   2. Each incoming UDP packet is decrypted with Salsa20.
 *   3. Parsed data is forwarded over WebSocket to all connected browser
 *      clients.  Each message includes the source PS5 IP so the UI can
 *      differentiate between teams.
 *
 * Finding a PS5's IP:
 *   PS5 Settings → Network → View Connection Status → IP Address
 *
 * Crypto note:
 *   The Salsa20 key below was reverse-engineered by the GT7 community
 *   (Nenkai and others). If your GT7 version is newer and the key has
 *   changed, check: https://github.com/Nenkai/PDTools or the sim-racing
 *   telemetry community on Discord.
 */

import dgram from 'dgram';
import { WebSocketServer } from 'ws';

// ── Salsa20 key (GT7, community-documented) ──────────────────────────────────
const SALSA20_KEY = Buffer.from('Xt-8ZtkIUk-4nnS8OounI7vegX-MoRA', 'utf8'); // 32 bytes

const UDP_PORT = 33740;   // GT7 sends telemetry here
const HB_PORT  = 33739;   // GT7 listens for heartbeat here
const WS_PORT  = 20777;   // WebSocket port for the React app

// Mutable IP list — updated via browser UI (or pre-seeded from CLI args)
let ps5IPs = [...new Set(process.argv.slice(2).filter(Boolean))];
console.log('GT7 Telemetry Server starting…');
if (ps5IPs.length) console.log(`  Pre-seeded IPs: ${ps5IPs.join(', ')}`);
console.log(`  WebSocket: ws://localhost:${WS_PORT}`);
console.log('  PS5 IPs can be configured from the browser UI.\n');

// ── Minimal Salsa20 implementation ───────────────────────────────────────────

function rotl(v, n) { return ((v << n) | (v >>> (32 - n))) >>> 0; }

function salsa20Block(key, nonce, counter) {
  const c = [0x61707865, 0x3320646e, 0x79622d32, 0x6b206574];
  const k = new Uint32Array(key.buffer, key.byteOffset, 8);
  const n = new Uint32Array(nonce.buffer, nonce.byteOffset, 2);
  const ctr = typeof counter === 'bigint' ? Number(counter) : counter;

  let x = [
    c[0],  k[0],  k[1],  k[2],
    k[3],  c[1],  n[0],  n[1],
    ctr & 0xFFFFFFFF, (ctr / 0x100000000) & 0xFFFFFFFF, c[2], k[4],
    k[5],  k[6],  k[7],  c[3],
  ];
  const orig = [...x];

  for (let i = 0; i < 10; i++) {
    x[4]  ^= rotl((x[0]  + x[12]) >>> 0, 7);  x[8]  ^= rotl((x[4]  + x[0])  >>> 0, 9);
    x[12] ^= rotl((x[8]  + x[4])  >>> 0, 13); x[0]  ^= rotl((x[12] + x[8])  >>> 0, 18);
    x[9]  ^= rotl((x[5]  + x[1])  >>> 0, 7);  x[13] ^= rotl((x[9]  + x[5])  >>> 0, 9);
    x[1]  ^= rotl((x[13] + x[9])  >>> 0, 13); x[5]  ^= rotl((x[1]  + x[13]) >>> 0, 18);
    x[14] ^= rotl((x[10] + x[6])  >>> 0, 7);  x[2]  ^= rotl((x[14] + x[10]) >>> 0, 9);
    x[6]  ^= rotl((x[2]  + x[14]) >>> 0, 13); x[10] ^= rotl((x[6]  + x[2])  >>> 0, 18);
    x[3]  ^= rotl((x[15] + x[11]) >>> 0, 7);  x[7]  ^= rotl((x[3]  + x[15]) >>> 0, 9);
    x[11] ^= rotl((x[7]  + x[3])  >>> 0, 13); x[15] ^= rotl((x[11] + x[7])  >>> 0, 18);
    x[1]  ^= rotl((x[0]  + x[3])  >>> 0, 7);  x[2]  ^= rotl((x[1]  + x[0])  >>> 0, 9);
    x[3]  ^= rotl((x[2]  + x[1])  >>> 0, 13); x[0]  ^= rotl((x[3]  + x[2])  >>> 0, 18);
    x[6]  ^= rotl((x[5]  + x[4])  >>> 0, 7);  x[7]  ^= rotl((x[6]  + x[5])  >>> 0, 9);
    x[4]  ^= rotl((x[7]  + x[6])  >>> 0, 13); x[5]  ^= rotl((x[4]  + x[7])  >>> 0, 18);
    x[11] ^= rotl((x[10] + x[9])  >>> 0, 7);  x[8]  ^= rotl((x[11] + x[10]) >>> 0, 9);
    x[9]  ^= rotl((x[8]  + x[11]) >>> 0, 13); x[10] ^= rotl((x[9]  + x[8])  >>> 0, 18);
    x[12] ^= rotl((x[15] + x[14]) >>> 0, 7);  x[13] ^= rotl((x[12] + x[15]) >>> 0, 9);
    x[14] ^= rotl((x[13] + x[12]) >>> 0, 13); x[15] ^= rotl((x[14] + x[13]) >>> 0, 18);
  }

  const out = Buffer.alloc(64);
  for (let i = 0; i < 16; i++) out.writeUInt32LE((x[i] + orig[i]) >>> 0, i * 4);
  return out;
}

function salsa20Decrypt(ciphertext, key, nonce, counterOffset = 0) {
  const output = Buffer.alloc(ciphertext.length);
  for (let i = 0; i < ciphertext.length; i += 64) {
    const block = salsa20Block(key, nonce, counterOffset + i / 64);
    const len = Math.min(64, ciphertext.length - i);
    for (let j = 0; j < len; j++) output[i + j] = ciphertext[i + j] ^ block[j];
  }
  return output;
}

// ── GT7 packet parser ─────────────────────────────────────────────────────────

function parsePacket(buf) {
  if (buf.length < 0x128) return null;

  const nonce = Buffer.alloc(8);
  buf.copy(nonce, 0, 0x40, 0x44);

  const decrypted = salsa20Decrypt(buf, SALSA20_KEY, nonce);

  if (decrypted[0] !== 0x47 || decrypted[1] !== 0x37 ||
      decrypted[2] !== 0x53 || decrypted[3] !== 0x30) {
    return null;
  }

  const fuelRatio    = decrypted.readFloatLE(0x44);
  const fuelCapacity = decrypted.readFloatLE(0x48);
  const speed        = decrypted.readFloatLE(0x4C);
  const currentLap   = decrypted.readInt16LE(0x74);
  const bestLapMs    = decrypted.readInt32LE(0x78);
  const lastLapMs    = decrypted.readInt32LE(0x7C);

  const tireTempFL   = decrypted.readFloatLE(0x84);
  const tireTempFR   = decrypted.readFloatLE(0x88);
  const tireTempRL   = decrypted.readFloatLE(0x8C);
  const tireTempRR   = decrypted.readFloatLE(0x90);

  const tireWearFL   = decrypted.readFloatLE(0xB4);
  const tireWearFR   = decrypted.readFloatLE(0xB8);
  const tireWearRL   = decrypted.readFloatLE(0xBC);
  const tireWearRR   = decrypted.readFloatLE(0xC0);

  const flags   = decrypted[0xA8];
  const onTrack = !!(flags & 0x01);
  const paused  = !!(flags & 0x02);

  return {
    fuelLiters:   Math.round(fuelRatio * fuelCapacity * 10) / 10,
    fuelRatio:    Math.round(fuelRatio * 1000) / 1000,
    fuelCapacity: Math.round(fuelCapacity * 10) / 10,
    currentLap,
    speedKmh:  Math.round(speed * 3.6),
    bestLapMs: bestLapMs > 0 ? bestLapMs : null,
    lastLapMs: lastLapMs > 0 ? lastLapMs : null,
    tireTemp:  [tireTempFL, tireTempFR, tireTempRL, tireTempRR].map(t => Math.round(t)),
    tireWear:  [tireWearFL, tireWearFR, tireWearRL, tireWearRR].map(w => Math.round(w * 100) / 100),
    onTrack,
    paused,
  };
}

// ── UDP socket ────────────────────────────────────────────────────────────────

const udp = dgram.createSocket('udp4');
udp.bind(UDP_PORT, () => console.log(`UDP listening on :${UDP_PORT}`));

// ── WebSocket server ──────────────────────────────────────────────────────────

const wss = new WebSocketServer({ port: WS_PORT });
console.log(`WebSocket server ready on ws://localhost:${WS_PORT}`);

wss.on('connection', ws => {
  console.log('Browser connected');

  // Tell the browser which IPs the server is currently tracking
  ws.send(JSON.stringify({ type: 'ips', ips: ps5IPs }));

  ws.on('message', raw => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'setIPs' && Array.isArray(msg.ips)) {
        ps5IPs = msg.ips.map(s => s.trim()).filter(Boolean);
        console.log(`PS5 IPs updated: [${ps5IPs.join(', ') || 'none'}]`);
        // Echo back to all connected browsers so UI stays in sync
        broadcast({ type: 'ips', ips: ps5IPs });
      }
    } catch {}
  });

  ws.on('close', () => console.log('Browser disconnected'));
});

function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === 1 /* OPEN */) client.send(msg);
  }
}

// ── Heartbeat ─────────────────────────────────────────────────────────────────

const HB_PACKET = Buffer.from([0x41]); // 'A'
const hbSock = dgram.createSocket('udp4');

function sendHeartbeats() {
  for (const ip of ps5IPs) hbSock.send(HB_PACKET, HB_PORT, ip);
}

setInterval(sendHeartbeats, 100);
sendHeartbeats();

// ── Incoming telemetry ────────────────────────────────────────────────────────

udp.on('message', (msg, rinfo) => {
  const parsed = parsePacket(msg);
  if (!parsed) return;
  broadcast({ ps5ip: rinfo.address, ...parsed });
});

udp.on('error', err => console.error('UDP error:', err));

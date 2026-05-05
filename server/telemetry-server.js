/**
 * GT7 Telemetry Server
 * ====================
 * Receives UDP telemetry from one or more PS5s on the local network,
 * decrypts each packet with Salsa20, and broadcasts parsed data to any
 * browser tab connected via WebSocket.
 *
 * Usage:
 *   node server/telemetry-server.js
 *
 * PS5 IP addresses are managed from the browser UI — no CLI args needed.
 * You can still pass IPs as CLI args for a quick start:
 *   node server/telemetry-server.js 192.168.1.10 192.168.1.11
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
import { lookup, reverse as dnsReverse } from 'dns/promises';
import { networkInterfaces } from 'os';
import { WebSocketServer } from 'ws';

// ── Salsa20 key (GT7, community-documented) ──────────────────────────────────
const SALSA20_KEY = Buffer.from('Simulator Interface Packet GT7 ver 0.0', 'utf8').slice(0, 32);

const UDP_PORT = 33740;   // GT7 sends telemetry here
const HB_PORT  = 33739;   // GT7 listens for heartbeat here
const WS_PORT  = 20777;   // WebSocket port for the React app

// label → resolved IP (e.g. "PS5-642" → "192.168.1.10")
const labelToIP  = new Map();
// resolved IP → label (reverse lookup for incoming UDP packets)
const ipToLabel  = new Map();

// Per-team tire radius baseline for wear estimation (label → [FL,FR,RL,RR])
const tireBaseline = new Map();

// All IPs that have ever sent valid GT7 telemetry this session
const seenPS5s = new Set();

// Pit detection per team: 'fast' | 'slow' — fires pitDetected on first slow packet after fast
const pitState = new Map();

// Cache of last successful hostname→IP resolutions (survives applyIPs calls)
const resolvedCache = new Map();

function getLocalSubnets() {
  const subnets = [];
  for (const addrs of Object.values(networkInterfaces())) {
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        subnets.push(addr.address.split('.').slice(0, 3).join('.'));
      }
    }
  }
  return [...new Set(subnets)];
}

async function scanForPS5s() {
  return new Promise(resolve => {
    const subnets = getLocalSubnets();
    console.log(`Scanning subnets: ${subnets.join(', ')} …`);
    // Use a dedicated socket so ICMP errors from non-PS5 hosts don't corrupt hbSock
    const scanSock = dgram.createSocket('udp4');
    scanSock.on('error', () => {}); // swallow Windows WSAECONNRESET errors
    for (const subnet of subnets) {
      for (let i = 1; i <= 254; i++) {
        scanSock.send(HB_PACKET, HB_PORT, `${subnet}.${i}`);
      }
    }
    setTimeout(async () => {
      try { scanSock.close(); } catch {}
      const ips = [...seenPS5s];
      const results = await Promise.all(ips.map(async ip => {
        try {
          const names = await dnsReverse(ip);
          const hostname = names[0]?.replace(/\.local\.?$/, '') || null;
          return { ip, hostname };
        } catch {
          return { ip, hostname: null };
        }
      }));
      resolve(results);
    }, 2000);
  });
}

async function resolveHost(input) {
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(input)) return input;
  const hostname = input.includes('.') ? input : `${input}.local`;
  try {
    const { address } = await lookup(hostname);
    console.log(`  Resolved "${input}" → ${address} (OS DNS)`);
    resolvedCache.set(input, address);
    return address;
  } catch {}
  // Fall back to the last successfully resolved IP for this hostname
  if (resolvedCache.has(input)) {
    const cached = resolvedCache.get(input);
    console.log(`  Using cached "${input}" → ${cached}`);
    return cached;
  }
  console.warn(`  Could not resolve "${input}" — will scan; enter IP directly if this persists`);
  return null;
}

// Mutable resolved IP list (used for heartbeats)
let ps5IPs = [];

async function applyIPs(inputs) {
  // Resolve all IPs first — don't touch ps5IPs until we have the full new list
  // so heartbeats keep flowing to the PS5 during resolution
  const pairs = await Promise.all(inputs.map(async label => {
    const ip = await resolveHost(label);
    return { label, ip };
  }));

  const newLabelToIP = new Map();
  const newIpToLabel = new Map();
  const newPs5IPs = [];
  for (const { label, ip } of pairs) {
    if (!ip) continue;
    newLabelToIP.set(label, ip);
    newIpToLabel.set(ip, label);
    newPs5IPs.push(ip);
  }

  // Atomic swap — heartbeats only interrupted for one tick
  labelToIP.clear(); for (const [k, v] of newLabelToIP) labelToIP.set(k, v);
  ipToLabel.clear(); for (const [k, v] of newIpToLabel) ipToLabel.set(k, v);
  ps5IPs = newPs5IPs;

  console.log(`PS5s updated: ${pairs.map(({ label, ip }) => ip ? `${label}→${ip}` : `${label}→(unresolved)`).join(', ') || 'none'}`);
}

const cliInputs = [...new Set(process.argv.slice(2).filter(Boolean))];
console.log('GT7 Telemetry Server starting…');
if (cliInputs.length) {
  console.log(`  Pre-seeded: ${cliInputs.join(', ')}`);
  applyIPs(cliInputs);
}
console.log(`  WebSocket: ws://localhost:${WS_PORT}`);
console.log('  PS5 IPs or hostnames (e.g. PS5-642) can be set from the browser UI.\n');

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

  const iv1 = buf.readUInt32LE(0x40);
  const iv2 = (iv1 ^ 0xDEADBEAF) >>> 0;
  const nonce = Buffer.alloc(8);
  nonce.writeUInt32LE(iv2, 0);
  nonce.writeUInt32LE(iv1, 4);

  const decrypted = salsa20Decrypt(buf, SALSA20_KEY, nonce);

  if (decrypted.readUInt32LE(0) !== 0x47375330) return null;

  // Position (meters, world space)
  const posX = decrypted.readFloatLE(0x04);
  const posZ = decrypted.readFloatLE(0x0C);

  // Engine
  const rpm          = decrypted.readFloatLE(0x3C);

  // Fuel
  const fuelRatio    = decrypted.readFloatLE(0x44);
  const fuelCapacity = decrypted.readFloatLE(0x48);

  // Angular velocity — yaw rate (rad/s) used for lateral-G estimation
  const angVelY      = decrypted.readFloatLE(0x2C);

  // Motion
  const speed        = decrypted.readFloatLE(0x4C);
  const boost        = decrypted.readFloatLE(0x50) - 1; // gauge pressure (bar)
  const oilPressure  = decrypted.readFloatLE(0x54);
  const waterTemp    = decrypted.readFloatLE(0x58);
  const oilTemp      = decrypted.readFloatLE(0x5C);

  // Tire temperatures (corrected offsets — 0x60, not 0x84)
  const tireTempFL   = decrypted.readFloatLE(0x60);
  const tireTempFR   = decrypted.readFloatLE(0x64);
  const tireTempRL   = decrypted.readFloatLE(0x68);
  const tireTempRR   = decrypted.readFloatLE(0x6C);

  // Race timing
  const currentLap   = decrypted.readInt16LE(0x74);
  const totalLaps    = decrypted.readInt16LE(0x76);
  const bestLapMs    = decrypted.readInt32LE(0x78);
  const lastLapMs    = decrypted.readInt32LE(0x7C);

  // Race position
  const racePos      = decrypted.readInt16LE(0x84);
  const totalCars    = decrypted.readInt16LE(0x86);
  const rpmWarning   = decrypted.readUInt16LE(0x88);
  const rpmLimiter   = decrypted.readUInt16LE(0x8A);

  // Controls
  const gearByte      = decrypted[0x90];
  const gear          = gearByte & 0x0F;        // 0=N, 1-8=gear, 15=R
  const suggestedGear = (gearByte >> 4) & 0x0F;
  const throttle      = decrypted[0x91];         // 0-255
  const brake         = decrypted[0x92];         // 0-255

  // Flags
  const flags   = decrypted[0x8E];
  const onTrack = !!(flags & 0x01);
  const paused  = !!(flags & 0x02);


  // Tire radius in meters (not wear — GT7 doesn't expose wear directly)
  const tireRadFL    = decrypted.readFloatLE(0xB4);
  const tireRadFR    = decrypted.readFloatLE(0xB8);
  const tireRadRL    = decrypted.readFloatLE(0xBC);
  const tireRadRR    = decrypted.readFloatLE(0xC0);

  return {
    posX: Math.round(posX * 10) / 10,
    posZ: Math.round(posZ * 10) / 10,
    rpm:          Math.round(rpm),
    rpmWarning,
    rpmLimiter,
    fuelLiters:   Math.round(fuelRatio * fuelCapacity * 10) / 10,
    fuelRatio:    Math.round(fuelRatio * 1000) / 1000,
    fuelCapacity: Math.round(fuelCapacity * 10) / 10,
    speedKmh:     Math.round(speed * 3.6),
    latG:         Math.round(Math.abs(speed * angVelY) / 9.81 * 100) / 100,
    boost:        Math.round(boost * 100) / 100,
    waterTemp:    Math.round(waterTemp),
    oilTemp:      Math.round(oilTemp),
    oilPressure:  Math.round(oilPressure * 10) / 10,
    tireTemp:     [tireTempFL, tireTempFR, tireTempRL, tireTempRR].map(t => Math.round(t)),
    tireRadius:   [tireRadFL, tireRadFR, tireRadRL, tireRadRR].map(r => Math.round(r * 10000) / 10000),
    currentLap,
    totalLaps,
    bestLapMs:    bestLapMs > 0 ? bestLapMs : null,
    lastLapMs:    lastLapMs > 0 ? lastLapMs : null,
    racePos:      racePos > 0 ? racePos : null,
    totalCars:    totalCars > 0 ? totalCars : null,
    gear,
    suggestedGear: suggestedGear > 0 ? suggestedGear : null,
    throttle,
    brake,
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

  // Tell the browser which labels the server is currently tracking
  ws.send(JSON.stringify({ type: 'ips', ips: [...labelToIP.keys()] }));

  ws.on('message', async raw => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'setIPs' && Array.isArray(msg.ips)) {
        const inputs = msg.ips.map(s => s.trim()).filter(Boolean);
        await applyIPs(inputs);
        broadcast({ type: 'ips', ips: inputs });
      } else if (msg.type === 'scan') {
        ws.send(JSON.stringify({ type: 'scanning' }));
        const found = await scanForPS5s();
        console.log(`Scan complete — found: ${found.map(r => r.hostname ? `${r.hostname} (${r.ip})` : r.ip).join(', ') || 'none'}`);
        ws.send(JSON.stringify({ type: 'scanResult', results: found }));
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
hbSock.on('error', err => console.warn('Heartbeat error:', err.message));

function sendHeartbeats() {
  for (const ip of ps5IPs) hbSock.send(HB_PACKET, HB_PORT, ip);
}

setInterval(sendHeartbeats, 100);
sendHeartbeats();

// ── Incoming telemetry ────────────────────────────────────────────────────────

udp.on('message', (msg, rinfo) => {
  const parsed = parsePacket(msg);
  if (!parsed) return;

  seenPS5s.add(rinfo.address);
  const label = ipToLabel.get(rinfo.address) || rinfo.address;

  // Tire wear: track max radius seen per tire — new tire = largest radius
  const radii = parsed.tireRadius;
  if (radii && radii.some(r => r > 0)) {
    if (!tireBaseline.has(label)) {
      tireBaseline.set(label, [...radii]);
    } else {
      const base = tireBaseline.get(label);
      radii.forEach((r, i) => { if (r > base[i]) base[i] = r; });
    }
    const base = tireBaseline.get(label);
    parsed.tireWear = radii.map((r, i) =>
      base[i] > 0 ? Math.round((r / base[i]) * 10000) / 100 : null
    );
  }

  // Pit detection:
  //   pitDetected — fires once when speed drops below 5 km/h after racing speed (>60)
  //   pitExit     — fires once when speed returns above 60 km/h after a full stop
  //                 The car exits the pit lane with fresh tires; tireRadius reflects the new set.
  const spd = parsed.speedKmh ?? 0;
  const ps = pitState.get(label);
  let pitDetected = false;
  let pitExit = false;
  if (spd > 60) {
    if (ps === 'slow') pitExit = true;
    pitState.set(label, 'fast');
  } else if (spd < 5 && ps === 'fast') {
    pitState.set(label, 'slow');
    pitDetected = true;
  }

  broadcast({ ps5ip: label, ...parsed, ...(pitDetected ? { pitDetected: true } : {}), ...(pitExit ? { pitExit: true } : {}) });
});

udp.on('error', err => console.error('UDP error:', err));

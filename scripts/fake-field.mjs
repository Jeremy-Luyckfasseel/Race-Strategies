/**
 * Drives a fake field of GT7 cars at a running relay.
 *
 * Real Salsa20-encrypted packets from distinct loopback addresses, so the relay
 * and the whole app see what they would see at an event — useful for demoing or
 * exercising the UI with no PS5 in the room. Each car pits once, staggered from
 * two minutes in, so the pit prompts and the stint log fire too.
 *
 *   node scripts/fake-field.mjs [cars] [seconds] [spread]
 *
 * spread is the fraction of a lap the field is strung out over (default 0.06).
 * Raise it to around 0.35 for a screenshot where the dots do not all overlap.
 *
 * Ctrl-C to stop early.
 */

import dgram from 'dgram';

const KEY = Buffer.from('Simulator Interface Packet GT7 ver 0.0', 'utf8').slice(0, 32);

function rotl(v, n) { return ((v << n) | (v >>> (32 - n))) >>> 0; }

function salsa20Block(key, nonce, counter) {
  const c = [0x61707865, 0x3320646e, 0x79622d32, 0x6b206574];
  const k = new Uint32Array(key.buffer, key.byteOffset, 8);
  const n = new Uint32Array(nonce.buffer, nonce.byteOffset, 2);
  let x = [
    c[0], k[0], k[1], k[2],
    k[3], c[1], n[0], n[1],
    counter & 0xFFFFFFFF, (counter / 0x100000000) & 0xFFFFFFFF, c[2], k[4],
    k[5], k[6], k[7], c[3],
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

function salsa20Xor(buf, nonce) {
  const out = Buffer.alloc(buf.length);
  for (let i = 0; i < buf.length; i += 64) {
    const block = salsa20Block(KEY, nonce, i / 64);
    const len = Math.min(64, buf.length - i);
    for (let j = 0; j < len; j++) out[i + j] = buf[i + j] ^ block[j];
  }
  return out;
}

const PACKET_LEN = 0x128;

/** Build one encrypted packet the relay will accept, with these field values. */
function buildPacket({
  posX = 0, posZ = 0, rpm = 7000, fuel = 60, capacity = 100,
  speedKmh = 150, currentLap = 1, totalLaps = 30, bestLapMs = 0, lastLapMs = 0,
  racePos = 1, totalCars = 10, onTrack = true, paused = false, tireRadius = 0.32,
  iv1 = 0x1234,
}) {
  const p = Buffer.alloc(PACKET_LEN);
  p.writeUInt32LE(0x47375330, 0x00);           // magic 'G7S0'
  p.writeFloatLE(posX, 0x04);
  p.writeFloatLE(posZ, 0x0C);
  p.writeFloatLE(0, 0x2C);                     // angular velocity Y
  p.writeFloatLE(rpm, 0x3C);
  p.writeFloatLE(fuel, 0x44);
  p.writeFloatLE(capacity, 0x48);
  p.writeFloatLE(speedKmh / 3.6, 0x4C);        // relay expects m/s
  p.writeFloatLE(1, 0x50);                     // boost (gauge = value - 1)
  p.writeFloatLE(5, 0x54);                     // oil pressure
  p.writeFloatLE(90, 0x58);                    // water temp
  p.writeFloatLE(110, 0x5C);                   // oil temp
  for (let i = 0; i < 4; i++) p.writeFloatLE(85, 0x60 + i * 4); // tire temps
  p.writeInt16LE(currentLap, 0x74);
  p.writeInt16LE(totalLaps, 0x76);
  p.writeInt32LE(bestLapMs, 0x78);
  p.writeInt32LE(lastLapMs, 0x7C);
  p.writeInt16LE(racePos, 0x84);
  p.writeInt16LE(totalCars, 0x86);
  p.writeUInt16LE(7500, 0x88);                 // rpm warning
  p.writeUInt16LE(8000, 0x8A);                 // rpm limiter
  p[0x8E] = (onTrack ? 0x01 : 0) | (paused ? 0x02 : 0);
  p[0x90] = 4;                                 // gear 4, no suggestion
  p[0x91] = 200;                               // throttle
  p[0x92] = 0;                                 // brake
  for (let i = 0; i < 4; i++) p.writeFloatLE(tireRadius, 0xB4 + i * 4);

  const iv2 = (iv1 ^ 0xDEADBEAF) >>> 0;
  const nonce = Buffer.alloc(8);
  nonce.writeUInt32LE(iv2, 0);
  nonce.writeUInt32LE(iv1, 4);

  const ct = salsa20Xor(p, nonce);
  // The relay reads the IV from the ciphertext at 0x40 before decrypting, so
  // it is carried in the clear there. Those four bytes decrypt to garbage and
  // sit in a field the parser never reads.
  ct.writeUInt32LE(iv1, 0x40);
  return ct;
}


// ── Drive the field ─────────────────────────────────────────────────────────

const CARS = Number(process.argv[2] || 10);
const SECONDS = Number(process.argv[3] || 0);      // 0 = run until stopped
const SPREAD  = Number(process.argv[4] || 0.06);   // fraction of a lap, front to back
const LAP_MS = 90_000;
const HZ = 60;

// Each car makes one pit stop, staggered, so the pit-exit banner, the compound
// and driver pickers, the BOX flag and the Pilotes stint log can all be seen
// without a PS5 in the room. detectPitEdges needs the car stopped for
// PIT_MIN_STOP_MS (8 s) before it counts; a real GT7 stop is 25 s+.
const PIT_FIRST_MS  = 120_000;
const PIT_STAGGER_MS = 20_000;
const PIT_LENGTH_MS  = 30_000;

// A rounded rectangle standing in for a circuit, in metres.
function trackPoint(t) {
  const a = (t % 1) * Math.PI * 2;
  return { x: 600 + Math.cos(a) * 500, z: 400 + Math.sin(a) * 320 };
}

// Two copies of this script feed the relay from the same ten addresses with
// different start times, so every car's dot flips between two points on the
// circuit sixty times a second. It looks like a rendering bug and is not one.
// A bound port is the cheapest lock that survives a killed parent process.
const LOCK_PORT = 33742;
await new Promise((resolve) => {
  const lock = dgram.createSocket('udp4');
  lock.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error('A fake field is already running — stop it first (Ctrl-C in its terminal).');
      console.error('If it was killed without releasing the port, kill any leftover');
      console.error('"node scripts/fake-field.mjs" process and try again.');
      process.exit(1);
    }
    throw err;
  });
  lock.bind(LOCK_PORT, '127.0.0.1', resolve);
});

const socks = [];
for (let i = 0; i < CARS; i++) {
  const ip = `127.0.0.${i + 2}`;
  const s = dgram.createSocket('udp4');
  s.on('error', () => { /* heartbeat noise */ });
  await new Promise((res) => s.bind(0, ip, res));
  socks.push({ ip, s, offset: i / CARS * SPREAD });  // strung out down the road
}

console.log(`Feeding ${CARS} cars at ${HZ} Hz into the relay. Ctrl-C to stop.`);
const started = Date.now();
let sent = 0;

const timer = setInterval(() => {
  const elapsed = Date.now() - started;
  socks.forEach((car, i) => {
    // The clock stops while the car is stationary in the pits, so its lap
    // count does not advance and it rejoins genuinely behind.
    const pitOpens = PIT_FIRST_MS + i * PIT_STAGGER_MS;
    const inPit    = elapsed >= pitOpens && elapsed < pitOpens + PIT_LENGTH_MS;
    const pitLost  = Math.min(Math.max(0, elapsed - pitOpens), PIT_LENGTH_MS);

    const progress = ((elapsed - pitLost) / LAP_MS) - car.offset;
    const lap = Math.max(1, Math.floor(progress) + 1);
    const p = trackPoint(progress);
    car.s.send(buildPacket({
      posX: p.x, posZ: p.z,
      speedKmh: inPit ? 0 : 150 + ((i * 7) % 40),
      currentLap: lap,
      totalLaps: 60,
      fuel: Math.max(5, 90 - (progress % 1) * 40),
      racePos: i + 1,
      totalCars: CARS,
      lastLapMs: lap > 1 ? LAP_MS + i * 400 : 0,
      bestLapMs: lap > 1 ? LAP_MS + i * 250 : 0,
    }), 33740, '127.0.0.1');
    sent += 1;
  });
  if (SECONDS && elapsed > SECONDS * 1000) finish();
}, 1000 / HZ);

function finish() {
  clearInterval(timer);
  for (const c of socks) { try { c.s.close(); } catch { /* already closed */ } }
  console.log(`
sent ${sent} packets over ${((Date.now() - started) / 1000).toFixed(0)}s`);
  process.exit(0);
}
process.on('SIGINT', finish);

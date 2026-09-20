/**
 * Drives a fake field of GT7 cars at a running relay.
 *
 * Real Salsa20-encrypted packets from distinct loopback addresses, so the relay
 * and the whole app see what they would see at an event — useful for demoing or
 * exercising the UI with no PS5 in the room. Cars run at their own pace, burn
 * fuel down, pit repeatedly and rejoin, so the pit prompts, the stint log, the
 * gaps and the fuel prediction all have something real to chew on.
 *
 * Needs the relay up first, in its own terminal:
 *
 *   npm run telemetry                 # terminal 1 — the UDP→WebSocket relay
 *   npm run dev                       # terminal 2 — the app
 *   npm run demo                      # terminal 3 — ten fake PS5s
 *
 * npm run demo is `fake-field.mjs 10 0 0.35`. Directly:
 *
 *   node scripts/fake-field.mjs [cars] [seconds] [spread]
 *
 * cars   how many consoles to fake (default 6).
 * seconds how long to run; 0 runs until Ctrl-C.
 * spread the fraction of a lap the field is strung out over (default 0.06).
 *        Around 0.35 gives a screenshot where the dots do not all overlap.
 *
 * Pit behaviour is set by environment variables, all in seconds:
 *
 *   PIT_FIRST=90 PIT_STAGGER=20 PIT_LENGTH=25 PIT_EVERY=180 npm run demo
 *
 * PIT_FIRST   when the first car boxes      (default 120)
 * PIT_STAGGER gap between each car's first stop (default 15)
 * PIT_LENGTH  how long a stop lasts         (default 30)
 * PIT_EVERY   how long they run between stops (default 240)
 *
 * Safe to leave running while `npm test` runs: the relay suite spawns its own
 * relay on its own ports (34740/21777) and sends from 127.0.9.x, so it no
 * longer collides with a pit wall that is already set up.
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

// Every car used to run an identical LAP_MS, so the field was frozen in place:
// the gaps never moved and there was nothing to test the interval column with.
// Each car now has its own pace, spread either side of the nominal lap, so the
// order genuinely changes over a stint.
const lapMsFor = (i) => LAP_MS * (1 + (i - CARS / 2) * 0.004);

// Fuel used to be `90 - (progress % 1) * 40`, a sawtooth that jumped back up at
// every lap line. The app reads a rise as the hose going in, so it correctly
// refused to measure a burn rate and sat on "measuring…" forever. A real car
// burns monotonically and only gains fuel in the pits, so this one does too.
const TANK_L = 90;
const BURN_PER_LAP_L = 3.4;

// Each car makes one pit stop, staggered, so the pit-exit banner, the compound
// and driver pickers, the BOX flag and the Pilotes stint log can all be seen
// without a PS5 in the room. detectPitEdges needs the car stopped for
// PIT_MIN_STOP_MS (8 s) before it counts; a real GT7 stop is 25 s+.
// Overridable so a pit stop can be watched without waiting two minutes for it:
//   PIT_FIRST=15 PIT_STAGGER=10 node scripts/fake-field.mjs 10 0 0.35
// PIT_LENGTH must stay above detectPitEdges' PIT_MIN_STOP_MS (8 s) or the stop
// is treated as a spin and no prompt is raised.
const envSecs = (name, fallbackMs) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v * 1000 : fallbackMs;
};
const PIT_FIRST_MS   = envSecs('PIT_FIRST', 120_000);
const PIT_STAGGER_MS = envSecs('PIT_STAGGER', 20_000);
const PIT_LENGTH_MS  = envSecs('PIT_LENGTH', 30_000);
// Cars pit REPEATEDLY, not once: this is how long they run between stops.
const PIT_EVERY_MS   = envSecs('PIT_EVERY', 240_000);

// A rounded rectangle standing in for a circuit, in metres.
function trackPoint(t) {
  const a = (t % 1) * Math.PI * 2;
  return { x: 600 + Math.cos(a) * 500, z: 400 + Math.sin(a) * 320 };
}

// Where the pit box is, as a fraction of a lap. Cars used to stop dead wherever
// they happened to be when their timer expired, which is not a thing a car can
// do: the app learns the pit box from where the starred car stops, so a field
// stopping at ten different points taught it nonsense. A car whose stop is due
// now carries on to here first, like a real one.
const PIT_AT = 0.5;

/** Did this car pass the pit entry between these two lap fractions? */
function passedPit(prevFrac, frac) {
  if (prevFrac == null) return false;
  return frac < prevFrac            // wrapped past the line this tick
    ? prevFrac < PIT_AT || frac >= PIT_AT
    : prevFrac < PIT_AT && frac >= PIT_AT;
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
  socks.push({
    ip, s,
    offset: i / CARS * SPREAD,   // strung out down the road
    lapMs: lapMsFor(i),
    raceMs: 0,                   // running time, frozen while stationary
    fuel: TANK_L,
    pitUntil: 0,                 // wall-clock ms this stop ends
    pitDue: false,               // scheduled to box; waiting to reach the pit
    prevFrac: null,              // last tick's position around the lap
    nextStopAt: PIT_FIRST_MS + i * PIT_STAGGER_MS,
    stops: 0,
  });
}

console.log(`Feeding ${CARS} cars at ${HZ} Hz into the relay. Ctrl-C to stop.`);
console.log(`First car boxes at ${(PIT_FIRST_MS / 1000).toFixed(0)}s, the rest `
  + `${(PIT_STAGGER_MS / 1000).toFixed(0)}s apart; each stop lasts `
  + `${(PIT_LENGTH_MS / 1000).toFixed(0)}s and they run `
  + `${(PIT_EVERY_MS / 1000).toFixed(0)}s between stops.`);
console.log(`Pace spread ${(lapMsFor(0) / 1000).toFixed(1)}s to `
  + `${(lapMsFor(CARS - 1) / 1000).toFixed(1)}s a lap, so the gaps actually move.`);
const started = Date.now();
let sent = 0;

// Simulated per tick rather than derived from a closed-form expression. The
// formula version had fuel wrap at the tank boundary with no stop in sight,
// which the app quite correctly read as a refuel that never happened, and each
// car pitted exactly once in its life. A car burns down, comes in when it is
// nearly dry or when the schedule says so, refuels, and goes again.
let lastTick = Date.now();

const timer = setInterval(() => {
  const now = Date.now();
  const dt = Math.max(0, now - lastTick);
  lastTick = now;
  const elapsed = now - started;

  // Positions follow who is actually furthest round, so the board reorders as
  // the quicker cars come through instead of being frozen at the grid order.
  const order = [...socks].sort((a, b) => (b.progress ?? 0) - (a.progress ?? 0));

  socks.forEach((car, i) => {
    void i;
    const inPit = now < car.pitUntil;

    if (inPit) {
      // Stationary: the clock stops, so the lap count does not advance and the
      // car rejoins genuinely behind. Fuel goes in over the length of the stop.
      const left = (car.pitUntil - now) / PIT_LENGTH_MS;
      car.fuel = Math.min(TANK_L, TANK_L - (TANK_L - car.fuelAtStop) * left);
    } else {
      car.raceMs += dt;
      car.fuel = Math.max(0, car.fuel - (dt / car.lapMs) * BURN_PER_LAP_L);

      // The schedule (or an empty tank) makes the stop DUE; the car still has
      // to reach the pit entry before it can actually stop.
      const dry = car.fuel <= BURN_PER_LAP_L * 1.2;
      if (elapsed >= car.nextStopAt || dry) car.pitDue = true;

      const frac = ((((car.raceMs / car.lapMs) - car.offset) % 1) + 1) % 1;
      if (car.pitDue && passedPit(car.prevFrac, frac)) {
        car.pitDue = false;
        car.fuelAtStop = car.fuel;
        car.pitUntil = now + PIT_LENGTH_MS;
        car.nextStopAt = elapsed + PIT_EVERY_MS + PIT_LENGTH_MS;
        car.stops += 1;
      }
      car.prevFrac = frac;
    }

    const progress = (car.raceMs / car.lapMs) - car.offset;
    car.progress = progress;
    const lap = Math.max(1, Math.floor(progress) + 1);
    const p = trackPoint(progress);
    const lapMs = car.lapMs;
    const fuel = car.fuel;

    // A timed endurance race has no lap total, and GT7 reports none. Sending a
    // fake 60 put a meaningless "12/60" on the dashboard.
    car.s.send(buildPacket({
      posX: p.x, posZ: p.z,
      speedKmh: inPit ? 0 : Math.round(LAP_MS / lapMs * 170),
      currentLap: lap,
      totalLaps: 0,
      fuel,
      racePos: order.indexOf(car) + 1,
      totalCars: CARS,
      lastLapMs: lap > 1 ? Math.round(lapMs) : 0,
      bestLapMs: lap > 1 ? Math.round(lapMs) - 400 : 0,
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

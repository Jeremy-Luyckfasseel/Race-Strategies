/**
 * End-to-end test of the real relay with a simulated 10-PS5 LAN event.
 *
 * Nothing here is mocked. It spawns server/telemetry-server.js as a real
 * process, opens a real WebSocket to it exactly as the browser does, and
 * fires real Salsa20-encrypted GT7 packets at the relay from ten distinct
 * loopback source addresses — so the relay sees ten separate consoles and
 * keys them apart the same way it would at an actual event.
 *
 * What this proves that unit tests cannot: the crypto, the byte offsets, the
 * per-car state keyed by source IP, and the pit-edge logic all line up
 * across a real socket boundary, for a whole field at once.
 *
 * Takes ~13 s, most of it spent genuinely waiting out the pit dwell — that
 * wait is the thing being tested, so it cannot be compressed.
 *
 * Run with: node tests/test_relay_e2e.js
 */

import dgram from 'dgram';
import { spawn } from 'child_process';
import { WebSocket } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, '..', 'server', 'telemetry-server.js');

let passed = 0;
let failed = 0;

function assert(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

function section(name) {
  console.log(`\n── ${name} ──`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Salsa20 + GT7 packet construction ───────────────────────────────────────
// Mirrors the relay's own scheme so we can produce packets it will accept.

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

// ── Simulated field ─────────────────────────────────────────────────────────

const CARS = Array.from({ length: 10 }, (_, i) => ({
  // Ten distinct source addresses, deliberately NOT 127.0.0.x: that is the
  // range scripts/fake-field.mjs sends from, and a fake field left running in
  // another terminal used to land in this relay and be decoded as these cars —
  // failing "speed decodes correctly — got 171" against a packet the test
  // never sent. The relay keys on source IP, so a different block is enough.
  ip: `127.0.9.${i + 2}`,
  sock: null,
  lap: 1,
  speedKmh: 150,
  fuel: 60 - i,                  // distinguishable per car
}));

const PIT_CAR = 2;   // does a genuine pit stop
const SPIN_CAR = 5;  // spins and rejoins — must NOT read as a pit stop

// Deliberately NOT GT7's real ports. The suite spawns its own relay, and on a
// machine where the pit wall is already set up — `npm run telemetry` and the
// fake field running in other windows — sharing 33740/20777 failed three tests
// that were perfectly fine.
const UDP = '34740';
const HB  = '34739';
const WS  = '21777';

async function main() {
  section('relay startup');
  // Its own ports, so a relay already running for a real session (or for the
  // fake field) does not make this suite fail with EADDRINUSE.
  const proc = spawn(process.execPath, [SERVER], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GT7_UDP_PORT: UDP, GT7_HB_PORT: HB, GT7_WS_PORT: WS },
  });
  let serverOut = '';
  proc.stdout.on('data', (d) => { serverOut += d.toString(); });
  proc.stderr.on('data', (d) => { serverOut += d.toString(); });

  const cleanup = () => {
    for (const c of CARS) { try { c.sock?.close(); } catch { /* already closed */ } }
    try { proc.kill(); } catch { /* already gone */ }
  };

  try {
    await sleep(1200);
    if (/EADDRINUSE/.test(serverOut)) {
      console.error('\n  ! ports ' + UDP + '/' + WS + ' are already in use — something else');
      console.error('    is on the ports this suite reserves for itself. Stop it and re-run.\n');
    }
    assert('relay process is running', proc.exitCode === null, serverOut);
    assert('UDP listener is up', new RegExp('UDP listening on :' + UDP).test(serverOut), serverOut);
    assert('WebSocket server is up', /WebSocket server ready/.test(serverOut), serverOut);

    if (proc.exitCode !== null) throw new Error(`relay exited early:\n${serverOut}`);

    section('browser connects and registers the field');
    const received = [];
    const ws = new WebSocket('ws://localhost:' + WS);
    await new Promise((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
      setTimeout(() => reject(new Error('WebSocket never opened')), 5000);
    });
    ws.on('message', (raw) => {
      try {
        const m = JSON.parse(raw.toString());
        if (m.ps5ip) received.push(m);
      } catch { /* control frame */ }
    });
    assert('WebSocket connected to the relay', ws.readyState === 1);

    ws.send(JSON.stringify({ type: 'setIPs', ips: CARS.map((c) => c.ip) }));
    await sleep(400);

    // Bind each simulated console to its own loopback address so the relay
    // sees ten different source IPs, exactly as it would on a real LAN.
    for (const c of CARS) {
      c.sock = dgram.createSocket('udp4');
      c.sock.on('error', () => { /* heartbeat ICMP noise */ });
      await new Promise((res, rej) => {
        c.sock.once('error', rej);
        c.sock.bind(0, c.ip, res);
      });
    }

    const send = (c) => {
      const buf = buildPacket({
        speedKmh: c.speedKmh,
        currentLap: c.lap,
        fuel: c.fuel,
        posX: c.lap * 10,
        posZ: 0,
        racePos: CARS.indexOf(c) + 1,
        lastLapMs: c.lap > 1 ? 120_000 + CARS.indexOf(c) * 500 : 0,
      });
      c.sock.send(buf, Number(UDP), '127.0.0.1');
    };

    section('whole field transmitting at 60 Hz');
    // Everyone racing for 1.5 s.
    let ticker = setInterval(() => { for (const c of CARS) send(c); }, 16);
    await sleep(1500);

    const seen = new Set(received.map((m) => m.ps5ip));
    assert('relay decoded packets from all ten consoles', seen.size === 10, `saw ${seen.size}: ${[...seen]}`);
    assert('each console is keyed by its own source IP',
      CARS.every((c) => seen.has(c.ip)), [...seen].join(','));

    const sample = received.find((m) => m.ps5ip === CARS[3].ip);
    assert('speed decodes correctly', sample.speedKmh === 150, `got ${sample?.speedKmh}`);
    assert('fuel decodes correctly', Math.abs(sample.fuelLiters - CARS[3].fuel) < 0.05, `got ${sample?.fuelLiters}`);
    assert('fuel ratio derives from capacity', Math.abs(sample.fuelRatio - CARS[3].fuel / 100) < 0.01);
    assert('lap decodes correctly', sample.currentLap === 1, `got ${sample?.currentLap}`);
    assert('on-track flag decodes', sample.onTrack === true);
    assert('race position decodes', sample.racePos === 4, `got ${sample?.racePos}`);
    assert('tyre wear is derived', Array.isArray(sample.tireWear) && sample.tireWear.length === 4);

    const noEdgesYet = received.filter((m) => m.pitDetected || m.pitExit);
    assert('no pit edges while everyone is racing', noEdgesYet.length === 0,
      JSON.stringify(noEdgesYet.map((m) => m.ps5ip)));

    section('one car pits for real, another spins');
    // Both stop at the same moment. Only the sustained one may count.
    CARS[PIT_CAR].speedKmh = 0;
    CARS[SPIN_CAR].speedKmh = 0;
    await sleep(3000);

    // The spinner recovers after ~3 s — well under the dwell.
    CARS[SPIN_CAR].speedKmh = 150;
    await sleep(6500);   // pit car is now well past the 8 s dwell

    CARS[PIT_CAR].speedKmh = 150;   // pit car rejoins
    await sleep(1200);

    clearInterval(ticker);
    ticker = null;

    const edgesFor = (ip) => received.filter((m) => m.ps5ip === ip && (m.pitDetected || m.pitExit));
    const pitEdges = edgesFor(CARS[PIT_CAR].ip);
    const spinEdges = edgesFor(CARS[SPIN_CAR].ip);

    assert('the real pit stop produced exactly one entry and one exit',
      pitEdges.length === 2, JSON.stringify(pitEdges.map((m) => (m.pitDetected ? 'enter' : 'exit'))));
    assert('in the right order',
      pitEdges[0]?.pitDetected === true && pitEdges[1]?.pitExit === true);

    assert('THE SPIN PRODUCED NO PIT EDGES AT ALL',
      spinEdges.length === 0, JSON.stringify(spinEdges.map((m) => (m.pitDetected ? 'enter' : 'exit'))));

    const otherEdges = received.filter(
      (m) => (m.pitDetected || m.pitExit) && m.ps5ip !== CARS[PIT_CAR].ip,
    );
    assert('no other car in the field was disturbed', otherEdges.length === 0,
      JSON.stringify(otherEdges.map((m) => m.ps5ip)));

    section('sustained throughput');
    assert('relay stayed alive throughout', proc.exitCode === null);
    // 10 cars x ~60 Hz x ~12 s, minus scheduler slack. A low number here would
    // mean the relay was dropping the field on the floor.
    assert('broadcast a realistic volume of packets', received.length > 3000,
      `only ${received.length} in ~12 s of 10-car traffic`);
    console.log(`     (relayed ${received.length} packets across ${seen.size} cars)`);

    ws.close();
  } finally {
    cleanup();
    await sleep(200);
  }
}

main()
  .then(() => {
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
  })
  .catch((err) => {
    console.error(`\n  ✗ harness error — ${err.message}`);
    console.log(`\n${passed} passed, ${failed + 1} failed`);
    process.exit(1);
  });

import { useRef, useEffect, useCallback } from 'react';

const TRACK_STORAGE_KEY = 'gt7_track_map_v1';
const MIN_SPEED_KMH  = 30;
const JUMP_SQ        = 2500;   // 50 m — teleport / major gap detection
const SEG_GAP_SQ     = 225;    // 15 m — segment break within a continuous run
const TIME_GAP_MS    = 200;    // break segment if RAF stalled > 200 ms
const GRID_M         = 3;
const PIT_SLOW_KMH   = 100;
const PIT_STOP_KMH   = 10;
const PIT_MIN_DUR_MS = 15_000;
const PIT_ZONE_M     = 35;
// A pit lane is seconds long at 60 Hz; anything past this is a parked car.
const SLOW_BUF_MAX   = 3000;

export function saveTrackMap(m) {
  try {
    localStorage.setItem(TRACK_STORAGE_KEY, JSON.stringify({
      segs:    m.segs,
      cells:   [...m.cells.entries()],
      pitLane: m.pitLane,
      bounds:  m.bounds,
    }));
  } catch { /* storage full or blocked — the map just is not saved */ }
}

// Split any segment that contains a point-to-point gap larger than JUMP_SQ.
// Applied on load to repair data recorded before this fix.
function splitSegments(segs) {
  const out = [];
  for (const seg of segs) {
    let cur = [];
    for (const pt of seg) {
      if (cur.length > 0) {
        const prev = cur[cur.length - 1];
        if ((pt.x - prev.x)**2 + (pt.z - prev.z)**2 > JUMP_SQ) {
          if (cur.length) out.push(cur);
          cur = [];
        }
      }
      cur.push(pt);
    }
    if (cur.length) out.push(cur);
  }
  return out.length ? out : [[]];
}

function loadTrackMap(m) {
  try {
    const raw = localStorage.getItem(TRACK_STORAGE_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (s.segs?.length)  m.segs    = splitSegments(s.segs);
    if (s.cells?.length) m.cells   = new Map(s.cells);
    if (s.pitLane)       m.pitLane = s.pitLane;
    if (s.bounds)        m.bounds  = s.bounds;
    m.dirty = true;
  } catch { /* unreadable saved map — start a fresh one */ }
}

/**
 * Runs the track-recording RAF loop at the App level so it keeps going
 * regardless of which tab is active. Returns a stable mapRef that TrackMap
 * reads for rendering, plus a resetMap callback.
 *
 * EVERY connected car records. Points are deduplicated into a GRID_M grid, so
 * ten cars on the same line cost nothing over one car — they only add cells
 * where their lines differ, which is how the track gets its actual width. The
 * circuit therefore completes in roughly a tenth of the time, which is what
 * makes a lobby session before the race worth anything: the map and the pit
 * lane are there before the race starts.
 *
 * It also removes a surprise. This used to follow whichever car's dashboard
 * was open, so clicking another leaderboard row silently changed who was
 * drawing, and the two cars' traces were stitched into one line.
 *
 * teams       — Map<ip, packet>, every car currently streaming
 * strategyIp  — my car. Only its pit entries clear MY tyre, so only it fires
 *               onPitEntry; the pit LANE itself is learned from anyone.
 * onPitEntry  — called when my car enters the pit zone
 */
export function useTrackMap(teams, strategyIp, onPitEntry) {
  const liveRef       = useRef({ teams: null, strategyIp: null });
  const onPitEntryRef = useRef(onPitEntry);

  // Kept current from an effect rather than assigned during render. The
  // recording loop below reads these every animation frame, so being one
  // render behind is invisible; writing them mid-render is not allowed.
  useEffect(() => {
    liveRef.current = { teams, strategyIp };
    onPitEntryRef.current = onPitEntry;
  });

  const mapRef = useRef({
    segs:      [[]],
    cells:     new Map(),
    pitLane:   null,
    bounds:    null,
    pathsLap:  -1,
    dirty:     false,
    // Recording state per car. The grid, the segments and the bounds are
    // shared — that is the point — but "where was this car last" cannot be.
    cars:      new Map(),
  });

  useEffect(() => {
    loadTrackMap(mapRef.current);

    let lastSaveTs = 0;
    // Set on a tab-return, for every car, so each starts a fresh segment rather
    // than joining a line across the gap.
    let breakAll = false;

    const carState = (m, id) => {
      let c = m.cars.get(id);
      if (!c) {
        c = {
          prevX: null, prevZ: null,
          lastPkt: null, lastRec: null, lastRecTs: 0,
          slowBuf: [], slowStart: null, inPit: false,
          segIdx: null, needsBreak: false,
        };
        m.cars.set(id, c);
      }
      return c;
    };

    const recordCar = (m, id, packet, isMine) => {
      const { posX, posZ, onTrack, speedKmh, currentLap } = packet;
      if (posX == null || posZ == null || !isFinite(posX) || !isFinite(posZ)) return;
      const spd = speedKmh ?? 0;
      const c   = carState(m, id);
      if (breakAll) c.needsBreak = true;

      if (m.pitLane?.box) {
        const dx = posX - m.pitLane.box.x, dz = posZ - m.pitLane.box.z;
        const inZone = dx*dx + dz*dz < PIT_ZONE_M*PIT_ZONE_M && spd < 80;
        // Only MY pit entry clears MY tyre. A rival boxing must not.
        if (inZone && !c.inPit && isMine) onPitEntryRef.current?.();
        c.inPit = inZone;
      }

      if (spd > PIT_SLOW_KMH) {
        if (c.slowStart !== null) {
          const buf = c.slowBuf;
          // Only MY car may decide where the pit lane is. Any car could before,
          // and the test is only "slow for fifteen seconds then quick again" —
          // so a rival beached in the gravel at Eau Rouge redefined the pit box
          // as that gravel trap, persisted it, and from then on every lap my
          // car passed within 35 m of it cleared my confirmed compound.
          if (isMine
            && Date.now() - c.slowStart > PIT_MIN_DUR_MS
            && buf.some(p => p.spd <= PIT_STOP_KMH)) {
            const box = buf.reduce((b, p) => p.spd < b.spd ? p : b, buf[0]);
            m.pitLane = { pts: buf.map(p => ({ x: p.x, z: p.z })), box: { x: box.x, z: box.z } };
            m.dirty = true;
          }
          c.slowBuf = []; c.slowStart = null;
        }
      } else {
        if (c.slowStart === null) c.slowStart = Date.now();
        // Capped. This runs at 60 Hz and is only cleared by exceeding
        // PIT_SLOW_KMH, so a car that never does — one parked in the pit lane
        // all race, which is exactly what a safety car is — grew it without
        // bound: a few hundred thousand entries an hour, then a single frame
        // spent reducing over all of them the moment it moved.
        if (c.slowBuf.length < SLOW_BUF_MAX) c.slowBuf.push({ x: posX, z: posZ, spd });
      }

      // Low speed or off-track: update lastPkt (anchor for gap detection) but don't draw
      if (!onTrack || spd < MIN_SPEED_KMH) { c.lastPkt = { x: posX, z: posZ }; return; }
      if (posX === c.prevX && posZ === c.prevZ) return;
      c.prevX = posX; c.prevZ = posZ;

      const pkt = c.lastPkt;
      c.lastPkt = { x: posX, z: posZ };
      const now = Date.now();

      // Break segment when:
      //  • no previous anchor (fresh start / tab-return that went through slow frames)
      //  • needsBreak flag set by visibility handler (tab switch, even through slow speed)
      //  • large GPS jump (teleport / position reset)
      //  • RAF was stalled > TIME_GAP_MS (freeze, tab-throttle)
      const newSeg = c.needsBreak
        || !pkt
        || c.segIdx === null
        || (posX - pkt.x)**2 + (posZ - pkt.z)**2 > JUMP_SQ
        || (c.lastRecTs > 0 && now - c.lastRecTs > TIME_GAP_MS);

      if (newSeg) c.needsBreak = false;

      if (!newSeg && c.lastRec) {
        const dx = posX - c.lastRec.x, dz = posZ - c.lastRec.z;
        if (dx*dx + dz*dz < 9) return;
      }
      c.lastRecTs = now;
      c.lastRec = { x: posX, z: posZ };

      const lap = currentLap ?? 0;
      const gx  = Math.round(posX / GRID_M) * GRID_M;
      const gz  = Math.round(posZ / GRID_M) * GRID_M;
      const key = `${gx},${gz}`;
      const isNew = !m.cells.has(key);
      m.cells.set(key, lap);
      if (isNew) {
        const pt = { x: posX, z: posZ, key };
        // Each car extends ITS OWN segment. Appending to whichever segment
        // happened to be last would weld two cars' lines together the moment
        // they were both recording.
        const curSeg = c.segIdx !== null ? m.segs[c.segIdx] : null;
        const lastSegPt = curSeg && curSeg.length > 0 ? curSeg[curSeg.length - 1] : null;
        // Use tighter SEG_GAP_SQ (15 m) so new cells that appear after a short gap
        // (freeze, briefly-hidden tab) don't connect back to a far-away segment end.
        const segGap = lastSegPt
          && (posX - lastSegPt.x)**2 + (posZ - lastSegPt.z)**2 > SEG_GAP_SQ;
        if (newSeg || !curSeg || curSeg.length === 0 || segGap) {
          m.segs.push([pt]);
          c.segIdx = m.segs.length - 1;
        } else {
          curSeg.push(pt);
        }
        if (!m.bounds) {
          m.bounds = { minX: posX, maxX: posX, minZ: posZ, maxZ: posZ };
        } else {
          if (posX < m.bounds.minX) m.bounds.minX = posX;
          if (posX > m.bounds.maxX) m.bounds.maxX = posX;
          if (posZ < m.bounds.minZ) m.bounds.minZ = posZ;
          if (posZ > m.bounds.maxZ) m.bounds.maxZ = posZ;
        }
        m.dirty = true;
      }
    };

    const record = () => {
      const { teams, strategyIp } = liveRef.current;
      if (!teams || teams.size === 0) return;
      const m = mapRef.current;
      for (const [id, packet] of teams) {
        if (packet) recordCar(m, id, packet, id === strategyIp);
      }
      breakAll = false;
      // Cars that have gone away keep nothing; their segments stay drawn.
      if (m.cars.size > teams.size) {
        for (const id of [...m.cars.keys()]) if (!teams.has(id)) m.cars.delete(id);
      }
    };

    const onVisible = () => {
      if (!document.hidden) {
        // Force a fresh segment on the next recording tick, for every car, even
        // if one is briefly at low speed and takes the early-return path first.
        breakAll = true;
        for (const c of mapRef.current.cars.values()) {
          c.needsBreak = true;
          c.prevX = null; c.prevZ = null; c.lastRecTs = 0;
          c.lastPkt = null; c.lastRec = null;
        }
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    let raf;
    const loop = (ts) => {
      record();
      // Persist new track data every 5 s so crashes don't lose much
      if (mapRef.current.dirty && ts - lastSaveTs > 5000) {
        saveTrackMap(mapRef.current);
        lastSaveTs = ts;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVisible);
      saveTrackMap(mapRef.current);
    };
  }, []);

  const resetMap = useCallback(() => {
    const m = mapRef.current;
    m.segs = [[]]; m.cells.clear();
    m.pitLane = null; m.bounds = null;
    m.dirty = false; m.pathsLap = -1;
    m.cars.clear();
    localStorage.removeItem(TRACK_STORAGE_KEY);
  }, []);

  return { mapRef, resetMap };
}

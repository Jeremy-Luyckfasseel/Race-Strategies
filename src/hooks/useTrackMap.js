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

export function saveTrackMap(m) {
  try {
    localStorage.setItem(TRACK_STORAGE_KEY, JSON.stringify({
      segs:    m.segs,
      cells:   [...m.cells.entries()],
      pitLane: m.pitLane,
      bounds:  m.bounds,
    }));
  } catch {}
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
  } catch {}
}

/**
 * Runs the track-recording RAF loop at the App level so it keeps going
 * regardless of which tab is active. Returns a stable mapRef that TrackMap
 * reads for rendering, plus a resetMap callback.
 *
 * liveData — latest telemetry packet for the selected PS5 (posX/Z, speedKmh, etc.)
 * onPitEntry — called when the car enters the pit zone
 */
export function useTrackMap(liveData, onPitEntry) {
  const liveRef       = useRef({});
  liveRef.current     = liveData ?? {};

  const onPitEntryRef = useRef(onPitEntry);
  onPitEntryRef.current = onPitEntry;

  const mapRef = useRef({
    segs:      [[]],
    cells:     new Map(),
    pitLane:   null,
    bounds:    null,
    pathsLap:  -1,
    dirty:     false,
    lastPkt:   null,
    lastRec:   null,
    slowBuf:   [],
    slowStart: null,
    inPit:     false,
  });

  useEffect(() => {
    loadTrackMap(mapRef.current);

    let prevPosX = null, prevPosZ = null, lastSaveTs = 0, lastRecTs = 0;
    // Persists through low-speed frames so a tab-return always starts a fresh segment
    let needsBreak = false;

    const record = () => {
      const { posX, posZ, onTrack, speedKmh, currentLap } = liveRef.current;
      if (posX == null || posZ == null || !isFinite(posX) || !isFinite(posZ)) return;
      const spd = speedKmh ?? 0;
      const m   = mapRef.current;

      if (m.pitLane?.box) {
        const dx = posX - m.pitLane.box.x, dz = posZ - m.pitLane.box.z;
        const inZone = dx*dx + dz*dz < PIT_ZONE_M*PIT_ZONE_M && spd < 80;
        if (inZone && !m.inPit) onPitEntryRef.current?.();
        m.inPit = inZone;
      }

      if (spd > PIT_SLOW_KMH) {
        if (m.slowStart !== null) {
          const buf = m.slowBuf;
          if (Date.now() - m.slowStart > PIT_MIN_DUR_MS && buf.some(p => p.spd <= PIT_STOP_KMH)) {
            const box = buf.reduce((b, p) => p.spd < b.spd ? p : b, buf[0]);
            m.pitLane = { pts: buf.map(p => ({ x: p.x, z: p.z })), box: { x: box.x, z: box.z } };
            m.dirty = true;
          }
          m.slowBuf = []; m.slowStart = null;
        }
      } else {
        if (m.slowStart === null) m.slowStart = Date.now();
        m.slowBuf.push({ x: posX, z: posZ, spd });
      }

      // Low speed or off-track: update lastPkt (anchor for gap detection) but don't draw
      if (!onTrack || spd < MIN_SPEED_KMH) { m.lastPkt = { x: posX, z: posZ }; return; }
      if (posX === prevPosX && posZ === prevPosZ) return;
      prevPosX = posX; prevPosZ = posZ;

      const pkt = m.lastPkt;
      m.lastPkt = { x: posX, z: posZ };
      const now = Date.now();

      // Break segment when:
      //  • no previous anchor (fresh start / tab-return that went through slow frames)
      //  • needsBreak flag set by visibility handler (tab switch, even through slow speed)
      //  • large GPS jump (teleport / position reset)
      //  • RAF was stalled > TIME_GAP_MS (freeze, tab-throttle)
      const newSeg = needsBreak
        || !pkt
        || (posX - pkt.x)**2 + (posZ - pkt.z)**2 > JUMP_SQ
        || (lastRecTs > 0 && now - lastRecTs > TIME_GAP_MS);

      if (newSeg) needsBreak = false;

      if (!newSeg && m.lastRec) {
        const dx = posX - m.lastRec.x, dz = posZ - m.lastRec.z;
        if (dx*dx + dz*dz < 9) return;
      }
      lastRecTs = now;
      m.lastRec = { x: posX, z: posZ };

      const lap = currentLap ?? 0;
      const gx  = Math.round(posX / GRID_M) * GRID_M;
      const gz  = Math.round(posZ / GRID_M) * GRID_M;
      const key = `${gx},${gz}`;
      const isNew = !m.cells.has(key);
      m.cells.set(key, lap);
      if (isNew) {
        const pt = { x: posX, z: posZ, key };
        const curSeg = m.segs[m.segs.length - 1];
        const lastSegPt = curSeg.length > 0 ? curSeg[curSeg.length - 1] : null;
        // Use tighter SEG_GAP_SQ (15 m) so new cells that appear after a short gap
        // (freeze, briefly-hidden tab) don't connect back to a far-away segment end.
        const segGap = lastSegPt
          && (posX - lastSegPt.x)**2 + (posZ - lastSegPt.z)**2 > SEG_GAP_SQ;
        if (newSeg || curSeg.length === 0 || segGap) m.segs.push([pt]);
        else curSeg.push(pt);
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

    const onVisible = () => {
      if (!document.hidden) {
        // Force a fresh segment on the next recording tick, even if the car is
        // briefly at low speed and goes through the early-return path first.
        needsBreak   = true;
        prevPosX     = null; prevPosZ = null; lastRecTs = 0;
        mapRef.current.lastPkt = null;
        mapRef.current.lastRec = null;
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
    m.lastPkt = null; m.lastRec = null;
    m.slowBuf = []; m.slowStart = null; m.inPit = false;
    localStorage.removeItem(TRACK_STORAGE_KEY);
  }, []);

  return { mapRef, resetMap };
}

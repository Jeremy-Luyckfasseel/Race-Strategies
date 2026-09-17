import { useState, useCallback, useRef, useEffect } from 'react';
import { backoffDelay } from '../logic/connection';
import { withTeamOrder, dropStaleTeams } from '../logic/teams';

/**
 * Incoming packets are collected in a ref and applied to React state on this
 * interval instead of one setState per packet. GT7 streams ~60 Hz per console,
 * so a 10-car LAN event is ~600 packets/sec — and because each arrives as its
 * own WebSocket event, React cannot batch them: that was ~600 full re-renders
 * a second, each cloning the teams Map and re-running every effect that
 * iterates it. Flushing at 20 Hz makes the render cost independent of how many
 * cars are connected. The track map stays smooth regardless because its dots
 * interpolate on their own rAF loop, 80 ms behind the newest sample.
 */
const FLUSH_MS = 50;

/**
 * Manages a WebSocket connection to the GT7 telemetry relay server.
 *
 * Protocol (both directions):
 *   browser → server:  { type: 'setIPs', ips: ['192.168.x.x', ...] }
 *   server → browser:  { type: 'ips', ips: [...] }          — current IP list
 *   server → browser:  { ps5ip: '...', fuelLiters, currentLap, ... } — telemetry
 *
 * `teams` is a Map<ps5ip, latestPacket>, flushed from a buffer every FLUSH_MS
 * (see below) rather than on every incoming message, and pruned of cars that
 * have gone quiet for TEAM_STALE_MS. `teamOrder` lists the cars in first-seen
 * order and is append-only — pruning a car that dropped out must not renumber
 * the others, since that index picks their display colour.
 * `serverIPs` mirrors what the server is actually heartbeating.
 *
 * Phase 3, Task 3.1: auto-reconnect. When the socket drops (and the user did NOT
 * explicitly disconnect) it retries with capped exponential backoff (1s → 2s → 4s
 * … cap ~15s, DECISION 4) for the whole session, re-sending the last IP list on
 * each reconnect. An explicit `disconnect()` suppresses reconnect.
 */
export function useTelemetry() {
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [teams, setTeams] = useState(new Map());
  const [teamOrder, setTeamOrder] = useState([]);
  const [serverIPs, setServerIPs] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [scanResults, setScanResults] = useState([]);

  // Packets land here between flushes; the interval below moves them into state.
  const pendingRef = useRef(new Map());
  // Mirror of `teams` so the flush can build the next Map without a state
  // updater callback (which React may invoke twice, and clearing `pendingRef`
  // inside one would drop packets on the second pass).
  const teamsRef = useRef(new Map());
  const orderRef = useRef([]);

  const wsRef = useRef(null);
  const connectRef = useRef(null); // latest doConnect, for the reconnect timer
  const userClosedRef = useRef(false); // true after an explicit disconnect()
  const reconnectAttemptRef = useRef(0);
  const reconnectPendingRef = useRef(false);
  const reconnectTimerRef = useRef(null);
  const lastUrlRef = useRef('ws://localhost:20777');
  const ipsRef = useRef([]); // last IP list, re-sent on reconnect

  const sendIPs = useCallback((ips) => {
    ipsRef.current = ips; // remember for reconnect
    if (wsRef.current?.readyState === 1 /* OPEN */) {
      wsRef.current.send(JSON.stringify({ type: 'setIPs', ips }));
    }
  }, []);

  const scan = useCallback(() => {
    if (wsRef.current?.readyState === 1 /* OPEN */) {
      setScanResults([]);
      setScanning(true);
      wsRef.current.send(JSON.stringify({ type: 'scan' }));
    }
  }, []);

  const clearReconnect = useCallback(() => {
    clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = null;
    reconnectPendingRef.current = false;
  }, []);

  const doConnect = useCallback((url = 'ws://localhost:20777', initialIPs = []) => {
    lastUrlRef.current = url;
    if (initialIPs.length) ipsRef.current = initialIPs;

    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
    }
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      reconnectAttemptRef.current = 0;
      reconnectPendingRef.current = false;
      setReconnecting(false);
      setConnected(true);
      if (ipsRef.current.length) {
        ws.send(JSON.stringify({ type: 'setIPs', ips: ipsRef.current }));
      }
    };

    // onerror and onclose can both fire; schedule at most one reconnect.
    const onDrop = () => {
      setConnected(false);
      if (userClosedRef.current || reconnectPendingRef.current) return;
      reconnectPendingRef.current = true;
      const delay = backoffDelay(reconnectAttemptRef.current);
      reconnectAttemptRef.current += 1;
      setReconnecting(true);
      reconnectTimerRef.current = setTimeout(() => {
        reconnectPendingRef.current = false;
        connectRef.current?.(lastUrlRef.current, ipsRef.current);
      }, delay);
    };
    ws.onclose = onDrop;
    ws.onerror = onDrop;

    ws.onmessage = ({ data }) => {
      try {
        const pkt = JSON.parse(data);
        if (!pkt) return;
        if (pkt.type === 'ips') {
          setServerIPs(pkt.ips || []);
        } else if (pkt.type === 'scanning') {
          setScanning(true);
        } else if (pkt.type === 'scanResult') {
          setScanning(false);
          setScanResults(pkt.results || []);
        } else if (pkt.ps5ip) {
          pendingRef.current.set(pkt.ps5ip, { ...pkt, ts: Date.now() });
        }
      } catch {
        /* ignore malformed packet */
      }
    };
  }, []);

  // Keep the reconnect timer pointed at the latest doConnect (set off-render).
  useEffect(() => {
    connectRef.current = doConnect;
  }, [doConnect]);

  // Apply buffered packets and drop cars that went quiet. Both steps return the
  // previous reference when nothing changed, so an idle session re-renders zero
  // times rather than 20 times a second.
  useEffect(() => {
    const id = setInterval(() => {
      const pending = pendingRef.current;
      const now = Date.now();

      let next = teamsRef.current;
      if (pending.size > 0) {
        next = new Map(next);
        for (const [ip, packet] of pending) next.set(ip, packet);

        let order = orderRef.current;
        for (const ip of pending.keys()) order = withTeamOrder(order, ip);
        if (order !== orderRef.current) {
          orderRef.current = order;
          setTeamOrder(order);
        }
        pending.clear();
      }

      next = dropStaleTeams(next, now);
      if (next === teamsRef.current) return;
      teamsRef.current = next;
      setTeams(next);
    }, FLUSH_MS);
    return () => clearInterval(id);
  }, []);

  // Public connect: clears the "user closed" flag and resets the backoff.
  const connect = useCallback((url = 'ws://localhost:20777', initialIPs = []) => {
    userClosedRef.current = false;
    reconnectAttemptRef.current = 0;
    clearReconnect();
    doConnect(url, initialIPs);
  }, [doConnect, clearReconnect]);

  const disconnect = useCallback(() => {
    userClosedRef.current = true; // suppress auto-reconnect
    clearReconnect();
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    setReconnecting(false);
    setConnected(false);
  }, [clearReconnect]);

  useEffect(
    () => () => {
      clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    },
    []
  );

  return { connected, reconnecting, teams, teamOrder, serverIPs, connect, disconnect, sendIPs, scan, scanning, scanResults };
}

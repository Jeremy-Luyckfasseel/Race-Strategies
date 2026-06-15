import { useState, useCallback, useRef, useEffect } from 'react';
import { backoffDelay } from '../logic/connection';

/**
 * Manages a WebSocket connection to the GT7 telemetry relay server.
 *
 * Protocol (both directions):
 *   browser → server:  { type: 'setIPs', ips: ['192.168.x.x', ...] }
 *   server → browser:  { type: 'ips', ips: [...] }          — current IP list
 *   server → browser:  { ps5ip: '...', fuelLiters, currentLap, ... } — telemetry
 *
 * `teams` is a Map<ps5ip, latestPacket> updated on every incoming telemetry message.
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
  const [serverIPs, setServerIPs] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [scanResults, setScanResults] = useState([]);

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
          setTeams((prev) => new Map(prev).set(pkt.ps5ip, { ...pkt, ts: Date.now() }));
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

  return { connected, reconnecting, teams, serverIPs, connect, disconnect, sendIPs, scan, scanning, scanResults };
}

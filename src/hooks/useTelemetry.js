import { useState, useCallback, useRef, useEffect } from 'react';

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
 */
export function useTelemetry() {
  const [connected, setConnected] = useState(false);
  const [teams, setTeams] = useState(new Map());
  const [serverIPs, setServerIPs] = useState([]);
  const wsRef = useRef(null);

  const sendIPs = useCallback((ips) => {
    if (wsRef.current?.readyState === 1 /* OPEN */) {
      wsRef.current.send(JSON.stringify({ type: 'setIPs', ips }));
    }
  }, []);

  const connect = useCallback((url = 'ws://localhost:20777', initialIPs = []) => {
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
    }
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      if (initialIPs.length) {
        ws.send(JSON.stringify({ type: 'setIPs', ips: initialIPs }));
      }
    };
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);
    ws.onmessage = ({ data }) => {
      try {
        const pkt = JSON.parse(data);
        if (!pkt) return;
        if (pkt.type === 'ips') {
          setServerIPs(pkt.ips || []);
        } else if (pkt.ps5ip) {
          setTeams(prev => new Map(prev).set(pkt.ps5ip, { ...pkt, ts: Date.now() }));
        }
      } catch {}
    };
  }, []);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    setConnected(false);
  }, []);

  useEffect(() => () => { wsRef.current?.close(); }, []);

  return { connected, teams, serverIPs, connect, disconnect, sendIPs };
}

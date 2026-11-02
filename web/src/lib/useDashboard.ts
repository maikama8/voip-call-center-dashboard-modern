import { useEffect, useState } from "react";
import type { ConnectionStatus, WallboardSnapshot } from "../types";

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function useDashboard(): { snapshot: WallboardSnapshot | null; status: ConnectionStatus } {
  const [snapshot, setSnapshot] = useState<WallboardSnapshot | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/snapshot")
      .then((response) => (response.ok ? response.json() : null))
      .then((body: WallboardSnapshot | null) => {
        if (!cancelled && body?.type === "snapshot") setSnapshot(body);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let stopped = false;
    let attempt = 0;
    let timer = 0;

    const connect = () => {
      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      socket = new WebSocket(`${protocol}://${window.location.host}/ws`);
      socket.onopen = () => {
        attempt = 0;
        setStatus("live");
      };
      socket.onmessage = (event) => {
        try {
          const body = JSON.parse(String(event.data)) as WallboardSnapshot;
          if (body.type === "snapshot") setSnapshot(body);
        } catch {
          /* ignore a malformed frame */
        }
      };
      socket.onclose = () => {
        if (stopped) return;
        setStatus((current) => (current === "connecting" ? "connecting" : "reconnecting"));
        const delay = Math.min(5000, 400 * 2 ** attempt);
        attempt += 1;
        timer = window.setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      socket?.close();
    };
  }, []);

  return { snapshot, status };
}

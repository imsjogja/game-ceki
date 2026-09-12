import { useEffect, useRef, useState } from "react";
import {
  GAME_SOCKET_PATH,
  type GameClientEvent,
  type GameServerEvent,
} from "@contracts/game-realtime";
import type { ClientState } from "@contracts/rummy";

export type GameRoomSnapshot = {
  code: string;
  name: string;
  state: ClientState;
  version: number;
};

type UseGameRoomArgs = {
  code: string;
};

type ConnectionState = {
  code: string;
  isConnecting: boolean;
  isConnected: boolean;
  error: string | null;
};

function websocketUrl(path: string): string {
  const url = new URL(path, window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

/**
 * Menerima snapshot room event-driven dan reconnect otomatis bila jaringan
 * pindah/terputus. tRPC `rummy.get` hanya memberi snapshot awal/fallback.
 */
export function useGameRoom({ code }: UseGameRoomArgs) {
  const [room, setRoom] = useState<GameRoomSnapshot | undefined>();
  const [connection, setConnection] = useState<ConnectionState>({
    code: "",
    isConnecting: true,
    isConnected: false,
    error: null,
  });
  const versionRef = useRef(-1);

  useEffect(() => {
    if (!code) return;

    // Room sebelumnya mungkin memiliki version lebih besar daripada room baru.
    // Reset pembanding sebelum membuka socket agar snapshot room baru tidak
    // diabaikan. Snapshot lama disaring dari nilai return hook di bawah.
    versionRef.current = -1;

    let disposed = false;
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    let terminal = false;
    const updateConnection = (next: Omit<ConnectionState, "code">) => {
      setConnection({ code, ...next });
    };

    const clearRetry = () => {
      if (!retryTimer) return;
      clearTimeout(retryTimer);
      retryTimer = null;
    };

    const connect = () => {
      if (disposed || terminal) return;
      clearRetry();
      updateConnection({
        isConnecting: true,
        isConnected: false,
        error: null,
      });
      try {
        socket = new WebSocket(websocketUrl(GAME_SOCKET_PATH));
      } catch {
        scheduleReconnect();
        return;
      }

      socket.onopen = () => {
        if (disposed || socket?.readyState !== WebSocket.OPEN) return;
        attempts = 0;
        updateConnection({
          isConnecting: false,
          isConnected: true,
          error: null,
        });
        const event: GameClientEvent = { type: "subscribe", code };
        socket.send(JSON.stringify(event));
      };

      socket.onmessage = message => {
        let event: GameServerEvent;
        try {
          event = JSON.parse(String(message.data)) as GameServerEvent;
        } catch {
          return;
        }

        if (event.type === "snapshot") {
          if (event.code !== code || event.version < versionRef.current) return;
          versionRef.current = event.version;
          setRoom({
            code: event.code,
            version: event.version,
            name: event.room.name,
            state: event.room.state,
          });
          updateConnection({
            isConnecting: false,
            isConnected: true,
            error: null,
          });
          return;
        }

        if (event.type === "error") {
          terminal = true;
          updateConnection({
            isConnecting: false,
            isConnected: false,
            error: event.message,
          });
          socket?.close();
        }
      };

      socket.onerror = () => {
        // Browser tidak menyertakan detail error WebSocket. onclose mengatur
        // retry dengan exponential backoff agar tidak membanjiri server.
      };

      socket.onclose = () => {
        if (disposed) return;
        if (terminal) return;
        updateConnection({
          isConnecting: true,
          isConnected: false,
          error: null,
        });
        scheduleReconnect();
      };
    };

    const scheduleReconnect = () => {
      if (disposed || terminal || retryTimer) return;
      const delay = Math.min(10_000, 500 * 2 ** Math.min(attempts++, 4));
      updateConnection({
        isConnecting: true,
        isConnected: false,
        error: null,
      });
      retryTimer = setTimeout(connect, delay);
    };

    connect();
    return () => {
      disposed = true;
      clearRetry();
      socket?.close();
    };
  }, [code]);

  const activeConnection =
    connection.code === code
      ? connection
      : { code, isConnecting: true, isConnected: false, error: null };
  return {
    room: room?.code === code ? room : undefined,
    ...activeConnection,
  };
}

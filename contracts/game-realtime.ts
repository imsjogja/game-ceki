// ------------------------------------------------------------------
// Kontrak sinkronisasi state permainan RemiKu.
//
// Mutasi game tetap melalui tRPC/HTTP agar validasi dan response error
// konsisten. WebSocket ini hanya mendistribusikan snapshot state yang sudah
// tersanitasi untuk setiap penerima, sehingga UI tidak perlu mem-poll state.
// ------------------------------------------------------------------

import type { ClientState } from "./rummy";

/** Endpoint WebSocket same-origin khusus snapshot permainan. */
export const GAME_SOCKET_PATH = "/api/game";

/** Ping cukup rapat untuk presence tanpa menjadikan HTTP polling pengganti WS. */
export const GAME_HEARTBEAT_MS = 10_000;

/** Snapshot game kecil; batasi input tetap untuk mencegah misuse endpoint. */
export const GAME_MAX_MESSAGE_BYTES = 4 * 1024;

export type GameClientEvent =
  { type: "subscribe"; code: string } | { type: "unsubscribe" };

export type GameServerEvent =
  | {
      type: "snapshot";
      code: string;
      /** Versi optimistic-lock room; selalu monoton naik pada state yang berubah. */
      version: number;
      room: { name: string; state: ClientState };
    }
  | {
      type: "error";
      code: "forbidden" | "room-not-found" | "room-closed" | "invalid-state";
      message: string;
    };

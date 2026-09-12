import type { IncomingMessage, Server } from "node:http";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { User } from "@db/schema";
import { rooms } from "@db/schema";
import {
  GAME_HEARTBEAT_MS,
  GAME_MAX_MESSAGE_BYTES,
  GAME_SOCKET_PATH,
  type GameClientEvent,
  type GameServerEvent,
} from "@contracts/game-realtime";
import {
  TURN_TIMEOUT_MS,
  getPlayerByUser,
  leavePlayerFromRoom,
  sanitizeState,
  tickGame,
  type GameState,
} from "@contracts/rummy";
import { authenticateRequest } from "./auth/session";
import { env } from "./lib/env";
import {
  getRoomByCode,
  maybeRecordMatch,
  withRoomAndDestroyIf,
  withRoomIfChanged,
} from "./queries/rooms";
import { getDb } from "./queries/connection";
import {
  clearPlayerRoomPresence,
  clearRoomPresence,
  touchRoomPresence,
} from "./presence";
import {
  clearMatchmakingForRoom,
  clearMatchmakingForUserInRoom,
} from "./queries/matchmaking";
import { destroyVoiceRoom, disconnectVoiceUser } from "./voice-router";

const codeSchema = z
  .string()
  .trim()
  .regex(/^[A-Z2-9]{6}$/i, "Kode room harus 6 karakter")
  .transform(value => value.toUpperCase());

const clientEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("subscribe"), code: codeSchema }),
  z.object({ type: z.literal("unsubscribe") }),
]);

/** Memberi waktu reconnect (reload, pindah jaringan) sebelum kursi jadi bot. */
export const GAME_DISCONNECT_GRACE_MS = 45_000;

export interface GameTransport {
  send(event: GameServerEvent): void;
  close(code?: number, reason?: string): void;
}

export interface GameSnapshot {
  code: string;
  version: number;
  room: Extract<GameServerEvent, { type: "snapshot" }>["room"];
  /** Internal only; tidak pernah diserialisasi ke socket. */
  playerUserId: number | null;
}

export type GameAuthorizer = (
  user: User | null,
  roomCode: string
) => Promise<GameSnapshot>;

interface GameMember {
  roomCode: string;
  /** User yang menerima snapshot (untuk sanitasi kartu tangan). */
  userId: number | null;
  /** Hanya terisi bila viewer memang peserta manusia di room. */
  playerUserId: number | null;
  transport: GameTransport;
}

function send(transport: GameTransport, event: GameServerEvent): void {
  try {
    transport.send(event);
  } catch {
    // Socket sudah tertutup; close handler akan melakukan cleanup.
  }
}

class GameJoinError extends Error {
  readonly code: Extract<GameServerEvent, { type: "error" }>["code"];

  constructor(
    code: Extract<GameServerEvent, { type: "error" }>["code"],
    message: string
  ) {
    super(message);
    this.code = code;
  }
}

/**
 * Hub snapshot per-process. Payload dibuat ulang untuk setiap member untuk
 * memastikan kartu tangan lawan tidak pernah masuk ke socket penerima lain.
 */
export class GameRealtimeHub {
  private readonly memberships = new Map<GameTransport, GameMember>();
  private readonly roomMembers = new Map<string, Set<GameMember>>();
  private readonly authorize: GameAuthorizer;
  private readonly onPlayerConnected: (
    roomCode: string,
    userId: number
  ) => void;
  private readonly onPlayerDisconnected: (
    roomCode: string,
    userId: number
  ) => void;

  constructor(
    authorize: GameAuthorizer,
    onPlayerConnected: (roomCode: string, userId: number) => void = () => {},
    onPlayerDisconnected: (roomCode: string, userId: number) => void = () => {}
  ) {
    this.authorize = authorize;
    this.onPlayerConnected = onPlayerConnected;
    this.onPlayerDisconnected = onPlayerDisconnected;
  }

  async receive(
    transport: GameTransport,
    user: User | null,
    event: GameClientEvent
  ): Promise<void> {
    if (event.type === "unsubscribe") {
      this.disconnect(transport);
      return;
    }
    await this.subscribe(transport, user, event.code);
  }

  disconnect(transport: GameTransport, notifyDisconnect = true): void {
    const member = this.memberships.get(transport);
    if (!member) return;

    this.memberships.delete(transport);
    const members = this.roomMembers.get(member.roomCode);
    members?.delete(member);
    if (members?.size === 0) this.roomMembers.delete(member.roomCode);

    if (
      member.playerUserId !== null &&
      !this.hasUserInRoom(member.roomCode, member.playerUserId)
    ) {
      clearPlayerRoomPresence(String(member.playerUserId), member.roomCode);
      if (notifyDisconnect) {
        this.onPlayerDisconnected(member.roomCode, member.playerUserId);
      }
    }
  }

  /** Kirim snapshot paling baru ke seluruh subscriber room. */
  async publishRoom(roomCode: string): Promise<void> {
    const members = this.roomMembers.get(roomCode);
    if (!members || members.size === 0) return;

    const room = await getRoomByCode(roomCode);
    if (!room) {
      this.destroyRoom(roomCode);
      return;
    }

    for (const member of [...members]) {
      const player =
        member.userId !== null
          ? getPlayerByUser(room.state, member.userId)
          : undefined;
      this.reconcilePlayerMembership(
        member,
        player && !player.isBot ? member.userId : null
      );
      send(member.transport, {
        type: "snapshot",
        code: room.code,
        version: room.version,
        room: {
          name: room.name,
          state: sanitizeState(room.state, member.userId),
        },
      });
      this.touch(member.transport);
    }
  }

  /** Perbarui presence dari pong heartbeat tanpa perlu HTTP polling. */
  touch(transport: GameTransport): void {
    const member = this.memberships.get(transport);
    if (!member) return;
    touchRoomPresence(
      member.playerUserId === null ? null : String(member.playerUserId),
      member.roomCode
    );
  }

  destroyRoom(roomCode: string): void {
    const members = this.roomMembers.get(roomCode);
    if (!members) return;

    this.roomMembers.delete(roomCode);
    for (const member of members) {
      this.memberships.delete(member.transport);
      send(member.transport, {
        type: "error",
        code: "room-closed",
        message: "Room sudah ditutup.",
      });
      member.transport.close(4001, "room-closed");
    }
  }

  /** Tutup semua game socket milik user yang tidak lagi menjadi peserta room. */
  disconnectUser(roomCode: string, userId: number): void {
    const members = this.roomMembers.get(roomCode);
    if (!members) return;

    for (const member of [...members]) {
      if (member.userId !== userId) continue;
      send(member.transport, {
        type: "error",
        code: "forbidden",
        message: "Anda sudah tidak menjadi pemain di room ini.",
      });
      this.disconnect(member.transport, false);
      member.transport.close(4003, "no-longer-room-member");
    }
  }

  private async subscribe(
    transport: GameTransport,
    user: User | null,
    roomCode: string
  ): Promise<void> {
    const current = this.memberships.get(transport);
    if (current?.roomCode === roomCode) {
      const snapshot = await this.sendSnapshot(transport, user, roomCode);
      if (snapshot)
        this.reconcilePlayerMembership(current, snapshot.playerUserId);
      return;
    }
    if (current) this.disconnect(transport);

    let snapshot: GameSnapshot;
    try {
      snapshot = await this.authorize(user, roomCode);
    } catch (error) {
      const message =
        error instanceof GameJoinError
          ? error.message
          : "Tidak dapat membuka sinkronisasi permainan.";
      const code = error instanceof GameJoinError ? error.code : "forbidden";
      this.error(transport, code, message);
      return;
    }

    const member: GameMember = {
      roomCode,
      userId: user?.id ?? null,
      // Jangan tandai peserta sebelum re-read setelah socket benar-benar
      // masuk hub. Bila mutasi terjadi persis di antara read awal dan
      // enrollment ini, publishRoom akan merekonsiliasi status peserta yang
      // terbaru alih-alih kehilangan event tersebut.
      playerUserId: null,
      transport,
    };
    const members = this.roomMembers.get(roomCode) ?? new Set<GameMember>();
    members.add(member);
    this.roomMembers.set(roomCode, members);
    this.memberships.set(transport, member);

    // Baca ulang setelah enrollment. Urutan ini menutup race berikut:
    // 1) subscribe membaca versi N; 2) mutasi menyimpan/publish N+1;
    // 3) socket baru belum ada di hub sehingga tidak menerima broadcast.
    // Jika mutasi terjadi sesudah enrollment, publishRoom mengirim event;
    // jika terjadi sebelumnya, snapshot ini sudah membawa versi terbaru.
    try {
      snapshot = await this.authorize(user, roomCode);
    } catch (error) {
      this.disconnect(transport, false);
      const message =
        error instanceof GameJoinError
          ? error.message
          : "Tidak dapat membuka sinkronisasi permainan.";
      const code = error instanceof GameJoinError ? error.code : "forbidden";
      this.error(transport, code, message);
      return;
    }
    // Room dapat mengeluarkan socket ini saat authorization kedua berjalan.
    if (this.memberships.get(transport) !== member) return;

    this.reconcilePlayerMembership(member, snapshot.playerUserId);
    this.touch(transport);
    send(transport, {
      type: "snapshot",
      code: snapshot.code,
      version: snapshot.version,
      room: snapshot.room,
    });
  }

  private async sendSnapshot(
    transport: GameTransport,
    user: User | null,
    roomCode: string
  ): Promise<GameSnapshot | null> {
    try {
      const snapshot = await this.authorize(user, roomCode);
      send(transport, {
        type: "snapshot",
        code: snapshot.code,
        version: snapshot.version,
        room: snapshot.room,
      });
      return snapshot;
    } catch (error) {
      const message =
        error instanceof GameJoinError ? error.message : "Room tidak tersedia.";
      const code = error instanceof GameJoinError ? error.code : "forbidden";
      this.error(transport, code, message);
      return null;
    }
  }

  /**
   * Pengunjung private dapat membuka socket sebelum menekan tombol "Gabung".
   * Publish room setelah mutasi join harus mempromosikan socket tersebut agar
   * heartbeat dan disconnect grace tetap diperlakukan sebagai pemain manusia.
   */
  private reconcilePlayerMembership(
    member: GameMember,
    nextPlayerUserId: number | null
  ): void {
    const previousPlayerUserId = member.playerUserId;
    if (previousPlayerUserId === nextPlayerUserId) return;

    member.playerUserId = nextPlayerUserId;
    if (
      previousPlayerUserId !== null &&
      !this.hasUserInRoom(member.roomCode, previousPlayerUserId)
    ) {
      clearPlayerRoomPresence(String(previousPlayerUserId), member.roomCode);
      this.onPlayerDisconnected(member.roomCode, previousPlayerUserId);
    }
    if (nextPlayerUserId !== null) {
      this.onPlayerConnected(member.roomCode, nextPlayerUserId);
    }
  }

  private hasUserInRoom(roomCode: string, userId: number): boolean {
    return [...(this.roomMembers.get(roomCode) ?? [])].some(
      member => member.playerUserId === userId
    );
  }

  private error(
    transport: GameTransport,
    code: Extract<GameServerEvent, { type: "error" }>["code"],
    message: string
  ): void {
    send(transport, { type: "error", code, message });
  }
}

/**
 * Scheduler per-room. Tidak melakukan scan berkala: tiap timer diarahkan ke
 * aksi bot atau timeout giliran manusia berikutnya.
 */
class GameRoomScheduler {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  schedule(roomCode: string, state: GameState): void {
    this.cancel(roomCode);
    const now = Date.now();
    const dueAt = nextGameWakeAt(state, now);
    if (dueAt === null) return;
    const delay = Math.max(0, dueAt - now);
    const timer = setTimeout(() => {
      this.timers.delete(roomCode);
      void this.run(roomCode);
    }, delay);
    timer.unref?.();
    this.timers.set(roomCode, timer);
  }

  async scheduleFromDatabase(roomCode: string): Promise<void> {
    const room = await getRoomByCode(roomCode);
    if (!room) {
      this.cancel(roomCode);
      return;
    }
    this.schedule(room.code, room.state);
  }

  async rehydrate(): Promise<void> {
    try {
      const playingRooms = await getDb().query.rooms.findMany({
        where: eq(rooms.status, "playing"),
      });
      for (const room of playingRooms) this.schedule(room.code, room.state);
    } catch (error) {
      // Database dapat belum siap saat development boot. `get`/mutasi berikutnya
      // tetap akan memanggil scheduleFromDatabase.
      console.error("[game] gagal memulihkan scheduler room:", error);
    }
  }

  close(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  destroyRoom(roomCode: string): void {
    this.cancel(roomCode);
  }

  private cancel(roomCode: string): void {
    const timer = this.timers.get(roomCode);
    if (timer) clearTimeout(timer);
    this.timers.delete(roomCode);
  }

  private async run(roomCode: string): Promise<void> {
    let changed = false;
    try {
      changed = await withRoomIfChanged(roomCode, async (state, room) => {
        const ticked = tickGame(state);
        const needsMatchRecord =
          state.status === "finished" && !state.statsRecorded;
        await maybeRecordMatch(room, state);
        return {
          changed: ticked || needsMatchRecord,
          result: ticked || needsMatchRecord,
        };
      });
    } catch (error) {
      // Room dapat terhapus bersamaan dengan leave. Jangan membuat timer baru.
      if (!isRoomNotFound(error)) {
        console.error(`[game] tick room ${roomCode} gagal:`, error);
      }
      return;
    }

    try {
      const room = await getRoomByCode(roomCode);
      if (!room) {
        destroyGameRoom(roomCode);
        return;
      }
      if (changed) await publishGameRoom(roomCode);
      this.schedule(room.code, room.state);
    } catch (error) {
      console.error(`[game] menjadwalkan ulang room ${roomCode} gagal:`, error);
    }
  }
}

/** Tentukan tick berikutnya tanpa melakukan scan room berkala. */
export function nextGameWakeAt(
  state: GameState,
  now = Date.now()
): number | null {
  if (state.status !== "playing") return null;
  const current = state.players[state.turnSeat];
  if (!current) return null;
  if (current.isBot || !current.connected) {
    return Math.max(now, state.botActionAt || 0);
  }
  return state.turnStartedAt + TURN_TIMEOUT_MS;
}

class DisconnectGrace {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  connected(roomCode: string, userId: number): void {
    this.clear(roomCode, userId);
  }

  disconnected(roomCode: string, userId: number): void {
    const key = this.key(roomCode, userId);
    if (this.timers.has(key)) return;
    const timer = setTimeout(() => {
      this.timers.delete(key);
      void removeDisconnectedPlayer(roomCode, userId);
    }, GAME_DISCONNECT_GRACE_MS);
    timer.unref?.();
    this.timers.set(key, timer);
  }

  clear(roomCode: string, userId: number): void {
    const key = this.key(roomCode, userId);
    const timer = this.timers.get(key);
    if (timer) clearTimeout(timer);
    this.timers.delete(key);
  }

  clearRoom(roomCode: string): void {
    for (const [key, timer] of this.timers) {
      if (!key.startsWith(`${roomCode}:`)) continue;
      clearTimeout(timer);
      this.timers.delete(key);
    }
  }

  close(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  private key(roomCode: string, userId: number) {
    return `${roomCode}:${userId}`;
  }
}

async function authorizeGameMember(
  user: User | null,
  roomCode: string
): Promise<GameSnapshot> {
  const room = await getRoomByCode(roomCode);
  if (!room) {
    throw new GameJoinError("room-not-found", "Room tidak ditemukan.");
  }
  const player = user ? getPlayerByUser(room.state, user.id) : undefined;
  return {
    code: room.code,
    version: room.version,
    room: {
      name: room.name,
      state: sanitizeState(room.state, user?.id ?? null),
    },
    playerUserId: player && !player.isBot ? player.userId : null,
  };
}

function headersFromNodeRequest(request: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else {
      headers.set(name, value);
    }
  }
  return headers;
}

function isSameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (!origin) return false;
  if (env.appOrigin) return origin === env.appOrigin;

  const host = request.headers.host;
  const forwardedProto = request.headers["x-forwarded-proto"];
  const protocol = Array.isArray(forwardedProto)
    ? forwardedProto[0]
    : forwardedProto?.split(",")[0]?.trim() || "http";
  return Boolean(host) && origin === `${protocol}://${host}`;
}

function rejectUpgrade(
  socket: import("node:net").Socket,
  status: "403 Forbidden" | "413 Payload Too Large"
): void {
  socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

function parseClientEvent(raw: RawData): GameClientEvent | null {
  const text = raw.toString();
  if (Buffer.byteLength(text) > GAME_MAX_MESSAGE_BYTES) return null;
  try {
    const parsed = clientEventSchema.safeParse(JSON.parse(text));
    return parsed.success ? (parsed.data as GameClientEvent) : null;
  } catch {
    return null;
  }
}

function isRoomNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "NOT_FOUND"
  );
}

/** Pasang gateway WebSocket game pada HTTP server Hono/Vite. */
export function attachGameGateway(server: Server) {
  const scheduler = new GameRoomScheduler();
  const disconnectGrace = new DisconnectGrace();
  const hub = new GameRealtimeHub(
    authorizeGameMember,
    (roomCode, userId) => disconnectGrace.connected(roomCode, userId),
    (roomCode, userId) => disconnectGrace.disconnected(roomCode, userId)
  );
  const gateway = new WebSocketServer({
    noServer: true,
    clientTracking: false,
    maxPayload: GAME_MAX_MESSAGE_BYTES,
    perMessageDeflate: false,
  });
  const sockets = new Set<WebSocket>();

  const heartbeat = setInterval(() => {
    for (const socket of sockets) {
      const tracked = socket as WebSocket & { isAlive?: boolean };
      if (tracked.isAlive === false) {
        socket.terminate();
        continue;
      }
      tracked.isAlive = false;
      socket.ping();
    }
  }, GAME_HEARTBEAT_MS);
  heartbeat.unref?.();

  const onUpgrade = (
    request: IncomingMessage,
    socket: import("node:net").Socket,
    head: Buffer
  ) => {
    const host = request.headers.host ?? "localhost";
    const url = new URL(request.url ?? "/", `http://${host}`);
    if (url.pathname !== GAME_SOCKET_PATH) return;
    if (!isSameOrigin(request)) {
      rejectUpgrade(socket, "403 Forbidden");
      return;
    }

    // Room private tetap bisa dilihat sebagai penonton; autentikasi hanya
    // diperlukan bila snapshot perlu menunjukkan tangan pemain sendiri.
    void authenticateRequest(headersFromNodeRequest(request))
      .catch(() => null)
      .then(user => {
        gateway.handleUpgrade(request, socket, head, websocket => {
          const transport: GameTransport = {
            send(event) {
              if (websocket.readyState === WebSocket.OPEN) {
                websocket.send(JSON.stringify(event));
              }
            },
            close(code, reason) {
              if (websocket.readyState === WebSocket.OPEN) {
                websocket.close(code, reason);
              }
            },
          };
          const tracked = websocket as WebSocket & { isAlive?: boolean };
          tracked.isAlive = true;
          sockets.add(websocket);
          websocket.on("pong", () => {
            tracked.isAlive = true;
            hub.touch(transport);
          });

          let messageQueue = Promise.resolve();
          websocket.on("message", raw => {
            messageQueue = messageQueue.then(async () => {
              const event = parseClientEvent(raw);
              if (!event) {
                send(transport, {
                  type: "error",
                  code: "invalid-state",
                  message: "Pesan sinkronisasi game tidak valid.",
                });
                return;
              }
              await hub.receive(transport, user, event);
            });
          });
          websocket.on("close", () => {
            sockets.delete(websocket);
            hub.disconnect(transport);
          });
          websocket.on("error", () => {
            // close handler menangani cleanup.
          });
        });
      })
      .catch(() => rejectUpgrade(socket, "403 Forbidden"));
  };

  server.on("upgrade", onUpgrade);
  void scheduler.rehydrate();

  return {
    close() {
      clearInterval(heartbeat);
      scheduler.close();
      disconnectGrace.close();
      server.off("upgrade", onUpgrade);
      for (const socket of sockets) socket.terminate();
      sockets.clear();
      gateway.close();
    },
    async publishRoom(roomCode: string) {
      await hub.publishRoom(roomCode);
    },
    async scheduleRoom(roomCode: string) {
      await scheduler.scheduleFromDatabase(roomCode);
    },
    destroyRoom(roomCode: string) {
      scheduler.destroyRoom(roomCode);
      disconnectGrace.clearRoom(roomCode);
      hub.destroyRoom(roomCode);
    },
    disconnectUser(roomCode: string, userId: number) {
      disconnectGrace.clear(roomCode, userId);
      hub.disconnectUser(roomCode, userId);
    },
  };
}

let currentGateway: ReturnType<typeof attachGameGateway> | null = null;

export function installGameGateway(server: Server) {
  currentGateway?.close();
  currentGateway = attachGameGateway(server);
  return currentGateway;
}

/** Broadcast snapshot setelah room berubah lewat tRPC atau scheduler. */
export async function publishGameRoom(code: string): Promise<void> {
  await currentGateway?.publishRoom(code);
}

/** Jadwalkan bot/timeout tanpa menunggu browser mem-poll. */
export async function scheduleGameRoom(code: string): Promise<void> {
  await currentGateway?.scheduleRoom(code);
}

/** Bersihkan WebSocket game saat room dihancurkan. */
export function destroyGameRoom(code: string): void {
  currentGateway?.destroyRoom(code);
}

/** Tutup WebSocket game pemain yang keluar atau dikeluarkan dari room. */
export function disconnectGameUser(code: string, userId: number): void {
  currentGateway?.disconnectUser(code, userId);
}

async function removeDisconnectedPlayer(
  roomCode: string,
  userId: number
): Promise<void> {
  try {
    const outcome = await withRoomAndDestroyIf(
      roomCode,
      state => leavePlayerFromRoom(state, userId),
      (_state, _room, result) => result.shouldDestroy
    );
    if (!outcome.result.didLeave) return;

    clearPlayerRoomPresence(String(userId), roomCode);
    disconnectVoiceUser(roomCode, userId);
    disconnectGameUser(roomCode, userId);
    if (outcome.destroyed) {
      clearRoomPresence(roomCode);
      destroyVoiceRoom(roomCode);
      destroyGameRoom(roomCode);
      await clearMatchmakingForRoom(roomCode);
      return;
    }

    await clearMatchmakingForUserInRoom(userId, roomCode);
    await publishGameRoom(roomCode);
    await scheduleGameRoom(roomCode);
  } catch (error) {
    if (!isRoomNotFound(error)) {
      console.error(
        `[game] cleanup pemain terputus ${userId} di room ${roomCode} gagal:`,
        error
      );
    }
  }
}

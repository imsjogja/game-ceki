import { createHmac } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { z } from "zod";
import type { User } from "@db/schema";
import {
  VOICE_HEARTBEAT_MS,
  VOICE_MAX_MESSAGE_BYTES,
  VOICE_MAX_PARTICIPANTS,
  VOICE_SOCKET_PATH,
  type VoiceClientEvent,
  type VoiceIceServer,
  type VoicePeerPublic,
  type VoiceServerEvent,
} from "@contracts/voice";
import { authenticateRequest } from "./auth/session";
import { env } from "./lib/env";
import { getRoomByCode } from "./queries/rooms";
import { getPlayerByUser } from "@contracts/rummy";

const codeSchema = z
  .string()
  .trim()
  .regex(/^[A-Z2-9]{6}$/i, "Kode room harus 6 karakter")
  .transform(value => value.toUpperCase());

const peerIdSchema = z.string().min(6).max(64);

const signalDataSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("sdp"),
    description: z.object({
      type: z.enum(["offer", "answer"]),
      sdp: z.string().min(1).max(16_384),
    }),
  }),
  z.object({
    kind: z.literal("ice"),
    candidate: z
      .object({
        candidate: z.string().max(2_048),
        sdpMid: z.string().max(64).nullable(),
        sdpMLineIndex: z.number().int().min(0).max(16).nullable(),
        usernameFragment: z.string().max(128).nullable().optional(),
      })
      .nullable(),
  }),
]);

const clientEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("join"), code: codeSchema, peerId: peerIdSchema }),
  z.object({
    type: z.literal("signal"),
    to: peerIdSchema,
    data: signalDataSchema,
  }),
  z.object({ type: z.literal("mute"), muted: z.boolean() }),
  z.object({ type: z.literal("leave") }),
]);

export interface VoiceTransport {
  send(event: VoiceServerEvent): void;
  close(code?: number, reason?: string): void;
}

export interface VoiceIdentity {
  userId: number;
  name: string;
  avatar: string | null;
  seat: number;
  iceServers: VoiceIceServer[];
}

export type VoiceAuthorizer = (
  user: User,
  roomCode: string
) => Promise<VoiceIdentity>;

interface VoiceMember extends VoicePeerPublic {
  userId: number;
  roomCode: string;
  transport: VoiceTransport;
}

interface VoiceRoom {
  peers: Map<string, VoiceMember>;
}

function send(transport: VoiceTransport, event: VoiceServerEvent): void {
  try {
    transport.send(event);
  } catch {
    // Socket sudah tertutup; event close akan membersihkan peer.
  }
}

/**
 * Hub signaling event-driven. State memang per-process; untuk scale-out,
 * hub ini perlu diganti Redis adapter/pub-sub sebelum replica app ditambah.
 */
export class VoiceSignalingHub {
  private readonly rooms = new Map<string, VoiceRoom>();
  private readonly memberships = new Map<VoiceTransport, VoiceMember>();
  private readonly authorize: VoiceAuthorizer;

  constructor(authorize: VoiceAuthorizer) {
    this.authorize = authorize;
  }

  async receive(
    transport: VoiceTransport,
    user: User,
    event: VoiceClientEvent
  ): Promise<void> {
    switch (event.type) {
      case "join":
        await this.join(transport, user, event.code, event.peerId);
        return;
      case "signal":
        this.signal(transport, event.to, event.data);
        return;
      case "mute":
        this.setMuted(transport, event.muted);
        return;
      case "leave":
        this.disconnect(transport);
        return;
    }
  }

  disconnect(transport: VoiceTransport): void {
    const member = this.memberships.get(transport);
    if (!member) return;

    this.memberships.delete(transport);
    const room = this.rooms.get(member.roomCode);
    if (!room || room.peers.get(member.peerId) !== member) return;

    room.peers.delete(member.peerId);
    this.broadcast(room, { type: "peer-left", peerId: member.peerId });
    if (room.peers.size === 0) this.rooms.delete(member.roomCode);
  }

  destroyRoom(roomCode: string): void {
    const room = this.rooms.get(roomCode);
    if (!room) return;

    this.rooms.delete(roomCode);
    for (const member of room.peers.values()) {
      this.memberships.delete(member.transport);
      send(member.transport, {
        type: "error",
        code: "room-closed",
        message: "Room sudah ditutup.",
      });
      member.transport.close(4001, "room-closed");
    }
  }

  /**
   * Keluarkan seluruh socket voice milik pemain yang sudah tidak lagi menjadi
   * anggota game. Tidak cukup mengandalkan unmount UI: socket lama dapat
   * bertahan saat tab hang, request leave datang dari tab lain, atau host
   * mengeluarkan pemain dari lobby.
   */
  disconnectUser(roomCode: string, userId: number): void {
    const room = this.rooms.get(roomCode);
    if (!room) return;

    for (const member of [...room.peers.values()]) {
      if (member.userId !== userId) continue;
      send(member.transport, {
        type: "error",
        code: "forbidden",
        message: "Anda sudah tidak menjadi pemain di room ini.",
      });
      this.disconnect(member.transport);
      member.transport.close(4003, "no-longer-room-member");
    }
  }

  private async join(
    transport: VoiceTransport,
    user: User,
    roomCode: string,
    peerId: string
  ): Promise<void> {
    const existing = this.memberships.get(transport);
    if (existing) {
      if (existing.roomCode === roomCode && existing.peerId === peerId) {
        const room = this.rooms.get(roomCode);
        send(transport, {
          type: "ready",
          peers: room ? this.publicPeers(room, peerId) : [],
          iceServers: [],
        });
        return;
      }
      this.error(
        transport,
        "invalid-state",
        "Voice chat sudah aktif di koneksi ini."
      );
      return;
    }

    let identity: VoiceIdentity;
    try {
      identity = await this.authorize(user, roomCode);
    } catch (error) {
      const message =
        error instanceof VoiceJoinError
          ? error.message
          : "Tidak bisa bergabung ke voice chat.";
      const code = error instanceof VoiceJoinError ? error.code : "forbidden";
      this.error(transport, code, message);
      return;
    }

    const room = this.rooms.get(roomCode) ?? {
      peers: new Map<string, VoiceMember>(),
    };
    this.rooms.set(roomCode, room);

    // Satu akun hanya boleh memiliki satu sesi voice pada satu room. Ini juga
    // mencegah dua tab akun yang sama saling mengirim audio dan memicu echo.
    for (const member of room.peers.values()) {
      if (member.userId !== identity.userId) continue;
      this.disconnect(member.transport);
      member.transport.close(4000, "replaced-by-new-session");
      break;
    }

    if (room.peers.size >= VOICE_MAX_PARTICIPANTS) {
      this.error(transport, "room-full", "Voice chat room ini sudah penuh.");
      return;
    }

    const member: VoiceMember = {
      peerId,
      userId: identity.userId,
      name: identity.name,
      avatar: identity.avatar,
      seat: identity.seat,
      muted: false,
      roomCode,
      transport,
    };
    room.peers.set(peerId, member);
    this.memberships.set(transport, member);

    send(transport, {
      type: "ready",
      peers: this.publicPeers(room, peerId),
      iceServers: identity.iceServers,
    });
    this.broadcast(
      room,
      { type: "peer-joined", peer: this.toPublic(member) },
      peerId
    );
  }

  private signal(
    transport: VoiceTransport,
    targetPeerId: string,
    data: Extract<VoiceClientEvent, { type: "signal" }>["data"]
  ): void {
    const sender = this.memberships.get(transport);
    if (!sender) {
      this.error(
        transport,
        "invalid-state",
        "Gabung voice chat terlebih dahulu."
      );
      return;
    }
    if (targetPeerId === sender.peerId) {
      this.error(
        transport,
        "invalid-state",
        "Tidak dapat mengirim sinyal ke diri sendiri."
      );
      return;
    }

    const target = this.rooms.get(sender.roomCode)?.peers.get(targetPeerId);
    if (!target) {
      this.error(
        transport,
        "peer-unavailable",
        "Pemain voice sudah tidak tersedia."
      );
      return;
    }
    send(target.transport, { type: "signal", from: sender.peerId, data });
  }

  private setMuted(transport: VoiceTransport, muted: boolean): void {
    const member = this.memberships.get(transport);
    if (!member || member.muted === muted) return;

    member.muted = muted;
    const room = this.rooms.get(member.roomCode);
    if (room) {
      this.broadcast(
        room,
        {
          type: "peer-updated",
          peerId: member.peerId,
          muted,
        },
        member.peerId
      );
    }
  }

  private publicPeers(
    room: VoiceRoom,
    exceptPeerId: string
  ): VoicePeerPublic[] {
    return [...room.peers.values()]
      .filter(member => member.peerId !== exceptPeerId)
      .map(member => this.toPublic(member));
  }

  private toPublic(member: VoiceMember): VoicePeerPublic {
    return {
      peerId: member.peerId,
      name: member.name,
      avatar: member.avatar,
      seat: member.seat,
      muted: member.muted,
    };
  }

  private broadcast(
    room: VoiceRoom,
    event: VoiceServerEvent,
    exceptPeerId?: string
  ): void {
    for (const member of room.peers.values()) {
      if (member.peerId !== exceptPeerId) send(member.transport, event);
    }
  }

  private error(
    transport: VoiceTransport,
    code: Extract<VoiceServerEvent, { type: "error" }>["code"],
    message: string
  ): void {
    send(transport, { type: "error", code, message });
  }
}

class VoiceJoinError extends Error {
  readonly code: Extract<VoiceServerEvent, { type: "error" }>["code"];

  constructor(
    code: Extract<VoiceServerEvent, { type: "error" }>["code"],
    message: string
  ) {
    super(message);
    this.code = code;
  }
}

function splitUrls(value: string): string[] {
  return value
    .split(",")
    .map(url => url.trim())
    .filter(Boolean);
}

function getIceServers(userId: number, roomCode: string): VoiceIceServer[] {
  const stunUrls = splitUrls(env.voiceStunUrls);
  const result: VoiceIceServer[] =
    stunUrls.length > 0 ? [{ urls: stunUrls }] : [];
  const turnUrls = splitUrls(env.voiceTurnUrls);
  if (turnUrls.length === 0 || !env.voiceTurnSecret) return result;

  const expiresAt = Math.floor(Date.now() / 1_000) + env.voiceTurnTtlSeconds;
  const username = `${expiresAt}:${userId}:${roomCode}`;
  const credential = createHmac("sha1", env.voiceTurnSecret)
    .update(username)
    .digest("base64");
  result.push({
    urls: turnUrls,
    username,
    credential,
    credentialType: "password",
  });
  return result;
}

async function authorizeVoiceMember(
  user: User,
  roomCode: string
): Promise<VoiceIdentity> {
  const room = await getRoomByCode(roomCode);
  if (!room)
    throw new VoiceJoinError("room-not-found", "Room tidak ditemukan.");
  if (room.state.matchType === "stranger") {
    throw new VoiceJoinError(
      "forbidden",
      "Voice chat tidak tersedia untuk room lawan online."
    );
  }

  const player = getPlayerByUser(room.state, user.id);
  if (!player || player.isBot) {
    throw new VoiceJoinError(
      "forbidden",
      "Hanya pemain room yang dapat memakai voice chat."
    );
  }

  return {
    userId: user.id,
    name: player.name,
    avatar: player.avatar ?? null,
    seat: player.seat,
    iceServers: getIceServers(user.id, room.code),
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
  status: "401 Unauthorized" | "403 Forbidden" | "413 Payload Too Large"
): void {
  socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

function parseClientEvent(raw: RawData): VoiceClientEvent | null {
  const text = raw.toString();
  if (Buffer.byteLength(text) > VOICE_MAX_MESSAGE_BYTES) return null;
  try {
    const parsed = clientEventSchema.safeParse(JSON.parse(text));
    return parsed.success ? (parsed.data as VoiceClientEvent) : null;
  } catch {
    return null;
  }
}

/** Pasang gateway WebSocket pada HTTP server Hono/Vite. */
export function attachVoiceGateway(server: Server) {
  const hub = new VoiceSignalingHub(authorizeVoiceMember);
  const gateway = new WebSocketServer({
    noServer: true,
    clientTracking: false,
    maxPayload: VOICE_MAX_MESSAGE_BYTES,
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
  }, VOICE_HEARTBEAT_MS);
  heartbeat.unref?.();

  const onUpgrade = (
    request: IncomingMessage,
    socket: import("node:net").Socket,
    head: Buffer
  ) => {
    const host = request.headers.host ?? "localhost";
    const url = new URL(request.url ?? "/", `http://${host}`);
    if (url.pathname !== VOICE_SOCKET_PATH) return;
    if (!isSameOrigin(request)) {
      rejectUpgrade(socket, "403 Forbidden");
      return;
    }

    void authenticateRequest(headersFromNodeRequest(request))
      .then(user => {
        gateway.handleUpgrade(request, socket, head, websocket => {
          const transport: VoiceTransport = {
            send(event) {
              if (websocket.readyState === WebSocket.OPEN) {
                websocket.send(JSON.stringify(event));
              }
            },
            close(code, reason) {
              if (websocket.readyState === WebSocket.OPEN)
                websocket.close(code, reason);
            },
          };
          const tracked = websocket as WebSocket & { isAlive?: boolean };
          tracked.isAlive = true;
          sockets.add(websocket);
          websocket.on("pong", () => {
            tracked.isAlive = true;
          });

          // Serialisasi handler agar SDP dan ICE diproses sesuai urutan pesan.
          let messageQueue = Promise.resolve();
          websocket.on("message", raw => {
            messageQueue = messageQueue.then(async () => {
              const event = parseClientEvent(raw);
              if (!event) {
                transport.send({
                  type: "error",
                  code: "invalid-state",
                  message: "Pesan voice tidak valid.",
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
      .catch(() => rejectUpgrade(socket, "401 Unauthorized"));
  };

  server.on("upgrade", onUpgrade);

  return {
    close() {
      clearInterval(heartbeat);
      server.off("upgrade", onUpgrade);
      for (const socket of sockets) socket.terminate();
      sockets.clear();
      gateway.close();
    },
    destroyRoom(roomCode: string) {
      hub.destroyRoom(roomCode);
    },
    disconnectUser(roomCode: string, userId: number) {
      hub.disconnectUser(roomCode, userId);
    },
  };
}

// Singleton production server. Rummy lifecycle memanggil fungsi ini ketika
// pemain manusia terakhir meninggalkan room.
let currentGateway: ReturnType<typeof attachVoiceGateway> | null = null;

export function installVoiceGateway(server: Server) {
  currentGateway?.close();
  currentGateway = attachVoiceGateway(server);
  return currentGateway;
}

/** Bersihkan semua signaling dan socket voice ketika room dimusnahkan. */
export function destroyVoiceRoom(code: string): void {
  currentGateway?.destroyRoom(code);
}

/** Tutup socket voice pemain yang telah keluar/dikeluarkan dari room. */
export function disconnectVoiceUser(code: string, userId: number): void {
  currentGateway?.disconnectUser(code, userId);
}

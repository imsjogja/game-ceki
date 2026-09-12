import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, publicQuery } from "./middleware";
import {
  VOICE_MAX_MAILBOX,
  VOICE_MAX_PEERS,
  VOICE_PEER_TTL_MS,
  type VoiceEnvelope,
  type VoicePeer,
  type VoicePeerPublic,
} from "@contracts/voice";

// ------------------------------------------------------------------
// Hub signaling voice chat — murni in-memory per proses server.
// Setiap room punya daftar peer + kotak surat pesan per peer.
// Tidak menyentuh database sama sekali.
// ------------------------------------------------------------------

interface VoiceHub {
  peers: Map<string, VoicePeer>;
  boxes: Map<string, VoiceEnvelope[]>;
}

const hubs = new Map<string, VoiceHub>();

/** Bersihkan signaling room segera setelah room permainan dimusnahkan. */
export function destroyVoiceRoom(code: string) {
  hubs.delete(code);
}

function getHub(code: string): VoiceHub {
  let hub = hubs.get(code);
  if (!hub) {
    hub = { peers: new Map(), boxes: new Map() };
    hubs.set(code, hub);
  }
  return hub;
}

/** Buang peer kedaluwarsa dalam satu hub — dipanggil lazily di tiap request. */
function sweep(hub: VoiceHub) {
  const now = Date.now();
  for (const [id, p] of hub.peers) {
    if (now - p.lastSeen > VOICE_PEER_TTL_MS) {
      hub.peers.delete(id);
      hub.boxes.delete(id);
    }
  }
}

// Janitor global: hub yang benar-benar kosong dibuang berkala agar
// kode room ngasal tidak menumpuk di memori.
const janitor = setInterval(() => {
  for (const [code, hub] of hubs) {
    sweep(hub);
    if (hub.peers.size === 0) hubs.delete(code);
  }
}, 60_000);
janitor.unref?.();

const toPublic = (p: VoicePeer): VoicePeerPublic => ({
  peerId: p.peerId,
  name: p.name,
  avatar: p.avatar,
  seat: p.seat,
  muted: p.muted,
});

const codeSchema = z
  .string()
  .trim()
  .min(4)
  .max(12)
  .transform((s) => s.toUpperCase());

const peerIdSchema = z.string().min(6).max(64);

const signalDataSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("sdp"),
    description: z.object({
      type: z.enum(["offer", "answer"]),
      sdp: z.string().max(16384),
    }),
  }),
  z.object({
    kind: z.literal("ice"),
    candidate: z
      .object({
        candidate: z.string().max(2048),
        sdpMid: z.string().max(64).nullable(),
        sdpMLineIndex: z.number().nullable(),
        usernameFragment: z.string().max(128).nullish(),
      })
      .nullable(),
  }),
]);

const touch = (hub: VoiceHub, peerId: string) => {
  const me = hub.peers.get(peerId);
  if (me) me.lastSeen = Date.now();
};

export const voiceRouter = createRouter({
  /** Gabung voice chat (upsert — juga dipakai untuk update status mute). */
  join: publicQuery
    .input(
      z.object({
        code: codeSchema,
        peerId: peerIdSchema,
        name: z.string().trim().min(1).max(24),
        avatar: z.string().max(500).nullable().optional(),
        seat: z.number().int().min(0).max(9).nullable().optional(),
        muted: z.boolean().default(false),
      }),
    )
    .mutation(({ input }) => {
      const hub = getHub(input.code);
      sweep(hub);
      if (!hub.peers.has(input.peerId) && hub.peers.size >= VOICE_MAX_PEERS) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Voice chat room ini sudah penuh.",
        });
      }
      hub.peers.set(input.peerId, {
        peerId: input.peerId,
        name: input.name,
        avatar: input.avatar ?? null,
        seat: input.seat ?? null,
        muted: input.muted,
        lastSeen: Date.now(),
      });
      return { peers: [...hub.peers.values()].map(toPublic) };
    }),

  /** Polling berkala: ambil daftar peer + pesan signaling untukku. */
  poll: publicQuery
    .input(z.object({ code: codeSchema, peerId: peerIdSchema }))
    .query(({ input }) => {
      const hub = getHub(input.code);
      touch(hub, input.peerId);
      sweep(hub);
      const messages = hub.boxes.get(input.peerId) ?? [];
      hub.boxes.set(input.peerId, []);
      return {
        peers: [...hub.peers.values()].map(toPublic),
        messages,
      };
    }),

  /** Kirim pesan signaling (SDP/ICE) ke peer lain. */
  signal: publicQuery
    .input(
      z.object({
        code: codeSchema,
        peerId: peerIdSchema,
        to: peerIdSchema,
        data: signalDataSchema,
      }),
    )
    .mutation(({ input }) => {
      const hub = getHub(input.code);
      touch(hub, input.peerId);
      const box = hub.boxes.get(input.to) ?? [];
      box.push({ from: input.peerId, data: input.data });
      if (box.length > VOICE_MAX_MAILBOX) {
        box.splice(0, box.length - VOICE_MAX_MAILBOX);
      }
      hub.boxes.set(input.to, box);
      return { ok: true as const };
    }),

  /** Keluar voice chat — kehadiran & kotak surat dibersihkan. */
  leave: publicQuery
    .input(z.object({ code: codeSchema, peerId: peerIdSchema }))
    .mutation(({ input }) => {
      const hub = hubs.get(input.code);
      if (hub) {
        hub.peers.delete(input.peerId);
        hub.boxes.delete(input.peerId);
        sweep(hub);
      }
      return { ok: true as const };
    }),
});

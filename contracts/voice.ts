import { MAX_ROOM_PLAYERS } from "./rummy";

// ------------------------------------------------------------------
// Kontrak signaling voice chat RemiKu.
//
// Audio tetap berjalan melalui WebRTC. Server hanya meneruskan signaling
// secara real-time melalui WebSocket yang terautentikasi; tidak ada mailbox
// polling sehingga SDP/ICE tidak tertunda atau hilang karena interval poll.
// ------------------------------------------------------------------

/** Endpoint WebSocket same-origin untuk signaling voice. */
export const VOICE_SOCKET_PATH = "/api/voice";

/** Detak WebSocket server untuk mendeteksi socket yang putus diam-diam. */
export const VOICE_HEARTBEAT_MS = 25_000;

/** Kapasitas total peserta voice mengikuti kapasitas room permainan. */
export const VOICE_MAX_PARTICIPANTS = MAX_ROOM_PLAYERS;

/** Batas payload signaling WebSocket agar tidak menjadi jalur upload umum. */
export const VOICE_MAX_MESSAGE_BYTES = 32 * 1024;

/** Payload signaling yang dipertukarkan antar peer. */
export type VoiceSignalData =
  | {
      kind: "sdp";
      description: { type: "offer" | "answer"; sdp: string };
    }
  | {
      kind: "ice";
      candidate: {
        candidate: string;
        sdpMid: string | null;
        sdpMLineIndex: number | null;
        usernameFragment?: string | null;
      } | null;
    };

/** Info kehadiran peserta voice chat dalam satu room. */
export interface VoicePeer {
  peerId: string;
  name: string;
  avatar: string | null;
  seat: number;
  muted: boolean;
}

export type VoicePeerPublic = VoicePeer;

/**
 * Bentuk serializable RTCIceServer. Kredensial TURN selalu dibuat server
 * untuk waktu terbatas dan hanya dikirim kepada pemain room yang sah.
 */
export interface VoiceIceServer {
  urls: string[];
  username?: string;
  credential?: string;
  credentialType?: "password";
}

/** Event yang boleh dikirim browser ke server signaling. */
export type VoiceClientEvent =
  | { type: "join"; code: string; peerId: string; muted: boolean }
  | { type: "signal"; to: string; data: VoiceSignalData }
  | { type: "mute"; muted: boolean }
  | { type: "leave" };

/** Event yang dikirim server ke browser. */
export type VoiceServerEvent =
  | { type: "ready"; peers: VoicePeerPublic[]; iceServers: VoiceIceServer[] }
  | { type: "peer-joined"; peer: VoicePeerPublic }
  | { type: "peer-updated"; peerId: string; muted: boolean }
  | { type: "peer-left"; peerId: string }
  | { type: "signal"; from: string; data: VoiceSignalData }
  | {
      type: "error";
      code:
        | "unauthorized"
        | "forbidden"
        | "room-not-found"
        | "room-full"
        | "peer-unavailable"
        | "invalid-state"
        | "room-closed";
      message: string;
    };

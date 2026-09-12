// ------------------------------------------------------------------
// Kontrak voice chat RemiKu.
//
// Audio mengalir peer-to-peer via WebRTC (mesh antar pemain).
// Server hanya menjadi "kotak surat" signaling in-memory untuk
// bertukar SDP offer/answer dan ICE candidate — memakai prosedur
// tRPC biasa (polling), sehingga tidak butuh WebSocket sama sekali.
// ------------------------------------------------------------------

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

/** Amplop pesan signaling: dari peer `from`, untuk peer tujuan. */
export interface VoiceEnvelope {
  from: string;
  data: VoiceSignalData;
}

/** Info kehadiran peserta voice chat dalam satu room. */
export interface VoicePeer {
  peerId: string;
  name: string;
  avatar: string | null;
  seat: number | null;
  muted: boolean;
  lastSeen: number;
}

/** Versi publik VoicePeer yang dikirim ke klien (tanpa lastSeen). */
export type VoicePeerPublic = Omit<VoicePeer, "lastSeen">;

/** Peer dianggap hilang jika tidak polling selama ini. */
export const VOICE_PEER_TTL_MS = 20_000;

/** Interval polling signaling dari klien. */
export const VOICE_POLL_MS = 1500;

/** Maksimum peserta voice per room (mesh masih ringan di 4–8 orang). */
export const VOICE_MAX_PEERS = 8;

/** Batas kotak surat per peer — pesan lama dibuang bila tak pernah diambil. */
export const VOICE_MAX_MAILBOX = 60;

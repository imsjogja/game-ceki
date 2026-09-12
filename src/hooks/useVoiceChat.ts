import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import {
  VOICE_POLL_MS,
  type VoiceEnvelope,
  type VoicePeerPublic,
  type VoiceSignalData,
} from "@contracts/voice";

// ------------------------------------------------------------------
// useVoiceChat — voice chat room berbasis WebRTC mesh.
//
// Audio mengalir langsung antar pemain (P2P). Server hanya dipakai
// sebagai kotak surat signaling (SDP/ICE) lewat polling tRPC ringan.
// Memakai pola "perfect negotiation" agar tabrakan offer antar peer
// terselesaikan otomatis: peer dengan peerId lebih besar bersikap
// "polite" (mengalah saat tabrakan).
// ------------------------------------------------------------------

export interface VoiceUiPeer extends VoicePeerPublic {
  speaking: boolean;
}

interface PeerEntry {
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  audio: HTMLAudioElement | null;
  analyser: AnalyserNode | null;
  buf: Uint8Array<ArrayBuffer> | null;
}

const ICE_SERVERS: RTCIceServer[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
];

function makePeerId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `p-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

export function useVoiceChat(opts: {
  code: string;
  name: string;
  avatar: string | null;
  seat: number | null;
}) {
  const { code } = opts;
  const utils = trpc.useUtils();

  const [active, setActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [muted, setMuted] = useState(false);
  const [peers, setPeers] = useState<VoiceUiPeer[]>([]);
  const [speakingSelf, setSpeakingSelf] = useState(false);

  const peerIdRef = useRef<string>(makePeerId());
  const activeRef = useRef(false);
  const busyRef = useRef(false);
  const mutedRef = useRef(false);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const streamRef = useRef<MediaStream | null>(null);
  const entriesRef = useRef(new Map<string, PeerEntry>());
  const audioCtxRef = useRef<AudioContext | null>(null);
  const selfSrcRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const selfAnalyserRef = useRef<AnalyserNode | null>(null);
  const selfBufRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const meterTimerRef = useRef<number | null>(null);

  // ---- signaling -------------------------------------------------

  const sendSignal = useCallback(
    async (to: string, data: VoiceSignalData) => {
      try {
        await utils.client.voice.signal.mutate({
          code: optsRef.current.code,
          peerId: peerIdRef.current,
          to,
          data,
        });
      } catch {
        // kegagalan sesaat — poll berikutnya memulihkan
      }
    },
    [utils],
  );

  // ---- manajemen peer connection ----------------------------------

  const destroyPeer = useCallback((peerId: string) => {
    const entry = entriesRef.current.get(peerId);
    if (!entry) return;
    entriesRef.current.delete(peerId);
    try {
      entry.pc.close();
    } catch {
      /* noop */
    }
    if (entry.audio) {
      entry.audio.srcObject = null;
      entry.audio.remove();
    }
    try {
      entry.analyser?.disconnect();
    } catch {
      /* noop */
    }
  }, []);

  const ensurePeer = useCallback(
    (peer: VoicePeerPublic) => {
      if (peer.peerId === peerIdRef.current) return;
      if (entriesRef.current.has(peer.peerId)) return;
      const stream = streamRef.current;
      if (!stream) return;

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      const entry: PeerEntry = {
        pc,
        polite: peerIdRef.current > peer.peerId,
        makingOffer: false,
        audio: null,
        analyser: null,
        buf: null,
      };
      entriesRef.current.set(peer.peerId, entry);

      pc.onnegotiationneeded = async () => {
        try {
          entry.makingOffer = true;
          await pc.setLocalDescription();
          const desc = pc.localDescription;
          if (desc) {
            await sendSignal(peer.peerId, {
              kind: "sdp",
              description: { type: desc.type as "offer" | "answer", sdp: desc.sdp },
            });
          }
        } catch {
          /* akan dicoba ulang oleh siklus berikutnya */
        } finally {
          entry.makingOffer = false;
        }
      };

      pc.onicecandidate = (ev) => {
        const c = ev.candidate;
        void sendSignal(peer.peerId, {
          kind: "ice",
          candidate: c
            ? {
                candidate: c.candidate,
                sdpMid: c.sdpMid,
                sdpMLineIndex: c.sdpMLineIndex,
                usernameFragment:
                  (c as unknown as { usernameFragment?: string | null })
                    .usernameFragment ?? null,
              }
            : null,
        });
      };

      pc.ontrack = (ev) => {
        const remote = ev.streams[0];
        if (!remote) return;
        const el = document.createElement("audio");
        el.autoplay = true;
        el.setAttribute("playsinline", "");
        el.srcObject = remote;
        el.style.display = "none";
        document.body.appendChild(el);
        entry.audio = el;
        void el.play().catch(() => {
          /* autoplay ditahan — tombol mic sudah berupa gestur pengguna */
        });
        const ctx = audioCtxRef.current;
        if (ctx) {
          try {
            const src = ctx.createMediaStreamSource(remote);
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 512;
            src.connect(analyser);
            entry.analyser = analyser;
            entry.buf = new Uint8Array(analyser.fftSize);
          } catch {
            /* indikator bicara peer dinonaktifkan */
          }
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed") {
          // hancurkan — poll berikutnya membangun ulang koneksi
          destroyPeer(peer.peerId);
        }
      };

      for (const track of stream.getTracks()) pc.addTrack(track, stream);
    },
    [destroyPeer, sendSignal],
  );

  const handleMessage = useCallback(
    async (msg: VoiceEnvelope) => {
      const entry = entriesRef.current.get(msg.from);
      if (!entry) return;
      const { pc } = entry;
      try {
        if (msg.data.kind === "sdp") {
          const desc = msg.data.description as RTCSessionDescriptionInit;
          const collision =
            desc.type === "offer" &&
            (entry.makingOffer || pc.signalingState !== "stable");
          // impolite mengabaikan offer yang bertabrakan
          if (collision && !entry.polite) return;
          if (desc.type === "offer" && pc.signalingState !== "stable") {
            await pc.setLocalDescription({ type: "rollback" });
          }
          await pc.setRemoteDescription(desc);
          if (desc.type === "offer") {
            await pc.setLocalDescription();
            const local = pc.localDescription;
            if (local) {
              await sendSignal(msg.from, {
                kind: "sdp",
                description: {
                  type: local.type as "offer" | "answer",
                  sdp: local.sdp,
                },
              });
            }
          }
        } else {
          await pc.addIceCandidate(msg.data.candidate);
        }
      } catch {
        /* pesan dobel/kedaluwarsa — abaikan */
      }
    },
    [sendSignal],
  );

  // ---- polling signaling ------------------------------------------

  const handlePoll = useCallback(
    async (data: { peers: VoicePeerPublic[]; messages: VoiceEnvelope[] }) => {
      if (!activeRef.current) return;
      const myId = peerIdRef.current;

      // server melupakanku (TTL) → gabung ulang
      if (!data.peers.some((p) => p.peerId === myId)) {
        const o = optsRef.current;
        try {
          await utils.client.voice.join.mutate({
            code: o.code,
            peerId: myId,
            name: o.name,
            avatar: o.avatar,
            seat: o.seat,
            muted: mutedRef.current,
          });
        } catch {
          /* coba lagi di poll berikutnya */
        }
      }

      // sinkronkan mesh: bangun koneksi baru, tutup yang hilang
      const remote = data.peers.filter((p) => p.peerId !== myId);
      for (const p of remote) ensurePeer(p);
      for (const id of [...entriesRef.current.keys()]) {
        if (!remote.some((p) => p.peerId === id)) destroyPeer(id);
      }

      // proses pesan signaling secara berurutan
      for (const msg of data.messages) await handleMessage(msg);

      // perbarui daftar peer di UI (pertahankan flag speaking)
      setPeers((prev) => {
        const speakingMap = new Map(prev.map((p) => [p.peerId, p.speaking]));
        return remote.map((p) => ({
          ...p,
          speaking: speakingMap.get(p.peerId) ?? false,
        }));
      });
    },
    [ensurePeer, destroyPeer, handleMessage, utils],
  );

  const pollQuery = trpc.voice.poll.useQuery(
    { code, peerId: peerIdRef.current },
    {
      enabled: active,
      refetchInterval: VOICE_POLL_MS,
      refetchIntervalInBackground: true,
      refetchOnWindowFocus: false,
      retry: false,
    },
  );

  const pollData = pollQuery.data;
  useEffect(() => {
    if (!active || !pollData) return;
    void handlePoll(pollData);
  }, [active, pollData, handlePoll]);

  // ---- pengukur suara (indikator bicara) --------------------------

  const startMeter = useCallback(() => {
    const ctx = new AudioContext();
    audioCtxRef.current = ctx;
    const stream = streamRef.current;
    if (stream) {
      try {
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        src.connect(analyser);
        selfSrcRef.current = src;
        selfAnalyserRef.current = analyser;
        selfBufRef.current = new Uint8Array(analyser.fftSize);
      } catch {
        /* indikator bicara diri dinonaktifkan */
      }
    }

    const loud = (
      analyser: AnalyserNode | null,
      buf: Uint8Array<ArrayBuffer> | null,
    ) => {
      if (!analyser || !buf) return false;
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      const step = 4;
      for (let i = 0; i < buf.length; i += step) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
      }
      return Math.sqrt(sum / (buf.length / step)) > 0.02;
    };

    meterTimerRef.current = window.setInterval(() => {
      const selfNow =
        !mutedRef.current && loud(selfAnalyserRef.current, selfBufRef.current);
      setSpeakingSelf((prev) => (prev === selfNow ? prev : selfNow));

      setPeers((prev) => {
        let changed = false;
        const next = prev.map((p) => {
          const e = entriesRef.current.get(p.peerId);
          const sp = e ? loud(e.analyser, e.buf) : false;
          if (sp !== p.speaking) changed = true;
          return sp === p.speaking ? p : { ...p, speaking: sp };
        });
        return changed ? next : prev;
      });
    }, 250);
  }, []);

  // ---- kontrol publik ---------------------------------------------

  const start = useCallback(async () => {
    if (activeRef.current || busyRef.current) return;
    busyRef.current = true;
    setStarting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;
      const o = optsRef.current;
      await utils.client.voice.join.mutate({
        code: o.code,
        peerId: peerIdRef.current,
        name: o.name,
        avatar: o.avatar,
        seat: o.seat,
        muted: false,
      });
      activeRef.current = true;
      setActive(true);
      startMeter();
    } catch {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      toast.error(
        "Tidak bisa mengakses mikrofon. Izinkan akses mic lalu coba lagi.",
      );
    } finally {
      busyRef.current = false;
      setStarting(false);
    }
  }, [startMeter, utils]);

  const stop = useCallback(() => {
    if (!activeRef.current) return;
    activeRef.current = false;
    setActive(false);
    void utils.client.voice.leave
      .mutate({ code: optsRef.current.code, peerId: peerIdRef.current })
      .catch(() => {});
    for (const id of [...entriesRef.current.keys()]) destroyPeer(id);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (meterTimerRef.current) {
      clearInterval(meterTimerRef.current);
      meterTimerRef.current = null;
    }
    try {
      selfSrcRef.current?.disconnect();
    } catch {
      /* noop */
    }
    selfSrcRef.current = null;
    selfAnalyserRef.current = null;
    selfBufRef.current = null;
    void audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    setPeers([]);
    setSpeakingSelf(false);
    setMuted(false);
    mutedRef.current = false;
  }, [destroyPeer, utils]);

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      mutedRef.current = next;
      streamRef.current?.getAudioTracks().forEach((t) => {
        t.enabled = !next;
      });
      if (activeRef.current) {
        const o = optsRef.current;
        void utils.client.voice.join
          .mutate({
            code: o.code,
            peerId: peerIdRef.current,
            name: o.name,
            avatar: o.avatar,
            seat: o.seat,
            muted: next,
          })
          .catch(() => {});
      }
      return next;
    });
  }, [utils]);

  // bersih total saat komponen dilepas (pindah halaman)
  const stopRef = useRef(stop);
  stopRef.current = stop;
  useEffect(() => () => stopRef.current(), []);

  /** Peta kursi → status voice — untuk indikator di meja permainan. */
  const bySeat = useMemo(() => {
    const m = new Map<number, { speaking: boolean; muted: boolean }>();
    for (const p of peers) {
      if (p.seat != null) m.set(p.seat, { speaking: p.speaking, muted: p.muted });
    }
    return m;
  }, [peers]);

  return {
    active,
    starting,
    muted,
    peers,
    speakingSelf,
    bySeat,
    start,
    stop,
    toggleMute,
  };
}

export type VoiceChat = ReturnType<typeof useVoiceChat>;

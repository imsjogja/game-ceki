import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  VOICE_SOCKET_PATH,
  type VoiceClientEvent,
  type VoiceIceServer,
  type VoicePeerPublic,
  type VoiceServerEvent,
  type VoiceSignalData,
} from "@contracts/voice";

// Audio WebRTC berjalan langsung antarpemain. WebSocket same-origin hanya
// meneruskan signaling SDP/ICE sehingga tidak lagi ada polling 1,5 detik.

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_MS = 750;
const JOIN_TIMEOUT_MS = 10_000;
const MAX_DEFERRED_SIGNALS_PER_PEER = 64;

export type VoiceConnectionState =
  "idle" | "connecting" | "connected" | "reconnecting" | "failed";

export interface VoiceUiPeer extends VoicePeerPublic {
  speaking: boolean;
  connectionState: RTCPeerConnectionState;
}

interface UseVoiceChatOptions {
  code: string;
  seat: number | null;
  /**
   * Voice hanya tersedia untuk pemain yang duduk pada room non-stranger.
   * Saat aktif, pemain masuk otomatis sebagai pendengar tanpa meminta mic.
   */
  enabled?: boolean;
}

interface PeerEntry {
  pc: RTCPeerConnection;
  audioTransceiver: RTCRtpTransceiver;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  isSettingRemoteAnswerPending: boolean;
  pendingCandidates: (RTCIceCandidateInit | null)[];
  audio: HTMLAudioElement | null;
  audioSource: MediaStreamAudioSourceNode | null;
  audioStream: MediaStream | null;
  analyser: AnalyserNode | null;
  buf: Uint8Array<ArrayBuffer> | null;
}

function makePeerId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `p-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function getSocketUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${VOICE_SOCKET_PATH}`;
}

function toRtcIceServers(servers: VoiceIceServer[]): RTCIceServer[] {
  return servers.map(server => ({
    urls: server.urls,
    username: server.username,
    credential: server.credential,
    credentialType: server.credentialType,
  }));
}

function parseServerEvent(raw: unknown): VoiceServerEvent | null {
  if (typeof raw !== "string") return null;
  try {
    const event = JSON.parse(raw) as { type?: unknown };
    return typeof event.type === "string" ? (event as VoiceServerEvent) : null;
  } catch {
    return null;
  }
}

function closeQuietly(pc: RTCPeerConnection): void {
  try {
    pc.close();
  } catch {
    // Sudah ditutup browser.
  }
}

export function useVoiceChat(opts: UseVoiceChatOptions) {
  const { code, seat, enabled = true } = opts;

  const [active, setActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [muted, setMuted] = useState(false);
  const [hasMicrophone, setHasMicrophone] = useState(false);
  const [connectionState, setConnectionState] =
    useState<VoiceConnectionState>("idle");
  const [peers, setPeers] = useState<VoiceUiPeer[]>([]);
  const [speakingSelf, setSpeakingSelf] = useState(false);

  const optsRef = useRef(opts);
  const peerIdRef = useRef(makePeerId());
  const activeRef = useRef(false);
  const mutedRef = useRef(false);
  const startingRef = useRef(false);
  const leftByUserRef = useRef(false);
  const operationRef = useRef(0);
  const socketRef = useRef<WebSocket | null>(null);
  const iceServersRef = useRef<RTCIceServer[]>([]);
  const peerDirectoryRef = useRef(new Map<string, VoicePeerPublic>());
  const entriesRef = useRef(new Map<string, PeerEntry>());
  const deferredSignalsRef = useRef(new Map<string, VoiceSignalData[]>());
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const joinTimeoutRef = useRef<number | null>(null);
  const messageQueueRef = useRef(Promise.resolve());

  const audioCtxRef = useRef<AudioContext | null>(null);
  const selfSrcRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const selfAnalyserRef = useRef<AnalyserNode | null>(null);
  const selfBufRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const meterTimerRef = useRef<number | null>(null);

  const connectRef = useRef<() => void>(() => {});
  const handleServerEventRef = useRef<
    (event: VoiceServerEvent) => Promise<void>
  >(async () => {});
  const stopRef = useRef<(userInitiated?: boolean) => void>(() => {});

  useEffect(() => {
    optsRef.current = opts;
  }, [code, enabled, opts, seat]);

  const clearJoinTimeout = useCallback(() => {
    if (joinTimeoutRef.current !== null) {
      window.clearTimeout(joinTimeoutRef.current);
      joinTimeoutRef.current = null;
    }
  }, []);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const updatePeerUi = useCallback(
    (peerId: string, update: (peer: VoiceUiPeer) => VoiceUiPeer): void => {
      setPeers(previous =>
        previous.map(peer => (peer.peerId === peerId ? update(peer) : peer))
      );
    },
    []
  );

  const syncPeersUi = useCallback(() => {
    const directory = [...peerDirectoryRef.current.values()].sort(
      (a, b) => a.seat - b.seat || a.name.localeCompare(b.name)
    );
    setPeers(previous => {
      const old = new Map(previous.map(peer => [peer.peerId, peer]));
      return directory.map(peer => {
        const before = old.get(peer.peerId);
        return {
          ...peer,
          speaking: before?.speaking ?? false,
          connectionState: before?.connectionState ?? "new",
        };
      });
    });
  }, []);

  const destroyPeer = useCallback((peerId: string): void => {
    const entry = entriesRef.current.get(peerId);
    if (!entry) return;

    entriesRef.current.delete(peerId);
    closeQuietly(entry.pc);
    if (entry.audio) {
      entry.audio.pause();
      entry.audio.srcObject = null;
      entry.audio.remove();
    }
    try {
      entry.audioSource?.disconnect();
      entry.analyser?.disconnect();
    } catch {
      // Audio graph mungkin sudah tertutup.
    }
  }, []);

  const destroyAllPeers = useCallback(() => {
    for (const peerId of [...entriesRef.current.keys()]) destroyPeer(peerId);
  }, [destroyPeer]);

  const playRemoteAudio = useCallback((audio: HTMLAudioElement): void => {
    void audio.play().catch(() => {
      // Pada browser dengan autoplay ketat, event gesture di bawah mencoba
      // kembali tanpa meminta akses mikrofon kepada pendengar.
    });
  }, []);

  const resumeRemoteAudio = useCallback(() => {
    const context = audioCtxRef.current;
    if (context?.state === "suspended") void context.resume().catch(() => {});
    for (const entry of entriesRef.current.values()) {
      if (entry.audio) playRemoteAudio(entry.audio);
    }
  }, [playRemoteAudio]);

  const attachLocalAudio = useCallback((onlyEntry?: PeerEntry): void => {
    const stream = streamRef.current;
    const track = stream?.getAudioTracks()[0];
    if (!stream || !track) return;

    const entries = onlyEntry
      ? [onlyEntry]
      : [...entriesRef.current.values()];
    for (const entry of entries) {
      if (entry.pc.signalingState === "closed") continue;
      const transceiver = entry.audioTransceiver;
      if (transceiver.sender.track?.id === track.id) {
        if (transceiver.direction === "recvonly") {
          transceiver.direction = "sendrecv";
        }
        continue;
      }

      // Semua koneksi selalu memiliki transceiver penerima. Saat mic
      // dinyalakan belakangan, isi sender yang sama agar renegosiasi hanya
      // menambah arah kirim dan tidak membuat jalur audio kedua.
      transceiver.direction = "sendrecv";
      void transceiver.sender.replaceTrack(track).catch(error => {
        console.warn("[voice] mikrofon tidak dapat dipasang ke peer:", error);
      });
    }
  }, []);

  const sendClientEvent = useCallback((event: VoiceClientEvent): boolean => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    try {
      socket.send(JSON.stringify(event));
      return true;
    } catch {
      return false;
    }
  }, []);

  const sendSignal = useCallback(
    (to: string, data: VoiceSignalData): void => {
      sendClientEvent({ type: "signal", to, data });
    },
    [sendClientEvent]
  );

  const flushCandidates = useCallback(async (entry: PeerEntry) => {
    const candidates = entry.pendingCandidates.splice(0);
    for (const candidate of candidates) {
      try {
        await entry.pc.addIceCandidate(candidate);
      } catch (error) {
        if (!entry.ignoreOffer) {
          console.warn(
            "[voice] kandidat ICE ditolak setelah remote SDP:",
            error
          );
        }
      }
    }
  }, []);

  const handleSignal = useCallback(
    async (from: string, data: VoiceSignalData): Promise<void> => {
      const entry = entriesRef.current.get(from);
      if (!entry) {
        const queued = deferredSignalsRef.current.get(from) ?? [];
        if (queued.length < MAX_DEFERRED_SIGNALS_PER_PEER) queued.push(data);
        deferredSignalsRef.current.set(from, queued);
        return;
      }

      const { pc } = entry;
      if (data.kind === "ice") {
        if (entry.ignoreOffer) return;
        if (!pc.remoteDescription) {
          entry.pendingCandidates.push(data.candidate);
          return;
        }
        try {
          await pc.addIceCandidate(data.candidate);
        } catch (error) {
          if (!entry.ignoreOffer) {
            console.warn("[voice] kandidat ICE tidak dapat dipasang:", error);
          }
        }
        return;
      }

      const description = data.description as RTCSessionDescriptionInit;
      const readyForOffer =
        !entry.makingOffer &&
        (pc.signalingState === "stable" || entry.isSettingRemoteAnswerPending);
      const offerCollision = description.type === "offer" && !readyForOffer;
      entry.ignoreOffer = !entry.polite && offerCollision;
      if (entry.ignoreOffer) return;

      try {
        if (offerCollision && pc.signalingState !== "stable") {
          await pc.setLocalDescription({ type: "rollback" });
        }
        entry.isSettingRemoteAnswerPending = description.type === "answer";
        await pc.setRemoteDescription(description);
        await flushCandidates(entry);
        if (description.type === "offer") {
          await pc.setLocalDescription();
          const local = pc.localDescription;
          if (local) {
            sendSignal(from, {
              kind: "sdp",
              description: {
                type: local.type as "offer" | "answer",
                sdp: local.sdp,
              },
            });
          }
        }
      } catch (error) {
        console.warn("[voice] gagal memproses SDP:", error);
      } finally {
        entry.isSettingRemoteAnswerPending = false;
      }
    },
    [flushCandidates, sendSignal]
  );

  const ensurePeer = useCallback(
    (peer: VoicePeerPublic): void => {
      if (peer.peerId === peerIdRef.current) return;
      peerDirectoryRef.current.set(peer.peerId, peer);

      const existing = entriesRef.current.get(peer.peerId);
      if (existing) return;
      if (!activeRef.current) return;

      const pc = new RTCPeerConnection({ iceServers: iceServersRef.current });
      // Pendengar tetap membangun koneksi WebRTC tanpa getUserMedia().
      // Transceiver ini menerima audio sekarang dan dapat berubah menjadi
      // sendrecv ketika pemain secara eksplisit menyalakan mikrofon.
      const audioTransceiver = pc.addTransceiver("audio", {
        direction: "recvonly",
      });
      const entry: PeerEntry = {
        pc,
        audioTransceiver,
        // ID yang lebih besar mengalah ketika dua browser mengirim offer
        // bersamaan (perfect negotiation).
        polite: peerIdRef.current > peer.peerId,
        makingOffer: false,
        ignoreOffer: false,
        isSettingRemoteAnswerPending: false,
        pendingCandidates: [],
        audio: null,
        audioSource: null,
        audioStream: null,
        analyser: null,
        buf: null,
      };
      entriesRef.current.set(peer.peerId, entry);
      updatePeerUi(peer.peerId, current => ({
        ...current,
        connectionState: pc.connectionState,
      }));

      pc.onnegotiationneeded = async () => {
        try {
          entry.makingOffer = true;
          await pc.setLocalDescription();
          const local = pc.localDescription;
          if (local) {
            sendSignal(peer.peerId, {
              kind: "sdp",
              description: {
                type: local.type as "offer" | "answer",
                sdp: local.sdp,
              },
            });
          }
        } catch (error) {
          console.warn("[voice] gagal membuat offer WebRTC:", error);
        } finally {
          entry.makingOffer = false;
        }
      };

      pc.onicecandidate = ({ candidate }) => {
        sendSignal(peer.peerId, {
          kind: "ice",
          candidate: candidate
            ? {
                candidate: candidate.candidate,
                sdpMid: candidate.sdpMid,
                sdpMLineIndex: candidate.sdpMLineIndex,
                usernameFragment:
                  (
                    candidate as RTCIceCandidate & {
                      usernameFragment?: string | null;
                    }
                  ).usernameFragment ?? null,
              }
            : null,
        });
      };

      pc.ontrack = event => {
        const remote = event.streams[0] ?? new MediaStream([event.track]);
        if (!entry.audio) {
          const audio = document.createElement("audio");
          audio.autoplay = true;
          audio.setAttribute("playsinline", "");
          audio.style.display = "none";
          document.body.appendChild(audio);
          entry.audio = audio;
        }
        if (entry.audio.srcObject !== remote) entry.audio.srcObject = remote;
        playRemoteAudio(entry.audio);

        if (entry.audioStream === remote) return;
        try {
          entry.audioSource?.disconnect();
          entry.analyser?.disconnect();
          entry.audioSource = null;
          entry.analyser = null;
          entry.buf = null;
          entry.audioStream = remote;
          const context = audioCtxRef.current;
          if (context) {
            const source = context.createMediaStreamSource(remote);
            const analyser = context.createAnalyser();
            analyser.fftSize = 512;
            source.connect(analyser);
            entry.audioSource = source;
            entry.analyser = analyser;
            entry.buf = new Uint8Array(analyser.fftSize);
          }
        } catch (error) {
          console.warn("[voice] indikator volume peer tidak tersedia:", error);
        }
      };

      pc.onconnectionstatechange = () => {
        if (entriesRef.current.get(peer.peerId) !== entry) return;
        updatePeerUi(peer.peerId, current => ({
          ...current,
          connectionState: pc.connectionState,
        }));
        if (pc.connectionState === "failed") {
          setConnectionState("failed");
          try {
            pc.restartIce();
          } catch {
            // Tombol "coba lagi" akan membangun ulang koneksi signaling.
          }
        }
      };

      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState !== "failed") return;
        try {
          pc.restartIce();
        } catch {
          // Browser lama tidak mendukung restartIce.
        }
      };

      attachLocalAudio(entry);

      const queued = deferredSignalsRef.current.get(peer.peerId);
      if (queued?.length) {
        deferredSignalsRef.current.delete(peer.peerId);
        void (async () => {
          for (const signal of queued) {
            await handleSignal(peer.peerId, signal);
          }
        })();
      }
    },
    [attachLocalAudio, handleSignal, playRemoteAudio, sendSignal, updatePeerUi]
  );

  const scheduleReconnect = useCallback(() => {
    if (!activeRef.current || reconnectTimerRef.current !== null) return;
    const attempt = reconnectAttemptRef.current + 1;
    reconnectAttemptRef.current = attempt;
    if (attempt > MAX_RECONNECT_ATTEMPTS) {
      setConnectionState("failed");
      toast.error(
        "Koneksi voice terputus. Tekan coba lagi untuk menyambungkan."
      );
      return;
    }

    setConnectionState("reconnecting");
    const delay = Math.min(
      10_000,
      RECONNECT_BASE_MS * 2 ** (attempt - 1) + Math.round(Math.random() * 250)
    );
    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null;
      connectRef.current();
    }, delay);
  }, []);

  const handleServerEvent = useCallback(
    async (event: VoiceServerEvent): Promise<void> => {
      if (!activeRef.current) return;

      switch (event.type) {
        case "ready": {
          clearJoinTimeout();
          reconnectAttemptRef.current = 0;
          iceServersRef.current = toRtcIceServers(event.iceServers);
          setConnectionState("connected");

          const remoteIds = new Set(event.peers.map(peer => peer.peerId));
          peerDirectoryRef.current.clear();
          for (const peer of event.peers)
            peerDirectoryRef.current.set(peer.peerId, peer);
          for (const peerId of [...entriesRef.current.keys()]) {
            if (!remoteIds.has(peerId)) destroyPeer(peerId);
          }
          syncPeersUi();
          for (const peer of event.peers) ensurePeer(peer);
          return;
        }
        case "peer-joined":
          peerDirectoryRef.current.set(event.peer.peerId, event.peer);
          syncPeersUi();
          ensurePeer(event.peer);
          return;
        case "peer-updated": {
          const peer = peerDirectoryRef.current.get(event.peerId);
          if (peer) {
            peerDirectoryRef.current.set(event.peerId, {
              ...peer,
              muted: event.muted,
            });
            syncPeersUi();
          }
          return;
        }
        case "peer-left":
          peerDirectoryRef.current.delete(event.peerId);
          deferredSignalsRef.current.delete(event.peerId);
          destroyPeer(event.peerId);
          syncPeersUi();
          return;
        case "signal":
          await handleSignal(event.from, event.data);
          return;
        case "error":
          if (event.code === "peer-unavailable") {
            toast.info(event.message);
            return;
          }
          setConnectionState("failed");
          toast.error(event.message);
          stopRef.current();
          return;
      }
    },
    [clearJoinTimeout, destroyPeer, ensurePeer, handleSignal, syncPeersUi]
  );
  useEffect(() => {
    handleServerEventRef.current = handleServerEvent;
  }, [handleServerEvent]);

  const connect = useCallback(() => {
    if (!activeRef.current) return;
    const current = socketRef.current;
    if (
      current &&
      (current.readyState === WebSocket.CONNECTING ||
        current.readyState === WebSocket.OPEN)
    ) {
      return;
    }

    let socket: WebSocket;
    try {
      socket = new WebSocket(getSocketUrl());
    } catch (error) {
      console.warn("[voice] WebSocket tidak dapat dibuat:", error);
      scheduleReconnect();
      return;
    }
    socketRef.current = socket;

    socket.onopen = () => {
      if (!activeRef.current || socketRef.current !== socket) {
        socket.close(1000, "voice-stopped");
        return;
      }
      sendClientEvent({
        type: "join",
        code: optsRef.current.code,
        peerId: peerIdRef.current,
        muted: mutedRef.current,
      });
      clearJoinTimeout();
      joinTimeoutRef.current = window.setTimeout(() => {
        if (socketRef.current === socket) {
          socket.close(4002, "voice-join-timeout");
        }
      }, JOIN_TIMEOUT_MS);
    };

    socket.onmessage = ({ data }) => {
      const event = parseServerEvent(data);
      if (!event) {
        console.warn("[voice] event server tidak valid.");
        return;
      }
      messageQueueRef.current = messageQueueRef.current
        .then(() => handleServerEventRef.current(event))
        .catch((error: unknown) => {
          console.warn("[voice] gagal memproses event server:", error);
        });
    };

    socket.onerror = () => {
      // Event close menangani retry; browser sengaja tidak memberi detail error.
    };

    socket.onclose = ({ code: closeCode, reason }) => {
      if (socketRef.current !== socket) return;
      socketRef.current = null;
      clearJoinTimeout();
      if (!activeRef.current) return;
      if (closeCode === 4000 && reason === "replaced-by-new-session") {
        toast.info("Voice chat dipindahkan ke tab lain.");
        stopRef.current();
        return;
      }
      if (closeCode === 4001 && reason === "room-closed") {
        toast.info("Room sudah ditutup.");
        stopRef.current();
        return;
      }

      destroyAllPeers();
      setPeers(previous =>
        previous.map(peer => ({
          ...peer,
          speaking: false,
          connectionState: "closed",
        }))
      );
      scheduleReconnect();
    };
  }, [clearJoinTimeout, destroyAllPeers, scheduleReconnect, sendClientEvent]);
  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  const startMeter = useCallback(() => {
    if (audioCtxRef.current) return;
    const context = new AudioContext();
    audioCtxRef.current = context;
    void context.resume().catch(() => {});

    const stream = streamRef.current;
    if (stream) {
      try {
        const source = context.createMediaStreamSource(stream);
        const analyser = context.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        selfSrcRef.current = source;
        selfAnalyserRef.current = analyser;
        selfBufRef.current = new Uint8Array(analyser.fftSize);
      } catch (error) {
        console.warn(
          "[voice] indikator volume mikrofon tidak tersedia:",
          error
        );
      }
    }

    const isSpeaking = (
      analyser: AnalyserNode | null,
      buffer: Uint8Array<ArrayBuffer> | null
    ): boolean => {
      if (!analyser || !buffer) return false;
      analyser.getByteTimeDomainData(buffer);
      let sum = 0;
      const step = 4;
      for (let index = 0; index < buffer.length; index += step) {
        const value = (buffer[index] - 128) / 128;
        sum += value * value;
      }
      return Math.sqrt(sum / (buffer.length / step)) > 0.02;
    };

    meterTimerRef.current = window.setInterval(() => {
      const selfSpeaking =
        !mutedRef.current &&
        isSpeaking(selfAnalyserRef.current, selfBufRef.current);
      setSpeakingSelf(previous =>
        previous === selfSpeaking ? previous : selfSpeaking
      );
      setPeers(previous => {
        let changed = false;
        const next = previous.map(peer => {
          const entry = entriesRef.current.get(peer.peerId);
          const speaking =
            !peer.muted &&
            isSpeaking(entry?.analyser ?? null, entry?.buf ?? null);
          if (speaking !== peer.speaking) changed = true;
          return speaking === peer.speaking ? peer : { ...peer, speaking };
        });
        return changed ? next : previous;
      });
    }, 250);
  }, []);

  const stopMedia = useCallback(() => {
    if (meterTimerRef.current !== null) {
      window.clearInterval(meterTimerRef.current);
      meterTimerRef.current = null;
    }
    try {
      selfSrcRef.current?.disconnect();
      selfAnalyserRef.current?.disconnect();
    } catch {
      // Audio graph sudah dibersihkan.
    }
    selfSrcRef.current = null;
    selfAnalyserRef.current = null;
    selfBufRef.current = null;
    const context = audioCtxRef.current;
    audioCtxRef.current = null;
    if (context && context.state !== "closed") {
      void context.close().catch(() => {});
    }
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
  }, []);

  const stop = useCallback((userInitiated = true) => {
    if (userInitiated) leftByUserRef.current = true;
    operationRef.current += 1;
    activeRef.current = false;
    startingRef.current = false;
    clearJoinTimeout();
    clearReconnectTimer();

    const socket = socketRef.current;
    socketRef.current = null;
    if (socket) {
      try {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "leave" }));
        }
        socket.close(1000, "voice-stopped");
      } catch {
        // Socket mungkin telah ditutup oleh jaringan.
      }
    }

    destroyAllPeers();
    stopMedia();
    peerDirectoryRef.current.clear();
    deferredSignalsRef.current.clear();
    iceServersRef.current = [];
    reconnectAttemptRef.current = 0;
    setActive(false);
    setStarting(false);
    setMuted(false);
    setHasMicrophone(false);
    setSpeakingSelf(false);
    setPeers([]);
    setConnectionState("idle");
    mutedRef.current = false;
  }, [clearJoinTimeout, clearReconnectTimer, destroyAllPeers, stopMedia]);
  useEffect(() => {
    stopRef.current = stop;
  }, [stop]);

  const joinListening = useCallback(() => {
    if (activeRef.current || startingRef.current || leftByUserRef.current) {
      return;
    }
    if (seat === null || !code || !enabled) return;

    // Jangan minta getUserMedia di sini. Peserta langsung bergabung sebagai
    // pendengar sehingga tetap dapat menerima audio dari mic pemain lain.
    mutedRef.current = true;
    activeRef.current = true;
    setMuted(true);
    setActive(true);
    setConnectionState("connecting");
    connectRef.current();
  }, [code, enabled, seat]);

  const start = useCallback(async () => {
    if (startingRef.current) return;
    if (seat === null || !code || !enabled) {
      toast.error("Hanya pemain dalam room yang dapat memakai voice chat.");
      return;
    }
    leftByUserRef.current = false;

    // Jika sudah memiliki stream, tombol ini berfungsi sebagai jalur aman
    // untuk menyalakan kembali mic yang sebelumnya dibisukan.
    if (streamRef.current) {
      mutedRef.current = false;
      streamRef.current.getAudioTracks().forEach(track => {
        track.enabled = true;
      });
      setMuted(false);
      setHasMicrophone(true);
      attachLocalAudio();
      sendClientEvent({ type: "mute", muted: false });
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error("Browser ini tidak mendukung akses mikrofon.");
      return;
    }

    const operation = operationRef.current + 1;
    operationRef.current = operation;
    startingRef.current = true;
    setStarting(true);
    // Mode dengar mungkin sudah tersambung saat pemain baru menyalakan mic.
    // Jangan timpa status `connected` dengan `connecting`: tidak ada socket
    // baru pada jalur ini, sehingga indikator loading sebelumnya berputar
    // permanen walaupun izin mic dan signaling sudah berhasil.
    if (!activeRef.current) setConnectionState("connecting");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (operationRef.current !== operation || !startingRef.current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }

      streamRef.current = stream;
      mutedRef.current = false;
      setMuted(false);
      setHasMicrophone(true);
      startMeter();
      attachLocalAudio();

      if (activeRef.current) {
        // Listener sudah tersambung ketika izin mic diberikan. Umumkan
        // perubahan status dan negosiasikan sender ke semua peer yang ada.
        sendClientEvent({ type: "mute", muted: false });
      } else {
        activeRef.current = true;
        setActive(true);
        setConnectionState("connecting");
        connectRef.current();
      }
    } catch (error) {
      if (operationRef.current === operation) {
        console.warn("[voice] akses mikrofon gagal:", error);
        if (!activeRef.current) setConnectionState("idle");
        toast.error(
          "Tidak bisa mengakses mikrofon. Izinkan akses mic lalu coba lagi."
        );
      }
    } finally {
      if (operationRef.current === operation) {
        startingRef.current = false;
        setStarting(false);
      }
    }
  }, [
    attachLocalAudio,
    code,
    enabled,
    seat,
    sendClientEvent,
    startMeter,
  ]);

  const reconnect = useCallback(() => {
    if (!activeRef.current || startingRef.current) return;
    clearJoinTimeout();
    clearReconnectTimer();
    reconnectAttemptRef.current = 0;
    setConnectionState("reconnecting");

    const socket = socketRef.current;
    socketRef.current = null;
    if (socket) {
      try {
        socket.close(4002, "voice-reconnect");
      } catch {
        // Tidak perlu menunggu socket lama.
      }
    }
    destroyAllPeers();
    setPeers(previous =>
      previous.map(peer => ({
        ...peer,
        speaking: false,
        connectionState: "new",
      }))
    );
    connectRef.current();
  }, [clearJoinTimeout, clearReconnectTimer, destroyAllPeers]);

  const toggleMute = useCallback(() => {
    if (!activeRef.current || !streamRef.current) return;
    setMuted(previous => {
      const next = !previous;
      mutedRef.current = next;
      streamRef.current?.getAudioTracks().forEach(track => {
        track.enabled = !next;
      });
      sendClientEvent({ type: "mute", muted: next });
      return next;
    });
  }, [sendClientEvent]);

  // Bila React memakai kembali instance halaman room untuk kode baru, tutup
  // mic/socket room lama sebelum bergabung ke room selanjutnya.
  const previousCodeRef = useRef(code);
  useEffect(() => {
    if (previousCodeRef.current === code) return;
    previousCodeRef.current = code;
    peerIdRef.current = makePeerId();
    stopRef.current(false);
    leftByUserRef.current = false;
  }, [code]);

  useEffect(() => {
    if (!enabled || seat === null) {
      stopRef.current(false);
      return;
    }
    leftByUserRef.current = false;
  }, [enabled, seat]);

  useEffect(() => {
    if (!enabled || seat === null || leftByUserRef.current) return;
    joinListening();
  }, [enabled, joinListening, seat]);

  useEffect(() => {
    if (!active) return;
    const resume = () => resumeRemoteAudio();
    window.addEventListener("pointerdown", resume, { capture: true });
    window.addEventListener("keydown", resume, { capture: true });
    return () => {
      window.removeEventListener("pointerdown", resume, { capture: true });
      window.removeEventListener("keydown", resume, { capture: true });
    };
  }, [active, resumeRemoteAudio]);

  useEffect(() => () => stopRef.current(false), []);

  const bySeat = useMemo(() => {
    const result = new Map<number, { speaking: boolean; muted: boolean }>();
    for (const peer of peers) {
      result.set(peer.seat, {
        speaking: peer.speaking,
        muted: peer.muted,
      });
    }
    return result;
  }, [peers]);

  return {
    active,
    starting,
    muted,
    hasMicrophone,
    connectionState,
    peers,
    speakingSelf,
    bySeat,
    start,
    stop,
    reconnect,
    toggleMute,
  };
}

export type VoiceChat = ReturnType<typeof useVoiceChat>;

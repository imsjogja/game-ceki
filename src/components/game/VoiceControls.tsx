import {
  Headphones,
  Loader2,
  Mic,
  MicOff,
  PhoneOff,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { VoiceChat } from "@/hooks/useVoiceChat";

/**
 * Pill kontrol voice chat — mengambang di pojok kanan bawah layar,
 * di luar kanvas meja sehingga ukurannya tetap di semua rasio layar.
 */
export function VoiceControls({ voice }: { voice: VoiceChat }) {
  const {
    active,
    starting,
    muted,
    connectionState,
    peers,
    speakingSelf,
    start,
    stop,
    reconnect,
    toggleMute,
  } = voice;

  const statusText =
    connectionState === "connecting"
      ? "MENYAMBUNGKAN…"
      : connectionState === "reconnecting"
        ? "MENYAMBUNGKAN ULANG…"
        : connectionState === "failed"
          ? "KONEKSI VOICE GAGAL"
          : null;

  if (!active) {
    return (
      <button
        onClick={() => void start()}
        disabled={starting}
        title="Ngobrol suara dengan pemain lain di room ini"
        className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full bg-black/80 py-2 pl-3 pr-4 text-[#f5c036] ring-1 ring-[#f5c036]/40 backdrop-blur-sm transition hover:bg-black/90 hover:ring-[#f5c036] disabled:opacity-60"
      >
        {starting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Mic className="h-4 w-4" />
        )}
        <span className="font-display text-sm tracking-wide">
          {starting ? "MENYAMBUNGKAN…" : "VOICE CHAT"}
        </span>
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 flex max-w-[calc(100vw-2rem)] items-center gap-1.5 rounded-full bg-black/85 p-1.5 ring-1 ring-emerald-400/40 backdrop-blur-sm">
      {/* mic saya */}
      <button
        onClick={toggleMute}
        title={muted ? "Nyalakan mikrofon" : "Bisukan mikrofon"}
        className={cn(
          "flex h-9 w-9 items-center justify-center rounded-full transition",
          muted
            ? "bg-[#c10328] text-white hover:bg-[#d91a42]"
            : "bg-[#286e44] text-[#FEFEEE] hover:bg-[#2f7f50]",
          speakingSelf && !muted && "speaking-glow"
        )}
      >
        {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
      </button>

      {statusText && (
        <span
          className={cn(
            "flex items-center gap-1 whitespace-nowrap px-1 font-display text-[10px] tracking-wide",
            connectionState === "failed" ? "text-[#e0707f]" : "text-[#f5c036]"
          )}
        >
          {connectionState !== "failed" && (
            <Loader2 className="h-3 w-3 animate-spin" />
          )}
          {statusText}
        </span>
      )}
      {connectionState === "failed" && (
        <button
          onClick={reconnect}
          title="Coba sambungkan ulang voice chat"
          className="flex h-8 items-center gap-1 rounded-full bg-[#c10328]/85 px-2 text-[10px] font-semibold text-white transition hover:bg-[#d91a42]"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          COBA LAGI
        </button>
      )}

      {/* peserta lain */}
      {peers.length === 0 && connectionState === "connected" && (
        <span className="px-2 text-[10px] text-white/40">
          menunggu pemain lain bergabung…
        </span>
      )}
      {peers.map(p => (
        <div
          key={p.peerId}
          title={`${p.name}${p.muted ? " (mic mati)" : ""} — koneksi ${p.connectionState}`}
          className={cn(
            "relative rounded-full transition",
            p.speaking && !p.muted && "speaking-glow"
          )}
        >
          {p.avatar ? (
            <img
              src={p.avatar}
              alt={p.name}
              className="h-9 w-9 rounded-full object-cover ring-1 ring-white/20"
            />
          ) : (
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#3a3a35] font-display text-sm text-white/85 ring-1 ring-white/20">
              {p.name[0]?.toUpperCase()}
            </span>
          )}
          {p.muted && (
            <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#c10328] ring-1 ring-black/60">
              <MicOff className="h-2 w-2 text-white" />
            </span>
          )}
        </div>
      ))}

      <span
        title="Gunakan headset untuk mencegah suara speaker masuk kembali ke mikrofon."
        className="hidden h-9 w-6 items-center justify-center text-white/35 sm:flex"
      >
        <Headphones className="h-4 w-4" />
      </span>

      {/* keluar voice */}
      <button
        onClick={stop}
        title="Keluar voice chat"
        className="flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white/60 ring-1 ring-white/15 transition hover:text-[#e0707f] hover:ring-[#c10328]/60"
      >
        <PhoneOff className="h-4 w-4" />
      </button>
    </div>
  );
}

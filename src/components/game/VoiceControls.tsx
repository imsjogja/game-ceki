import { Mic, MicOff, PhoneOff, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { VoiceChat } from "@/hooks/useVoiceChat";

/**
 * Pill kontrol voice chat — mengambang di pojok kanan bawah layar,
 * di luar kanvas meja sehingga ukurannya tetap di semua rasio layar.
 */
export function VoiceControls({ voice }: { voice: VoiceChat }) {
  const { active, starting, muted, peers, speakingSelf, start, stop, toggleMute } =
    voice;

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
    <div className="fixed bottom-4 right-4 z-50 flex items-center gap-1.5 rounded-full bg-black/85 p-1.5 ring-1 ring-emerald-400/40 backdrop-blur-sm">
      {/* mic saya */}
      <button
        onClick={toggleMute}
        title={muted ? "Nyalakan mikrofon" : "Bisukan mikrofon"}
        className={cn(
          "flex h-9 w-9 items-center justify-center rounded-full transition",
          muted
            ? "bg-[#c10328] text-white hover:bg-[#d91a42]"
            : "bg-[#286e44] text-[#FEFEEE] hover:bg-[#2f7f50]",
          speakingSelf && !muted && "speaking-glow",
        )}
      >
        {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
      </button>

      {/* peserta lain */}
      {peers.length === 0 && (
        <span className="px-2 text-[10px] text-white/40">
          menunggu pemain lain bergabung…
        </span>
      )}
      {peers.map((p) => (
        <div
          key={p.peerId}
          title={`${p.name}${p.muted ? " (mic mati)" : ""}`}
          className={cn(
            "relative rounded-full transition",
            p.speaking && !p.muted && "speaking-glow",
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

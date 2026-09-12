import * as Popover from "@radix-ui/react-popover";
import {
  Headphones,
  Loader2,
  Mic,
  MicOff,
  PhoneOff,
  RefreshCw,
  UsersRound,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { VoiceChat } from "@/hooks/useVoiceChat";

type VoiceState = Pick<
  VoiceChat,
  | "active"
  | "starting"
  | "muted"
  | "connectionState"
  | "peers"
  | "speakingSelf"
  | "start"
  | "stop"
  | "reconnect"
  | "toggleMute"
>;

function connectionLabel(voice: VoiceState) {
  switch (voice.connectionState) {
    case "connecting":
      return "MENYAMBUNGKAN…";
    case "reconnecting":
      return "MENYAMBUNGKAN ULANG…";
    case "failed":
      return "KONEKSI VOICE GAGAL";
    case "connected":
      return voice.peers.length > 0
        ? `${voice.peers.length + 1} PEMAIN DI VOICE`
        : "MENUNGGU PEMAIN LAIN";
    default:
      return "VOICE BELUM AKTIF";
  }
}

function VoiceIcon({
  voice,
  className,
}: {
  voice: VoiceState;
  className?: string;
}) {
  if (
    voice.starting ||
    voice.connectionState === "connecting" ||
    voice.connectionState === "reconnecting"
  ) {
    return <Loader2 className={cn("animate-spin", className)} />;
  }
  if (voice.muted) return <MicOff className={className} />;
  return <Mic className={className} />;
}

function VoicePanel({ voice }: { voice: VoiceState }) {
  const status = connectionLabel(voice);
  const failed = voice.connectionState === "failed";

  return (
    <div className="voice-panel w-[min(19rem,calc(100vw-2rem))] text-[#FEFEEE]">
      <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 pb-3 pt-4">
        <div>
          <p className="font-display text-xl tracking-wide text-[#f5c036]">
            VOICE CHAT
          </p>
          <p
            aria-live="polite"
            className={cn(
              "mt-0.5 text-[10px] font-semibold tracking-[0.14em]",
              failed ? "text-[#e0707f]" : "text-white/45"
            )}
          >
            {status}
          </p>
        </div>
        {voice.active && (
          <span className="flex items-center gap-1 rounded-full bg-[#286e44]/25 px-2 py-1 text-[10px] font-bold text-[#7fd4a4] ring-1 ring-[#286e44]/60">
            <UsersRound className="h-3 w-3" />
            {voice.peers.length + 1}
          </span>
        )}
      </div>

      <div className="space-y-3 px-4 py-4">
        {voice.active ? (
          <>
            <button
              type="button"
              onClick={voice.toggleMute}
              className={cn(
                "flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left transition",
                voice.muted
                  ? "bg-[#c10328]/20 text-white ring-1 ring-[#c10328]/60 hover:bg-[#c10328]/30"
                  : "bg-[#286e44]/25 text-[#FEFEEE] ring-1 ring-[#286e44]/70 hover:bg-[#286e44]/40",
                voice.speakingSelf && !voice.muted && "speaking-glow"
              )}
            >
              <span
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                  voice.muted ? "bg-[#c10328]" : "bg-[#286e44]"
                )}
              >
                <VoiceIcon voice={voice} className="h-4 w-4" />
              </span>
              <span>
                <span className="block text-sm font-semibold">
                  {voice.muted ? "Mikrofon dibisukan" : "Mikrofon menyala"}
                </span>
                <span className="block text-xs text-white/50">
                  Ketuk untuk {voice.muted ? "menyalakan" : "membisukan"} mic
                </span>
              </span>
            </button>

            {voice.peers.length > 0 ? (
              <div>
                <p className="mb-2 text-[10px] font-bold tracking-[0.16em] text-white/40">
                  PESERTA
                </p>
                <div className="space-y-1.5">
                  {voice.peers.map(peer => (
                    <div
                      key={peer.peerId}
                      className={cn(
                        "flex items-center gap-2 rounded-lg bg-black/25 px-2.5 py-2 ring-1 ring-white/5",
                        peer.speaking && !peer.muted && "speaking-glow"
                      )}
                    >
                      {peer.avatar ? (
                        <img
                          src={peer.avatar}
                          alt=""
                          className="h-7 w-7 rounded-full object-cover ring-1 ring-white/20"
                        />
                      ) : (
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#3a3a35] font-display text-sm text-white/85 ring-1 ring-white/20">
                          {peer.name[0]?.toUpperCase()}
                        </span>
                      )}
                      <span className="min-w-0 flex-1 truncate text-xs font-medium">
                        {peer.name}
                      </span>
                      {peer.muted ? (
                        <MicOff className="h-3.5 w-3.5 text-[#e0707f]" />
                      ) : (
                        <Mic className="h-3.5 w-3.5 text-[#7fd4a4]" />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="rounded-lg bg-black/25 px-3 py-2.5 text-xs leading-relaxed text-white/50 ring-1 ring-white/5">
                Belum ada pemain lain di voice chat. Kontrol ini tetap ringkas
                agar meja dan kartu tidak tertutup.
              </div>
            )}

            {failed && (
              <button
                type="button"
                onClick={voice.reconnect}
                className="flex min-h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#c10328]/85 px-3 text-xs font-bold text-white transition hover:bg-[#d91a42]"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                COBA SAMBUNGKAN ULANG
              </button>
            )}

            <div className="flex items-center justify-between gap-3 pt-1">
              <span
                title="Gunakan headset agar suara speaker tidak masuk kembali ke mikrofon."
                className="flex items-center gap-1.5 text-[10px] text-white/35"
              >
                <Headphones className="h-3.5 w-3.5" /> Pakai headset
              </span>
              <button
                type="button"
                onClick={voice.stop}
                className="flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-white/55 transition hover:bg-[#c10328]/15 hover:text-[#e0707f]"
              >
                <PhoneOff className="h-3.5 w-3.5" /> Keluar voice
              </button>
            </div>
          </>
        ) : (
          <button
            type="button"
            onClick={() => void voice.start()}
            disabled={voice.starting}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#286e44] px-4 text-sm font-bold text-[#FEFEEE] transition hover:bg-[#2f7f50] disabled:cursor-wait disabled:opacity-60"
          >
            <VoiceIcon voice={voice} className="h-4 w-4" />
            {voice.starting ? "MENYAMBUNGKAN…" : "NYALAKAN VOICE CHAT"}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Rail vertikal untuk desktop. Lajur meja di sebelah kiri dicadangkan lewat
 * CSS agar dock tidak pernah menutup kartu tangan, deck, atau tombol giliran.
 */
export function VoiceControls({ voice }: { voice: VoiceChat }) {
  const playerCount = voice.active ? voice.peers.length + 1 : 0;

  return (
    <div className="voice-desktop-dock">
      <div className="voice-dock-rail">
        <button
          type="button"
          onClick={() => {
            if (voice.active) voice.toggleMute();
            else if (!voice.starting) void voice.start();
          }}
          disabled={voice.starting}
          title={
            voice.active
              ? voice.muted
                ? "Nyalakan mikrofon"
                : "Bisukan mikrofon"
              : "Nyalakan voice chat"
          }
          aria-label={
            voice.active
              ? voice.muted
                ? "Nyalakan mikrofon"
                : "Bisukan mikrofon"
              : "Nyalakan voice chat"
          }
          className={cn(
            "voice-dock-trigger",
            voice.active ? (voice.muted ? "is-muted" : "is-active") : "is-idle",
            voice.speakingSelf && !voice.muted && "speaking-glow"
          )}
        >
          <VoiceIcon voice={voice} className="h-5 w-5" />
          <span className="voice-dock-label">
            {voice.active ? (voice.muted ? "MIC MATI" : "MIC ON") : "VOICE"}
          </span>
          {voice.active && !voice.muted && (
            <span className="voice-dock-live" aria-hidden />
          )}
        </button>

        <Popover.Root>
          <Popover.Trigger asChild>
            <button
              type="button"
              title="Buka detail voice chat"
              aria-label="Buka detail voice chat"
              className="voice-dock-details"
            >
              <UsersRound className="h-4 w-4" />
              <span className="voice-dock-detail-count">
                {voice.active ? playerCount : "…"}
              </span>
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              side="right"
              align="center"
              sideOffset={14}
              collisionPadding={16}
              className="z-[60] rounded-xl border border-[#f5c036]/25 bg-[#1c1812]/95 shadow-2xl backdrop-blur-md outline-none data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
            >
              <VoicePanel voice={voice} />
              <Popover.Arrow className="fill-[#1c1812]" />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>
    </div>
  );
}

/**
 * Trigger khusus viewport compact. Ia tinggal di header dan membuka bottom
 * sheet sehingga tidak ada kontrol tetap yang melapisi tangan pemain.
 */
export function VoiceHeaderControl({
  voice,
  className,
}: {
  voice: VoiceChat;
  className?: string;
}) {
  const playerCount = voice.active ? voice.peers.length + 1 : 0;

  return (
    <Sheet>
      <SheetTrigger asChild>
        <button
          type="button"
          onClick={() => {
            if (!voice.active && !voice.starting) void voice.start();
          }}
          disabled={voice.starting}
          title="Voice chat"
          aria-label="Buka kontrol voice chat"
          className={cn(
            "voice-header-control relative h-8 gap-1.5 text-white/70 hover:text-[#f5c036]",
            voice.active && !voice.muted && "text-[#7fd4a4]",
            voice.muted && "text-[#e0707f]",
            className
          )}
        >
          <VoiceIcon voice={voice} className="h-4 w-4" />
          <span className="game-header-label">Voice</span>
          {voice.active && (
            <span className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-[#f5c036] px-0.5 font-num text-[8px] font-bold text-[#1a150a] ring-1 ring-black/40">
              {playerCount}
            </span>
          )}
        </button>
      </SheetTrigger>
      <SheetContent
        side="bottom"
        className="voice-mobile-sheet rounded-t-2xl border-[#f5c036]/30 bg-[#1c1812] p-0 text-[#FEFEEE]"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>Voice chat</SheetTitle>
        </SheetHeader>
        <VoicePanel voice={voice} />
      </SheetContent>
    </Sheet>
  );
}

/** Kontrol mobile untuk lobby; game memakai VoiceHeaderControl di header meja. */
export function LobbyVoiceControl({ voice }: { voice: VoiceChat }) {
  return (
    <div className="voice-lobby-mobile">
      <VoiceHeaderControl voice={voice} />
    </div>
  );
}

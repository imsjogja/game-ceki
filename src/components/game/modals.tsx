import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { PlayingCard } from "@/components/game/PlayingCard";
import { Trophy, RefreshCw, Home, ArrowRight, Flame, Loader2 } from "lucide-react";
import type { ClientState, CardCode, SessionReason } from "@contracts/rummy";

function PlayerMini({ state, seat }: { state: ClientState; seat: number }) {
  const p = state.players.find((x) => x.seat === seat);
  if (!p) return null;
  return (
    <div className="flex items-center gap-2">
      {p.avatar ? (
        <img src={p.avatar} alt="" className="h-7 w-7 rounded-full object-cover" />
      ) : (
        <span className={`flex h-7 w-7 items-center justify-center rounded-full font-display text-sm ${p.isBot ? "bg-[#3a3a35]" : "bg-[#286e44]"}`}>
          {p.name[0]?.toUpperCase()}
        </span>
      )}
      <span className="truncate text-sm font-semibold">{p.name}</span>
    </div>
  );
}

function reasonTitle(state: ClientState): { title: string; sub: string } {
  const r = state.roundResult;
  if (!r) return { title: "SESI BERAKHIR", sub: "" };
  const closer = r.winnerSeat !== null ? state.players.find((p) => p.seat === r.winnerSeat) : null;
  switch (r.reason as SessionReason) {
    case "tutup":
      return { title: `${closer?.name ?? ""} TUTUP TANGAN!`, sub: "+250 poin tutup" };
    case "tutupJoker":
      return { title: `${closer?.name ?? ""} TUTUP DENGAN JOKER!`, sub: "+500 poin tutup joker" };
    case "jokerDiscarded":
      return { title: "JOKER DIBUANG!", sub: "Sesi berakhir seketika" };
    case "deckOut":
      return { title: "DECK HABIS!", sub: "Sesi berakhir tanpa penutup" };
  }
}

export function RoundEndModal({
  state,
  isPlayer,
  onNext,
  pending,
  open,
  onClose,
}: {
  state: ClientState;
  isPlayer: boolean;
  onNext: () => void;
  pending: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const r = state.roundResult;
  if (!r) return null;
  const { title, sub } = reasonTitle(state);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-h-[88vh] overflow-y-auto border-[#f5c036]/40 bg-[#1c1812] text-[#FEFEEE] sm:max-w-2xl"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="text-center">
            <span className="font-display text-4xl tracking-wide text-[#f5c036] text-gold-glow">
              {title}
            </span>
            <span className="mt-1 block font-num text-sm font-normal text-white/60">
              {sub}
            </span>
          </DialogTitle>
        </DialogHeader>

        {/* rincian skor tiap pemain */}
        <div className="space-y-3">
          {r.deltas.map((d) => {
            const p = state.players.find((x) => x.seat === d.seat);
            const isCloser = d.seat === r.winnerSeat;
            return (
              <div
                key={d.seat}
                className={`rounded-lg border p-3 ${
                  isCloser
                    ? "border-[#f5c036]/60 bg-[#f5c036]/10"
                    : "border-white/10 bg-black/30"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <PlayerMini state={state} seat={d.seat} />
                  <div className="text-right">
                    <span
                      className={`font-num text-lg font-bold ${
                        d.delta >= 0 ? "text-[#7fd4a4]" : "text-[#e0707f]"
                      }`}
                    >
                      {d.delta >= 0 ? "+" : ""}{d.delta}
                    </span>
                    {d.tersalip && (
                      <span className="ml-2 inline-flex items-center gap-1 rounded bg-[#c10328]/30 px-1.5 py-0.5 text-[10px] font-bold text-[#e0707f]">
                        <Flame className="h-3 w-3" /> TERSALIP → 0
                      </span>
                    )}
                  </div>
                </div>
                <p className="mt-1 font-num text-[11px] text-white/50">
                  jadi +{d.meldPlus} · tangan −{d.handMinus}
                  {d.bonus > 0 && ` · bonus +${d.bonus}`}
                  {"  →  skor "}
                  <span className="font-bold text-[#f5c036]">{d.newScore}</span>
                </p>
                {p?.hand && p.hand.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {p.hand.map((c, i) => (
                      <PlayingCard key={`${c}-${i}`} code={c as CardCode} size="xs" />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Skor sementara */}
        <div className="rounded-lg bg-black/30 p-3">
          <p className="mb-2 text-center text-[10px] font-semibold tracking-[0.25em] text-white/40">
            SKOR — TARGET {state.targetScore}
          </p>
          <div className="flex justify-center gap-6">
            {[...state.players]
              .sort((a, b) => b.score - a.score)
              .map((p) => (
                <div key={p.seat} className="text-center">
                  <div className="font-num text-2xl font-bold text-[#FEFEEE]">{p.score}</div>
                  <div className="max-w-20 truncate text-[11px] text-white/50">{p.name}</div>
                </div>
              ))}
          </div>
        </div>

        {isPlayer ? (
          <button onClick={onNext} disabled={pending} className="btn-gold h-12 w-full disabled:opacity-60">
            {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : <ArrowRight className="h-5 w-5" />}
            {pending ? "MEMULAI SESI…" : "SESI BERIKUTNYA"}
          </button>
        ) : (
          <p className="text-center text-sm text-white/40">Menunggu pemain melanjutkan...</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function GameEndModal({
  state,
  isPlayer,
  onRematch,
  onHome,
  pending,
  open,
  onClose,
}: {
  state: ClientState;
  isPlayer: boolean;
  onRematch: () => void;
  onHome: () => void;
  pending: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const champion = state.players.find((p) => p.seat === state.winnerSeat);
  const standings = [...state.players].sort((a, b) => b.score - a.score);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="border-[#f5c036]/40 bg-[#1c1812] text-[#FEFEEE] sm:max-w-lg"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="text-center">
            <Trophy className="mx-auto h-10 w-10 text-[#f5c036]" />
            <span className="mt-2 block font-display text-5xl tracking-wide text-[#f5c036] text-gold-glow">
              {champion?.name}
            </span>
            <span className="mt-1 block font-display text-xl tracking-wide text-white/70">
              MENEMBUS {state.targetScore} POIN — MENANG!
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-2">
          {standings.map((p, i) => (
            <div
              key={p.seat}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 ${
                i === 0 ? "bg-[#f5c036]/15 ring-1 ring-[#f5c036]/50" : "bg-black/30"
              }`}
            >
              <span className={`font-num w-6 text-center text-lg font-bold ${i === 0 ? "text-[#f5c036]" : "text-white/40"}`}>
                {i + 1}
              </span>
              <PlayerMini state={state} seat={p.seat} />
              <span className="ml-auto font-num text-xl font-bold text-[#FEFEEE]">{p.score}</span>
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          {isPlayer && (
            <button onClick={onRematch} disabled={pending} className="btn-gold h-12 flex-1 disabled:opacity-60">
              {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : <RefreshCw className="h-5 w-5" />}
              {pending ? "MENYIAPKAN…" : "MAIN LAGI"}
            </button>
          )}
          <button onClick={onHome} className="btn-stitch h-12 flex-1">
            <Home className="h-4 w-4" /> BERANDA
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ScoreboardDialog({
  state,
  open,
  onClose,
}: {
  state: ClientState;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="border-[#f5c036]/40 bg-[#1c1812] text-[#FEFEEE] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-3xl tracking-wide text-[#f5c036]">
            PAPAN SKOR — TARGET {state.targetScore}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          {[...state.players]
            .sort((a, b) => b.score - a.score)
            .map((p, i) => (
              <div key={p.seat} className="flex items-center gap-3 rounded-lg bg-black/30 px-3 py-2">
                <span className={`font-num w-5 text-center font-bold ${i === 0 ? "text-[#f5c036]" : "text-white/40"}`}>
                  {i + 1}
                </span>
                <PlayerMini state={state} seat={p.seat} />
                <span className="ml-auto font-num text-xs text-white/40">
                  sesi ini +{p.meldPlus}
                </span>
                <span className="font-num text-lg font-bold">{p.score}</span>
              </div>
            ))}
        </div>
        {state.roundHistory.length > 0 && (
          <div className="mt-2">
            <p className="mb-1.5 text-[10px] font-semibold tracking-[0.25em] text-white/40">
              RIWAYAT SESI
            </p>
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {[...state.roundHistory].reverse().map((r) => (
                <div key={r.round} className="flex items-center justify-between gap-2 rounded bg-white/[0.04] px-2.5 py-1.5 text-xs">
                  <span className="shrink-0 text-white/50">Sesi {r.round}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{r.label}</span>
                  <span className="flex shrink-0 gap-1.5 font-num">
                    {r.deltas.map((d) => (
                      <span
                        key={d.seat}
                        className={d.delta >= 0 ? "text-[#7fd4a4]" : "text-[#e0707f]"}
                      >
                        {d.delta >= 0 ? "+" : ""}{d.delta}
                      </span>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

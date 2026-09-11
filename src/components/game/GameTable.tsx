import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Reorder } from "framer-motion";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { PlayingCard, SuitIcon } from "@/components/game/PlayingCard";
import { RoundEndModal, GameEndModal, ScoreboardDialog } from "@/components/game/modals";
import { Logo } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger,
} from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  validateMeld, findMelds, isJoker, sortHand,
  TURN_TIMEOUT_MS, type CardCode, type ClientState, type ClientPlayer,
} from "@contracts/rummy";
import { cn } from "@/lib/utils";
import {
  ScrollText, LayoutGrid, LogOut, Layers, ArrowDownToLine, Sparkles,
  Loader2, GripVertical, ArrowUpDown,
} from "lucide-react";

// ----------------------------------------------------------

function useNow(stepMs = 500) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), stepMs);
    return () => clearInterval(id);
  }, [stepMs]);
  return now;
}

function TurnTimer({ startedAt, isBot }: { startedAt: number; isBot: boolean }) {
  const now = useNow();
  if (isBot) return null;
  const remain = Math.max(0, TURN_TIMEOUT_MS - (now - startedAt));
  const pct = (remain / TURN_TIMEOUT_MS) * 100;
  const secs = Math.ceil(remain / 1000);
  return (
    <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-white/10">
      <div
        className={cn("h-full rounded-full transition-all", secs <= 15 ? "bg-[#c10328]" : "bg-[#f5c036]")}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** Indikator proses global — muncul saat ada aksi yang sedang dikirim */
function PendingPill({ show, label }: { show: boolean; label?: string }) {
  if (!show) return null;
  return (
    <div className="fixed left-1/2 top-3 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/85 px-4 py-1.5 text-xs font-semibold text-[#f5c036] ring-1 ring-[#f5c036]/50 shadow-lg backdrop-blur-sm">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      {label ?? "MEMPROSES…"}
    </div>
  );
}

function OpponentSeat({
  player,
  state,
  position,
}: {
  player: ClientPlayer;
  state: ClientState;
  position: string;
}) {
  const isTurn = state.status === "playing" && state.turnSeat === player.seat;
  const reveal = state.status === "roundEnd" || state.status === "finished";
  const backs = Math.min(player.handCount, 11);

  return (
    <div className={cn("absolute z-20 flex w-32 flex-col items-center", position)}>
      <div className={cn("relative rounded-full", isTurn && "turn-glow")}>
        {player.avatar ? (
          <img src={player.avatar} alt="" className="h-12 w-12 rounded-full object-cover ring-2 ring-black/40" />
        ) : (
          <span
            className={cn(
              "flex h-12 w-12 items-center justify-center rounded-full font-display text-xl ring-2 ring-black/40",
              player.isBot ? "bg-[#3a3a35] text-white/80" : "bg-[#286e44] text-[#FEFEEE]",
            )}
          >
            {player.name[0]?.toUpperCase()}
          </span>
        )}
        <span className="absolute -bottom-1 -right-1 rounded-full bg-black/70 px-1.5 py-0.5 font-num text-[10px] font-bold text-[#f5c036] ring-1 ring-[#f5c036]/40">
          {player.score}
        </span>
      </div>
      <p className="mt-1.5 max-w-32 truncate text-xs font-semibold text-[#FEFEEE]">
        {player.name}
        {player.isBot && <span className="ml-1 text-[9px] text-white/40">BOT</span>}
      </p>
      <TurnTimer startedAt={isTurn ? state.turnStartedAt : 0} isBot={!isTurn || player.isBot} />
      {/* kartu lawan */}
      <div className="mt-1.5 flex h-9 items-start justify-center">
        {reveal && player.hand
          ? player.hand.map((c, i) => (
              <div key={`${c}-${i}`} className="-ml-5 first:ml-0">
                <PlayingCard code={c} size="xs" />
              </div>
            ))
          : Array.from({ length: backs }).map((_, i) => (
              <div key={i} className="-ml-5 first:ml-0">
                <PlayingCard back size="xs" />
              </div>
            ))}
      </div>
      {/* poin meld milik lawan */}
      {player.meldPlus > 0 && (
        <span className="mt-1 rounded bg-[#286e44]/50 px-1.5 py-0.5 font-num text-[10px] font-bold text-[#7fd4a4]">
          +{player.meldPlus}
        </span>
      )}
    </div>
  );
}

// ----------------------------------------------------------

export function GameTable({ code }: { code: string }) {
  useAuth();
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  const roomQuery = trpc.rummy.get.useQuery(
    { code },
    { refetchInterval: 1200, retry: false },
  );
  const data = roomQuery.data;

  const [selected, setSelected] = useState<CardCode[]>([]);
  const [sortMode, setSortMode] = useState<"rank" | "suit">("rank");
  const [manualOrder, setManualOrder] = useState<CardCode[] | null>(null);
  const [scoreOpen, setScoreOpen] = useState(false);
  const [jokerConfirm, setJokerConfirm] = useState<CardCode | null>(null);

  const state = data?.state;
  const me = state?.you ?? null;
  const myTurn = !!state && !!me && state.status === "playing" && state.turnSeat === me.seat;
  const phase = state?.phase;

  // bersihkan seleksi saat giliran/fase berubah
  useEffect(() => {
    setSelected([]);
  }, [state?.turnSeat, state?.phase, state?.status]);

  // urutan manual direset tiap sesi baru
  useEffect(() => {
    setManualOrder(null);
  }, [state?.round]);

  const invalidate = () => utils.rummy.get.invalidate({ code });
  const onErr = (e: { message: string }) => toast.error(e.message);

  const draw = trpc.rummy.draw.useMutation({ onSuccess: invalidate, onError: onErr });
  const meld = trpc.rummy.meld.useMutation({
    onSuccess: () => { setSelected([]); invalidate(); },
    onError: onErr,
  });
  const discard = trpc.rummy.discard.useMutation({
    onSuccess: () => { setSelected([]); invalidate(); },
    onError: onErr,
  });
  const nextRound = trpc.rummy.nextRound.useMutation({ onSuccess: invalidate, onError: onErr });
  const rematch = trpc.rummy.rematch.useMutation({ onSuccess: invalidate, onError: onErr });
  const leave = trpc.rummy.leave.useMutation({
    onSuccess: () => navigate("/"),
    onError: onErr,
  });

  const anyPending =
    draw.isPending || meld.isPending || discard.isPending ||
    nextRound.isPending || rematch.isPending || leave.isPending;
  const pendingLabel = draw.isPending
    ? "MENGAMBIL KARTU…"
    : meld.isPending
      ? "MEMBUKA KOMBINASI…"
      : discard.isPending
        ? "MEMBUANG KARTU…"
        : nextRound.isPending
          ? "MEMULAI SESI BARU…"
          : leave.isPending
            ? "KELUAR ROOM…"
            : "MEMPROSES…";

  const myPlayer: ClientPlayer | undefined = state?.players.find((p) => p.seat === me?.seat);

  // urutan tampilan tangan: manual (drag) > urut otomatis
  const displayHand = useMemo(() => {
    if (!myPlayer?.hand) return [] as CardCode[];
    const hand = myPlayer.hand;
    if (manualOrder) {
      const kept = manualOrder.filter((c) => hand.includes(c));
      const fresh = hand.filter((c) => !manualOrder.includes(c));
      return [...kept, ...fresh];
    }
    if (sortMode === "rank") return sortHand(hand);
    const suitOrder: Record<string, number> = { S: 0, H: 1, C: 2, D: 3 };
    return sortHand(hand).sort(
      (a, b) => (isJoker(a) ? 9 : suitOrder[a[1]]) - (isJoker(b) ? 9 : suitOrder[b[1]]),
    );
  }, [myPlayer?.hand, manualOrder, sortMode]);

  if (!state) return null;

  const validSelection =
    selected.length >= 3 &&
    validateMeld(selected, myPlayer?.hasMelded ?? false) !== null;

  const handCount = myPlayer?.handCount ?? 0;
  const oneSelected = selected.length === 1;
  const selectedJoker = oneSelected && isJoker(selected[0]);
  const canTutup = myTurn && phase === "play" && oneSelected && handCount === 1;
  const canDiscard = myTurn && phase === "play" && oneSelected && handCount > 1;

  /** Apakah kartu buangan sedalam `depth` sah diambil (target + ≥2 kartu tangan = jadi) */
  const takeableDepth = (depth: number): boolean => {
    if (!myTurn || phase !== "draw" || !myPlayer?.hand) return false;
    const pile = state.discard;
    if (depth >= pile.length) return false;
    const target = pile[pile.length - 1 - depth];
    return findMelds([...myPlayer.hand, target], myPlayer.hasMelded).some((m) =>
      m.includes(target),
    );
  };

  const toggleSelect = (c: CardCode) => {
    if (!myTurn || phase !== "play") return;
    setSelected((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c],
    );
  };

  const handleDiscard = () => {
    if (!oneSelected) return;
    if (selectedJoker && handCount > 1) {
      setJokerConfirm(selected[0]);
      return;
    }
    discard.mutate({ code, card: selected[0], faceDown: handCount === 1 });
  };

  const applySort = (mode: "rank" | "suit") => {
    setSortMode(mode);
    setManualOrder(null);
  };

  // posisi lawan relatif terhadap saya (searah jarum jam)
  const others = (() => {
    if (!me) return state.players;
    const n = state.players.length;
    const list: ClientPlayer[] = [];
    for (let i = 1; i < n; i++) {
      const p = state.players.find((pl) => pl.seat === (me.seat + i) % n);
      if (p) list.push(p);
    }
    return list;
  })();

  const positions =
    others.length === 1
      ? ["top-2 left-1/2 -translate-x-1/2"]
      : others.length === 2
        ? ["top-2 left-[16%]", "top-2 right-[16%]"]
        : ["top-24 left-2", "top-2 left-1/2 -translate-x-1/2", "top-24 right-2"];

  const currentPlayer = state.players.find((p) => p.seat === state.turnSeat);
  // kaskade buangan: hanya 7 teratas yang relevan (aturan ambil maks 7)
  const fanSize = Math.min(7, state.discard.length);
  const fanCards = state.discard.slice(-fanSize);
  const buriedCount = state.discard.length - fanSize;

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <PendingPill show={anyPending} label={pendingLabel} />

      {/* ===== Header meja ===== */}
      <header className="relative z-30 flex items-center justify-between gap-2 px-3 py-2 sm:px-6">
        <Logo size="text-2xl" />
        <div className="flex items-center gap-2 text-center">
          <span className="hidden font-display text-lg tracking-wide text-white/60 sm:block">
            {data?.name}
          </span>
          <span className="rounded-full border border-dashed border-[#f5c036]/40 px-3 py-0.5 font-num text-xs font-bold tracking-[0.25em] text-[#f5c036]">
            {code}
          </span>
          <span className="rounded-full bg-black/40 px-3 py-0.5 font-num text-xs text-white/60">
            Sesi {state.round} · {state.targetScore}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm" variant="ghost"
            onClick={() => setScoreOpen(true)}
            className="h-8 gap-1.5 text-white/70 hover:text-[#f5c036]"
          >
            <LayoutGrid className="h-4 w-4" />
            <span className="hidden sm:inline">Skor</span>
          </Button>
          <Sheet>
            <SheetTrigger asChild>
              <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-white/70 hover:text-[#f5c036]">
                <ScrollText className="h-4 w-4" />
                <span className="hidden sm:inline">Log</span>
              </Button>
            </SheetTrigger>
            <SheetContent className="border-l-[#f5c036]/30 bg-[#1c1812] text-[#FEFEEE]">
              <SheetHeader>
                <SheetTitle className="font-display text-2xl tracking-wide text-[#f5c036]">
                  LOG PERMAINAN
                </SheetTitle>
              </SheetHeader>
              <div className="mt-4 space-y-1.5 overflow-y-auto">
                {[...state.log].reverse().map((l, i) => (
                  <p key={`${l.t}-${i}`} className="border-l-2 border-[#286e44]/60 pl-2 text-xs text-white/70">
                    {l.msg}
                  </p>
                ))}
              </div>
            </SheetContent>
          </Sheet>
          <Button
            size="sm" variant="ghost"
            disabled={leave.isPending}
            onClick={() => {
              if (me) leave.mutate({ code });
              else navigate("/");
            }}
            className="h-8 gap-1.5 text-white/70 hover:text-[#c10328]"
          >
            {leave.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
            <span className="hidden sm:inline">{me ? "Keluar" : "Beranda"}</span>
          </Button>
        </div>
      </header>

      {/* ===== Area meja ===== */}
      <div className="relative min-h-0 flex-1">
        {/* meja felt */}
        <div className="absolute left-1/2 top-1/2 h-[88%] w-[min(96vw,70rem)] -translate-x-1/2 -translate-y-1/2">
          <div className="felt felt-hatch absolute inset-0 rounded-[3rem] shadow-[inset_0_0_80px_rgba(0,0,0,0.55),0_30px_60px_rgba(0,0,0,0.5)] sm:rounded-[50%]" />
          <div className="stitch pointer-events-none absolute inset-3 rounded-[2.5rem] sm:inset-5 sm:rounded-[46%]" />
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 opacity-[0.07]">
            <div className="flex items-center gap-2">
              <SuitIcon suit="S" className="h-16 w-16" />
              <span className="font-display text-8xl">REMIKU</span>
              <SuitIcon suit="H" className="h-16 w-16" />
            </div>
          </div>
        </div>

        {/* lawan */}
        {others.map((p, i) => (
          <OpponentSeat key={p.seat} player={p} state={state} position={positions[i]} />
        ))}

        {/* banner giliran */}
        {state.status === "playing" && !myTurn && (
          <div className="absolute left-1/2 top-[36%] z-10 -translate-x-1/2">
            <span className="rounded-full bg-black/60 px-4 py-1.5 font-display text-lg tracking-wide text-[#FEFEEE]/90 backdrop-blur-sm">
              GILIRAN {currentPlayer?.name?.toUpperCase()}
            </span>
          </div>
        )}
        {state.status === "playing" && myTurn && (
          <div className="absolute left-1/2 top-[36%] z-10 -translate-x-1/2">
            <span className="rounded-full bg-[#f5c036] px-4 py-1.5 font-display text-lg tracking-wide text-[#1a150a] shadow-lg">
              {phase === "draw" ? "GILIRANMU — AMBIL KARTU" : "BUKA KOMBINASI, LALU BUANG"}
            </span>
          </div>
        )}

        {/* area tengah: rak kombinasi jadi + tumpukan */}
        <div className="absolute left-1/2 top-1/2 z-10 flex w-[min(92vw,60rem)] -translate-x-1/2 -translate-y-1/2 items-center justify-center gap-5 px-4">
          {/* rak kartu jadi */}
          <div className="max-h-52 min-h-24 max-w-[58%] flex-1 overflow-y-auto rounded-xl bg-black/15 p-2 ring-1 ring-white/5">
            {state.melds.length === 0 && !state.closedCard && (
              <p className="py-6 text-center font-display text-xl tracking-wide text-white/25">
                BELUM ADA KARTU JADI
              </p>
            )}
            <div className="flex flex-wrap content-start items-start justify-center gap-2.5">
              {state.melds.map((m) => {
                const owner = state.players.find((p) => p.seat === m.ownerSeat);
                return (
                  <div
                    key={m.id}
                    className="rounded-lg bg-black/30 p-1.5 pb-1 ring-1 ring-white/10"
                  >
                    <div className="flex">
                      {m.cards.map((c, i) => (
                        <div key={`${c}-${i}`} className="-ml-8 first:ml-0">
                          <PlayingCard code={c} size="sm" />
                        </div>
                      ))}
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2 px-0.5">
                      <span className="max-w-16 truncate text-[9px] font-semibold text-white/60">
                        {owner?.name}
                      </span>
                      <span className="font-num text-[9px] font-bold text-[#f5c036]">
                        +{m.points}
                      </span>
                    </div>
                  </div>
                );
              })}
              {/* kartu tutup tangan (tertutup) */}
              {state.closedCard && (
                <div className="rounded-lg bg-[#f5c036]/10 p-1.5 pb-1 ring-1 ring-[#f5c036]/40">
                  {state.closedCard === "BACK" ? (
                    <PlayingCard back size="sm" />
                  ) : (
                    <PlayingCard code={state.closedCard} size="sm" />
                  )}
                  <p className="mt-1 text-center text-[9px] font-bold text-[#f5c036]">TUTUP</p>
                </div>
              )}
            </div>
          </div>

          {/* tumpukan deck & kaskade buangan */}
          <div className="flex shrink-0 items-start gap-4 sm:gap-6">
            {/* deck */}
            <div className="flex flex-col items-center gap-1">
              <div
                onClick={() => myTurn && phase === "draw" && !anyPending && draw.mutate({ code, from: "stock", depth: 0 })}
                className={cn("relative", myTurn && phase === "draw" && !anyPending && "cursor-pointer")}
              >
                {state.stockCount > 1 && (
                  <div className="absolute -left-1 -top-1 opacity-70"><PlayingCard back size="md" /></div>
                )}
                <div className={cn("relative", myTurn && phase === "draw" && "animate-pulse ring-4 ring-[#f5c036]/80 rounded-[0.45rem]")}>
                  <PlayingCard back size="md" />
                </div>
                <span className="absolute -right-2 -top-2 z-10 flex h-6 min-w-6 items-center justify-center rounded-full bg-[#f5c036] px-1 font-num text-xs font-bold text-[#1a150a]">
                  {state.stockCount}
                </span>
                {draw.isPending && (
                  <div className="absolute inset-0 z-20 flex items-center justify-center rounded-[0.45rem] bg-black/60">
                    <Loader2 className="h-5 w-5 animate-spin text-[#f5c036]" />
                  </div>
                )}
              </div>
              <span className="flex items-center gap-1 text-[10px] font-semibold tracking-wider text-white/50">
                <Layers className="h-3 w-3" /> DECK
              </span>
            </div>

            {/* kaskade buangan: bertumpuk ke kanan, indeks tiap kartu tetap terlihat.
                Hanya 7 teratas yang ditampilkan (batas ambil) — sisanya terkubur rapi. */}
            <div className="flex flex-col items-center gap-1">
              <div className="relative h-20" style={{ width: `${56 + Math.max(0, fanSize - 1) * 20}px` }}>
                {fanCards.length === 0 && (
                  <div className="flex h-20 w-14 items-center justify-center rounded-[0.45rem] border-2 border-dashed border-white/20 text-white/20">
                    <SuitIcon suit="D" className="h-5 w-5" />
                  </div>
                )}
                {fanCards.map((c, i) => {
                  const depth = fanCards.length - 1 - i; // 0 = paling atas (paling kanan)
                  const ok = takeableDepth(depth);
                  const isTop = depth === 0;
                  return (
                    <div
                      key={`${c}-${state.discard.length - fanSize + i}`}
                      className="absolute top-0"
                      style={{ left: i * 20, zIndex: i }}
                    >
                      <div
                        onClick={() => ok && !anyPending && draw.mutate({ code, from: "discard", depth })}
                        title={ok ? (depth === 0 ? "Ambil kartu ini" : `Ambil ${depth + 1} kartu`) : undefined}
                        className={cn(
                          "relative transition-all",
                          ok && !anyPending && "cursor-pointer hover:-translate-y-2",
                          !ok && "brightness-[0.65]",
                          ok && isTop && myTurn && phase === "draw" && "animate-pulse ring-4 ring-[#f5c036]/80 rounded-[0.45rem]",
                        )}
                      >
                        <PlayingCard code={c} size="md" />
                        {ok && depth > 0 && (
                          <span className="absolute -top-2 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-full bg-[#f5c036] px-1.5 font-num text-[10px] font-bold text-[#1a150a] shadow">
                            +{depth + 1}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
                {draw.isPending && (
                  <div className="absolute inset-0 z-30 flex items-center justify-center rounded-[0.45rem] bg-black/40">
                    <Loader2 className="h-5 w-5 animate-spin text-[#f5c036]" />
                  </div>
                )}
              </div>
              <span className="flex items-center gap-1 text-[10px] font-semibold tracking-wider text-white/50">
                <Sparkles className="h-3 w-3" /> BUANGAN
                {buriedCount > 0 && (
                  <span className="rounded bg-black/50 px-1 font-num text-[9px] text-white/40">
                    +{buriedCount} terkubur
                  </span>
                )}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ===== Panel bawah: info + aksi + tangan ===== */}
      <div className="relative z-30 pb-2">
        {/* bar aksi */}
        <div className="mx-auto mb-2 flex max-w-3xl flex-wrap items-center justify-center gap-2 px-3">
          {me && myPlayer && (
            <>
              <span className="rounded-full bg-black/60 px-3 py-1.5 font-num text-xs font-bold text-[#FEFEEE] ring-1 ring-white/15">
                SKOR <span className="text-[#f5c036]">{myPlayer.score}</span>
              </span>
              <span className="rounded-full bg-[#286e44]/40 px-3 py-1.5 font-num text-xs font-bold text-[#7fd4a4] ring-1 ring-[#286e44]">
                +{myPlayer.meldPlus}
              </span>
              <span className="rounded-full bg-[#c10328]/25 px-3 py-1.5 font-num text-xs font-bold text-[#e0707f] ring-1 ring-[#c10328]/50">
                −{myPlayer.handMinus ?? 0}
              </span>
            </>
          )}

          {myTurn && phase === "draw" && (
            <span className="flex items-center gap-1.5 rounded-full bg-[#f5c036]/15 px-3 py-1.5 text-xs font-medium text-[#f5c036] ring-1 ring-[#f5c036]/40">
              <ArrowDownToLine className="h-3.5 w-3.5" /> Klik deck atau kartu buangan yang menyala
            </span>
          )}

          {myTurn && phase === "play" && (
            <>
              <button
                onClick={() => meld.mutate({ code, cards: selected })}
                disabled={!validSelection || anyPending}
                className="btn-gold h-10 px-5 text-base disabled:opacity-50"
              >
                {meld.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                BUKA {selected.length > 0 && `(${selected.length})`}
              </button>
              <button
                onClick={handleDiscard}
                disabled={(!canDiscard && !canTutup) || anyPending}
                className={cn(
                  "h-10 text-base disabled:opacity-50",
                  canTutup ? "btn-gold" : "btn-stitch",
                  selectedJoker && handCount > 1 && "border-[#c10328] text-[#e0707f]",
                )}
              >
                {discard.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {canTutup
                  ? selectedJoker
                    ? "TUTUP DENGAN JOKER (+500)"
                    : "TUTUP TANGAN (+250)"
                  : selectedJoker
                    ? "BUANG JOKER (SESI BERAKHIR)"
                    : `BUANG${oneSelected ? " 1 KARTU" : ""}`}
              </button>
              {!myPlayer?.hasMelded && (
                <span className="text-[11px] text-white/40">
                  Tutupan pertama harus seri tanpa joker
                </span>
              )}
            </>
          )}

          {me && (
            <button
              onClick={() => applySort(sortMode === "rank" ? "suit" : "rank")}
              title="Urutkan otomatis — atau seret kartu untuk menyusun manual"
              className="flex items-center gap-1 rounded-full bg-black/60 px-3 py-1.5 text-xs font-medium text-white/60 ring-1 ring-white/15 hover:text-[#f5c036]"
            >
              <ArrowUpDown className="h-3 w-3" />
              {sortMode === "rank" ? "Angka" : "Bunga"}
            </button>
          )}
        </div>

        {/* tangan saya — bisa diseret untuk menyusun manual */}
        {me && myPlayer?.hand && (
          <div className="flex flex-col items-center px-2 pb-1 pt-4">
            <Reorder.Group
              axis="x"
              values={displayHand}
              onReorder={(v: CardCode[]) => setManualOrder(v)}
              className="flex max-w-full overflow-x-auto pb-1"
              key={`round-${state.round}`}
            >
              {displayHand.map((c, i) => (
                <Reorder.Item
                  key={c}
                  value={c}
                  initial={{ y: 80, opacity: 0, rotate: -6 }}
                  animate={{ y: 0, opacity: 1, rotate: 0 }}
                  transition={{ type: "spring", stiffness: 260, damping: 24, delay: i * 0.04 }}
                  whileDrag={{ scale: 1.12, zIndex: 50 }}
                  className={cn("-ml-8 first:ml-0 sm:-ml-7", manualOrder && "cursor-grab active:cursor-grabbing")}
                >
                  <PlayingCard
                    code={c}
                    size="md"
                    selected={selected.includes(c)}
                    dimmed={myTurn && phase === "play" && selected.length > 0 && !selected.includes(c)}
                    disabled={!myTurn || phase !== "play"}
                    onClick={() => toggleSelect(c)}
                  />
                </Reorder.Item>
              ))}
            </Reorder.Group>
            <p className="mt-0.5 flex items-center gap-1 text-[10px] text-white/30">
              <GripVertical className="h-3 w-3" /> Seret kartu untuk menyusun manual
            </p>
          </div>
        )}

        {/* penonton */}
        {!me && (
          <p className="pb-3 text-center text-sm text-white/40">
            Mode penonton — kamu menyaksikan meja ini secara langsung.
          </p>
        )}
      </div>

      {/* ===== Modal ===== */}
      {state.status === "roundEnd" && (
        <RoundEndModal
          state={state}
          isPlayer={!!me}
          onNext={() => nextRound.mutate({ code })}
          pending={nextRound.isPending}
        />
      )}
      {state.status === "finished" && (
        <GameEndModal
          state={state}
          isPlayer={!!me}
          onRematch={() => rematch.mutate({ code })}
          onHome={() => navigate("/")}
          pending={rematch.isPending}
        />
      )}
      <ScoreboardDialog state={state} open={scoreOpen} onClose={() => setScoreOpen(false)} />

      {/* konfirmasi buang joker */}
      <AlertDialog open={!!jokerConfirm} onOpenChange={(o) => !o && setJokerConfirm(null)}>
        <AlertDialogContent className="border-[#c10328]/50 bg-[#1c1812] text-[#FEFEEE]">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-3xl tracking-wide text-[#c10328]">
              BUANG JOKER?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-white/60">
              Membuang joker secara terbuka akan <b className="text-[#e0707f]">mengakhiri sesi ini seketika</b>.
              Skor dihitung dari kartu jadi dan sisa tangan saat ini. Yakin?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/20 bg-transparent text-white/70 hover:bg-white/10 hover:text-white">
              Batal
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (jokerConfirm) discard.mutate({ code, card: jokerConfirm, faceDown: false });
                setJokerConfirm(null);
              }}
              className="bg-[#c10328] text-white hover:bg-[#d91a42]"
            >
              Ya, buang joker
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

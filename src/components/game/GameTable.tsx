import { useEffect, useMemo, useRef, useState } from "react";
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
import { playTurnChime, resumeAudio } from "@/lib/sounds";
import {
  ScrollText, LayoutGrid, LogOut, Layers, ArrowDownToLine, Sparkles,
  Loader2, GripVertical, ArrowUpDown, Mic, MicOff, Volume2, VolumeX,
} from "lucide-react";

// ----------------------------------------------------------
// Panggung meja dengan tinggi desain tetap dan lebar yang mengikuti
// rasio layar (dibatasi 940–1500), lalu di-scale agar memenuhi layar
// penuh — pola yang dipakai game kartu profesional. Tidak ada lagi
// zona yang remuk/menindih, dan tidak ada ruang layar yang terbuang.
const STAGE_H = 640;
const STAGE_MIN_W = 940;
const STAGE_MAX_W = 1500;

function useStage() {
  const [stage, setStage] = useState({ w: 960, scale: 1 });
  useEffect(() => {
    const update = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      // lebar panggung mengikuti rasio layar → skala mengisi penuh
      // salah satu sumbu (lebar atau tinggi) selalu pas 100%
      const w = Math.round(
        Math.min(STAGE_MAX_W, Math.max(STAGE_MIN_W, (STAGE_H * vw) / vh)),
      );
      setStage({ w, scale: Math.min(vw / w, vh / STAGE_H) });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);
  return stage;
}

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
    <div className="mt-0.5 h-1 w-20 overflow-hidden rounded-full bg-white/10">
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

/** Status voice chat satu pemain. */
export interface SeatVoice {
  speaking: boolean;
  muted: boolean;
}

/** Kursi lawan — ringkas: avatar, nama, timer, tumpukan kartu + jumlah. */
function OpponentSeat({
  player,
  state,
  voice,
}: {
  player: ClientPlayer;
  state: ClientState;
  voice?: SeatVoice;
}) {
  const isTurn = state.status === "playing" && state.turnSeat === player.seat;
  const backs = Math.max(0, Math.min(3, player.handCount));

  return (
    <div className="flex w-32 flex-col items-center">
      <div className="flex items-center gap-2">
        <div
          className={cn(
            "relative rounded-full transition-transform duration-300",
            isTurn && "turn-glow scale-110",
            voice?.speaking && !voice.muted && "speaking-glow",
          )}
        >
          {isTurn && <span className="turn-ring" aria-hidden />}
          {isTurn && (
            <span className="turn-badge absolute -top-3 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-full bg-[#f5c036] px-1.5 py-px font-display text-[9px] tracking-[0.2em] text-[#1a150a] shadow-md">
              GILIRAN
            </span>
          )}
          {player.avatar ? (
            <img src={player.avatar} alt="" className="h-10 w-10 rounded-full object-cover ring-2 ring-black/40" />
          ) : (
            <span
              className={cn(
                "flex h-10 w-10 items-center justify-center rounded-full font-display text-base ring-2 ring-black/40",
                player.isBot ? "bg-[#3a3a35] text-white/80" : "bg-[#286e44] text-[#FEFEEE]",
              )}
            >
              {player.name[0]?.toUpperCase()}
            </span>
          )}
          <span className="absolute -bottom-1 -right-1 rounded-full bg-black/70 px-1.5 py-0.5 font-num text-[10px] font-bold text-[#f5c036] ring-1 ring-[#f5c036]/40">
            {player.score}
          </span>
          {voice && (
            <span
              title={voice.muted ? `${player.name} — mic mati` : `${player.name} — di voice chat`}
              className={cn(
                "absolute -left-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full ring-1 ring-black/50",
                voice.muted ? "bg-[#c10328]" : "bg-[#286e44]",
              )}
            >
              {voice.muted ? (
                <MicOff className="h-2.5 w-2.5 text-white" />
              ) : (
                <Mic className="h-2.5 w-2.5 text-white" />
              )}
            </span>
          )}
        </div>
        {/* tumpukan kartu lawan + jumlah */}
        <div className="relative h-8 w-8">
          {Array.from({ length: backs }).map((_, i) => (
            <div
              key={i}
              className="absolute h-7 w-5 rounded-[3px] bg-[#c10328] ring-1 ring-[#f5c036]/40"
              style={{
                left: i * 5,
                top: -i,
                backgroundImage:
                  "repeating-linear-gradient(45deg, rgba(245,192,54,.18) 0 1.5px, transparent 1.5px 4.5px)",
              }}
            />
          ))}
          <span className="absolute -right-2 -top-1.5 z-10 flex h-4 min-w-4 items-center justify-center rounded-full bg-black/80 px-1 font-num text-[9px] font-bold text-[#FEFEEE] ring-1 ring-white/25">
            {player.handCount}
          </span>
        </div>
      </div>
      <p
        className={cn(
          "mt-1 max-w-32 truncate text-[11px] font-semibold",
          isTurn ? "text-[#f5c036]" : "text-[#FEFEEE]",
        )}
      >
        {player.name}
        {player.isBot && <span className="ml-1 text-[8px] text-white/40">BOT</span>}
      </p>
      <TurnTimer startedAt={isTurn ? state.turnStartedAt : 0} isBot={!isTurn || player.isBot} />
      {player.meldPlus > 0 && (
        <span className="mt-0.5 rounded bg-[#286e44]/50 px-1.5 py-0.5 font-num text-[10px] font-bold leading-none text-[#7fd4a4]">
          +{player.meldPlus}
        </span>
      )}
    </div>
  );
}

// ----------------------------------------------------------

export function GameTable({
  code,
  voiceBySeat,
}: {
  code: string;
  voiceBySeat?: Map<number, SeatVoice>;
}) {
  useAuth();
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const stage = useStage();

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
  const [resultOpen, setResultOpen] = useState(true);
  const [soundOn, setSoundOn] = useState(() => {
    try {
      return localStorage.getItem("remiku:sound") !== "off";
    } catch {
      return true;
    }
  });

  const state = data?.state;
  const me = state?.you ?? null;
  const myTurn = !!state && !!me && state.status === "playing" && state.turnSeat === me.seat;
  const phase = state?.phase;

  // modal hasil selalu terbuka otomatis setiap kali sesi/permainan berakhir
  useEffect(() => {
    if (state?.status === "roundEnd" || state?.status === "finished") {
      setResultOpen(true);
    }
  }, [state?.status, state?.round]);

  // buka kunci AudioContext pada gestur pertama (kebijakan autoplay browser)
  useEffect(() => {
    const unlock = () => resumeAudio();
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  // lonceng saat giliran menjadi milikku
  const prevMyTurnRef = useRef(false);
  useEffect(() => {
    if (myTurn && !prevMyTurnRef.current && soundOn) playTurnChime();
    prevMyTurnRef.current = myTurn;
  }, [myTurn, soundOn]);

  const toggleSound = () => {
    setSoundOn((v) => {
      const next = !v;
      try {
        localStorage.setItem("remiku:sound", next ? "on" : "off");
      } catch {
        /* penyimpanan tak tersedia */
      }
      return next;
    });
  };

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

  // lawan lain, searah jarum jam dari posisiku
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

  const currentPlayer = state.players.find((p) => p.seat === state.turnSeat);
  // kaskade buangan: hanya 7 teratas yang relevan (aturan ambil maks 7)
  const fanSize = Math.min(7, state.discard.length);
  const fanCards = state.discard.slice(-fanSize);
  const buriedCount = state.discard.length - fanSize;

  // ── geometri kipas tangan (kartu besar 112px, landai) ──
  const n = displayHand.length;
  const mid = (n - 1) / 2;
  /** jarak antar kartu (px) — kipas lebar namun tetap rapat */
  const fanGap = n <= 1 ? 0 : Math.max(38, Math.min(96, (stage.w - 240) / (n - 1)));
  /** sudut antar kartu — sebaran total ±~10° agar tidak melengkung dalam */
  const fanStep = n <= 1 ? 0 : Math.min(2.8, 28 / n);

  return (
    <div className="flex h-dvh w-full items-center justify-center overflow-hidden bg-[#14110d]">
      <PendingPill show={anyPending} label={pendingLabel} />

      {/* ===== Panggung meja: kanvas adaptif yang di-scale memenuhi layar ===== */}
      <div
        className="flex shrink-0 flex-col"
        style={{
          width: stage.w,
          height: STAGE_H,
          transform: `scale(${stage.scale})`,
          transformOrigin: "center center",
        }}
      >
        {/* ===== Header meja ===== */}
        <header className="relative z-30 flex h-11 shrink-0 items-center justify-between gap-2 px-2">
          <Logo size="text-xl" />
          <div className="flex items-center gap-2 text-center">
            <span className="font-display text-base tracking-wide text-white/60">
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
              onClick={toggleSound}
              title={soundOn ? "Matikan suara notifikasi" : "Nyalakan suara notifikasi"}
              className={cn("h-8 gap-1.5", soundOn ? "text-[#f5c036]" : "text-white/40 hover:text-white/70")}
            >
              {soundOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              Suara
            </Button>
            <Button
              size="sm" variant="ghost"
              onClick={() => setScoreOpen(true)}
              className="h-8 gap-1.5 text-white/70 hover:text-[#f5c036]"
            >
              <LayoutGrid className="h-4 w-4" />
              Skor
            </Button>
            <Sheet>
              <SheetTrigger asChild>
                <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-white/70 hover:text-[#f5c036]">
                  <ScrollText className="h-4 w-4" />
                  Log
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
              {me ? "Keluar" : "Beranda"}
            </Button>
          </div>
        </header>

        {/* ===== Meja felt: lawan + banner + area tengah ===== */}
        <div className="relative mx-auto flex min-h-0 w-full flex-1 flex-col px-2">
          <div className="felt felt-hatch absolute inset-x-2 inset-y-0 rounded-[1.6rem] shadow-[inset_0_0_80px_rgba(0,0,0,0.55),0_30px_60px_rgba(0,0,0,0.5)]" />
          <div className="stitch pointer-events-none absolute inset-x-5 inset-y-2.5 rounded-[1.2rem]" />
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 opacity-[0.07]">
            <div className="flex items-center gap-2">
              <SuitIcon suit="S" className="h-14 w-14" />
              <span className="font-display text-7xl">REMIKU</span>
              <SuitIcon suit="H" className="h-14 w-14" />
            </div>
          </div>

          {/* baris lawan — jalur tetap, tak pernah menindih */}
          <div className="relative z-10 flex h-[96px] shrink-0 items-start justify-around gap-2 px-10 pt-4">
            {others.map((p) => (
              <OpponentSeat
                key={p.seat}
                player={p}
                state={state}
                voice={voiceBySeat?.get(p.seat)}
              />
            ))}
          </div>

          {/* baris banner giliran — ruang khusus, tinggi tetap */}
          <div className="relative z-10 flex h-9 shrink-0 items-center justify-center">
            {state.status === "playing" && !myTurn && (
              <span className="rounded-full bg-black/60 px-4 py-1 font-display text-base tracking-wide text-[#FEFEEE]/90 backdrop-blur-sm">
                GILIRAN {currentPlayer?.name?.toUpperCase()}
              </span>
            )}
            {state.status === "playing" && myTurn && (
              <span className="turn-banner rounded-full bg-[#f5c036] px-4 py-1 font-display text-base tracking-wide text-[#1a150a]">
                {phase === "draw" ? "GILIRANMU — AMBIL KARTU" : "BUKA KOMBINASI, LALU BUANG"}
              </span>
            )}
          </div>

          {/* zona tengah: rak kartu jadi + tumpukan deck/buangan.
              pb besar — area bawah meja memang ditutupi kipas tangan */}
          <div className="relative z-10 flex min-h-0 flex-1 items-stretch gap-4 px-6 pb-24 pt-1">
            {/* rak kartu jadi */}
            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto rounded-xl bg-black/20 p-2 ring-1 ring-white/5">
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

            {/* tumpukan deck & kaskade buangan — klaster tetap di kanan */}
            <div className="flex shrink-0 items-center gap-6 self-center pr-1">
              {/* deck */}
              <div className="flex flex-col items-center gap-1">
                <div
                  onClick={() => myTurn && phase === "draw" && !anyPending && draw.mutate({ code, from: "stock", depth: 0 })}
                  className={cn("relative", myTurn && phase === "draw" && !anyPending && "cursor-pointer")}
                >
                  {state.stockCount > 1 && (
                    <div className="absolute -left-1 -top-1 opacity-70"><PlayingCard back size="lg" /></div>
                  )}
                  <div className={cn("relative", myTurn && phase === "draw" && "animate-pulse ring-4 ring-[#f5c036]/80 rounded-[0.45rem]")}>
                    <PlayingCard back size="lg" />
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
                <div className="relative h-[6.5rem]" style={{ width: `${72 + Math.max(0, fanSize - 1) * 22}px` }}>
                  {fanCards.length === 0 && (
                    <div className="flex h-[6.5rem] w-[4.5rem] items-center justify-center rounded-[0.45rem] border-2 border-dashed border-white/20 text-white/20">
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
                        style={{ left: i * 22, zIndex: i }}
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
                          <PlayingCard code={c} size="lg" />
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

        {/* ===== Info, aksi & kipas tangan — ditarik naik, menutupi tepi bawah meja ===== */}
        <div className="relative z-30 -mt-24 shrink-0">
        {/* ===== Bar aksi ===== */}
        <div className="flex h-12 flex-wrap items-center justify-center gap-2 px-3">
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

        {/* ===== Kipas tangan saya — kartu besar, lebar, bisa diseret ===== */}
        {me && myPlayer?.hand ? (
          <div className="relative flex h-[204px] flex-col items-center pb-2">
            {myTurn && (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-[8%] -top-2 bottom-0 animate-pulse"
                style={{
                  background:
                    "radial-gradient(ellipse 55% 85% at 50% 95%, rgba(245,192,54,0.22), transparent 70%)",
                }}
              />
            )}
            <Reorder.Group
              axis="x"
              values={displayHand}
              onReorder={(v: CardCode[]) => setManualOrder(v)}
              className="flex h-[178px] items-end justify-center"
              key={`round-${state.round}`}
            >
              {displayHand.map((c, i) => {
                const rot = (i - mid) * fanStep;
                return (
                  <Reorder.Item
                    key={c}
                    value={c}
                    initial={{ y: 80, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 260, damping: 24, delay: i * 0.04 }}
                    whileDrag={{ scale: 1.1, zIndex: 50 }}
                    style={{ marginLeft: i === 0 ? 0 : fanGap - 112, zIndex: i }}
                    className={cn(manualOrder && "cursor-grab active:cursor-grabbing")}
                  >
                    {/* kipas: rotasi di wrapper agar tak bentrok dengan drag */}
                    <div
                      style={{
                        transform: `rotate(${rot}deg)`,
                        transformOrigin: "50% 120%",
                      }}
                    >
                      <PlayingCard
                        code={c}
                        size="2xl"
                        selected={selected.includes(c)}
                        dimmed={myTurn && phase === "play" && selected.length > 0 && !selected.includes(c)}
                        disabled={!myTurn || phase !== "play"}
                        onClick={() => toggleSelect(c)}
                      />
                    </div>
                  </Reorder.Item>
                );
              })}
            </Reorder.Group>
            <p className="mt-0.5 flex items-center gap-1 text-[10px] text-white/30">
              <GripVertical className="h-3 w-3" /> Seret kartu untuk menyusun manual
            </p>
          </div>
        ) : (
          <div className="flex h-[204px] items-center justify-center">
            <p className="text-sm text-white/40">
              Mode penonton — kamu menyaksikan meja ini secara langsung.
            </p>
          </div>
        )}
        </div>
      </div>

      {/* ===== Modal ===== */}
      {state.status === "roundEnd" && (
        <RoundEndModal
          state={state}
          isPlayer={!!me}
          onNext={() => nextRound.mutate({ code })}
          pending={nextRound.isPending}
          open={resultOpen}
          onClose={() => setResultOpen(false)}
        />
      )}
      {state.status === "finished" && (
        <GameEndModal
          state={state}
          isPlayer={!!me}
          onRematch={() => rematch.mutate({ code })}
          onHome={() => navigate("/")}
          pending={rematch.isPending}
          open={resultOpen}
          onClose={() => setResultOpen(false)}
        />
      )}
      {/* tombol buka ulang saat modal hasil ditutup */}
      {(state.status === "roundEnd" || state.status === "finished") && !resultOpen && (
        <button
          onClick={() => setResultOpen(true)}
          className="btn-gold fixed left-1/2 top-14 z-40 h-10 -translate-x-1/2 px-5 text-sm"
        >
          LIHAT HASIL {state.status === "finished" ? "AKHIR" : "SESI"}
        </button>
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

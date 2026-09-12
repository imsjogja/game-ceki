import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/hooks/useAuth";
import { SiteHeader } from "@/components/SiteHeader";
import { FeltWeave } from "@/components/game/FeltWeave";
import { PlayingCard } from "@/components/game/PlayingCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Users,
  Bot,
  Trophy,
  Target,
  Copy,
  History,
  LoaderCircle,
  Search,
  X,
  Eye,
  Radio,
} from "lucide-react";
import { TARGET_SCORES } from "@contracts/rummy";
import { ONLINE_OPPONENT_COUNTS } from "@contracts/matchmaking";

const FAN_CARDS = ["AH", "KH", "QH", "JH", "TH"] as const;

export default function Home() {
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const [createOpen, setCreateOpen] = useState(false);
  const [roomName, setRoomName] = useState("");
  const [targetScore, setTargetScore] = useState(250);
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [joinCode, setJoinCode] = useState("");
  const [joinOpen, setJoinOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [botCount, setBotCount] = useState(1);
  const [quickTarget, setQuickTarget] = useState(500);
  const [onlineOpen, setOnlineOpen] = useState(false);
  const [onlineOpponents, setOnlineOpponents] = useState(1);
  const [onlineTarget, setOnlineTarget] = useState(500);
  const [onlineSearching, setOnlineSearching] = useState(false);

  const utils = trpc.useUtils();

  const createRoom = trpc.rummy.create.useMutation({
    onSuccess: (data) => navigate(`/room/${data.code}`),
    onError: (e) => toast.error(e.message),
  });

  const quickPlay = trpc.rummy.quickPlay.useMutation({
    onSuccess: (data) => navigate(`/room/${data.code}`),
    onError: (e) => toast.error(e.message),
  });
  const onlineMatch = trpc.rummy.matchmaking.enqueue.useMutation({
    onError: (e) => toast.error(e.message),
  });
  const cancelOnlineMatch = trpc.rummy.matchmaking.cancel.useMutation({
    onError: (e) => toast.error(e.message),
  });

  const guestLogin = trpc.auth.guest.useMutation();

  const handleQuickPlay = async () => {
    try {
      if (!isAuthenticated) {
        await guestLogin.mutateAsync();
        await utils.invalidate();
        toast.success("Masuk sebagai Tamu — langsung main!");
      }
      quickPlay.mutate({ bots: botCount, targetScore: quickTarget });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal masuk sebagai tamu");
    }
  };

  const handleOnlineMatch = async () => {
    if (!isAuthenticated) {
      toast.info("Masuk dulu untuk mencari lawan online.");
      navigate("/login");
      return;
    }
    try {
      const result = await onlineMatch.mutateAsync({
        opponents: onlineOpponents,
        targetScore: onlineTarget,
      });
      if (result.status === "matched") {
        toast.success("Lawan ditemukan! Menyiapkan meja...");
        navigate(`/room/${result.roomCode}`);
        return;
      }
      setOnlineSearching(true);
    } catch {
      // Pesan kesalahan ditampilkan oleh mutation.
    }
  };

  const handleCancelOnlineMatch = async () => {
    try {
      const result = await cancelOnlineMatch.mutateAsync();
      if (result.status === "matched") {
        toast.success("Lawan ditemukan! Menyiapkan meja...");
        navigate(`/room/${result.roomCode}`);
        return;
      }
      setOnlineSearching(false);
      setOnlineOpen(false);
      toast.info("Pencarian lawan dibatalkan.");
    } catch {
      // Pesan kesalahan ditampilkan oleh mutation.
    }
  };

  const statsQuery = trpc.rummy.myStats.useQuery(undefined, {
    enabled: isAuthenticated,
    retry: false,
  });
  const leaderboard = trpc.rummy.leaderboard.useQuery(undefined, { retry: false });
  const live = trpc.rummy.liveStats.useQuery(undefined, {
    refetchInterval: 8000,
    refetchIntervalInBackground: false,
    retry: false,
  });
  const onlineStatus = trpc.rummy.matchmaking.status.useQuery(undefined, {
    enabled: onlineSearching && isAuthenticated,
    refetchInterval: onlineSearching ? 2_000 : false,
    refetchIntervalInBackground: false,
    retry: false,
  });

  useEffect(() => {
    const status = onlineStatus.data;
    if (!status) return;
    if (status.status === "matched") {
      const transition = window.setTimeout(() => {
        setOnlineSearching(false);
        setOnlineOpen(false);
        toast.success("Lawan ditemukan! Menyiapkan meja...");
        navigate(`/room/${status.roomCode}`);
      }, 0);
      return () => window.clearTimeout(transition);
    } else if (status.status === "idle" && onlineSearching) {
      const transition = window.setTimeout(() => {
        setOnlineSearching(false);
        setOnlineOpen(false);
        toast.info("Pencarian lawan berakhir.");
      }, 0);
      return () => window.clearTimeout(transition);
    }
  }, [navigate, onlineSearching, onlineStatus.data]);

  const handleCreate = () => {
    if (!isAuthenticated) {
      toast.info("Masuk dulu untuk membuat room");
      navigate("/login");
      return;
    }
    createRoom.mutate({
      targetScore,
      maxPlayers,
      name: roomName.trim() || undefined,
    });
  };

  const handleJoin = () => {
    const code = joinCode.trim().toUpperCase();
    if (!/^[A-Z2-9]{6}$/.test(code)) {
      toast.error("Kode room harus 6 karakter");
      return;
    }
    if (!isAuthenticated) {
      toast.info("Masuk dulu untuk gabung room");
      navigate("/login");
      return;
    }
    navigate(`/room/${code}`);
  };

  const stats = statsQuery.data?.stats;
  const history = statsQuery.data?.history ?? [];
  const winRate =
    stats && stats.gamesPlayed > 0
      ? Math.round((stats.gamesWon / stats.gamesPlayed) * 100)
      : 0;
  const onlineSearchResult =
    onlineStatus.data?.status === "searching" ? onlineStatus.data : null;

  return (
    <div className="min-h-screen">
      <SiteHeader />

      {/* ============ HERO — kain tenun hidup + headline mask ============ */}
      <section className="relative mx-3 sm:mx-6 overflow-hidden rounded-2xl border border-[#f5c036]/25">
        <FeltWeave />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/30" />
        <div className="relative z-10 flex min-h-[26rem] flex-col justify-between gap-8 p-6 sm:p-10 lg:flex-row lg:items-end">
          <div className="max-w-xl">
            {/* statistik live: siapa yang sedang di meja */}
            <div className="mb-4 inline-flex items-center gap-4 rounded-full border border-dashed border-[#f5c036]/40 bg-black/45 px-4 py-1.5 backdrop-blur-sm">
              <span className="flex items-center gap-2 text-xs font-semibold text-[#FEFEEE]/90">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#3ddc84] opacity-60" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#3ddc84]" />
                </span>
                <span className="font-num text-sm font-bold text-[#7fd4a4]">
                  {live.data?.playersOnline ?? "–"}
                </span>
                pemain online
              </span>
              <span className="h-3 w-px bg-white/20" />
              <span className="flex items-center gap-2 text-xs font-semibold text-[#FEFEEE]/90">
                <span className="font-num text-sm font-bold text-[#f5c036]">
                  {live.data?.activeRooms ?? "–"}
                </span>
                room aktif
              </span>
            </div>
            <div className="inline-block bg-[#FEFEEE] px-4 py-3 sm:px-6 sm:py-4">
              <h1 className="font-display text-6xl leading-[0.9] text-[#14110d] sm:text-8xl">
                MAIN REMI,
                <br />
                <span className="text-[#c10328]">KAPAN SAJA.</span>
              </h1>
            </div>
            <p className="mt-4 max-w-md text-sm leading-relaxed text-[#FEFEEE]/90 sm:text-base">
              Remi Indonesia ala ceki — 7 kartu dengan 2 joker. Susun seri
              &amp; set, tutup tangan, dan tembus skor target. Buat room,
              kirim link ke teman, jadi raja meja hijau.
            </p>
            <div className="pointer-events-auto mt-6 flex flex-wrap items-center gap-3">
              {/* Main vs Bot — langsung main, tanpa menunggu */}
              <Dialog open={quickOpen} onOpenChange={setQuickOpen}>
                <DialogTrigger asChild>
                  <button className="btn-gold h-12">
                    <Bot className="h-5 w-5" /> MAIN VS BOT
                  </button>
                </DialogTrigger>
                <DialogContent className="border-[#f5c036]/30 bg-[#1c1812] text-[#FEFEEE]">
                  <DialogHeader>
                    <DialogTitle className="font-display text-3xl tracking-wide text-[#f5c036]">
                      DUEL MELAWAN BOT
                    </DialogTitle>
                  </DialogHeader>
                  <div className="space-y-5 pt-2">
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold tracking-wider text-white/60">
                        JUMLAH LAWAN
                      </label>
                      <div className="flex gap-2">
                        {[1, 2, 3].map((n) => (
                          <button
                            key={n}
                            onClick={() => setBotCount(n)}
                            className={`flex-1 rounded-lg border-2 py-2 font-num text-lg font-bold transition-all ${
                              botCount === n
                                ? "border-[#f5c036] bg-[#f5c036]/15 text-[#f5c036]"
                                : "border-white/15 text-white/50 hover:border-white/30"
                            }`}
                          >
                            {n} Bot
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold tracking-wider text-white/60">
                        TARGET SKOR
                      </label>
                      <div className="flex gap-2">
                        {TARGET_SCORES.map((t) => (
                          <button
                            key={t}
                            onClick={() => setQuickTarget(t)}
                            className={`flex-1 rounded-lg border-2 py-2 font-num text-lg font-bold transition-all ${
                              quickTarget === t
                                ? "border-[#f5c036] bg-[#f5c036]/15 text-[#f5c036]"
                                : "border-white/15 text-white/50 hover:border-white/30"
                            }`}
                          >
                            {t}
                          </button>
                        ))}
                      </div>
                    </div>
                    <Button
                      onClick={handleQuickPlay}
                      disabled={quickPlay.isPending || guestLogin.isPending}
                      className="h-12 w-full rounded-full bg-[#f5c036] font-display text-xl tracking-wide text-[#1a150a] hover:bg-[#ffd35c]"
                    >
                      {quickPlay.isPending || guestLogin.isPending
                        ? "MENYIAPKAN MEJA..."
                        : "MULAI SEKARANG"}
                    </Button>
                    {!isAuthenticated && (
                      <p className="text-center text-[11px] text-white/40">
                        Belum masuk? Kamu otomatis masuk sebagai Tamu.
                      </p>
                    )}
                  </div>
                </DialogContent>
              </Dialog>

              <Dialog
                open={onlineOpen}
                onOpenChange={(open) => {
                  if (!onlineSearching) setOnlineOpen(open);
                }}
              >
                <DialogTrigger asChild>
                  <button className="btn-stitch h-12">
                    <Users className="h-5 w-5" /> LAWAN ONLINE
                  </button>
                </DialogTrigger>
                <DialogContent
                  className="border-[#286e44]/60 bg-[#1c1812] text-[#FEFEEE]"
                  onPointerDownOutside={(event) => {
                    if (onlineSearching) event.preventDefault();
                  }}
                  onEscapeKeyDown={(event) => {
                    if (onlineSearching) event.preventDefault();
                  }}
                >
                  <DialogHeader>
                    <DialogTitle className="font-display text-3xl tracking-wide text-[#7fd4a4]">
                      {onlineSearching ? "MENCARI LAWAN..." : "LAWAN PEMAIN ONLINE"}
                    </DialogTitle>
                  </DialogHeader>
                  {onlineSearching ? (
                    <div className="space-y-5 pt-3 text-center">
                      <div
                        className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border-2 border-dashed border-[#7fd4a4]/60 bg-[#286e44]/20"
                        role="status"
                        aria-live="polite"
                        aria-label="Sedang mencari lawan"
                      >
                        <LoaderCircle className="h-7 w-7 animate-spin text-[#7fd4a4]" />
                      </div>
                      <div>
                        <p className="font-display text-2xl tracking-wide text-[#FEFEEE]">
                          MENCARI {onlineSearchResult?.opponentsNeeded ?? onlineOpponents} LAWAN
                        </p>
                        <p className="mt-1 text-sm text-white/45">
                          {onlineSearchResult?.queuedPlayers ?? 1} pemain dengan target {onlineTarget} sudah siap.
                        </p>
                        <div className="mx-auto mt-3 flex max-w-xs items-center gap-2 text-left text-xs text-[#7fd4a4]">
                          <Search className="h-4 w-4 shrink-0 animate-pulse" />
                          <span>Memperbarui antrean secara otomatis…</span>
                        </div>
                      </div>
                      <p className="rounded-lg border border-white/10 bg-black/25 p-3 text-xs leading-relaxed text-white/45">
                        Kamu akan masuk meja otomatis saat jumlah pemain lengkap.
                        Tidak ada bot yang ditambahkan ke awal pertandingan.
                      </p>
                      <Button
                        onClick={handleCancelOnlineMatch}
                        disabled={cancelOnlineMatch.isPending}
                        variant="outline"
                        className="h-11 w-full border-[#c10328]/60 bg-[#c10328]/10 font-display tracking-wide text-[#e0707f] hover:bg-[#c10328]/20 hover:text-white"
                      >
                        <X className="h-4 w-4" />
                        {cancelOnlineMatch.isPending
                          ? "MEMBATALKAN..."
                          : "BATALKAN PENCARIAN"}
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-5 pt-2">
                      <div>
                        <label className="mb-1.5 block text-xs font-semibold tracking-wider text-white/60">
                          JUMLAH LAWAN
                        </label>
                        <div className="flex gap-2">
                          {ONLINE_OPPONENT_COUNTS.map((n) => (
                            <button
                              key={n}
                              onClick={() => setOnlineOpponents(n)}
                              className={`flex-1 rounded-lg border-2 py-2 font-num text-lg font-bold transition-all ${
                                onlineOpponents === n
                                  ? "border-[#7fd4a4] bg-[#286e44]/25 text-[#7fd4a4]"
                                  : "border-white/15 text-white/50 hover:border-white/30"
                              }`}
                            >
                              {n} Lawan
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="mb-1.5 block text-xs font-semibold tracking-wider text-white/60">
                          TARGET SKOR
                        </label>
                        <div className="flex gap-2">
                          {TARGET_SCORES.map((t) => (
                            <button
                              key={t}
                              onClick={() => setOnlineTarget(t)}
                              className={`flex-1 rounded-lg border-2 py-2 font-num text-lg font-bold transition-all ${
                                onlineTarget === t
                                  ? "border-[#7fd4a4] bg-[#286e44]/25 text-[#7fd4a4]"
                                  : "border-white/15 text-white/50 hover:border-white/30"
                              }`}
                            >
                              {t}
                            </button>
                          ))}
                        </div>
                      </div>
                      <Button
                        onClick={handleOnlineMatch}
                        disabled={onlineMatch.isPending}
                        className="h-12 w-full rounded-full bg-[#286e44] font-display text-xl tracking-wide text-[#FEFEEE] hover:bg-[#3a9b63]"
                      >
                        <Users className="h-5 w-5" />
                        {onlineMatch.isPending ? "MENCARI..." : "CARI LAWAN"}
                      </Button>
                      <p className="text-center text-[11px] text-white/40">
                        Match online mempertemukan pemain yang memilih jumlah
                        lawan dan target skor yang sama.
                      </p>
                    </div>
                  )}
                </DialogContent>
              </Dialog>

              <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogTrigger asChild>
                  <button className="btn-stitch h-12">BUAT ROOM</button>
                </DialogTrigger>
                <DialogContent className="border-[#f5c036]/30 bg-[#1c1812] text-[#FEFEEE]">
                  <DialogHeader>
                    <DialogTitle className="font-display text-3xl tracking-wide text-[#f5c036]">
                      BUAT ROOM BARU
                    </DialogTitle>
                  </DialogHeader>
                  <div className="space-y-5 pt-2">
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold tracking-wider text-white/60">
                        NAMA ROOM (OPSIONAL)
                      </label>
                      <Input
                        value={roomName}
                        onChange={(e) => setRoomName(e.target.value)}
                        placeholder={`Meja ${user?.name ?? "Kamu"}`}
                        maxLength={48}
                        className="border-white/20 bg-black/40"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold tracking-wider text-white/60">
                        TARGET SKOR
                      </label>
                      <div className="flex gap-2">
                        {TARGET_SCORES.map((t) => (
                          <button
                            key={t}
                            onClick={() => setTargetScore(t)}
                            className={`flex-1 rounded-lg border-2 py-2 font-num text-lg font-bold transition-all ${
                              targetScore === t
                                ? "border-[#f5c036] bg-[#f5c036]/15 text-[#f5c036]"
                                : "border-white/15 text-white/50 hover:border-white/30"
                            }`}
                          >
                            {t}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold tracking-wider text-white/60">
                        MAKS. PEMAIN
                      </label>
                      <div className="flex gap-2">
                        {[2, 3, 4].map((n) => (
                          <button
                            key={n}
                            onClick={() => setMaxPlayers(n)}
                            className={`flex-1 rounded-lg border-2 py-2 font-num text-lg font-bold transition-all ${
                              maxPlayers === n
                                ? "border-[#f5c036] bg-[#f5c036]/15 text-[#f5c036]"
                                : "border-white/15 text-white/50 hover:border-white/30"
                            }`}
                          >
                            {n}
                          </button>
                        ))}
                      </div>
                    </div>
                    <Button
                      onClick={handleCreate}
                      disabled={createRoom.isPending}
                      className="h-12 w-full rounded-full bg-[#f5c036] font-display text-xl tracking-wide text-[#1a150a] hover:bg-[#ffd35c]"
                    >
                      {createRoom.isPending ? "MEMBUAT..." : "BUAT & MASUK ROOM"}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>

              <Dialog open={joinOpen} onOpenChange={setJoinOpen}>
                <DialogTrigger asChild>
                  <button className="btn-stitch h-12">GABUNG ROOM</button>
                </DialogTrigger>
                <DialogContent className="border-[#f5c036]/30 bg-[#1c1812] text-[#FEFEEE]">
                  <DialogHeader>
                    <DialogTitle className="font-display text-3xl tracking-wide text-[#f5c036]">
                      GABUNG KE ROOM
                    </DialogTitle>
                  </DialogHeader>
                  <div className="space-y-5 pt-2">
                    <div>
                      <label
                        htmlFor="join-room-code"
                        className="mb-1.5 block text-xs font-semibold tracking-wider text-white/60"
                      >
                        KODE ROOM
                      </label>
                      <Input
                        id="join-room-code"
                        autoFocus
                        value={joinCode}
                        onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                        onKeyDown={(e) => e.key === "Enter" && handleJoin()}
                        placeholder="CONTOH: ABC234"
                        maxLength={6}
                        className="h-12 border-white/20 bg-black/40 text-center font-num text-lg font-bold tracking-[0.3em] text-[#FEFEEE] placeholder:font-sans placeholder:text-xs placeholder:tracking-normal placeholder:text-white/30"
                      />
                    </div>
                    <Button
                      onClick={handleJoin}
                      className="h-12 w-full rounded-full bg-[#f5c036] font-display text-xl tracking-wide text-[#1a150a] hover:bg-[#ffd35c]"
                    >
                      GABUNG SEKARANG
                    </Button>
                    <p className="text-center text-[11px] text-white/40">
                      Masukkan kode 6 karakter dari temanmu untuk bergabung.
                    </p>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>

          {/* Kipas kartu dekoratif */}
          <div className="relative hidden h-56 w-72 shrink-0 lg:block">
            {FAN_CARDS.map((c, i) => (
              <motion.div
                key={c}
                className="absolute left-1/2 top-1/2 origin-bottom"
                initial={{ rotate: 0, x: "-50%", y: "-50%" }}
                animate={{
                  rotate: (i - 2) * 14,
                  x: "-50%",
                  y: ["-52%", "-48%", "-52%"],
                }}
                transition={{
                  rotate: { delay: 0.15 * i, type: "spring", stiffness: 120, damping: 14 },
                  y: { duration: 3 + i * 0.4, repeat: Infinity, ease: "easeInOut" },
                }}
              >
                <PlayingCard code={c as never} size="lg" />
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ============ MEJA PUBLIK YANG SEDANG BERMAIN ============ */}
      <section className="mx-auto mt-10 max-w-5xl px-4">
        <div className="rounded-xl border border-dashed border-[#7fd4a4]/35 bg-black/25 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 font-display text-2xl tracking-wide text-[#7fd4a4]">
                <Radio className="h-5 w-5 animate-pulse" /> MEJA AKTIF
              </h2>
              <p className="mt-1 text-xs text-white/45">
                Tonton permainan yang sedang berlangsung secara langsung.
              </p>
            </div>
            <span className="rounded-full border border-dashed border-[#7fd4a4]/40 bg-[#286e44]/15 px-3 py-1 font-num text-xs font-bold text-[#7fd4a4]">
              {live.data?.rooms.length ?? 0} TERBUKA
            </span>
          </div>

          {live.isLoading && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {[0, 1].map((index) => (
                <div
                  key={index}
                  className="h-28 animate-pulse rounded-lg border border-white/10 bg-white/[0.04]"
                />
              ))}
            </div>
          )}

          {!live.isLoading && (live.data?.rooms.length ?? 0) === 0 && (
            <div className="mt-4 rounded-lg border border-white/10 bg-black/20 px-4 py-8 text-center">
              <p className="font-display text-xl tracking-wide text-[#FEFEEE]/80">
                BELUM ADA MEJA TERBUKA
              </p>
              <p className="mt-1 text-sm text-white/40">
                Mulai lawan online atau kembali lagi saat pemain lain sedang bermain.
              </p>
            </div>
          )}

          {(live.data?.rooms.length ?? 0) > 0 && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {live.data?.rooms.map((room) => (
                <div
                  key={room.code}
                  className="rounded-lg border border-[#7fd4a4]/20 bg-[#286e44]/10 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-[#FEFEEE]">
                        {room.name}
                      </p>
                      <p className="mt-1 font-num text-xs tracking-[0.18em] text-white/45">
                        {room.code}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full border border-white/15 bg-black/25 px-2 py-1 text-[10px] font-bold tracking-wide text-[#7fd4a4]">
                      {room.matchType === "bot" ? "VS BOT" : "ONLINE"}
                    </span>
                  </div>
                  <div className="mt-4 flex items-center justify-between gap-3">
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-white/60">
                      <span className="flex items-center gap-1.5">
                        <Users className="h-3.5 w-3.5 text-[#7fd4a4]" />
                        <b className="font-num text-[#FEFEEE]">{room.playersOnline}</b>
                        user aktif
                      </span>
                      <span>
                        target <b className="font-num text-[#f5c036]">{room.targetScore}</b>
                      </span>
                    </div>
                    <button
                      onClick={() => navigate(`/room/${room.code}`)}
                      className="btn-stitch h-9 shrink-0 px-3 text-xs"
                    >
                      <Eye className="h-4 w-4" /> TONTON
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ============ STATISTIK SAYA ============ */}
      {isAuthenticated && stats && (
        <section className="mx-auto mt-10 max-w-5xl px-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "PERMAINAN", value: stats.gamesPlayed, icon: Users },
              { label: "MENANG", value: stats.gamesWon, icon: Trophy },
              { label: "WIN RATE", value: `${winRate}%`, icon: Target },
              { label: "REMI!", value: stats.rummyCount, icon: Bot },
            ].map((s) => (
              <div
                key={s.label}
                className="rounded-xl border border-dashed border-[#f5c036]/30 bg-black/25 px-4 py-3 text-center"
              >
                <div className="font-num text-3xl font-bold text-[#f5c036]">{s.value}</div>
                <div className="mt-1 text-[10px] font-semibold tracking-[0.2em] text-white/50">
                  {s.label}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ============ LEADERBOARD & RIWAYAT ============ */}
      <section className="mx-auto mt-10 grid max-w-5xl gap-6 px-4 pb-8 lg:grid-cols-2">
        <div className="rounded-xl border border-dashed border-[#f5c036]/30 bg-black/25 p-5">
          <h2 className="font-display text-2xl tracking-wide text-[#f5c036]">
            PAPAN PERINGKAT
          </h2>
          <div className="mt-4 space-y-2">
            {(leaderboard.data ?? []).length === 0 && (
              <p className="py-6 text-center text-sm text-white/40">
                Belum ada pemain di papan peringkat. Jadilah yang pertama!
              </p>
            )}
            {(leaderboard.data ?? []).map((p, i) => (
              <div
                key={p.userId}
                className="flex items-center gap-3 rounded-lg bg-white/[0.04] px-3 py-2"
              >
                <span
                  className={`font-num w-6 text-center font-bold ${
                    i === 0 ? "text-[#f5c036]" : i < 3 ? "text-[#FEFEEE]" : "text-white/40"
                  }`}
                >
                  {i + 1}
                </span>
                {p.avatar ? (
                  <img src={p.avatar} alt="" className="h-7 w-7 rounded-full object-cover" />
                ) : (
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#286e44] font-display text-sm">
                    {(p.name ?? "P")[0]?.toUpperCase()}
                  </span>
                )}
                <span className="flex-1 truncate text-sm font-medium">{p.name}</span>
                <span className="font-num text-sm text-white/60">{p.gamesWon} menang</span>
                <span className="font-num text-sm font-bold text-[#f5c036]">{p.totalPoints}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-dashed border-[#f5c036]/30 bg-black/25 p-5">
          <h2 className="flex items-center gap-2 font-display text-2xl tracking-wide text-[#f5c036]">
            <History className="h-5 w-5" /> RIWAYAT SAYA
          </h2>
          <div className="mt-4 space-y-2">
            {!isAuthenticated && (
              <p className="py-6 text-center text-sm text-white/40">
                Masuk untuk melihat riwayat permainanmu.
              </p>
            )}
            {isAuthenticated && history.length === 0 && (
              <p className="py-6 text-center text-sm text-white/40">
                Belum ada permainan. Buat room pertamamu!
              </p>
            )}
            {history.map((m) => {
              const meWon = m.winnerUserId === user?.id;
              return (
                <div
                  key={m.id}
                  className="flex items-center gap-3 rounded-lg bg-white/[0.04] px-3 py-2"
                >
                  <span
                    className={`rounded px-1.5 py-0.5 font-display text-xs tracking-wide ${
                      meWon ? "bg-[#286e44] text-[#FEFEEE]" : "bg-[#c10328]/80 text-[#FEFEEE]"
                    }`}
                  >
                    {meWon ? "MENANG" : "KALAH"}
                  </span>
                  <div className="flex-1 text-sm">
                    <span className="text-white/80">Room {m.roomCode}</span>
                    <span className="ml-2 text-white/40">
                      {m.players.length} pemain · {m.rounds} ronde
                    </span>
                  </div>
                  <span className="font-num text-xs text-white/40">
                    {new Date(m.createdAt).toLocaleDateString("id-ID", {
                      day: "numeric", month: "short",
                    })}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ============ CARA MAIN ============ */}
      <section className="mx-auto max-w-5xl px-4 pb-16">
        <div className="rounded-xl border border-dashed border-[#f5c036]/30 bg-black/25 p-5">
          <h2 className="font-display text-2xl tracking-wide text-[#f5c036]">CARA MAIN</h2>
          <Accordion type="single" collapsible className="mt-2">
            <AccordionItem value="goal" className="border-white/10">
              <AccordionTrigger className="text-sm font-semibold hover:text-[#f5c036]">
                Tujuan permainan
              </AccordionTrigger>
              <AccordionContent className="text-sm leading-relaxed text-white/70">
                Setiap pemain memegang <b>7 kartu</b> dari dek 52 kartu + <b>2 joker</b>.
                Susun kartu menjadi kombinasi <b>jadi</b>: <b>Seri</b> (3+ kartu berurutan
                sebunga — As melingkar, jadi K-A-2 sah) dan <b>Set</b> (3–4 kartu berangka
                sama). Kartu jadi bernilai <b className="text-[#7fd4a4]">PLUS</b>, kartu sisa
                di tangan bernilai <b className="text-[#e0707f]">MINUS</b>. Skor diakumulasi
                antar-sesi — pemain pertama yang menembus <b>target skor</b> menang.
                Hati-hati: kalau skormu <b>tersalip</b> pemain lain, skormu hangus ke 0!
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="turn" className="border-white/10">
              <AccordionTrigger className="text-sm font-semibold hover:text-[#f5c036]">
                Alur giliran
              </AccordionTrigger>
              <AccordionContent className="text-sm leading-relaxed text-white/70">
                Setiap giliran: <b>1)</b> Ambil kartu teratas deck, atau ambil dari tumpukan
                buangan — maksimal <b>7 kartu teratas</b>, dan kartu yang kamu incar harus
                langsung <b>jadi</b> dengan minimal 2 kartu di tanganmu (semua kartu di
                atasnya ikut terambil). <b>2)</b> Buka kombinasi jadi —{" "}
                <b>kombinasi pertamamu wajib seri tanpa joker</b>. Kartu jadi tidak bisa
                ditambah lagi. <b>3)</b> Buang 1 kartu terbuka. Kalau semua kartumu jadi dan
                sisa satu — buang <b>tertutup</b> untuk <b className="text-[#f5c036]">TUTUP
                TANGAN (+250)</b> dan akhiri sesi!
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="score" className="border-white/10">
              <AccordionTrigger className="text-sm font-semibold hover:text-[#f5c036]">
                Perhitungan skor
              </AccordionTrigger>
              <AccordionContent className="text-sm leading-relaxed text-white/70">
                Kartu angka 2–10 = <b>5 poin</b>, J/Q/K = <b>10 poin</b>, As ={" "}
                <b>15 poin</b>, joker = nilai kartu yang diwakilinya. Akhir sesi: kartu jadi
                menambah skormu, kartu sisa tangan menguranginya. Tutup tangan ={" "}
                <b className="text-[#f5c036]">+250</b>. Sesi juga berakhir kalau deck habis.
                Pemain pertama sesi berikutnya adalah pemegang skor tertinggi.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="joker" className="border-white/10">
              <AccordionTrigger className="text-sm font-semibold hover:text-[#f5c036]">
                Aturan joker
              </AccordionTrigger>
              <AccordionContent className="text-sm leading-relaxed text-white/70">
                Joker bisa menggantikan kartu apa pun, tapi: <b>1)</b> tidak boleh dipakai di
                kombinasi pertamamu; <b>2)</b> membuang joker terbuka ={" "}
                <b className="text-[#e0707f]">sesi langsung berakhir</b>; <b>3)</b> joker yang
                masih di tangan saat sesi berakhir ={" "}
                <b className="text-[#e0707f]">−500 poin</b>; <b>4)</b> tutup tangan dengan
                joker = <b className="text-[#f5c036]">+500 poin</b>!
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="room" className="border-white/10">
              <AccordionTrigger className="text-sm font-semibold hover:text-[#f5c036]">
                Room &amp; undang teman
              </AccordionTrigger>
              <AccordionContent className="text-sm leading-relaxed text-white/70">
                Buat room, lalu bagikan <b>kode 6 huruf</b> atau <b>link undangan</b> ke
                temanmu. Kursi kosong bisa diisi bot agar bisa langsung main. Pemain yang
                keluar di tengah permainan digantikan bot, jadi permainan tidak pernah macet.
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
        <p className="mt-8 text-center text-xs text-white/30">
          RemiKu — remi Indonesia (ceki) untuk 2–4 pemain · <Copy className="inline h-3 w-3" /> bagikan
          kode room untuk mengundang teman
        </p>
      </section>
    </div>
  );
}

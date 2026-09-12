import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import {
  Copy, Check, Share2, Crown, Bot, X, UserPlus, LogOut, Play, Loader2,
} from "lucide-react";
import { TARGET_SCORES } from "@contracts/rummy";

export function Lobby({ code }: { code: string }) {
  const { user, isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [copied, setCopied] = useState<"code" | "link" | null>(null);

  const roomQuery = trpc.rummy.get.useQuery(
    { code },
    { refetchInterval: 1200, retry: false },
  );
  if (!roomQuery.data) return null;
  const { name, state } = roomQuery.data;
  const me = state.you;
  const isHost = me !== null && state.hostSeat === me.seat;
  const inviteUrl = `${window.location.origin}/room/${code}`;

  const invalidate = () => utils.rummy.get.invalidate({ code });
  const onErr = (e: { message: string }) => toast.error(e.message);

  const join = trpc.rummy.join.useMutation({ onSuccess: invalidate, onError: onErr });
  const leave = trpc.rummy.leave.useMutation({
    onSuccess: () => navigate("/", { replace: true }),
    onError: onErr,
  });
  const addBot = trpc.rummy.addBot.useMutation({ onSuccess: invalidate, onError: onErr });
  const removePlayer = trpc.rummy.removePlayer.useMutation({
    onSuccess: invalidate,
    onError: onErr,
  });
  const setOptions = trpc.rummy.setOptions.useMutation({
    onSuccess: invalidate,
    onError: onErr,
  });
  const start = trpc.rummy.start.useMutation({ onSuccess: invalidate, onError: onErr });

  const copy = async (text: string, what: "code" | "link") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1800);
      toast.success(what === "code" ? "Kode room disalin!" : "Link undangan disalin!");
    } catch {
      toast.error("Gagal menyalin");
    }
  };

  const share = async () => {
    const text = `Ayo main remi bareng di RemiKu! Gabung room aku: ${inviteUrl} (kode: ${code})`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "RemiKu — Ajakan Main Remi", text, url: inviteUrl });
      } catch {
        /* dibatalkan user */
      }
    } else {
      copy(inviteUrl, "link");
    }
  };

  const emptySeats = state.maxPlayers - state.players.length;
  const leaveToHome = () => {
    if (me) leave.mutate({ code });
    else navigate("/", { replace: true });
  };
  const leaveThenLogout = () => {
    if (me) {
      leave.mutate(
        { code },
        {
          onSuccess: () => logout(),
        },
      );
    } else {
      logout();
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader
        onHome={leaveToHome}
        onLogout={leaveThenLogout}
        busy={leave.isPending}
      />

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 pb-16">
        {/* Judul room + kode */}
        <div className="mt-2 text-center">
          <p className="text-xs font-semibold tracking-[0.25em] text-white/40">LOBBY ROOM</p>
          <h1 className="mt-1 font-display text-5xl tracking-wide text-[#FEFEEE]">{name}</h1>
          <button
            onClick={() => copy(code, "code")}
            className="group mx-auto mt-3 flex items-center gap-3 rounded-full border-2 border-dashed border-[#f5c036]/60 bg-black/30 px-5 py-2 transition-colors hover:border-[#f5c036]"
          >
            <span className="font-num text-2xl font-bold tracking-[0.35em] text-[#f5c036]">
              {code}
            </span>
            {copied === "code" ? (
              <Check className="h-4 w-4 text-[#286e44]" />
            ) : (
              <Copy className="h-4 w-4 text-white/50 group-hover:text-[#f5c036]" />
            )}
          </button>
        </div>

        {/* Undang teman */}
        <div className="mx-auto mt-6 max-w-xl rounded-xl border border-dashed border-[#f5c036]/40 bg-black/25 p-4">
          <p className="text-center text-xs font-semibold tracking-[0.2em] text-[#f5c036]">
            UNDANG TEMAN KE ROOM INI
          </p>
          <div className="mt-3 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-black/40 px-3 py-2 font-num text-xs text-white/70">
              {inviteUrl}
            </code>
            <Button
              size="sm"
              onClick={() => copy(inviteUrl, "link")}
              className="shrink-0 bg-[#f5c036] font-semibold text-[#1a150a] hover:bg-[#ffd35c]"
            >
              {copied === "link" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={share}
              className="shrink-0 border-[#286e44] bg-[#286e44]/30 text-[#FEFEEE] hover:bg-[#286e44]/60"
            >
              <Share2 className="h-4 w-4" />
            </Button>
          </div>
          <a
            href={`https://wa.me/?text=${encodeURIComponent(
              `Ayo main remi bareng di RemiKu! Gabung room aku: ${inviteUrl} (kode: ${code})`,
            )}`}
            target="_blank"
            rel="noreferrer"
            className="mt-2 block text-center text-xs text-[#286e44] underline underline-offset-2 hover:text-[#3a9b63]"
          >
            Bagikan lewat WhatsApp →
          </a>
        </div>

        {/* Kursi pemain */}
        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {state.players.map((p) => (
            <div
              key={p.seat}
              className={`relative rounded-xl border-2 p-4 text-center transition-colors ${
                p.userId === user?.id
                  ? "border-[#f5c036] bg-[#f5c036]/10"
                  : "border-dashed border-white/20 bg-black/25"
              }`}
            >
              {isHost && p.seat !== state.hostSeat && (
                <button
                  onClick={() => removePlayer.mutate({ code, seat: p.seat })}
                  title="Keluarkan"
                  className="absolute right-1.5 top-1.5 rounded-full p-1 text-white/30 hover:bg-[#c10328]/20 hover:text-[#c10328]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
              {p.avatar ? (
                <img
                  src={p.avatar}
                  alt=""
                  className="mx-auto h-12 w-12 rounded-full object-cover ring-2 ring-[#f5c036]/40"
                />
              ) : (
                <span
                  className={`mx-auto flex h-12 w-12 items-center justify-center rounded-full font-display text-xl ring-2 ring-[#f5c036]/40 ${
                    p.isBot ? "bg-[#3a3a35] text-white/70" : "bg-[#286e44] text-[#FEFEEE]"
                  }`}
                >
                  {p.isBot ? <Bot className="h-6 w-6" /> : p.name[0]?.toUpperCase()}
                </span>
              )}
              <p className="mt-2 truncate text-sm font-semibold">{p.name}</p>
              <div className="mt-1 flex items-center justify-center gap-1.5">
                {p.isHost && (
                  <span className="flex items-center gap-1 rounded bg-[#f5c036]/20 px-1.5 py-0.5 text-[10px] font-bold text-[#f5c036]">
                    <Crown className="h-3 w-3" /> HOST
                  </span>
                )}
                {p.isBot && (
                  <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-bold text-white/50">
                    BOT
                  </span>
                )}
                {p.userId === user?.id && (
                  <span className="rounded bg-[#286e44]/40 px-1.5 py-0.5 text-[10px] font-bold text-[#7fd4a4]">
                    KAMU
                  </span>
                )}
              </div>
            </div>
          ))}

          {Array.from({ length: emptySeats }).map((_, i) => (
            <button
              key={`empty-${i}`}
              onClick={() => isHost && addBot.mutate({ code })}
              disabled={!isHost || addBot.isPending}
              className="group flex min-h-28 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-white/15 bg-black/10 p-4 text-white/30 transition-colors enabled:hover:border-[#286e44] enabled:hover:text-[#7fd4a4]"
            >
              {addBot.isPending ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <UserPlus className="h-5 w-5" />
              )}
              <span className="text-xs font-semibold">
                {addBot.isPending ? "Menambah..." : isHost ? "+ Tambah Bot" : "Kursi kosong"}
              </span>
            </button>
          ))}
        </div>

        {/* Pengaturan target skor */}
        <div className="mx-auto mt-6 max-w-md text-center">
          <p className="text-xs font-semibold tracking-[0.2em] text-white/40">TARGET SKOR</p>
          <div className="mt-2 flex justify-center gap-2">
            {TARGET_SCORES.map((t) => (
              <button
                key={t}
                onClick={() => isHost && setOptions.mutate({ code, targetScore: t })}
                disabled={!isHost}
                className={`rounded-lg border-2 px-4 py-1.5 font-num font-bold transition-all ${
                  state.targetScore === t
                    ? "border-[#f5c036] bg-[#f5c036]/15 text-[#f5c036]"
                    : "border-white/15 text-white/40 enabled:hover:border-white/30"
                } ${!isHost && "cursor-default"}`}
              >
                {t}
              </button>
            ))}
          </div>
          {!isHost && me && (
            <p className="mt-1 text-[11px] text-white/30">Hanya host yang bisa mengubah</p>
          )}
        </div>

        {/* Aksi utama */}
        <div className="mt-8 flex flex-col items-center gap-3">
          {me === null ? (
            isAuthenticated ? (
              <button
                onClick={() => join.mutate({ code })}
                disabled={join.isPending || state.players.length >= state.maxPlayers}
                className="btn-gold h-14 px-10 text-2xl disabled:opacity-60"
              >
                {join.isPending && <Loader2 className="h-5 w-5 animate-spin" />}
                {join.isPending
                  ? "BERGABUNG..."
                  : state.players.length >= state.maxPlayers
                    ? "ROOM PENUH"
                    : "GABUNG ROOM"}
              </button>
            ) : (
              <button onClick={() => navigate("/login")} className="btn-gold h-14 px-10 text-2xl">
                MASUK UNTUK GABUNG
              </button>
            )
          ) : isHost ? (
            <button
              onClick={() => start.mutate({ code })}
              disabled={start.isPending || state.players.length < 2}
              className="btn-gold h-14 px-10 text-2xl disabled:opacity-60"
            >
              {start.isPending ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Play className="h-5 w-5" />
              )}
              {start.isPending
                ? "MEMULAI..."
                : state.players.length < 2
                  ? "BUTUH MIN. 2 PEMAIN"
                  : "MULAI PERMAINAN"}
            </button>
          ) : (
            <p className="animate-pulse font-display text-2xl tracking-wide text-white/50">
              MENUNGGU HOST MEMULAI...
            </p>
          )}

          {me !== null && (
            <button
              onClick={leaveToHome}
              disabled={leave.isPending}
              className="btn-stitch h-10 text-base"
            >
              <LogOut className="h-4 w-4" /> KELUAR ROOM
            </button>
          )}
        </div>
      </main>
    </div>
  );
}

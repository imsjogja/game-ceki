import { useEffect } from "react";
import { useParams } from "react-router";
import { trpc } from "@/providers/trpc";
import { SiteHeader } from "@/components/SiteHeader";
import { Lobby } from "@/components/game/Lobby";
import { GameTable } from "@/components/game/GameTable";
import { VoiceControls } from "@/components/game/VoiceControls";
import { useVoiceChat } from "@/hooks/useVoiceChat";

export default function Room() {
  const { code = "" } = useParams();
  const roomCode = code.toUpperCase();

  const roomQuery = trpc.rummy.get.useQuery(
    { code: roomCode },
    {
      refetchInterval: 1200,
      retry: false,
      refetchOnWindowFocus: true,
    },
  );

  // Voice chat room — WebRTC P2P, signaling lewat polling tRPC ringan.
  const room = roomQuery.data;
  const state = room?.state;
  const me = state?.you ?? null;
  const myPlayer = state?.players.find((p) => p.seat === me?.seat);
  const voice = useVoiceChat({
    code: roomCode,
    name: myPlayer?.name ?? "Penonton",
    avatar: myPlayer?.avatar ?? null,
    seat: me?.seat ?? null,
  });
  const roomUnavailable = !roomQuery.isLoading && (!!roomQuery.error || !room);

  // Room yang sudah dihancurkan dapat masih terbuka di tab pemain terakhir.
  // Pakai navigasi dokumen, bukan hanya state router, agar tab yang sedang
  // memiliki request polling lama selalu pulih ke beranda tanpa blank screen.
  useEffect(() => {
    if (!roomUnavailable) return;
    window.location.replace("/");
  }, [roomUnavailable]);

  if (roomQuery.isLoading) {
    return (
      <div className="flex min-h-screen flex-col">
        <SiteHeader />
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <div className="font-display text-4xl text-[#f5c036] animate-pulse">
              MEMUAT MEJA...
            </div>
            <p className="mt-2 font-num text-sm text-white/40">{roomCode}</p>
          </div>
        </div>
      </div>
    );
  }

  if (roomUnavailable || !room) {
    // Fallback terlihat selama browser memproses redirect dokumen di atas.
    // Ini mencegah halaman room yang sudah tidak ada tampak seperti layar hitam.
    return (
      <div className="flex min-h-screen flex-col">
        <SiteHeader />
        <main className="flex flex-1 items-center justify-center px-4 text-center">
          <div>
            <p className="font-display text-4xl tracking-wide text-[#f5c036]">
              ROOM SUDAH DITUTUP
            </p>
            <p className="mt-2 text-sm text-white/55">
              Mengarahkan kembali ke beranda…
            </p>
            <a href="/" className="btn-gold mt-6 h-11 px-6 text-lg">
              KE BERANDA
            </a>
          </div>
        </main>
      </div>
    );
  }

  // Selain status waiting, tampilkan meja permainan (pemain & penonton)
  if (room.state.status !== "waiting") {
    return (
      <>
        <GameTable code={roomCode} room={room} voiceBySeat={voice.bySeat} />
        {room.state.matchType !== "stranger" && (
          <VoiceControls voice={voice} />
        )}
      </>
    );
  }

  return (
    <>
      <Lobby code={roomCode} room={room} />
      {room.state.matchType !== "stranger" && (
        <VoiceControls voice={voice} />
      )}
    </>
  );
}

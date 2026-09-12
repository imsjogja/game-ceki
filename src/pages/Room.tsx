import { useEffect } from "react";
import { useParams } from "react-router";
import { trpc } from "@/lib/trpc";
import { SiteHeader } from "@/components/SiteHeader";
import { Lobby } from "@/components/game/Lobby";
import { GameTable } from "@/components/game/GameTable";
import {
  LobbyVoiceControl,
  VoiceControls,
} from "@/components/game/VoiceControls";
import { useGameRoom } from "@/hooks/useGameRoom";
import { useVoiceChat } from "@/hooks/useVoiceChat";

export default function Room() {
  const { code = "" } = useParams();
  const roomCode = code.toUpperCase();

  const roomQuery = trpc.rummy.get.useQuery(
    { code: roomCode },
    {
      retry: false,
      staleTime: Infinity,
      refetchOnWindowFocus: false,
    }
  );

  const realtime = useGameRoom({
    code: roomCode,
  });

  // Voice chat WebRTC P2P dengan signaling WebSocket event-driven.
  // Query HTTP adalah snapshot awal/fallback. Jangan biarkan snapshot WS
  // lama menimpa respons HTTP yang sudah memiliki version room lebih baru
  // ketika keduanya selesai hampir bersamaan saat halaman dibuka.
  const room =
    realtime.room?.code === roomCode &&
    (!roomQuery.data || realtime.room.version >= roomQuery.data.version)
      ? realtime.room
      : roomQuery.data;
  const state = room?.state;
  const me = state?.you ?? null;
  const voice = useVoiceChat({
    code: roomCode,
    seat: me?.seat ?? null,
  });
  const roomUnavailable =
    !room &&
    (roomQuery.error !== null ||
      realtime.error !== null ||
      (!roomQuery.isLoading && !realtime.isConnecting));
  const canUseVoice = me !== null && state?.matchType !== "stranger";

  // Room yang sudah dihancurkan dapat masih terbuka di tab pemain terakhir.
  // Pakai navigasi dokumen, bukan hanya state router, agar tab yang sedang
  // memiliki request polling lama selalu pulih ke beranda tanpa blank screen.
  useEffect(() => {
    if (!roomUnavailable) return;
    window.location.replace("/");
  }, [roomUnavailable]);

  if (!room && (roomQuery.isLoading || realtime.isConnecting)) {
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
        <GameTable
          code={roomCode}
          room={room}
          voiceBySeat={voice.bySeat}
          voice={canUseVoice ? voice : undefined}
        />
        {canUseVoice && <VoiceControls voice={voice} />}
      </>
    );
  }

  return (
    <>
      <Lobby code={roomCode} room={room} />
      {canUseVoice && (
        <>
          <VoiceControls voice={voice} />
          <LobbyVoiceControl voice={voice} />
        </>
      )}
    </>
  );
}

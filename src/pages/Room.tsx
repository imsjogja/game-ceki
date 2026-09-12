import { useParams, useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { SiteHeader } from "@/components/SiteHeader";
import { Lobby } from "@/components/game/Lobby";
import { GameTable } from "@/components/game/GameTable";
import { VoiceControls } from "@/components/game/VoiceControls";
import { useVoiceChat } from "@/hooks/useVoiceChat";
import { Button } from "@/components/ui/button";

export default function Room() {
  const { code = "" } = useParams();
  const navigate = useNavigate();
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
  const state = roomQuery.data?.state;
  const me = state?.you ?? null;
  const myPlayer = state?.players.find((p) => p.seat === me?.seat);
  const voice = useVoiceChat({
    code: roomCode,
    name: myPlayer?.name ?? "Penonton",
    avatar: myPlayer?.avatar ?? null,
    seat: me?.seat ?? null,
  });

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

  if (roomQuery.error || !roomQuery.data) {
    return (
      <div className="flex min-h-screen flex-col">
        <SiteHeader />
        <div className="flex flex-1 items-center justify-center px-4">
          <div className="rounded-xl border border-dashed border-[#c10328]/50 bg-black/30 p-8 text-center">
            <div className="font-display text-4xl text-[#c10328]">ROOM TIDAK DITEMUKAN</div>
            <p className="mt-2 text-sm text-white/50">
              Kode <span className="font-num font-bold">{roomCode}</span> tidak valid
              atau room sudah ditutup.
            </p>
            <Button
              onClick={() => navigate("/")}
              className="mt-6 rounded-full bg-[#f5c036] font-display text-lg tracking-wide text-[#1a150a] hover:bg-[#ffd35c]"
            >
              KE BERANDA
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Selain status waiting, tampilkan meja permainan (pemain & penonton)
  if (roomQuery.data.state.status !== "waiting") {
    return (
      <>
        <GameTable code={roomCode} voiceBySeat={voice.bySeat} />
        <VoiceControls voice={voice} />
      </>
    );
  }

  return (
    <>
      <Lobby code={roomCode} />
      <VoiceControls voice={voice} />
    </>
  );
}

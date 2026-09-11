import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Logo } from "@/components/SiteHeader";
import { SuitIcon } from "@/components/game/PlayingCard";
import { trpc } from "@/providers/trpc";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Ghost } from "lucide-react";

function getOAuthUrl() {
  const kimiAuthUrl = import.meta.env.VITE_KIMI_AUTH_URL;
  const appID = import.meta.env.VITE_APP_ID;
  const redirectUri = `${window.location.origin}/api/oauth/callback`;
  const state = btoa(redirectUri);

  const url = new URL(`${kimiAuthUrl}/api/oauth/authorize`);
  url.searchParams.set("client_id", appID);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "profile");
  url.searchParams.set("state", state);

  return url.toString();
}

export default function Login() {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const guestLogin = trpc.auth.guest.useMutation({
    onSuccess: async (data) => {
      await utils.invalidate();
      toast.success(`Selamat datang, ${data.name}!`);
      navigate("/");
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="mb-8 text-center">
        <div className="flex justify-center"><Logo size="text-5xl" /></div>
        <p className="mt-2 text-sm text-white/50">
          Game remi online — buat room, undang teman, menangkan meja.
        </p>
      </div>
      <Card className="w-full max-w-sm border-[#f5c036]/30 bg-[#1c1812] text-[#FEFEEE]">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex -space-x-1.5">
            <SuitIcon suit="S" className="h-6 w-6 text-[#FEFEEE]" />
            <SuitIcon suit="H" className="h-6 w-6 text-[#c10328]" />
            <SuitIcon suit="C" className="h-6 w-6 text-[#FEFEEE]" />
            <SuitIcon suit="D" className="h-6 w-6 text-[#c10328]" />
          </div>
          <CardTitle className="font-display text-3xl tracking-wide text-[#f5c036]">
            MASUK & MAIN
          </CardTitle>
          <p className="text-xs text-white/40">
            Satu klik — statistik dan riwayat permainanmu tersimpan.
          </p>
        </CardHeader>
        <CardContent>
          <button
            className="btn-gold h-12 w-full"
            onClick={() => {
              window.location.href = getOAuthUrl();
            }}
          >
            MASUK DENGAN KIMI
          </button>
          <div className="my-3 flex items-center gap-3">
            <span className="h-px flex-1 bg-white/10" />
            <span className="text-[10px] tracking-[0.2em] text-white/30">ATAU</span>
            <span className="h-px flex-1 bg-white/10" />
          </div>
          <button
            className="btn-stitch h-11 w-full"
            onClick={() => guestLogin.mutate()}
            disabled={guestLogin.isPending}
          >
            <Ghost className="h-4 w-4" />
            {guestLogin.isPending ? "MASUK..." : "MASUK SEBAGAI TAMU"}
          </button>
          <p className="mt-2 text-center text-[11px] text-white/30">
            Tamu langsung main tanpa daftar — identitas baru tiap sesi tamu.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

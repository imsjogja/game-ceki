import { Link, useNavigate } from "react-router";
import { useAuth } from "@/hooks/useAuth";
import { SuitIcon } from "@/components/game/PlayingCard";
import { LogOut } from "lucide-react";

export function Logo({ size = "text-3xl" }: { size?: string }) {
  return (
    <Link to="/" className="flex items-center gap-1.5 select-none">
      <span className="flex -space-x-1">
        <SuitIcon suit="S" className="h-4 w-4 text-[#FEFEEE]" />
        <SuitIcon suit="H" className="h-4 w-4 text-[#c10328]" />
      </span>
      <span className={`font-display ${size} text-[#f5c036] text-gold-glow leading-none pt-0.5`}>
        REMIKU
      </span>
    </Link>
  );
}

export function SiteHeader() {
  const { user, isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <header className="relative z-20 flex items-center justify-between px-4 sm:px-8 py-4">
      <Logo />
      <div className="flex items-center gap-3">
        {isAuthenticated && user ? (
          <>
            <div className="flex items-center gap-2 rounded-full border border-dashed border-[#f5c036]/40 bg-black/30 py-1 pl-1 pr-3 backdrop-blur-sm">
              {user.avatar ? (
                <img src={user.avatar} alt="" className="h-7 w-7 rounded-full object-cover" />
              ) : (
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#286e44] font-display text-sm text-[#FEFEEE]">
                  {(user.name ?? "P")[0]?.toUpperCase()}
                </span>
              )}
              <span className="max-w-28 truncate text-sm font-medium">{user.name ?? "Pemain"}</span>
            </div>
            <button
              onClick={() => logout()}
              title="Keluar"
              className="rounded-full border border-dashed border-white/25 p-2 text-white/60 transition-colors hover:border-[#c10328] hover:text-[#c10328]"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </>
        ) : (
          <button onClick={() => navigate("/login")} className="btn-stitch h-10">
            MASUK
          </button>
        )}
      </div>
    </header>
  );
}

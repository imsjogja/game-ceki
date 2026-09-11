import { memo } from "react";
import type { CardCode, Suit } from "@contracts/rummy";
import { RANK_LABEL, isRedCard, isJoker } from "@contracts/rummy";
import { cn } from "@/lib/utils";

export const RED = "#c10328";
export const BLACK = "#221f1a";

export function SuitIcon({
  suit,
  className,
  style,
}: {
  suit: Suit;
  className?: string;
  style?: React.CSSProperties;
}) {
  const common = { className, style, viewBox: "0 0 24 24", fill: "currentColor" as const };
  switch (suit) {
    case "H":
      return (
        <svg {...common}>
          <path d="M12 21.4C6.2 16.3 2.6 12.8 2.6 8.9 2.6 6 4.8 3.9 7.6 3.9c1.7 0 3.3.8 4.4 2.2 1.1-1.4 2.7-2.2 4.4-2.2 2.8 0 5 2.1 5 5 0 3.9-3.6 7.4-9.4 12.5z" />
        </svg>
      );
    case "D":
      return (
        <svg {...common}>
          <path d="M12 2.2 19.4 12 12 21.8 4.6 12z" />
        </svg>
      );
    case "S":
      return (
        <svg {...common}>
          <path d="M12 2.2C8.3 7.4 3.8 10.1 3.8 14c0 2.9 2.1 5 4.9 5 1 0 1.9-.3 2.7-.8L10.3 22h3.4l-1.1-3.8c.8.5 1.7.8 2.7.8 2.8 0 4.9-2.1 4.9-5 0-3.9-4.5-6.6-8.2-11.8z" />
        </svg>
      );
    case "C":
      return (
        <svg {...common}>
          <circle cx="12" cy="7.6" r="4.4" />
          <circle cx="6.8" cy="13.8" r="4.4" />
          <circle cx="17.2" cy="13.8" r="4.4" />
          <path d="M12 12.4 9.6 22h4.8z" />
        </svg>
      );
  }
}

type Size = "xs" | "sm" | "md" | "lg" | "xl";

const SIZES: Record<Size, { w: string; h: string; rank: string; corner: string; center: string }> = {
  xs: { w: "w-8", h: "h-11", rank: "text-[9px]", corner: "w-2", center: "w-4" },
  sm: { w: "w-11", h: "h-[3.9rem]", rank: "text-[11px]", corner: "w-2.5", center: "w-5" },
  md: { w: "w-14", h: "h-20", rank: "text-sm", corner: "w-3", center: "w-7" },
  lg: { w: "w-[4.5rem]", h: "h-[6.5rem]", rank: "text-base", corner: "w-3.5", center: "w-9" },
  xl: { w: "w-20", h: "h-28", rank: "text-lg", corner: "w-4", center: "w-10" },
};

/** Kartu remi — wajah krem dengan indeks sudut, atau punggung anyaman merah. */
export const PlayingCard = memo(function PlayingCard({
  code,
  back = false,
  size = "md",
  selected = false,
  disabled = false,
  dimmed = false,
  onClick,
  className,
  style,
}: {
  code?: CardCode | null;
  back?: boolean;
  size?: Size;
  selected?: boolean;
  disabled?: boolean;
  dimmed?: boolean;
  onClick?: () => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  const s = SIZES[size];

  if (back || !code) {
    return (
      <div
        onClick={disabled ? undefined : onClick}
        style={style}
        className={cn(
          s.w, s.h,
          "relative shrink-0 rounded-[0.45rem] card-shadow select-none",
          !disabled && onClick && "cursor-pointer",
          className,
        )}
      >
        <div className="absolute inset-0 rounded-[0.45rem] bg-[#8e0c26]" />
        <div
          className="absolute inset-[3px] rounded-[0.35rem]"
          style={{
            background: "#c10328",
            backgroundImage:
              "repeating-linear-gradient(45deg, rgba(245,192,54,.16) 0 2px, transparent 2px 6px), repeating-linear-gradient(-45deg, rgba(0,0,0,.18) 0 2px, transparent 2px 6px)",
          }}
        />
        <div className="absolute inset-[3px] rounded-[0.35rem] border border-dashed border-[#f5c036]/50" />
      </div>
    );
  }

  const suit = code[1] as Suit;
  const color = isRedCard(code) ? RED : BLACK;

  // ── Joker: wajah emas dengan bintang ──
  if (isJoker(code)) {
    return (
      <div
        onClick={disabled ? undefined : onClick}
        style={style}
        className={cn(
          s.w, s.h,
          "relative shrink-0 rounded-[0.45rem] card-shadow select-none transition-all duration-150",
          !disabled && onClick && "cursor-pointer hover:-translate-y-1.5",
          selected && "-translate-y-3.5 ring-[2.5px] ring-[#f5c036]",
          dimmed && "opacity-40",
          className,
        )}
      >
        <div className="absolute inset-0 rounded-[0.45rem] bg-[#1a150a]" />
        <div
          className="absolute inset-[3px] rounded-[0.35rem]"
          style={{
            background:
              "radial-gradient(circle at 50% 32%, #f5c036 0%, #b8860b 45%, #5c4308 100%)",
          }}
        />
        <div className="absolute inset-[3px] rounded-[0.35rem] border border-dashed border-[#1a150a]/60" />
        <span
          className={cn(
            "absolute left-1 top-0.5 font-display leading-none text-[#1a150a]",
            s.rank,
          )}
        >
          J
        </span>
        <span
          className={cn(
            "absolute bottom-0.5 right-1 rotate-180 font-display leading-none text-[#1a150a]",
            s.rank,
          )}
        >
          J
        </span>
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          className={cn(s.center, "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[#1a150a]")}
        >
          <path d="M12 1.8l2.9 6.6 7.1.7-5.4 4.8 1.6 7-6.2-3.8-6.2 3.8 1.6-7L2 9.1l7.1-.7z" />
        </svg>
      </div>
    );
  }

  return (
    <div
      onClick={disabled ? undefined : onClick}
      style={style}
      className={cn(
        s.w, s.h,
        "relative shrink-0 rounded-[0.45rem] bg-[#FEFEEE] card-shadow select-none transition-all duration-150",
        !disabled && onClick && "cursor-pointer hover:-translate-y-1.5",
        selected && "-translate-y-3.5 ring-[2.5px] ring-[#f5c036]",
        dimmed && "opacity-40",
        className,
      )}
    >
      {/* indeks sudut kiri atas */}
      <div
        className={cn("absolute left-1 top-0.5 flex flex-col items-center leading-none font-bold", s.rank)}
        style={{ color }}
      >
        <span>{RANK_LABEL[code[0] as keyof typeof RANK_LABEL]}</span>
        <SuitIcon suit={suit} className={cn(s.corner, "mt-px")} />
      </div>
      {/* indeks sudut kanan bawah */}
      <div
        className={cn("absolute right-1 bottom-0.5 flex flex-col items-center leading-none font-bold rotate-180", s.rank)}
        style={{ color }}
      >
        <span>{RANK_LABEL[code[0] as keyof typeof RANK_LABEL]}</span>
        <SuitIcon suit={suit} className={cn(s.corner, "mt-px")} />
      </div>
      {/* suit tengah */}
      <SuitIcon
        suit={suit}
        className={cn(s.center, "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2")}
        style={{ color }}
      />
    </div>
  );
});

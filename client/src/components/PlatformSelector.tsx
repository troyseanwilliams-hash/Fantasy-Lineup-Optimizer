import { ALL_PLATFORMS, PLATFORM_COLORS, isPlatformSupported, type Platform, type Sport } from "@shared/platform-config";
import { Crown } from "lucide-react";

interface PlatformSelectorProps {
  sport: Sport | string;
  value: Platform;
  onChange: (p: Platform) => void;
  showProBadge?: boolean;
  tier?: string;
  className?: string;
}

export function PlatformSelector({
  sport,
  value,
  onChange,
  showProBadge = false,
  tier = "free",
  className = "",
}: PlatformSelectorProps) {
  const isAdmin = tier === "admin";

  return (
    <div
      className={`flex items-center bg-slate-800/60 border border-slate-700/50 rounded-xl p-1 gap-0.5 ${className}`}
      data-testid="platform-selector"
    >
      {ALL_PLATFORMS.map(({ value: p, label, shortLabel }) => {
        if (!isPlatformSupported(sport as Sport, p)) return null;

        const colors = PLATFORM_COLORS[p];
        const isActive = value === p;
        const isLocked = showProBadge && p !== "draftkings" && !isAdmin;

        return (
          <button
            key={p}
            onClick={() => {
              if (isLocked) return;
              onChange(p);
            }}
            data-testid={`platform-tab-${p}`}
            title={isLocked ? `${label} coming soon` : label}
            className={`
              relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black
              transition-all select-none
              ${isActive
                ? `${colors.bg} ${colors.text} border ${colors.border}`
                : isLocked
                ? "text-slate-600 cursor-not-allowed"
                : "text-slate-400 hover:text-white hover:bg-slate-700/40"
              }
            `}
          >
            {shortLabel}
            {isLocked && (
              <Crown className="w-2.5 h-2.5 text-amber-400/80" />
            )}
          </button>
        );
      })}
    </div>
  );
}

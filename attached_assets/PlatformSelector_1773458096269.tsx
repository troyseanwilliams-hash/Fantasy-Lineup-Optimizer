// PlatformSelector.tsx
// Drop-in platform tab bar for the Optimizer and ProOptimizer headers.
// Renders DraftKings / FanDuel / Yahoo tabs with per-platform colours.
// Hides Yahoo for sports it doesn't support (Soccer).
//
// Usage:
//   <PlatformSelector
//     sport="NBA"
//     value={platform}
//     onChange={setPlatform}
//   />

import { Badge } from "@/components/ui/badge";
import { ALL_PLATFORMS, PLATFORM_COLORS, isPlatformSupported, type Platform, type Sport } from "@shared/platform-config";
import { Crown } from "lucide-react";

interface PlatformSelectorProps {
  sport: Sport | string;
  value: Platform;
  onChange: (p: Platform) => void;
  /** If true, show a small "PRO" badge on FD/YH to indicate they're paid features */
  showProBadge?: boolean;
  /** Tier string from subscription — used to gate FD/YH behind paywall */
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
  const isPaid = tier === "pro" || tier === "premium" || tier === "star";

  return (
    <div
      className={`flex items-center bg-slate-800/60 border border-slate-700/50 rounded-xl p-1 gap-0.5 ${className}`}
      data-testid="platform-selector"
    >
      {ALL_PLATFORMS.map(({ value: p, label, shortLabel }) => {
        // Hide unsupported platforms (Yahoo doesn't have Soccer)
        if (!isPlatformSupported(sport as Sport, p)) return null;

        const colors = PLATFORM_COLORS[p];
        const isActive = value === p;
        const isLocked = showProBadge && p !== "draftkings" && !isPaid;

        return (
          <button
            key={p}
            onClick={() => {
              if (isLocked) return; // let parent show upsell toast
              onChange(p);
            }}
            data-testid={`platform-tab-${p}`}
            title={isLocked ? `${label} requires a paid plan` : label}
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

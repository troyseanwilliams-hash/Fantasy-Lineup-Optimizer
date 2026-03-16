import { useState, useEffect, useCallback, useRef } from "react";
import { X, ChevronRight, ChevronLeft, Sparkles, Zap, Archive, TrendingUp, Activity, Layers, Crown, BarChart3, Swords, Target } from "lucide-react";
import { Button } from "@/components/ui/button";

interface TutorialStep {
  target?: string;
  title: string;
  description: string;
  icon: typeof Zap;
  iconColor: string;
  position?: "top" | "bottom" | "left" | "right" | "center";
  route?: string;
}

const TUTORIAL_STEPS: TutorialStep[] = [
  {
    title: "Welcome to EliteLineup AI",
    description: "Let's take a quick tour of the key features that will help you dominate DFS. This will only take about a minute.",
    icon: Sparkles,
    iconColor: "text-emerald-400",
    position: "center",
  },
  {
    target: "[data-testid='dashboard-sport-selector']",
    title: "Pick Your Sport",
    description: "Start by selecting a sport. We support NBA, NHL, MLB, NFL, Golf, and Soccer across DraftKings, FanDuel, and Yahoo.",
    icon: Target,
    iconColor: "text-orange-400",
    position: "bottom",
  },
  {
    target: "[data-testid='top-scorers-section']",
    title: "Top Projected Players",
    description: "See the highest-projected players for today's slate. These are your building blocks for winning lineups.",
    icon: TrendingUp,
    iconColor: "text-emerald-400",
    position: "top",
  },
  {
    target: "[data-testid='sport-selector']",
    title: "Optimizer Access",
    description: "Click any sport in the header to access the Lineup Optimizer. Free users get the Standard Optimizer, while paid tiers unlock the Pro Optimizer with advanced features.",
    icon: Zap,
    iconColor: "text-amber-400",
    position: "bottom",
  },
  {
    target: "[data-testid='nav-tools']",
    title: "Tools & Analytics",
    description: "Access powerful tools like Prop Bets analysis, PrizePicks optimizer, Showdown builder, AI Scout signals, and Ownership heatmaps.",
    icon: Layers,
    iconColor: "text-violet-400",
    position: "bottom",
  },
  {
    target: "[data-testid='nav-my-dfs']",
    title: "Your DFS Hub",
    description: "The Vault stores all your saved lineups. You can also track live scores, view your performance history, and manage player configurations from here.",
    icon: Archive,
    iconColor: "text-cyan-400",
    position: "bottom",
  },
  {
    title: "Pro Optimizer & Sim Mode",
    description: "The Pro Optimizer uses linear programming to build optimal lineups. Turn on Sim Mode to run Monte Carlo simulations — thousands of game scenarios to find lineups with the highest ceiling for GPP tournaments.",
    icon: Activity,
    iconColor: "text-violet-400",
    position: "center",
  },
  {
    title: "Vault Power Tools",
    description: "In the Vault, use Regenerate to rebuild lineups with new settings, or ReSim to run simulations on saved lineups. Sort results by P90 (boom potential), P75 (upside), Median, Average, or Composite score.",
    icon: BarChart3,
    iconColor: "text-cyan-400",
    position: "center",
  },
  {
    title: "Subscription Tiers",
    description: "Contender (free) gives you basic optimization. Sharpshooter ($19.99/mo) adds Sim Mode & Props. Champion ($39.99/mo) unlocks everything — higher sim counts, Pro Optimizer, AI Scout, and more.",
    icon: Crown,
    iconColor: "text-amber-400",
    position: "center",
  },
  {
    title: "You're All Set!",
    description: "Pick a sport above and start building lineups. You can replay this tutorial anytime from the menu. Good luck out there!",
    icon: Swords,
    iconColor: "text-emerald-400",
    position: "center",
  },
];

const STORAGE_KEY = "elitelineup_tutorial_completed";

export function useTutorial() {
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    const completed = localStorage.getItem(STORAGE_KEY);
    if (!completed) {
      const timer = setTimeout(() => setIsActive(true), 1500);
      return () => clearTimeout(timer);
    }
  }, []);

  const startTutorial = useCallback(() => setIsActive(true), []);
  const endTutorial = useCallback(() => {
    setIsActive(false);
    localStorage.setItem(STORAGE_KEY, "true");
  }, []);

  return { isActive, startTutorial, endTutorial };
}

interface OverlayProps {
  isActive: boolean;
  onEnd: () => void;
}

export function TutorialOverlay({ isActive, onEnd }: OverlayProps) {
  const [step, setStep] = useState(0);
  const [spotlightRect, setSpotlightRect] = useState<DOMRect | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const current = TUTORIAL_STEPS[step];

  const measureTarget = useCallback(() => {
    if (!current?.target) {
      setSpotlightRect(null);
      return;
    }
    const el = document.querySelector(current.target);
    if (el) {
      const rect = el.getBoundingClientRect();
      setSpotlightRect(rect);
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } else {
      setSpotlightRect(null);
    }
  }, [current]);

  useEffect(() => {
    if (!isActive) return;
    const timer = setTimeout(measureTarget, 200);
    window.addEventListener("resize", measureTarget);
    window.addEventListener("scroll", measureTarget, true);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", measureTarget);
      window.removeEventListener("scroll", measureTarget, true);
    };
  }, [isActive, step, measureTarget]);

  useEffect(() => {
    if (!isActive) {
      setStep(0);
    }
  }, [isActive]);

  if (!isActive || !current) return null;

  const isCenter = !spotlightRect || current.position === "center";
  const isFirst = step === 0;
  const isLast = step === TUTORIAL_STEPS.length - 1;
  const Icon = current.icon;

  const padding = 12;
  const clipPath = spotlightRect
    ? `polygon(
        0% 0%, 0% 100%, 100% 100%, 100% 0%, 0% 0%,
        ${spotlightRect.left - padding}px ${spotlightRect.top - padding}px,
        ${spotlightRect.right + padding}px ${spotlightRect.top - padding}px,
        ${spotlightRect.right + padding}px ${spotlightRect.bottom + padding}px,
        ${spotlightRect.left - padding}px ${spotlightRect.bottom + padding}px,
        ${spotlightRect.left - padding}px ${spotlightRect.top - padding}px
      )`
    : undefined;

  let tooltipStyle: React.CSSProperties = {};
  if (isCenter) {
    tooltipStyle = {
      position: "fixed",
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
    };
  } else if (spotlightRect) {
    const pos = current.position || "bottom";
    const centerX = spotlightRect.left + spotlightRect.width / 2;

    if (pos === "bottom") {
      tooltipStyle = {
        position: "fixed",
        top: spotlightRect.bottom + padding + 12,
        left: Math.max(16, Math.min(centerX - 180, window.innerWidth - 376)),
      };
    } else if (pos === "top") {
      tooltipStyle = {
        position: "fixed",
        bottom: window.innerHeight - spotlightRect.top + padding + 12,
        left: Math.max(16, Math.min(centerX - 180, window.innerWidth - 376)),
      };
    } else if (pos === "right") {
      tooltipStyle = {
        position: "fixed",
        top: Math.max(16, spotlightRect.top),
        left: spotlightRect.right + padding + 12,
      };
    } else {
      tooltipStyle = {
        position: "fixed",
        top: Math.max(16, spotlightRect.top),
        right: window.innerWidth - spotlightRect.left + padding + 12,
      };
    }
  }

  return (
    <div className="fixed inset-0 z-[9999]" data-testid="tutorial-overlay">
      <div
        className="absolute inset-0 bg-black/70 transition-all duration-300"
        style={{ clipPath }}
        onClick={onEnd}
        data-testid="tutorial-backdrop"
      />

      {spotlightRect && (
        <div
          className="absolute pointer-events-none rounded-xl border-2 border-emerald-400/60 shadow-[0_0_30px_rgba(16,185,129,0.3)] transition-all duration-300"
          style={{
            top: spotlightRect.top - padding,
            left: spotlightRect.left - padding,
            width: spotlightRect.width + padding * 2,
            height: spotlightRect.height + padding * 2,
          }}
          data-testid="tutorial-spotlight"
        />
      )}

      <div
        ref={tooltipRef}
        className="w-[360px] max-w-[calc(100vw-32px)] bg-slate-800 border border-slate-600/60 rounded-2xl shadow-2xl shadow-black/50 p-5 z-[10000] animate-in fade-in slide-in-from-bottom-4 duration-300"
        style={tooltipStyle}
        data-testid="tutorial-tooltip"
      >
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div className={`w-9 h-9 rounded-xl bg-slate-700/60 border border-slate-600/40 flex items-center justify-center`}>
              <Icon className={`w-5 h-5 ${current.iconColor}`} />
            </div>
            <div>
              <h3 className="text-sm font-black text-white leading-tight" data-testid="tutorial-step-title">{current.title}</h3>
              <span className="text-[10px] font-bold text-slate-500">Step {step + 1} of {TUTORIAL_STEPS.length}</span>
            </div>
          </div>
          <button
            onClick={onEnd}
            className="text-slate-500 hover:text-white transition-colors p-1 -mr-1 -mt-1"
            data-testid="tutorial-close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-sm text-slate-300 leading-relaxed mb-4" data-testid="tutorial-step-description">
          {current.description}
        </p>

        <div className="flex items-center gap-3">
          <div className="flex gap-1 flex-1">
            {TUTORIAL_STEPS.map((_, i) => (
              <div
                key={i}
                className={`h-1 flex-1 rounded-full transition-all ${
                  i <= step ? "bg-emerald-500" : "bg-slate-700"
                }`}
              />
            ))}
          </div>

          <div className="flex items-center gap-1.5">
            {!isFirst && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setStep(s => s - 1)}
                className="h-8 px-2 text-slate-400 hover:text-white"
                data-testid="tutorial-prev"
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
            )}
            {isLast ? (
              <Button
                size="sm"
                onClick={onEnd}
                className="h-8 px-4 bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-xs"
                data-testid="tutorial-finish"
              >
                Let's Go!
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => setStep(s => s + 1)}
                className="h-8 px-3 bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-xs"
                data-testid="tutorial-next"
              >
                Next <ChevronRight className="w-4 h-4 ml-0.5" />
              </Button>
            )}
          </div>
        </div>

        {isFirst && (
          <button
            onClick={onEnd}
            className="w-full text-center text-xs text-slate-500 hover:text-slate-300 mt-3 transition-colors"
            data-testid="tutorial-skip"
          >
            Skip tutorial
          </button>
        )}
      </div>
    </div>
  );
}

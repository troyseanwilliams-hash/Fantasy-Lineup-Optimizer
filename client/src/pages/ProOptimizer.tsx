import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { NflPortfolioControls, NflPortfolioReportView, useNflPortfolio } from "@/components/NflPortfolio";
import { QualitySearchDiagnostics } from "@/components/QualitySearchDiagnostics";
import { useRoute, useLocation, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { buildUrl } from "@shared/routes";
import type { Player, Slate, ProOptimizeResponse } from "@shared/schema";
import { getPlatformConfig, assignPlayersToSlots, getSlotDisplayName, positionFitsSlot, PLATFORM_COLORS, type Platform, type Sport } from "@shared/platform-config";
import { parseGameInfo, sanitizeGameInfo } from "@/lib/game-info";
import { PlatformSelector } from "@/components/PlatformSelector";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { PlayerHistoryCard } from "@/components/PlayerHistoryCard";
import { Card } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import {
  Lock, Unlock, X, Zap, Save, Search, Download, RefreshCw,
  ChevronDown, ChevronUp, ArrowUpDown, Loader2,
  Crown, TrendingUp, TrendingDown, AlertTriangle,
  ShieldAlert, Activity, SaveAll, Star, Flag, MapPin,
  Cloud, Sun, Wind, CloudRain, Droplets, Target,
  Trophy, Flame, Award, BarChart3, Users, Percent, ArrowLeftRight, Plus, Maximize2, Minimize2
} from "lucide-react";
import { gradeLineup, GRADE_COLORS } from "@/lib/lineup-grader";
import { PlayerInfoHoverCard } from "@/components/PlayerInfoHoverCard";
import { ScoutPanel } from "@/components/ScoutPanel";
import { InfoTip, LabelTip } from "@/components/InfoTip";
import { usePageMeta } from "@/hooks/use-page-meta";
import { useResolvedSlate } from "@/hooks/use-resolved-slate";
import { useSessionPlayerQuery } from "@/hooks/use-session-player-query";
import {
  formatDraftGroupIdentity,
  formatSlateIdentity,
  formatSlateOptionLabel,
  optimizerSlatePath,
} from "@/lib/slate-identity";
import {
  csvEscape,
  exportFilename,
  formatResolvedPlayer,
  resolveExportPlayers,
  resolvedPlayersById,
  validateExportSlate,
} from "@/lib/resolve-export-players";

type SortKey = "name" | "position" | "team" | "salary" | "projectedPoints" | "boostedProj" | "ownershipProjection";
type SortDir = "asc" | "desc";

interface PlayerWithOwnership extends Player {
  ownershipProjection?: number;
  ownershipSource?: "supplied" | "estimated";
  ownershipSourceLabel?: string;
}

interface FavoriteStack {
  id: number;
  slateId: number;
  kind: "game" | "players";
  name: string;
  gameKey: string | null;
  playerIds: number[];
}

const INJURY_COLORS: Record<string, string> = {
  OUT: "bg-red-500/20 text-red-400 border-red-500/30",
  Doubtful: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  Questionable: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  Probable: "bg-green-500/20 text-green-400 border-green-500/30",
  "Day-to-Day": "bg-blue-500/20 text-blue-400 border-blue-500/30",
};

function formatSalary(salary: number, plat: Platform): string {
  if (plat === "yahoo") return `$${salary}`;
  return `$${(salary / 1000).toFixed(1)}K`;
}

function formatCap(cap: number, plat: Platform): string {
  if (plat === "yahoo") return `$${cap}`;
  return `$${cap.toLocaleString()}`;
}

function getPlayerStarCount(projectedPoints: number): number {
  if (projectedPoints >= 45) return 5;
  if (projectedPoints >= 35) return 4;
  if (projectedPoints >= 25) return 3;
  if (projectedPoints >= 15) return 2;
  return 1;
}

function PlayerStarRating({ stars }: { stars: number }) {
  return (
    <div className="flex items-center gap-px">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={`w-3 h-3 ${
            i < stars
              ? stars >= 4
                ? "text-yellow-400 fill-yellow-400"
                : stars >= 3
                ? "text-orange-400 fill-orange-400"
                : "text-emerald-400 fill-emerald-400"
              : "text-slate-700"
          }`}
        />
      ))}
    </div>
  );
}

const NFL_FLEX_POSITIONS = ["RB", "WR", "TE"] as const;
type NflFlexPosition = typeof NFL_FLEX_POSITIONS[number];

function FlexPositionControls({
  allowedPositions,
  onToggle,
  testId = "nfl-flex-controls",
}: {
  allowedPositions: NflFlexPosition[];
  onToggle: (position: NflFlexPosition) => void;
  testId?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-700/50 bg-slate-800/60 px-2 sm:px-3 py-2" data-testid={testId}>
      <div className="flex items-center gap-2">
        <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wide text-amber-400 whitespace-nowrap">
          FLEX Positions
        </span>
        <div className="flex items-center gap-2 sm:gap-3">
          {NFL_FLEX_POSITIONS.map(position => {
            const checked = allowedPositions.includes(position);
            const isLastSelected = checked && allowedPositions.length === 1;
            return (
              <label key={position} className={`inline-flex items-center gap-1 text-[10px] sm:text-[11px] font-black ${isLastSelected ? "text-slate-500" : "text-slate-300"}`}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={isLastSelected}
                  onChange={() => onToggle(position)}
                  aria-label={`Allow ${position} in FLEX`}
                  data-testid={`${testId}-${position}`}
                  className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-950 accent-amber-500 disabled:cursor-not-allowed"
                />
                {position}
              </label>
            );
          })}
        </div>
      </div>
      <p className="mt-1 text-[9px] leading-tight text-slate-500">
        Restricts which positions can fill FLEX only; required RB, WR, and TE slots are unchanged.
      </p>
    </div>
  );
}

export default function ProOptimizer() {
  usePageMeta({ title: "Pro Optimizer - Monte Carlo Simulation", description: "Advanced DFS lineup optimization powered by Monte Carlo simulations.", path: "/optimizer-pro" });
  const [, params] = useRoute("/optimizer-pro/:id");
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  // Type-safe accessors — avoids repeated (user as any) casts throughout
  const userId = (user as any)?.id as string | undefined;
  const userIsAdmin = (user as any)?.isAdmin === true;
  const { toast } = useToast();
  const slateId = Number(params?.id);

  const [search, setSearch] = useState("");
  const [posFilter, setPosFilter] = useState("ALL");
  const [lockedIds, setLockedIds] = useState<number[]>([]);
  const [excludedIds, setExcludedIds] = useState<number[]>([]);
  const [customProjections, setCustomProjections] = useState<Record<string, number>>({});
  const [boosts, setBoosts] = useState<Record<number, number>>({});
  const [sortKey, setSortKey] = useState<SortKey>("projectedPoints");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [lineupCount, setLineupCount] = useState(5);
  const portfolio = useNflPortfolio(userId, slateId);
  // useBoosts: pro users get boosts on by default; they can still toggle it off.
  // We use a separate userOverride flag so a pro user's explicit "off" is respected
  // even after subData refetches — without this, the useEffect would flip it back on.
  const [useBoostsUserOverride, setUseBoostsUserOverride] = useState<boolean | null>(null);
  const useBoosts = useBoostsUserOverride !== null ? useBoostsUserOverride : false;
  const setUseBoosts = (val: boolean) => setUseBoostsUserOverride(val);
  const [fadedIds, setFadedIds] = useState<number[]>([]);
  const [exposureLimits, setExposureLimits] = useState<Record<string, number>>({});
  const [globalMaxExposure, setGlobalMaxExposure] = useState<number | null>(null);
  const [minProjection, setMinProjection] = useState<number | null>(null);
  const [flexAllowedPositions, setFlexAllowedPositions] = useState<NflFlexPosition[]>([...NFL_FLEX_POSITIONS]);
  const [leverageMode, setLeverageMode] = useState(false);
  const [outperformerMode, setOutperformerMode] = useState(false);
  const [projectionMode, setProjectionMode] = useState<"balanced" | "ceiling">("balanced");

  // ── Simulation Mode ────────────────────────────────────────────────────────
  const [simMode, setSimMode] = useState(false);
  const lineupsRef = useRef<HTMLDivElement>(null);
  const [numSims, setNumSims] = useState(200);
  const [stackGameKeys, setStackGameKeys] = useState<string[]>([]);
  const [favoriteStackIds, setFavoriteStackIds] = useState<number[]>([]);
  const [simSortMetric, setSimSortMetric] = useState<"composite" | "p90" | "p75" | "median" | "avg" | "ev">("composite");
  const [minStarRating, setMinStarRating] = useState<number>(0);
  const [lineupSwaps, setLineupSwaps] = useState<Record<string, Record<string, Player>>>({});
  const [visibleLineupCount, setVisibleLineupCount] = useState(10);
  const [visiblePlayerCount, setVisiblePlayerCount] = useState(75);
  const [swappingTarget, setSwappingTarget] = useState<{ lineupIdx: number; slot: string } | null>(null);
  const [salaryRange, setSalaryRange] = useState<[number, number] | null>(null);
  const [mobileView, setMobileView] = useState<"players" | "lineup">("players");
  const [lineupSortBy, setLineupSortBy] = useState<"index" | "projected" | "salary" | "ceiling" | "p90" | "median" | "freq">("index");
  const [simSettingsExpanded, setSimSettingsExpanded] = useState(false);
  const [playerFocus, setPlayerFocus] = useState(false);
  const playerPoolRef = useRef<HTMLDivElement>(null);
  const currentSlateIdRef = useRef(slateId);
  const favoriteStackHandoffAppliedRef = useRef<number | null>(null);
  currentSlateIdRef.current = slateId;
  const componentMountedRef = useRef(true);
  const exportInFlightRef = useRef(false);

  useEffect(() => {
    componentMountedRef.current = true;
    return () => {
      componentMountedRef.current = false;
    };
  }, []);

  const [platform, setPlatform] = useState<Platform>("draftkings");

  const { data: slates } = useQuery<Slate[]>({ queryKey: ["/api/slates"], refetchInterval: 300000 });
  const slate = useResolvedSlate(slateId, slates, "/optimizer-pro");
  const sport = (slate?.sport || "NBA") as Sport;
  const isClassic = (slate?.gameType || "Classic").trim().toLowerCase() === "classic";
  const isNflClassic = sport === "NFL" && (slate?.gameType || "Classic").toLowerCase() === "classic";
  const portfolioSupported = isNflClassic && platform === "draftkings";
  useEffect(() => { portfolio.setReport(undefined); }, [simMode, platform]);

  const favoriteStacksQueryKey = `/api/slates/${slateId}/favorite-stacks`;
  const {
    data: favoriteStacks,
  } = useQuery<FavoriteStack[]>({
    queryKey: [favoriteStacksQueryKey],
    queryFn: async () => {
      const response = await fetch(favoriteStacksQueryKey, { credentials: "include" });
      if (!response.ok) {
        throw new Error("Failed to load saved stacks");
      }
      const data = await response.json();
      if (!Array.isArray(data)) {
        throw new Error("Saved stacks response was invalid");
      }
      return data as FavoriteStack[];
    },
    enabled: !!slate && Number.isFinite(slateId) && isClassic,
  });

  const config = useMemo(() => {
    try { return getPlatformConfig(sport, platform); }
    catch { return getPlatformConfig("NBA", "draftkings"); }
  }, [sport, platform]);

  const sportSlates = useMemo(() => {
    if (!slates) return [];
    return slates
      .filter(s => s.sport === sport && s.platform === platform)
      .sort((a, b) => {
        if (a.isMain && !b.isMain) return -1;
        if (!a.isMain && b.isMain) return 1;
        return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
      });
  }, [slates, sport, platform]);

  const playerUrl = buildUrl("/api/slates/:id/players", { id: slateId });
  const {
    data: players,
    isLoading,
    isFetching: isFetchingPlayers,
    playerRefreshError,
    refreshPlayers,
  } = useSessionPlayerQuery<PlayerWithOwnership[]>({
    url: playerUrl,
    userId,
    enabled: !!slateId,
  });

  const { data: subData } = useQuery<{ tier: string; lineupCount: number; maxLineups: number; sportCounts: Record<string, number> }>({
    queryKey: ["/api/subscription"],
    enabled: !!user,
  });

  const isGolf = sport === "GOLF";
  const slateHasStarted = slate ? new Date(slate.startTime) <= new Date() : false;

  const salaryBounds = useMemo(() => {
    if (!players || players.length === 0) return { min: 3000, max: 10000, step: 100 };
    const salaries = players.map(p => p.salary).filter(s => typeof s === "number" && !isNaN(s));
    if (salaries.length === 0) return { min: 3000, max: 10000, step: 100 };
    const min = Math.min(...salaries);
    const max = Math.max(...salaries);
    if (min === max) return { min, max: min + 100, step: 100 };
    return { min, max, step: 100 };
  }, [players]);

  const { data: golfAnalysis } = useQuery<any>({
    queryKey: ["/api/golf-analysis", slateId],
    queryFn: async () => {
      const res = await fetch(`/api/golf-analysis/${slateId}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: isGolf && !!slateId,
  });

  const golfTournamentCards = useMemo(() => {
    if (!isGolf || !players || players.length === 0) return null;
    const sorted = [...players].sort((a, b) => Number(b.projectedPoints) - Number(a.projectedPoints));
    const topSalary = Math.max(...players.map(p => p.salary));
    const favorites = sorted.slice(0, 5).map(p => {
      const impliedProb = (p.salary / topSalary) * 0.45;
      const americanOdds = impliedProb >= 0.5
        ? Math.round(-100 * impliedProb / (1 - impliedProb))
        : Math.round(100 * (1 - impliedProb) / impliedProb);
      return { ...p, odds: americanOdds > 0 ? `+${americanOdds}` : `${americanOdds}`, impliedProb: (impliedProb * 100).toFixed(0) };
    });
    const valuePicks = [...players].map(p => ({ ...p, value: Number(p.projectedPoints) / (p.salary / 1000) })).sort((a, b) => b.value - a.value).slice(0, 4);
    const tournamentParts = sanitizeGameInfo(players.find(p => p.gameInfo)?.gameInfo || "Tournament").split(" - ");
    return { favorites, valuePicks, tournamentName: tournamentParts[0] || "Tournament", courseName: tournamentParts[1] || "", fieldSize: players.length, avgSalary: Math.round(players.reduce((s, p) => s + p.salary, 0) / players.length) };
  }, [isGolf, players]);

  const isPro = subData?.tier === "pro" || subData?.tier === "premium";
  const isStar = subData?.tier === "star";
  const hasPaidAccess = isPro || isStar;
  const isAdmin = user?.isAdmin === true;
  const maxLineupSlider = isAdmin ? 150 : isPro ? 20 : 5;

  useEffect(() => {
    if (isPro && useBoostsUserOverride === null) {
      setUseBoostsUserOverride(true);
    }
  }, [isPro, useBoostsUserOverride]);

  const optimizeMutation = useMutation<ProOptimizeResponse, Error, any>({
    mutationFn: async (constraints) => {
      const res = await apiRequest("POST", "/api/optimize/pro", constraints);
      return res.json();
    },
    onSuccess: (data) => {
      portfolio.setReport((data as any).nflPortfolioReport);
      if (data.lineups?.length) setMobileView("lineup");
      // Warn if server returned lineups that violate the requested exposure limits.
      // This can happen due to solver rounding or insufficient player pool diversity.
      if (data?.lineups && (Object.keys(exposureLimits).length > 0 || globalMaxExposure)) {
        const appearances: Record<number, number> = {};
        for (const ld of data.lineups) {
          for (const p of (ld.lineup || [])) {
            appearances[p.id] = (appearances[p.id] || 0) + 1;
          }
        }
        const violations = Object.entries(appearances).filter(([id, count]) => {
          const pct = (count / data.lineups.length) * 100;
          const playerLimit = exposureLimits[id];
          const effectiveLimit = playerLimit ?? (globalMaxExposure ?? undefined);
          return effectiveLimit !== undefined && pct > effectiveLimit;
        });
        if (violations.length > 0) {
          toast({
            title: "Exposure Limits Exceeded",
            description: `${violations.length} player(s) exceeded their set limits. Try reducing lineup count or tightening exposure settings.`,
            variant: "destructive",
          });
        }
      }
      setTimeout(() => lineupsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
    },
  });

  // ── Simulation optimizer mutation ─────────────────────────────────────────
  const simMutation = useMutation<any, Error, any>({
    mutationFn: async (constraints) => {
      const res = await apiRequest("POST", "/api/optimize/sim", constraints);
      return res.json();
    },
    onSuccess: (data: any) => {
      portfolio.setReport(data.nflPortfolioReport);
      if (data?.lineups?.length === 0) {
        toast({ title: "No sim lineups", description: data.message || "Try reducing constraints.", variant: "destructive" });
      } else if (data?.lineups?.length > 0) {
        setMobileView("lineup");
        toast({
          title: `${data.lineups.length} Sim Lineups Built`,
          description: data.partial && data.message
            ? data.message
            : `${data.simsRun} sims · ${data.uniqueLineups} unique lineups found · ${data.gamesRepresented} games represented`,
        });
        setTimeout(() => lineupsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
      }
    },
    onError: (err: any) => {
      toast({ title: "Sim Failed", description: err.message || "Simulation error", variant: "destructive" });
    },
  });

  useEffect(() => {
    // Call handleReset to ensure ALL state is cleared when slate changes.
    // Previously fadedIds, lockedIds, excludedIds, exposureLimits, globalMaxExposure,
    // and useBoostsUserOverride were not cleared — stale player IDs from one slate
    // could match different players on the new slate.
    handleReset(false);
  }, [slateId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setVisiblePlayerCount(75);
  }, [slateId, search, posFilter]);

  const [savedIndices, setSavedIndices] = useState<Set<number>>(new Set());
  const [isSavingAll, setIsSavingAll] = useState(false);
  const [saveTopCount, setSaveTopCount] = useState<number>(150);

  const saveLineupMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/lineups", data);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to save");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/lineups"] });
      queryClient.invalidateQueries({ queryKey: ["/api/subscription"] });
    },
    onError: (err: Error) => {
      toast({ title: "Cannot Save", description: err.message, variant: "destructive" });
    },
  });

  const toggleSort = useCallback((key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  }, [sortKey]);

  // This is the explicit projection map sent to the optimizer before any
  // server-only automatic, Scout, or simulation adjustments are applied.
  const buildPlayerProjections = useCallback((): Record<string, number> => {
    const projections: Record<string, number> = { ...customProjections };
    if (players) {
      for (const p of players) {
        const manualBoost = boosts[p.id] || 0;
        if (manualBoost !== 0) {
          const base = customProjections[p.id.toString()] ?? Number(p.projectedPoints);
          projections[p.id.toString()] = Math.round((base + manualBoost) * 10) / 10;
        }
      }
    }
    return projections;
  }, [players, customProjections, boosts]);

  const cutoffProjectionById = useMemo(() => {
    const explicitProjections = buildPlayerProjections();
    return Object.fromEntries((players ?? []).map(p => [
      p.id.toString(),
      explicitProjections[p.id.toString()] ?? Number(p.projectedPoints),
    ]));
  }, [players, buildPlayerProjections]);

  const filteredPlayers = useMemo(() => {
    if (!players) return [];
    return players
      .filter(p => {
        if (excludedIds.includes(p.id)) return false;
        const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.team.toLowerCase().includes(search.toLowerCase());
        const matchPos = posFilter === "ALL" || p.position.includes(posFilter);
        return matchSearch && matchPos;
      })
      .map(p => {
        const boost = p.boostScore ? Number(p.boostScore) : 0;
        const baseProj = Number(p.projectedPoints);
        const customProj = customProjections[p.id.toString()] ?? baseProj;
        const manualBoost = boosts[p.id] || 0;
        const boostAdjPct = Math.max(-0.08, Math.min(0.08, boost * 0.008));
        const manualProj = Math.round((customProj + manualBoost) * 10) / 10;
        const automaticProj = useBoosts && boost !== 0
          ? Math.round(manualProj * (1 + boostAdjPct) * 10) / 10
          : manualProj;
        const boostedProj = automaticProj;
        const isFaded = fadedIds.includes(p.id);
        const own = (p as any).ownershipProjection ?? 0;
        const cutoffProjection = cutoffProjectionById[p.id.toString()] ?? baseProj;
        const belowMinProjection = minProjection !== null && minProjection > 0 && cutoffProjection < minProjection;
        return { ...p, baseProj, customProj, manualProj, boostedProj, cutoffProjection, belowMinProjection, manualBoost, boost, isFaded, ownershipProjection: own as number };
      })
      .sort((a, b) => {
        let aVal: any, bVal: any;
        switch (sortKey) {
          case "name": aVal = a.name; bVal = b.name; break;
          case "position": aVal = a.position; bVal = b.position; break;
          case "team": aVal = a.team; bVal = b.team; break;
          case "salary": aVal = a.salary; bVal = b.salary; break;
          case "projectedPoints": aVal = a.baseProj; bVal = b.baseProj; break;
          case "boostedProj": aVal = a.boostedProj; bVal = b.boostedProj; break;
          case "ownershipProjection": aVal = a.ownershipProjection; bVal = b.ownershipProjection; break;
          default: aVal = a.boostedProj; bVal = b.boostedProj;
        }
        if (typeof aVal === "string") return sortDir === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
        return sortDir === "asc" ? aVal - bVal : bVal - aVal;
      });
  }, [players, search, posFilter, excludedIds, customProjections, boosts, cutoffProjectionById, minProjection, sortKey, sortDir, useBoosts, fadedIds]);

  const games = useMemo(() => {
    if (!players) return [];
    const gameMap = new Map<string, { away: string; home: string; time: string }>();
    players.forEach(p => {
      if (p.gameInfo) {
        const parsedGame = parseGameInfo(p.gameInfo);
        const time = parsedGame.time || "";
        const teams = parsedGame.away && parsedGame.home
          ? `${parsedGame.away} @ ${parsedGame.home}`
          : parsedGame.display.replace(time, "").trim();
        let away: string, home: string;
        if (teams.includes("@")) {
          [away, home] = teams.split(" @ ").map(s => s.trim());
        } else if (teams.includes("vs")) {
          [home, away] = teams.split(" vs ").map(s => s.trim());
        } else {
          away = p.opponent || "";
          home = p.team;
        }
        const sortedKey = [away, home].sort().join("-");
        if (!gameMap.has(sortedKey)) {
          gameMap.set(sortedKey, { away, home, time });
        }
      }
    });
    return Array.from(gameMap.values());
  }, [players]);

  const excludedPlayers = useMemo(() => {
    if (!players) return [];
    return players.filter(p => excludedIds.includes(p.id));
  }, [players, excludedIds]);

  const boostedPlayers = useMemo(() => {
    if (!optimizeMutation.data?.boostsSummary) {
      if (!players) return [];
      return players
        .filter(p => p.boostScore && Number(p.boostScore) !== 0)
        .map(p => ({ playerId: p.id, playerName: p.name, boostScore: Number(p.boostScore), boostReason: p.boostReason || "" }))
        .sort((a, b) => Math.abs(b.boostScore) - Math.abs(a.boostScore))
        .slice(0, 10);
    }
    return optimizeMutation.data.boostsSummary;
  }, [players, optimizeMutation.data]);

  const injuredPlayers = useMemo(() => {
    if (!optimizeMutation.data?.injurySummary) {
      if (!players) return [];
      return players
        .filter(p => p.injuryStatus && p.injuryStatus !== "Healthy")
        .map(p => ({ playerId: p.id, playerName: p.name, status: p.injuryStatus || "", detail: p.injuryDetail || "" }));
    }
    return optimizeMutation.data.injurySummary;
  }, [players, optimizeMutation.data]);

  // Merge standard optimizer results and sim results into a single lineups array
  const rawGeneratedLineups = useMemo(() => {
    if (simMode && simMutation.data?.lineups) {
      const metricKeyMap: Record<string, string> = {
        p90: "p90Score", p75: "p75Score", median: "medianScore",
        avg: "avgSimScore", composite: "compositeScore", ev: "evScore",
      };
      const sortKey = metricKeyMap[simSortMetric] || "compositeScore";
      const mapped = simMutation.data.lineups.map((lu: any) => ({
        lineup:               lu.lineup,
        totalSalary:          lu.totalSalary,
        totalProjectedPoints: lu.totalProjectedPoints,
        simSortValue:         (lu[sortKey] ?? lu.medianScore ?? 0) as number,
        simData: {
          avgSimScore:   lu.avgSimScore,
          medianScore:   lu.medianScore,
          p75Score:      lu.p75Score,
          p90Score:      lu.p90Score,
          freqPct:       lu.freqPct,
          stackedGame:   lu.stackedGame,
          stackCount:    lu.stackCount,
          stackTeams:    lu.stackTeams,
          compositeScore:lu.compositeScore,
          evScore:       lu.evScore,
          winPct:        lu.winPct,
          cashPct:       lu.cashPct,
        },
      }));
      mapped.sort((a: any, b: any) => b.simSortValue - a.simSortValue);
      return mapped;
    }
    return optimizeMutation.data?.lineups || [];
  }, [simMode, simMutation.data, optimizeMutation.data, simSortMetric]);

  const isOptimizing = optimizeMutation.isPending || simMutation.isPending;

  const togglePlayerFocus = useCallback(() => {
    setPlayerFocus(focused => {
      const nextFocused = !focused;
      if (nextFocused) {
        window.setTimeout(() => playerPoolRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
      }
      return nextFocused;
    });
  }, []);

  const playersById = useMemo(() => new Map(players?.map(p => [p.id, p]) ?? []), [players]);

  const selectableFavoriteStacks = useMemo(() => {
    if (!isClassic || !favoriteStacks) return [];
    return favoriteStacks.filter(stack =>
      Number(stack.slateId) === slateId
      && Number.isFinite(Number(stack.id))
      && (stack.kind === "game" || stack.kind === "players")
      && typeof stack.name === "string"
      && (stack.gameKey === null || typeof stack.gameKey === "string")
      && Array.isArray(stack.playerIds)
    );
  }, [favoriteStacks, isClassic, slateId]);

  const selectedFavoriteStackIds = useMemo(() => {
    const validIds = new Set(selectableFavoriteStacks.map(stack => Number(stack.id)));
    return favoriteStackIds.filter(id => validIds.has(Number(id)));
  }, [favoriteStackIds, selectableFavoriteStacks]);

  const useFavoriteStacksQueryFlag = useMemo(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).get("useFavoriteStacks") === "1";
  }, [slateId]);

  useEffect(() => {
    if (!isClassic || !favoriteStacks) {
      if (!isClassic) setFavoriteStackIds([]);
      return;
    }
    const validIds = new Set(selectableFavoriteStacks.map(stack => Number(stack.id)));
    setFavoriteStackIds(previous => previous.filter(id => validIds.has(Number(id))));
  }, [favoriteStacks, isClassic, selectableFavoriteStacks]);

  useEffect(() => {
    if (
      !useFavoriteStacksQueryFlag
      || !isClassic
      || !favoriteStacks
      || favoriteStackHandoffAppliedRef.current === slateId
    ) {
      return;
    }
    favoriteStackHandoffAppliedRef.current = slateId;
    setSimMode(true);
    setSimSettingsExpanded(true);
    setFavoriteStackIds(selectableFavoriteStacks.map(stack => Number(stack.id)));
  }, [favoriteStacks, isClassic, selectableFavoriteStacks, slateId, useFavoriteStacksQueryFlag]);

  const generatedLineups = useMemo(() => {
    const enrichPlayer = (p: any) => {
      const enriched = playersById.get(p.id);
      if (enriched) {
        return { ...p, recentActualAvg: enriched.recentActualAvg, gamesTracked: enriched.gamesTracked };
      }
      return p;
    };
    const enrichLineup = (lineupData: any) => ({
      ...lineupData,
      lineup: lineupData.lineup.map(enrichPlayer),
    });
    if (Object.keys(lineupSwaps).length === 0) return rawGeneratedLineups.map(enrichLineup);
    return rawGeneratedLineups.map((lineupData, idx) => {
      const swaps = lineupSwaps[idx];
      if (!swaps || Object.keys(swaps).length === 0) return enrichLineup(lineupData);
      const originalSlots = assignPlayersToSlots(lineupData.lineup, config.slots, sport);
      const removedIds = new Set<number>();
      for (const slotKey of Object.keys(swaps)) {
        const slotPlayer = originalSlots[slotKey];
        if (slotPlayer) removedIds.add(slotPlayer.id);
      }
      const keptPlayers = lineupData.lineup.filter((p: any) => !removedIds.has(p.id));
      const newPlayers = [...keptPlayers, ...Object.values(swaps)].map(enrichPlayer);
      const newSalary = newPlayers.reduce((s, p) => s + p.salary, 0);
      const newProj = newPlayers.reduce((s, p) => s + Number(p.projectedPoints), 0);
      return { ...lineupData, lineup: newPlayers, totalSalary: newSalary, totalProjectedPoints: newProj };
    });
  }, [rawGeneratedLineups, lineupSwaps, config.slots, sport, playersById]);

  const sortedLineups = useMemo(() => {
    const indexed = generatedLineups.map((lu, i) => ({ ...lu, _origIdx: i }));
    if (lineupSortBy === "projected") {
      indexed.sort((a, b) => (b.totalProjectedPoints || 0) - (a.totalProjectedPoints || 0));
    } else if (lineupSortBy === "salary") {
      indexed.sort((a, b) => (b.totalSalary || 0) - (a.totalSalary || 0));
    } else if (lineupSortBy === "ceiling") {
      indexed.sort((a, b) => ((b as any).simData?.p75Score || 0) - ((a as any).simData?.p75Score || 0));
    } else if (lineupSortBy === "p90") {
      indexed.sort((a, b) => ((b as any).simData?.p90Score || 0) - ((a as any).simData?.p90Score || 0));
    } else if (lineupSortBy === "median") {
      indexed.sort((a, b) => ((b as any).simData?.medianScore || 0) - ((a as any).simData?.medianScore || 0));
    } else if (lineupSortBy === "freq") {
      indexed.sort((a, b) => ((b as any).simData?.freqPct || 0) - ((a as any).simData?.freqPct || 0));
    }
    return indexed;
  }, [generatedLineups, lineupSortBy]);

  const handleProSwap = useCallback((lineupIdx: number, slot: string) => {
    if (swappingTarget?.lineupIdx === lineupIdx && swappingTarget?.slot === slot) {
      setSwappingTarget(null);
    } else {
      setSwappingTarget({ lineupIdx, slot });
    }
  }, [swappingTarget]);

  const handleProSwapSelect = useCallback((player: Player) => {
    if (!swappingTarget) return;
    setLineupSwaps(prev => ({
      ...prev,
      [swappingTarget.lineupIdx]: {
        ...(prev[swappingTarget.lineupIdx] || {}),
        [swappingTarget.slot]: player,
      },
    }));
    setSwappingTarget(null);
  }, [swappingTarget]);

  const proSwapEligiblePlayers = useMemo(() => {
    if (!swappingTarget || !players) return [];
    const lineupData = generatedLineups[swappingTarget.lineupIdx];
    if (!lineupData) return [];
    const lineupPlayers = lineupData.lineup || [];
    const lineupPlayerIds = new Set(lineupPlayers.map(p => p.id));
    const slots = assignPlayersToSlots(lineupPlayers, config.slots, sport);
    const currentPlayer = slots[swappingTarget.slot];
    // Single slot assignment call — previously called twice redundantly
    const currentPlayerSalary = slots[swappingTarget.slot]?.salary || 0;
    const lineupSalary = lineupPlayers.reduce((s, p) => s + p.salary, 0);
    const availableBudget = config.salaryCap - lineupSalary + currentPlayerSalary;
    return players.filter(p => {
      if (lineupPlayerIds.has(p.id)) return false;
      if (excludedIds.includes(p.id)) return false;
      if (!positionFitsSlot(p.position, swappingTarget.slot, sport)) return false;
      if (p.salary > availableBudget) return false;
      return true;
    });
  }, [swappingTarget, players, generatedLineups, config, sport, excludedIds]);

  const toggleFlexPosition = useCallback((position: NflFlexPosition) => {
    setFlexAllowedPositions(prev => {
      if (prev.includes(position)) {
        return prev.length > 1 ? prev.filter(current => current !== position) : prev;
      }
      return [...prev, position];
    });
  }, []);

  const availableGames = useMemo(() => {
    if (!players || players.length === 0) return [];
    const gameMap = new Map<string, { label: string; playerCount: number; avgProj: number }>();
    for (const p of players) {
      const parsedGame = parseGameInfo(p.gameInfo);
      if (!parsedGame.away || !parsedGame.home) continue;
      const away = parsedGame.away.toUpperCase();
      const home = parsedGame.home.toUpperCase();
      const key = [away, home].sort().join("-");
      const label = `${away}@${home}`;
      const entry = gameMap.get(key) || { label, playerCount: 0, avgProj: 0 };
      entry.playerCount++;
      entry.avgProj += Number(p.projectedPoints) || 0;
      gameMap.set(key, entry);
    }
    return Array.from(gameMap.entries())
      .map(([key, data]) => ({ key, label: data.label, playerCount: data.playerCount, avgProj: Math.round((data.avgProj / data.playerCount) * 10) / 10 }))
      .sort((a, b) => b.avgProj - a.avgProj);
  }, [players]);

  const exposureTracking = useMemo(() => {
    if (generatedLineups.length === 0 || !players) return [];
    const appearances: Record<number, number> = {};
    for (const lineupData of generatedLineups) {
      const lineupPlayers = lineupData.lineup || [];
      for (const p of lineupPlayers) {
        appearances[p.id] = (appearances[p.id] || 0) + 1;
      }
    }
    return Object.entries(appearances)
      .map(([id, count]) => {
        const player = players.find(p => p.id === Number(id));
        const pct = (count / generatedLineups.length) * 100;
        const playerLimit = exposureLimits[id];
        const effectiveLimit = playerLimit ?? (globalMaxExposure ?? undefined);
        return {
          playerId: Number(id),
          playerName: player?.name || `Player #${id}`,
          position: player?.position || "",
          injuryStatus: (player as any)?.injuryStatus || null,
          count,
          total: generatedLineups.length,
          pct,
          limit: effectiveLimit,
          overLimit: effectiveLimit !== undefined && pct > effectiveLimit,
          isPlayerSpecific: playerLimit !== undefined,
        };
      })
      .sort((a, b) => b.pct - a.pct);
  }, [generatedLineups, players, exposureLimits, globalMaxExposure]);

  const handleOptimize = () => {
    portfolio.setReport(undefined);
    if (portfolioSupported && portfolio.error) {
      toast({ title: "Invalid NFL strategy", description: portfolio.error, variant: "destructive" });
      return;
    }
    const projections = buildPlayerProjections();
    if (isPro && fadedIds.length > 0 && players) {
      for (const p of players) {
        if (fadedIds.includes(p.id)) {
          const own = (p as any).ownershipProjection ?? 10;
          const fadeMultiplier = Math.max(0.3, 1 - (own / 100));
          const base = projections[p.id.toString()] ?? Number(p.projectedPoints);
          projections[p.id.toString()] = Math.round(base * fadeMultiplier * 10) / 10;
        }
      }
    }
    const ratingExcluded: number[] = [];
    if (minStarRating > 0 && players) {
      for (const p of players) {
        const proj = projections[p.id.toString()] ?? Number(p.projectedPoints);
        if (getPlayerStarCount(proj) < minStarRating && !lockedIds.includes(p.id)) {
          ratingExcluded.push(p.id);
        }
      }
    }
    const activeExposureLimits = Object.keys(exposureLimits).length > 0 ? exposureLimits : undefined;
    setSavedIndices(new Set());
    setLineupSwaps({});
    setSwappingTarget(null);
    setVisibleLineupCount(10);

    if (simMode) {
      // ── Simulation mode: Monte Carlo game-script optimization ──────────────
      simMutation.mutate({
        ...(portfolioSupported ? { nflPortfolio: { ...portfolio.settings, enabled: true }, contestType: "gpp" } : {}),
        slateId,
        platform,
        lockedPlayerIds:  lockedIds,
        excludedPlayerIds: [...excludedIds, ...ratingExcluded],
        playerProjections: Object.keys(projections).length > 0 ? projections : undefined,
        playerMinSalary:  salaryRange && salaryRange[0] > salaryBounds.min ? salaryRange[0] : undefined,
        playerMaxSalary:  salaryRange && salaryRange[1] < salaryBounds.max ? salaryRange[1] : undefined,
        lineupCount: numSims,
        numSims,
        stackGameKeys,
         favoriteStackIds: isClassic ? selectedFavoriteStackIds : [],
        globalMaxExposure: globalMaxExposure ?? undefined,
        minProjection: minProjection ?? undefined,
        minStarRating,
        sortMetric: simSortMetric,
        useBoosts,
        ceilingMode: projectionMode === "ceiling",
        leverageMode,
        outperformerMode,
        ...(isNflClassic ? { flexAllowedPositions } : {}),
      });
    } else {
      optimizeMutation.mutate({
        ...(portfolioSupported ? { nflPortfolio: { ...portfolio.settings, enabled: true }, contestType: "gpp" } : {}),
        slateId,
        platform,
        lockedPlayerIds: lockedIds,
        excludedPlayerIds: [...excludedIds, ...ratingExcluded],
        playerProjections: Object.keys(projections).length > 0 ? projections : undefined,
        playerMinSalary: salaryRange && salaryRange[0] > salaryBounds.min ? salaryRange[0] : undefined,
        playerMaxSalary: salaryRange && salaryRange[1] < salaryBounds.max ? salaryRange[1] : undefined,
        lineupCount,
        useBoosts,
        exposureLimits: activeExposureLimits,
        globalMaxExposure: globalMaxExposure ?? undefined,
        minProjection: minProjection ?? undefined,
        leverageMode,
        projectionMode,
        minStarRating,
        outperformerMode,
        ...(isNflClassic ? { flexAllowedPositions } : {}),
      });
    }
  };

  const handleSaveLineup = (lineup: any, index: number) => {
    if (!user || savedIndices.has(index)) return;
    const lineupPlayers = lineup.lineup || [];
    const payload: any = {
      userId: userId!,
      slateId,
      sport,
      platform,
      totalSalary: lineup.totalSalary,
      totalProjectedPoints: String(lineup.totalProjectedPoints),
      playerIds: lineupPlayers.map((p: Player) => p.id),
      name: `Optimizer Pro #${index + 1} - ${sport} ${config.shortLabel}`,
    };
    if (lineup.simData) payload.simData = lineup.simData;
    saveLineupMutation.mutate(payload, {
      onSuccess: () => {
        setSavedIndices(prev => new Set(prev).add(index));
        toast({ title: "Lineup Saved!", description: `Lineup #${index + 1} added to your vault.` });
      },
    });
  };

  const handleSaveAll = async () => {
    if (!user || generatedLineups.length === 0) return;
    const unsavedLineups = generatedLineups
      .map((lineup, i) => ({ lineup, index: i }))
      .filter(({ index }) => !savedIndices.has(index));
    if (unsavedLineups.length === 0) {
      toast({ title: "Already Saved", description: "All lineups are already in your vault." });
      return;
    }
    setIsSavingAll(true);
    // Fire all saves in parallel — much faster than sequential awaits for 20 lineups.
    const saveResults = await Promise.allSettled(
      unsavedLineups.map(({ lineup, index }) => {
        const lineupPlayers = lineup.lineup || [];
        const payload: any = {
          userId: userId!,
          slateId,
          sport,
          platform,
          totalSalary: lineup.totalSalary,
          totalProjectedPoints: String(lineup.totalProjectedPoints),
          playerIds: lineupPlayers.map((p: Player) => p.id),
          name: `Optimizer Pro #${index + 1} - ${sport} ${config.shortLabel}`,
        };
        if (lineup.simData) payload.simData = lineup.simData;
        return apiRequest("POST", "/api/lineups", payload).then(async res => {
          if (!res.ok) {
            const err = await res.json();
            throw new Error(err.message || "Failed to save");
          }
          return { index };
        });
      })
    );
    let successCount = 0;
    let failCount = 0;
    let vaultLimitMsg: string | null = null;
    for (let i = 0; i < saveResults.length; i++) {
      const result = saveResults[i];
      if (result.status === "fulfilled") {
        successCount++;
        setSavedIndices(prev => new Set(prev).add(unsavedLineups[i].index));
      } else {
        failCount++;
        const msg = (result as PromiseRejectedResult).reason?.message || "";
        if ((msg.includes("limit") || msg.includes("maximum")) && !vaultLimitMsg) {
          vaultLimitMsg = msg;
        }
      }
    }
    if (vaultLimitMsg) {
      toast({ title: "Vault Limit Reached", description: vaultLimitMsg, variant: "destructive" });
    }
    queryClient.invalidateQueries({ queryKey: ["/api/lineups"] });
    queryClient.invalidateQueries({ queryKey: ["/api/subscription"] });
    setIsSavingAll(false);
    if (successCount > 0) {
      toast({
        title: `${successCount} Lineup${successCount > 1 ? "s" : ""} Saved!`,
        description: failCount > 0
          ? `${successCount} added to vault, ${failCount} failed.`
          : `All ${successCount} lineup${successCount > 1 ? "s" : ""} added to your vault.`,
      });
    } else if (failCount > 0) {
      toast({ title: "Save Failed", description: "Could not save lineups. Please try again.", variant: "destructive" });
    }
  };

  const handleSaveTopX = async () => {
    if (!user || sortedLineups.length === 0 || isSavingAll) return;
    const count = Math.min(saveTopCount, sortedLineups.length);
    const topLineups = sortedLineups.slice(0, count);
    const unsaved = topLineups.filter(lu => !savedIndices.has(lu._origIdx));
    if (unsaved.length === 0) {
      toast({ title: "Already Saved", description: `Top ${count} lineups are already in your vault.` });
      return;
    }
    setIsSavingAll(true);
    const saveResults = await Promise.allSettled(
      unsaved.map((lu) => {
        const lineupPlayers = lu.lineup || [];
        const sortLabel = lineupSortBy === "index" ? "" : ` [${lineupSortBy.toUpperCase()}]`;
        const payload: any = {
          userId: userId!,
          slateId,
          sport,
          platform,
          totalSalary: lu.totalSalary,
          totalProjectedPoints: String(lu.totalProjectedPoints),
          playerIds: lineupPlayers.map((p: Player) => p.id),
          name: `${simMode ? "Sim" : "Pro"} Top${count}${sortLabel} #${sortedLineups.indexOf(lu) + 1} - ${sport} ${config.shortLabel}`,
        };
        if (lu.simData) payload.simData = lu.simData;
        return apiRequest("POST", "/api/lineups", payload).then(async res => {
          if (!res.ok) {
            const err = await res.json();
            throw new Error(err.message || "Failed to save");
          }
          return { origIdx: lu._origIdx };
        });
      })
    );
    let successCount = 0;
    let failCount = 0;
    let vaultLimitMsg: string | null = null;
    for (let i = 0; i < saveResults.length; i++) {
      const result = saveResults[i];
      if (result.status === "fulfilled") {
        successCount++;
        setSavedIndices(prev => new Set(prev).add(unsaved[i]._origIdx));
      } else {
        failCount++;
        const msg = (result as PromiseRejectedResult).reason?.message || "";
        if ((msg.includes("limit") || msg.includes("maximum")) && !vaultLimitMsg) {
          vaultLimitMsg = msg;
        }
      }
    }
    if (vaultLimitMsg) {
      toast({ title: "Vault Limit Reached", description: vaultLimitMsg, variant: "destructive" });
    }
    queryClient.invalidateQueries({ queryKey: ["/api/lineups"] });
    queryClient.invalidateQueries({ queryKey: ["/api/subscription"] });
    setIsSavingAll(false);
    if (successCount > 0) {
      const sortName = lineupSortBy === "index" ? "order" : lineupSortBy === "ceiling" ? "P75" : lineupSortBy.toUpperCase();
      toast({
        title: `Top ${count} Saved!`,
        description: failCount > 0
          ? `${successCount} saved by ${sortName}, ${failCount} failed.`
          : `${successCount} lineup${successCount > 1 ? "s" : ""} saved (sorted by ${sortName}).`,
      });
    } else if (failCount > 0) {
      toast({ title: "Save Failed", description: "Could not save lineups. Please try again.", variant: "destructive" });
    }
  };

  const handleExportCSV = async () => {
    if (generatedLineups.length === 0 || exportInFlightRef.current) return;

    // Snapshot the rows and slate before resolving IDs. The generated lineup
    // state can be replaced if the user changes slates during the request.
    const exportSlateId = slateId;
    const exportSport = sport;
    const exportPlatform = platform;
    const exportSlots = [...config.slots];
    const exportRows: Array<Array<Player | null>> = generatedLineups.map((lineupData: any) => {
      const slotAssignments = assignPlayersToSlots(lineupData.lineup || [], exportSlots, exportSport);
      return exportSlots.map(slot => slotAssignments[slot] || null);
    });
    const playerIds = exportRows
      .flatMap(row => row.map(player => player?.id))
      .filter((id): id is number => typeof id === "number");

    if (playerIds.length === 0) {
      toast({ title: "CSV Export Failed", description: "These lineups have no players to export.", variant: "destructive" });
      return;
    }

    exportInFlightRef.current = true;
    try {
      // Pro bulk export resolves the union once, rather than making one
      // request per lineup.
      const resolved = await resolveExportPlayers({ slateId: exportSlateId, playerIds });
      validateExportSlate(resolved, {
        slateId: exportSlateId,
        sport: exportSport,
        platform: exportPlatform,
      });
      if (!componentMountedRef.current || currentSlateIdRef.current !== exportSlateId) {
        throw new Error("Export canceled because the slate changed.");
      }

      const playersById = resolvedPlayersById(resolved);
      const rows = exportRows.map((row, lineupIndex) => row.map((player, slotIndex) => {
        const slot = exportSlots[slotIndex];
        if (!player) throw new Error(`Export slot ${getSlotDisplayName(slot)} is empty in lineup ${lineupIndex + 1}.`);
        const resolvedPlayer = playersById.get(Number(player.id));
        if (!resolvedPlayer) throw new Error(`Export player missing for ${getSlotDisplayName(slot)} in lineup ${lineupIndex + 1}.`);
        return csvEscape(formatResolvedPlayer(resolvedPlayer, exportPlatform));
      }));
      const csv = [
        exportSlots.map(slot => csvEscape(getSlotDisplayName(slot))).join(","),
        ...rows.map(row => row.join(",")),
      ].join("\n");

      if (!componentMountedRef.current || currentSlateIdRef.current !== exportSlateId) {
        throw new Error("Export canceled because the slate changed.");
      }
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = exportFilename(resolved.slate, exportSport, exportPlatform, `${exportRows.length}-lineups`);
      a.click();
      URL.revokeObjectURL(url);
      toast({
        title: "CSV Exported",
        description: `${exportRows.length} lineup${exportRows.length > 1 ? "s" : ""} exported for ${config.label} upload.`,
      });
    } catch (error) {
      toast({
        title: "CSV Export Failed",
        description: error instanceof Error ? error.message : "Could not resolve platform player IDs.",
        variant: "destructive",
      });
    } finally {
      exportInFlightRef.current = false;
    }
  };

  const handleSlateChange = (newSlateId: string) => {
    setLocation(optimizerSlatePath("pro", newSlateId));
  };

  const handleReset = (resetPortfolio = true) => {
    if (resetPortfolio) portfolio.reset();
    else portfolio.setReport(undefined);
    setLockedIds([]);
    setExcludedIds([]);
    setFadedIds([]);
    setCustomProjections({});
    setBoosts({});
    setExposureLimits({});
    setGlobalMaxExposure(null);
    setMinProjection(null);
    setFlexAllowedPositions([...NFL_FLEX_POSITIONS]);
    setSavedIndices(new Set());
    setSalaryRange(null);
    setLineupSwaps({});
    setSwappingTarget(null);
    setUseBoostsUserOverride(null);
    setStackGameKeys([]);
    setFavoriteStackIds([]);
    setMinStarRating(0);
    optimizeMutation.reset();
    simMutation.reset();
  };

  useEffect(() => {
    if (slate?.platform) {
      setPlatform(slate.platform as Platform);
    }
  }, [slateId, slate?.platform]);

  const handlePlatformChange = (newPlatform: Platform) => {
    const userTier = subData?.tier || "free";
    const isPaidUser = userTier === "star" || userTier === "pro" || userIsAdmin;
    if (newPlatform === "fanduel" && !userIsAdmin) {
      toast({
        title: "Coming Soon",
        description: "FanDuel optimization is coming soon.",
        variant: "destructive",
      });
      return;
    }
    if (newPlatform === "yahoo" && !isPaidUser) {
      toast({
        title: "Upgrade Required",
        description: "Yahoo optimization requires a Sharpshooter or Champion subscription.",
        variant: "destructive",
      });
      return;
    }
    setPlatform(newPlatform);
    handleReset();
    if (slates) {
      const match = slates.find(s => s.sport === sport && s.platform === newPlatform && s.isMain)
        || slates.find(s => s.sport === sport && s.platform === newPlatform);
      if (match && match.id !== slateId) {
        setLocation(optimizerSlatePath("pro", match.id));
      }
    }
  };

  const pColors = PLATFORM_COLORS[platform];

  const positions = ["ALL", ...(config.positionFilters || ["PG", "SG", "SF", "PF", "C"])];

  const SortHeader = ({ label, field, className = "" }: { label: string; field: SortKey; className?: string }) => (
    <th
      className={`px-3 py-3 text-[11px] font-black uppercase tracking-widest cursor-pointer select-none hover:text-slate-300 transition-colors ${className}`}
      onClick={() => toggleSort(field)}
      data-testid={`sort-${field}`}
    >
      <div className="flex items-center gap-1">
        {label}
        {sortKey === field ? (
          sortDir === "desc" ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />
        ) : (
          <ArrowUpDown className="w-3 h-3 opacity-30" />
        )}
      </div>
    </th>
  );

  if (!hasPaidAccess && !isLoading) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center px-4">
        <Card className="max-w-md w-full p-8 bg-slate-900 border-amber-500/30 text-center">
          <div className="mx-auto w-16 h-16 rounded-full bg-amber-500/10 flex items-center justify-center mb-6">
            <Crown className="w-8 h-8 text-amber-400" />
          </div>
          <h2 className="text-2xl font-black text-white mb-3" data-testid="text-pro-locked-title">Advanced Optimizer</h2>
          <p className="text-slate-400 mb-6 text-sm" data-testid="text-pro-locked-desc">
            Unlock the advanced optimizer to generate multiple unique lineups at once. Sharpshooter gets up to 5 lineups, Champion gets up to 20 with AI boosts and injury adjustments.
          </p>
          <Link href="/pricing">
            <Button className="bg-amber-500 text-black font-black w-full" data-testid="button-upgrade-pro">
              <Crown className="w-4 h-4 mr-2" />
              View Plans
            </Button>
          </Link>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="h-[80vh] flex items-center justify-center">
        <Loader2 className="w-10 h-10 text-amber-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className={`flex flex-col ${playerFocus ? "fixed inset-0 z-50 h-[100dvh] overflow-hidden bg-slate-950" : "min-h-full overflow-visible"}`} data-testid="pro-optimizer-page">
      {!playerFocus && isNflClassic && platform === "draftkings" && (
        <Link href="/nfl-gpp?tab=classic" className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 border-b border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-emerald-300">
          <span className="font-bold text-sm">Audit your final NFL Classic upload</span>
          <span className="text-xs">Current Classic position caps · 115% ownership ceiling · review before approval →</span>
        </Link>
      )}
      {/* Mobile and laptop view switch stays above the long setup controls. */}
      {!playerFocus && <div className="2xl:hidden flex border-b border-slate-800 bg-slate-900/80 sticky top-0 z-20">
        <button
          onClick={() => setMobileView("players")}
          data-testid="pro-mobile-tab-players"
          className={`flex-1 px-4 py-2.5 text-xs font-black uppercase tracking-widest transition-all ${
            mobileView === "players"
              ? "text-amber-400 border-b-2 border-amber-400 bg-slate-800/50"
              : "text-slate-500 hover:text-slate-300"
          }`}
        >
          Players {filteredPlayers.length > 0 && `(${filteredPlayers.length})`}
        </button>
        <button
          onClick={() => setMobileView("lineup")}
          data-testid="pro-mobile-tab-lineup"
          className={`flex-1 px-4 py-2.5 text-xs font-black uppercase tracking-widest transition-all ${
            mobileView === "lineup"
              ? "text-amber-400 border-b-2 border-amber-400 bg-slate-800/50"
              : "text-slate-500 hover:text-slate-300"
          }`}
        >
          Lineups {optimizeMutation.data ? `(${optimizeMutation.data.lineups?.length || 0})` : ""}
        </button>
        <button
          type="button"
          onClick={togglePlayerFocus}
          aria-label="Expand player pool"
          title="Expand player pool"
          data-testid="button-player-focus-mobile"
          className="inline-flex w-11 shrink-0 items-center justify-center border-l border-slate-800 text-slate-400 hover:text-white"
        >
          <Maximize2 className="h-4 w-4" />
        </button>
      </div>}
      {/* Top Controls Bar */}
      {!playerFocus && <div className="border-b border-slate-800 bg-slate-900/60 px-4 py-2">
        <div className="flex flex-col gap-2 md:gap-0">
          {/* Row 1: Slate info + selector */}
          <div className="flex items-center gap-3 overflow-x-auto scrollbar-hide">
            <Badge className={`text-[11px] font-black flex-shrink-0 ${pColors.bg} ${pColors.text} ${pColors.border}`} data-testid="badge-platform">
              {config.shortLabel} {sport}
            </Badge>

            <PlatformSelector
              sport={sport}
              value={platform}
              onChange={handlePlatformChange}
              showProBadge
              tier={userIsAdmin ? "admin" : (subData?.tier || "free")}
            />

            {slate && (
              <span
                className="text-xs font-black text-amber-400/70 flex-shrink-0 max-w-[min(42vw,28rem)] truncate"
                title={formatSlateIdentity(slate)}
                data-testid="pro-slate-date"
              >
                {formatSlateIdentity(slate)}
              </span>
            )}

            <div className="h-4 w-px bg-slate-700 flex-shrink-0" />

            <select
              className="bg-slate-800 border border-slate-700 text-white text-xs rounded-lg px-2 py-1 font-bold flex-shrink-0"
              value={slateId}
              onChange={e => {
                const selectedSlate = sportSlates.find(s => String(s.id) === e.target.value);
                const userTier = subData?.tier || "free";
                if (selectedSlate && !selectedSlate.isMain && userTier !== "pro" && !userIsAdmin) {
                  toast({ title: "Champion Feature", description: "Additional slates require a Champion subscription. Visit the Pricing page to upgrade.", variant: "destructive" });
                  return;
                }
                handleSlateChange(e.target.value);
              }}
              data-testid="pro-slate-selector"
            >
              {sportSlates.map(s => {
                const userTier = subData?.tier || "free";
                const isGated = !s.isMain && userTier !== "pro" && !userIsAdmin;
                return (
                  <option key={s.id} value={s.id} disabled={isGated}>
                    {formatSlateOptionLabel(s)}{isGated ? " · CHAMPION" : ""}
                  </option>
                );
              })}
            </select>

            {slate && (
              <span
                className="hidden lg:inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wide text-slate-400 whitespace-nowrap"
                data-testid="pro-selected-slate-identity"
              >
                Target: <span className="text-amber-300">{formatDraftGroupIdentity(slate)}</span>
              </span>
            )}
            <Link
              href={`/player-config?slateId=${slateId}`}
              className="hidden lg:inline-flex text-[10px] font-black uppercase tracking-wide text-amber-300 hover:text-amber-200"
              data-testid="pro-player-configuration-link"
            >
              Player Configuration
            </Link>

            {isPro && (
              <>
                <div className="h-4 w-px bg-slate-700 flex-shrink-0 hidden md:block" />
                <div className="hidden md:flex items-center gap-1.5 flex-shrink-0">
                  <LabelTip text="Apply AI Scout projection adjustments from live injury and news data."><label className="text-[10px] font-black text-slate-400 uppercase">Boosts</label></LabelTip>
                  <Switch checked={useBoosts} onCheckedChange={setUseBoosts} data-testid="toggle-boosts" className="scale-90" />
                </div>
                <div className="hidden md:flex items-center gap-1.5 flex-shrink-0">
                  <LabelTip text="Down-weight heavily-owned 'chalk' players and boost low-ownership plays for tournament differentiation."><label className="text-[10px] font-black text-amber-400 uppercase">Leverage</label></LabelTip>
                  <Switch checked={leverageMode} onCheckedChange={setLeverageMode} data-testid="toggle-leverage" className="scale-90" />
                </div>
                <div className="hidden md:flex items-center gap-1.5 flex-shrink-0">
                  <LabelTip text="Outperformer Mode — boosts players who consistently meet or exceed their projections and penalizes those who consistently miss."><label className="text-[10px] font-black text-cyan-400 uppercase">OPM</label></LabelTip>
                  <Switch checked={outperformerMode} onCheckedChange={setOutperformerMode} data-testid="toggle-outperformer" className="scale-90" />
                </div>
                <div className="hidden md:flex items-center gap-1.5 flex-shrink-0">
                  <LabelTip text="Balanced = safe, high-floor lineups for cash games. Ceiling = high-upside lineups targeting boom-or-bust GPP plays."><label className="text-[10px] font-black text-purple-400 uppercase">Mode</label></LabelTip>
                  <button
                    onClick={() => setProjectionMode(projectionMode === "balanced" ? "ceiling" : "balanced")}
                    className={`text-[10px] font-black px-2 py-0.5 rounded ${
                      projectionMode === "ceiling"
                        ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                        : "bg-slate-700/50 text-slate-400 border border-slate-600/30"
                    }`}
                    data-testid="button-projection-mode"
                  >
                    {projectionMode === "ceiling" ? "CEILING" : "BALANCED"}
                  </button>
                </div>
              </>
            )}

            <div className="h-4 w-px bg-slate-700 flex-shrink-0 hidden md:block" />

            {!simMode && <div className="hidden md:flex items-center gap-2 bg-slate-800/60 rounded-lg px-2 py-1 border border-slate-700/50 flex-shrink-0">
              <LabelTip text="Number of unique lineups to generate. More lineups = more diversity and exposure spread."><span className="text-[10px] font-black text-slate-400 uppercase whitespace-nowrap">Qty</span></LabelTip>
              <Slider
                value={[lineupCount]}
                onValueChange={(v) => setLineupCount(Math.min(v[0], maxLineupSlider))}
                min={1}
                max={maxLineupSlider}
                step={1}
                className="w-20"
                data-testid="slider-lineup-count"
              />
              <span className="text-xs font-black text-amber-400 min-w-[18px] text-center" data-testid="text-lineup-count">{lineupCount}</span>
            </div>}

          </div>

          {/* Row 2 (Desktop): Max Exposure + Salary Range */}
          {(isPro && (simMode ? numSims : lineupCount) > 1 || (players && players.length > 0)) && (
            <div className="hidden md:flex items-center gap-3 overflow-x-auto scrollbar-hide">
              <div className="flex items-center gap-2 bg-slate-800/60 rounded-lg px-2 py-1 border border-slate-700/50 flex-shrink-0">
                <LabelTip text="Exclude players whose base projection is below this cutoff. Custom projections and manual +pts boosts are included; automatic, Scout, and simulation adjustments do not affect eligibility."><label htmlFor="input-min-projection" className="text-[10px] font-black text-emerald-400 uppercase whitespace-nowrap">Min Projection</label></LabelTip>
                <input
                  id="input-min-projection"
                  type="number"
                  min={0}
                  step="0.1"
                  placeholder="Off"
                  value={minProjection ?? ""}
                  onChange={e => {
                    const value = e.target.value;
                    if (value === "") {
                      setMinProjection(null);
                      return;
                    }
                    const parsed = Number(value);
                    if (Number.isFinite(parsed) && parsed >= 0) setMinProjection(parsed);
                  }}
                  className={`w-20 bg-transparent border-0 text-right font-mono font-black text-xs focus:outline-none tabular-nums ${minProjection !== null ? "text-emerald-400" : "text-slate-500"}`}
                  data-testid="input-min-projection"
                />
                <span className={`text-xs font-black min-w-[42px] text-center ${minProjection !== null ? "text-emerald-400" : "text-slate-500"}`}>
                  {minProjection !== null ? `${minProjection}+` : "pts min"}
                </span>
                {minProjection !== null && (
                  <button onClick={() => setMinProjection(null)} className="text-slate-500 hover:text-white cursor-pointer" data-testid="button-reset-min-projection"><X className="w-3 h-3" /></button>
                )}
              </div>
              {isNflClassic && (
                <FlexPositionControls
                  allowedPositions={flexAllowedPositions}
                  onToggle={toggleFlexPosition}
                />
              )}
              {isPro && (simMode ? numSims : lineupCount) > 1 && (
                <>
                  <div className="flex items-center gap-2 bg-slate-800/60 rounded-lg px-2 py-1 border border-slate-700/50 flex-shrink-0">
                    <LabelTip text="Maximum share for any player within this newly generated batch. An 80% cap still allows the player in up to 80% of the batch, so it reduces concentration but cannot guarantee one injury will not affect many lineups."><span className="text-[10px] font-black text-cyan-400 uppercase whitespace-nowrap">Max Exp</span></LabelTip>
                    <Slider
                      value={[globalMaxExposure ?? 100]}
                      onValueChange={(v) => setGlobalMaxExposure(v[0] === 100 ? null : v[0])}
                      min={10}
                      max={100}
                      step={5}
                      className="w-24"
                      data-testid="slider-global-exposure"
                    />
                    <span className={`text-xs font-black min-w-[28px] text-center ${globalMaxExposure ? "text-cyan-400" : "text-slate-500"}`} data-testid="text-global-exposure">
                      {globalMaxExposure ? `${globalMaxExposure}%` : "Off"}
                    </span>
                  </div>
                </>
              )}
              {players && players.length > 0 && (
                <div className="flex items-center gap-2 bg-slate-800/60 rounded-lg px-2 py-1 border border-slate-700/50 flex-shrink-0">
                  <span className="text-[10px] font-black text-emerald-400 uppercase whitespace-nowrap">Salary</span>
                  <Slider
                    value={salaryRange || [salaryBounds.min, salaryBounds.max]}
                    onValueChange={(v) => setSalaryRange([v[0], v[1]])}
                    min={salaryBounds.min}
                    max={salaryBounds.max}
                    step={salaryBounds.step}
                    className="w-32"
                    data-testid="slider-salary-range"
                  />
                  <span className={`text-[10px] font-black min-w-[70px] text-center tabular-nums ${salaryRange && (salaryRange[0] > salaryBounds.min || salaryRange[1] < salaryBounds.max) ? pColors.text : "text-slate-500"}`} data-testid="text-salary-range">
                    {salaryRange && (salaryRange[0] > salaryBounds.min || salaryRange[1] < salaryBounds.max)
                      ? `${formatSalary(salaryRange[0], platform)}-${formatSalary(salaryRange[1], platform)}`
                      : "All"}
                  </span>
                  {salaryRange && (salaryRange[0] > salaryBounds.min || salaryRange[1] < salaryBounds.max) && (
                    <button onClick={() => setSalaryRange(null)} className="text-slate-500 hover:text-white cursor-pointer" data-testid="button-reset-salary">
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              )}
              <div className="flex items-center gap-1.5 bg-slate-800/60 rounded-lg px-2 py-1 border border-slate-700/50 flex-shrink-0">
                <LabelTip text="Only include players at or above this star rating. Ratings are based on projected points: 1★ (<15), 2★ (15-24), 3★ (25-34), 4★ (35-44), 5★ (45+)."><span className="text-[10px] font-black text-amber-400 uppercase whitespace-nowrap">Min ★</span></LabelTip>
                <div className="flex gap-1">
                  {[0, 1, 2, 3, 4, 5].map(n => (
                    <button
                      key={n}
                      onClick={() => setMinStarRating(minStarRating === n ? 0 : n)}
                      className={`w-5 h-5 rounded text-[10px] font-black transition-all border ${
                        minStarRating === n
                          ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
                          : "text-slate-500 border-slate-700/50 hover:text-slate-300"
                      }`}
                      data-testid={`btn-min-stars-${n}`}
                    >
                      {n === 0 ? "All" : n}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
          {players && players.length > 0 && (
            <p className="hidden md:block px-1 pt-1 text-[9px] leading-tight text-slate-500">
              Below-cutoff players are excluded using base/custom projection plus manual +pts boosts; automatic, Scout, and simulation adjustments do not affect eligibility.
            </p>
          )}

          {/* Row 2 (Mobile only): Toggles + settings */}
          {isPro && (
            <div className="flex md:hidden items-center gap-3 overflow-x-auto scrollbar-hide">
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <label className="text-[10px] font-black text-slate-400 uppercase">Boosts</label>
                <Switch checked={useBoosts} onCheckedChange={setUseBoosts} data-testid="toggle-boosts-mobile" className="scale-90" />
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <label className="text-[10px] font-black text-amber-400 uppercase">Leverage</label>
                <Switch checked={leverageMode} onCheckedChange={setLeverageMode} data-testid="toggle-leverage-mobile" className="scale-90" />
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <LabelTip text="Outperformer Mode — boosts players who consistently meet or exceed their projections and penalizes those who consistently miss."><label className="text-[10px] font-black text-cyan-400 uppercase">OPM</label></LabelTip>
                <Switch checked={outperformerMode} onCheckedChange={setOutperformerMode} data-testid="toggle-outperformer-mobile" className="scale-90" />
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <label className="text-[10px] font-black text-purple-400 uppercase">Mode</label>
                <button
                  onClick={() => setProjectionMode(projectionMode === "balanced" ? "ceiling" : "balanced")}
                  className={`text-[10px] font-black px-2 py-0.5 rounded ${
                    projectionMode === "ceiling"
                      ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                      : "bg-slate-700/50 text-slate-400 border border-slate-600/30"
                  }`}
                  data-testid="button-projection-mode-mobile"
                >
                  {projectionMode === "ceiling" ? "CEILING" : "BALANCED"}
                </button>
              </div>
              {!simMode && <div className="flex items-center gap-2 bg-slate-800/60 rounded-lg px-2 py-1 border border-slate-700/50 flex-shrink-0">
                <span className="text-[10px] font-black text-slate-400 uppercase whitespace-nowrap">Qty</span>
                <Slider
                  value={[lineupCount]}
                  onValueChange={(v) => setLineupCount(Math.min(v[0], maxLineupSlider))}
                  min={1}
                  max={maxLineupSlider}
                  step={1}
                  className="w-20"
                  data-testid="slider-lineup-count-mobile"
                />
                <span className="text-xs font-black text-amber-400 min-w-[18px] text-center">{lineupCount}</span>
              </div>}
              {isPro && (simMode ? numSims : lineupCount) > 1 && (
                <>
                  <div className="flex items-center gap-2 bg-slate-800/60 rounded-lg px-2 py-1 border border-slate-700/50 flex-shrink-0">
                    <span className="text-[10px] font-black text-slate-400 uppercase whitespace-nowrap">Max Exp</span>
                    <Slider
                      value={[globalMaxExposure ?? 100]}
                      onValueChange={(v) => setGlobalMaxExposure(v[0] === 100 ? null : v[0])}
                      min={10}
                      max={100}
                      step={5}
                      className="w-20"
                      data-testid="slider-global-exposure-mobile"
                    />
                    <span className={`text-xs font-black min-w-[28px] text-center ${globalMaxExposure ? "text-cyan-400" : "text-slate-500"}`}>
                      {globalMaxExposure ? `${globalMaxExposure}%` : "Off"}
                    </span>
                  </div>
                </>
              )}
              {players && players.length > 0 && (
                <div className="flex items-center gap-2 bg-slate-800/60 rounded-lg px-2 py-1 border border-slate-700/50 flex-shrink-0">
                  <span className="text-[10px] font-black text-emerald-400 uppercase whitespace-nowrap">Salary</span>
                  <Slider
                    value={salaryRange || [salaryBounds.min, salaryBounds.max]}
                    onValueChange={(v) => setSalaryRange([v[0], v[1]])}
                    min={salaryBounds.min}
                    max={salaryBounds.max}
                    step={salaryBounds.step}
                    className="w-24"
                    data-testid="slider-salary-range-mobile"
                  />
                  <span className={`text-[10px] font-black min-w-[60px] text-center tabular-nums ${salaryRange && (salaryRange[0] > salaryBounds.min || salaryRange[1] < salaryBounds.max) ? pColors.text : "text-slate-500"}`}>
                    {salaryRange && (salaryRange[0] > salaryBounds.min || salaryRange[1] < salaryBounds.max)
                      ? `${formatSalary(salaryRange[0], platform)}-${formatSalary(salaryRange[1], platform)}`
                      : "All"}
                  </span>
                </div>
              )}
              <div className="flex items-center gap-1 bg-slate-800/60 rounded-lg px-2 py-1 border border-slate-700/50 flex-shrink-0">
                <LabelTip text="Only include players at or above this star rating. Ratings are based on projected points: 1★ (<15), 2★ (15-24), 3★ (25-34), 4★ (35-44), 5★ (45+)."><span className="text-[10px] font-black text-amber-400 uppercase whitespace-nowrap">Min ★</span></LabelTip>
                {[0, 1, 2, 3, 4, 5].map(n => (
                  <button
                    key={n}
                    onClick={() => setMinStarRating(minStarRating === n ? 0 : n)}
                    className={`w-5 h-5 rounded text-[10px] font-black transition-all border ${
                      minStarRating === n
                        ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
                        : "text-slate-500 border-slate-700/50 hover:text-slate-300"
                    }`}
                    data-testid={`btn-min-stars-mobile-${n}`}
                  >
                    {n === 0 ? "All" : n}
                  </button>
                ))}
              </div>
            </div>
          )}

          {isNflClassic && (
            <div className="flex md:hidden mt-1.5">
              <FlexPositionControls
                allowedPositions={flexAllowedPositions}
                onToggle={toggleFlexPosition}
                testId="nfl-flex-controls-mobile"
              />
            </div>
          )}

          <div className="flex md:hidden flex-col gap-1 mt-1.5" data-testid="min-projection-section-mobile">
            <div className="flex items-center gap-2 bg-slate-800/60 rounded-lg px-2 py-1.5 border border-slate-700/50">
              <Target className={`w-3.5 h-3.5 flex-shrink-0 ${minProjection !== null ? "text-emerald-400" : "text-slate-500"}`} />
              <label htmlFor="input-min-projection-mobile" className="text-[10px] font-black text-emerald-400 uppercase whitespace-nowrap">Min Projection</label>
              <input
                id="input-min-projection-mobile"
                type="number"
                min={0}
                step="0.1"
                placeholder="Off"
                value={minProjection ?? ""}
                onChange={e => {
                  const value = e.target.value;
                  if (value === "") {
                    setMinProjection(null);
                    return;
                  }
                  const parsed = Number(value);
                  if (Number.isFinite(parsed) && parsed >= 0) setMinProjection(parsed);
                }}
                className={`flex-1 min-w-0 bg-transparent border-0 text-right font-mono font-black text-xs focus:outline-none tabular-nums ${minProjection !== null ? "text-emerald-400" : "text-slate-500"}`}
                data-testid="input-min-projection-mobile"
              />
              <span className={`text-[10px] font-black whitespace-nowrap ${minProjection !== null ? "text-emerald-400" : "text-slate-500"}`}>
                {minProjection !== null ? `${minProjection}+` : "pts min"}
              </span>
              {minProjection !== null && (
                <button onClick={() => setMinProjection(null)} className="text-slate-500 hover:text-white cursor-pointer" data-testid="button-reset-min-projection-mobile"><X className="w-3 h-3" /></button>
              )}
            </div>
            <p className="px-1 text-[9px] leading-tight text-slate-500">
              Below-cutoff players are excluded using base/custom projection plus manual +pts boosts; automatic, Scout, and simulation adjustments do not affect eligibility.
            </p>
          </div>

          {/* Row 3 (Mobile only for non-Pro): Qty slider */}
          {!isPro && (
            <div className="flex md:hidden items-center gap-2">
              {!simMode && <div className="flex items-center gap-2 bg-slate-800/60 rounded-lg px-2 py-1 border border-slate-700/50 flex-shrink-0">
                <span className="text-[10px] font-black text-slate-400 uppercase whitespace-nowrap">Qty</span>
                <Slider
                  value={[lineupCount]}
                  onValueChange={(v) => setLineupCount(Math.min(v[0], maxLineupSlider))}
                  min={1}
                  max={maxLineupSlider}
                  step={1}
                  className="w-20"
                  data-testid="slider-lineup-count-basic-mobile"
                />
                <span className="text-xs font-black text-amber-400 min-w-[18px] text-center">{lineupCount}</span>
              </div>}
              {players && players.length > 0 && (
                <div className="flex items-center gap-2 bg-slate-800/60 rounded-lg px-2 py-1 border border-slate-700/50 flex-shrink-0">
                  <span className={`text-[10px] font-black ${pColors.text} uppercase whitespace-nowrap`}>Salary</span>
                  <Slider
                    value={salaryRange || [salaryBounds.min, salaryBounds.max]}
                    onValueChange={(v) => setSalaryRange([v[0], v[1]])}
                    min={salaryBounds.min}
                    max={salaryBounds.max}
                    step={salaryBounds.step}
                    className="w-24"
                    data-testid="slider-salary-range-basic-mobile"
                  />
                  <span className={`text-[10px] font-black min-w-[60px] text-center tabular-nums ${salaryRange && (salaryRange[0] > salaryBounds.min || salaryRange[1] < salaryBounds.max) ? pColors.text : "text-slate-500"}`}>
                    {salaryRange && (salaryRange[0] > salaryBounds.min || salaryRange[1] < salaryBounds.max)
                      ? `${formatSalary(salaryRange[0], platform)}-${formatSalary(salaryRange[1], platform)}`
                      : "All"}
                  </span>
                </div>
              )}
            </div>
          )}

          {slateHasStarted && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-2.5 text-center" data-testid="slate-locked-msg">
              <p className="text-red-400 text-xs font-bold">This slate has locked — games have already started.</p>
              <p className="text-slate-400 text-[10px] mt-0.5">Switch to another sport with upcoming games to build lineups.</p>
            </div>
          )}

          {/* ── Optimizer Mode ─────────────────────────────────────────────── */}
          <div className={`rounded-xl border transition-all overflow-hidden ${simMode ? "border-violet-500/40 bg-violet-500/5" : "border-emerald-500/30 bg-emerald-500/5"}`} data-testid="sim-mode-panel">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-3 py-2">
              <div>
                <div className="flex items-center gap-2">
                  <Activity className={`w-3.5 h-3.5 ${simMode ? "text-violet-400" : "text-emerald-400"}`} />
                  <span className="text-xs font-black text-white">Optimizer Mode</span>
                </div>
                <p className="mt-0.5 text-[10px] text-slate-400">
                  {simMode
                    ? "Simulation compares lineups across many possible game outcomes."
                    : "Normal builds the strongest lineups from the selected projections."}
                </p>
              </div>
              <div className="grid grid-cols-2 rounded-lg bg-slate-950/60 p-1 border border-slate-700/60" role="group" aria-label="Optimizer mode">
                <button
                  type="button"
                  onClick={() => setSimMode(false)}
                  className={`px-3 py-1 rounded-md text-[10px] font-black transition-colors ${!simMode ? "bg-emerald-500/20 text-emerald-300" : "text-slate-500 hover:text-slate-300"}`}
                  data-testid="btn-normal-mode"
                >
                  NORMAL
                </button>
                <button
                  type="button"
                  onClick={() => setSimMode(true)}
                  className={`px-3 py-1 rounded-md text-[10px] font-black transition-colors ${simMode ? "bg-violet-500/20 text-violet-300" : "text-slate-500 hover:text-slate-300"}`}
                  data-testid="btn-sim-mode-toggle"
                >
                  SIMULATION
                </button>
              </div>
            </div>

            {simMode && (
              <div className="px-3 pb-2 pt-1 space-y-2 border-t border-violet-500/10">
                <div className="space-y-1">
                  <LabelTip text="Sets the simulation count and the maximum number of unique lineups to return. Fewer may be returned when scenarios produce duplicate lineups or constraints limit the pool. Normal-mode Qty does not apply."><span className="text-[9px] font-black text-violet-300 uppercase">Sim lineup count</span></LabelTip>
                  <div className="flex gap-1">
                    {[50, 100, 200, ...(isPro || userIsAdmin ? [500] : [])].map(n => (
                      <button
                        key={n}
                        onClick={() => setNumSims(n)}
                        className={`flex-1 py-0.5 rounded text-[10px] font-black transition-all border ${
                          numSims === n
                            ? "bg-violet-500/20 text-violet-400 border-violet-500/30"
                            : "text-slate-500 border-slate-700/50 hover:text-slate-300"
                        }`}
                        data-testid={`btn-sims-${n}`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setSimSettingsExpanded(expanded => !expanded)}
                  className="flex w-full items-center justify-between rounded-md border border-violet-500/20 bg-slate-950/40 px-2 py-1.5 text-left transition-colors hover:bg-violet-500/10"
                  aria-expanded={simSettingsExpanded}
                  data-testid="button-toggle-sim-settings"
                >
                  <span className="text-[10px] font-black uppercase tracking-wide text-violet-200">
                    Advanced simulation settings
                    {stackGameKeys.length > 0 ? ` · ${stackGameKeys.length} game stack${stackGameKeys.length === 1 ? "" : "s"} selected` : ""}
                  </span>
                  {simSettingsExpanded ? <ChevronUp className="h-3.5 w-3.5 text-violet-300" /> : <ChevronDown className="h-3.5 w-3.5 text-violet-300" />}
                </button>

                {simSettingsExpanded && <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <InfoTip
                    text="P90 = top 10% ceiling (boom potential). P75 = top 25% upside. Median = middle outcome. Average = mean across all sims. Composite = weighted blend of all metrics. 🏆 EV = tournament expected value — every lineup is scored against a simulated opponent field built from projected ownership and mapped through a GPP payout curve (with a chalk-duplication penalty). Best for large-field GPPs."
                    side="bottom"
                  />
                  <span className="text-[9px] font-black text-slate-500 uppercase">Sort By</span>
                  <div className="flex gap-1 flex-1">
                    {([
                      { key: "composite", label: "Composite" },
                      { key: "p90", label: "P90" },
                      { key: "p75", label: "P75" },
                      { key: "median", label: "Median" },
                      { key: "avg", label: "Average" },
                      { key: "ev", label: "🏆 EV" },
                    ] as const).map(m => (
                      <button
                        key={m.key}
                        onClick={() => setSimSortMetric(m.key)}
                        className={`flex-1 py-0.5 rounded text-[10px] font-black transition-all border ${
                          simSortMetric === m.key
                            ? "bg-violet-500/20 text-violet-400 border-violet-500/30"
                            : "text-slate-500 border-slate-700/50 hover:text-slate-300"
                        }`}
                        data-testid={`btn-sim-sort-${m.key}`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>
                </div>}

                {/* Target game stack — compact */}
                {(availableGames.length > 0 || (isClassic && selectableFavoriteStacks.length > 0)) && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <LabelTip text="NFL quarterbacks always pair with at least one same-team WR/TE. Select games to also require that pair and an opposing RB/WR/TE from one selected game. Other sports require three players from a selected game, including both teams; no selection leaves them unrestricted."><span className="text-[9px] font-black text-slate-500 uppercase tracking-wider">Game Stacks ({stackGameKeys.length} selected)</span></LabelTip>
                      {(stackGameKeys.length > 0 || favoriteStackIds.length > 0) && (
                        <button
                          onClick={() => {
                            setStackGameKeys([]);
                            setFavoriteStackIds([]);
                          }}
                          className="text-[9px] font-black text-red-400 hover:text-red-300 transition-colors"
                          data-testid="btn-clear-stack-game"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {availableGames.map(g => (
                        <button
                          key={g.key}
                          onClick={() => setStackGameKeys(keys => keys.includes(g.key) ? keys.filter(key => key !== g.key) : [...keys, g.key])}
                          aria-pressed={stackGameKeys.includes(g.key)}
                          className={`px-1.5 py-0.5 rounded text-[9px] font-black transition-all border ${
                            stackGameKeys.includes(g.key)
                              ? "bg-violet-500/20 text-violet-400 border-violet-500/40 ring-1 ring-violet-500/20"
                              : "text-slate-500 border-slate-700/50 hover:text-slate-300 hover:border-slate-600"
                          }`}
                          data-testid={`btn-stack-game-${g.key}`}
                        >
                          {g.label}
                        </button>
                      ))}
                    </div>
                    {isClassic && selectableFavoriteStacks.length > 0 && (
                      <div className="mt-2 space-y-1.5 border-t border-violet-500/10 pt-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[9px] font-black uppercase tracking-wider text-violet-300">
                            Saved stack alternatives ({selectedFavoriteStackIds.length} selected)
                          </span>
                          <Link
                            href={`/top-stacks?slateId=${slateId}`}
                            className="text-[9px] font-black text-violet-300 hover:text-violet-200 whitespace-nowrap"
                            data-testid="link-manage-top-stacks"
                          >
                            Manage / Top Stacks
                          </Link>
                        </div>
                        <div className="grid gap-1 sm:grid-cols-2">
                          {selectableFavoriteStacks.map(stack => {
                            const stackPlayers = stack.playerIds
                              .map(playerId => playersById.get(Number(playerId)))
                              .filter((player): player is PlayerWithOwnership => !!player);
                            const playerDetails = stack.playerIds.map(playerId => {
                              const player = playersById.get(Number(playerId));
                              return player
                                ? `${player.name} (${player.position} · ${player.team})`
                                : `Player #${playerId}`;
                            }).join(", ");
                            const gameLabel = stack.gameKey
                              ? availableGames.find(game => game.key === stack.gameKey)?.label || stack.gameKey
                              : null;
                            const detail = stack.kind === "game"
                              ? `${gameLabel ? `Game: ${gameLabel}` : "Saved game"}${playerDetails ? ` · ${playerDetails}` : ""}`
                              : `Exact players: ${playerDetails || "Saved exact-player stack"}`;
                            const selected = selectedFavoriteStackIds.includes(Number(stack.id));
                            return (
                              <button
                                key={stack.id}
                                type="button"
                                onClick={() => setFavoriteStackIds(ids => selected
                                  ? ids.filter(id => Number(id) !== Number(stack.id))
                                  : [...ids, Number(stack.id)])}
                                aria-pressed={selected}
                                className={`min-w-0 rounded border px-2 py-1 text-left transition-all ${
                                  selected
                                    ? "border-violet-500/40 bg-violet-500/20 text-violet-200 ring-1 ring-violet-500/20"
                                    : "border-slate-700/50 text-slate-400 hover:border-violet-500/30 hover:text-slate-200"
                                }`}
                                data-testid={`btn-favorite-stack-${stack.id}`}
                              >
                                <span className="block truncate text-[10px] font-black">{stack.name}</span>
                                <span className="block truncate text-[9px] font-medium text-slate-500" title={detail}>
                                  {detail}
                                </span>
                                {stack.kind === "players" && stackPlayers.length > 0 && (
                                  <span className="sr-only">{stackPlayers.length} saved players</span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                        <p className="text-[10px] leading-tight text-slate-400">
                          Saved stacks are alternatives to the game buttons. Each lineup uses one chosen alternative — not all selected alternatives combined.
                        </p>
                      </div>
                    )}
                    <p className="text-[10px] text-slate-400">
                      {stackGameKeys.length
                        ? sport === "NFL"
                          ? "Each lineup: QB + same-team WR/TE + opposing RB/WR/TE from one selected game."
                          : "Each lineup: 3+ players from one selected game, including both teams."
                        : sport === "NFL"
                          ? "Always required: QB + at least one same-team WR/TE. Select games to add an opposing player."
                          : "Select games to require stacks. None selected: unrestricted."}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Action Buttons Row */}
          <div className="flex flex-wrap items-center gap-2 pt-1 md:pt-0">
            <Button
              onClick={handleOptimize}
              disabled={isOptimizing || slateHasStarted}
              size="sm"
              className={`font-black shadow-lg text-xs flex-1 md:flex-none ${
                simMode
                  ? "bg-violet-500 text-white shadow-violet-500/20 hover:bg-violet-400"
                  : "bg-amber-500 text-black shadow-amber-500/20 hover:bg-amber-400"
              }`}
              data-testid="button-generate"
            >
              {isOptimizing ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              ) : simMode ? (
                <Activity className="w-3.5 h-3.5 mr-1.5" />
              ) : (
                <Zap className="w-3.5 h-3.5 mr-1.5" />
              )}
              {slateHasStarted ? "SLATE LOCKED"
                : isOptimizing && simMode ? `Simulating ${numSims}×…`
                : simMode ? `Simulate up to ${numSims} Lineups`
                : `Generate ${lineupCount}`}
            </Button>

            {generatedLineups.length > 0 && (
              <>
                <Button
                  onClick={handleSaveAll}
                  disabled={isSavingAll || saveLineupMutation.isPending || savedIndices.size === generatedLineups.length}
                  variant="outline"
                  size="sm"
                  className={`font-black text-xs flex-1 md:flex-none ${savedIndices.size === generatedLineups.length ? "border-emerald-500/30 text-emerald-400" : "border-amber-500/30 text-amber-400"}`}
                  data-testid="button-save-all"
                >
                  {isSavingAll ? (
                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  ) : savedIndices.size === generatedLineups.length ? (
                    <Trophy className="w-3.5 h-3.5 mr-1.5" />
                  ) : (
                    <SaveAll className="w-3.5 h-3.5 mr-1.5" />
                  )}
                  <span className="hidden sm:inline">
                    {savedIndices.size === generatedLineups.length
                      ? "All Saved"
                      : isSavingAll
                        ? `Saving ${savedIndices.size}/${generatedLineups.length}...`
                        : savedIndices.size > 0
                          ? `Save (${generatedLineups.length - savedIndices.size})`
                          : `Save All (${generatedLineups.length})`}
                  </span>
                  <span className="sm:hidden">
                    {savedIndices.size === generatedLineups.length
                      ? "Saved"
                      : isSavingAll
                        ? `${savedIndices.size}/${generatedLineups.length}`
                        : `Save ${savedIndices.size > 0 ? generatedLineups.length - savedIndices.size : "All"}`}
                  </span>
                </Button>
                <Button
                  onClick={handleExportCSV}
                  variant="outline"
                  size="sm"
                  className="font-black text-xs border-cyan-500/30 text-cyan-400 flex-1 md:flex-none"
                  data-testid="button-export-csv"
                  title={slate ? `Export for ${formatDraftGroupIdentity(slate)}` : "Export CSV"}
                >
                  <Download className="w-3.5 h-3.5 mr-1.5" />
                  <span className="hidden sm:inline">Export CSV</span>
                  <span className="sm:hidden">CSV</span>
                </Button>
                {slate && (
                  <span className="basis-full text-[10px] text-slate-500 truncate" data-testid="pro-export-slate-identity">
                    Export target: <span className="font-bold text-slate-300">{formatSlateIdentity(slate)}</span>
                  </span>
                )}
              </>
            )}

            <Button variant="ghost" size="sm" onClick={() => handleReset()} className="text-slate-400 font-bold text-xs" data-testid="button-reset">
              Reset
            </Button>
          </div>
        </div>
      </div>}

      {!playerFocus && portfolioSupported && <div className="shrink-0 p-2 space-y-2 max-h-[40dvh] overflow-auto">
        <NflPortfolioControls key={`${userId}:${slateId}`} settings={portfolio.settings} onChange={portfolio.setSettings} supported={portfolioSupported} players={players || []} slateId={slateId} />
        <NflPortfolioReportView report={portfolio.report} target={`Slate ${slateId} · ${simMode ? "Sim" : "Pro"}`} />
      </div>}
      <div className="flex min-h-0 flex-1 flex-col 2xl:flex-row 2xl:overflow-hidden">
        {/* LEFT: Player Pool */}
        <div ref={playerPoolRef} className={`flex min-w-0 flex-1 flex-col border-r border-slate-800 2xl:overflow-hidden ${playerFocus ? "w-full min-h-0 overflow-hidden" : ""} ${!playerFocus && mobileView !== "players" ? "hidden 2xl:flex" : ""}`}>
          {/* AI Scout Panel */}
          {!playerFocus && <div className="px-3 sm:px-4 pt-2">
            <ScoutPanel
              sport={sport}
              players={players}
              compact
              onBoostApply={(projections) => {
                setCustomProjections(prev => ({ ...projections, ...prev }));
              }}
            />
          </div>}

          {/* Filter Bar */}
          <div className="px-4 py-3 border-b border-slate-800 bg-slate-900/20 flex flex-col md:flex-row gap-3 items-stretch md:items-center">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Search players..."
                className="bg-slate-900 border-slate-700 pl-10 h-9 text-sm"
                value={search}
                onChange={e => setSearch(e.target.value)}
                data-testid="input-player-search"
              />
            </div>
            <div className="flex gap-1 bg-slate-900 rounded-lg p-0.5 border border-slate-800 flex-wrap">
              {positions.map(pos => (
                <button
                  key={pos}
                  onClick={() => setPosFilter(pos)}
                  data-testid={`filter-pos-${pos}`}
                  className={`px-3 py-1.5 rounded-md text-[11px] font-black transition-all ${
                    posFilter === pos
                      ? "bg-amber-500 text-black shadow-lg shadow-amber-500/20"
                      : "text-slate-400 hover:text-slate-300"
                  }`}
                >
                  {pos}
                </button>
              ))}
            </div>
            <div className="text-[11px] text-slate-400 font-bold ml-auto" data-testid="text-player-count">
              {filteredPlayers.length} players
            </div>
            <button
              type="button"
              onClick={() => { void refreshPlayers(); }}
              disabled={isFetchingPlayers}
              title="Refresh player pool"
              aria-label="Refresh player pool"
              data-testid="button-refresh-players"
              className="inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-[11px] font-black uppercase tracking-wide text-slate-300 transition-colors hover:border-amber-500/50 hover:text-amber-300 disabled:cursor-wait disabled:opacity-60"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isFetchingPlayers ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
            <button
              type="button"
              onClick={togglePlayerFocus}
              aria-pressed={playerFocus}
              data-testid="button-player-focus"
              className={`inline-flex items-center justify-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-black uppercase tracking-wide transition-colors ${playerFocus ? "border-amber-400/50 bg-amber-500/15 text-amber-300" : "border-slate-700 bg-slate-900 text-slate-300 hover:border-amber-500/40 hover:text-amber-300"}`}
            >
              {playerFocus ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              {playerFocus ? "Back to optimizer" : "Expand players"}
            </button>
          </div>
          {playerRefreshError && players && (
            <div
              role="alert"
              data-testid="player-refresh-warning"
              className="flex items-center justify-between gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-[11px] font-bold text-amber-300"
            >
              <span>Player data could not be refreshed. Showing the last loaded pool.</span>
              <button
                type="button"
                onClick={() => { void refreshPlayers(); }}
                className="shrink-0 underline underline-offset-2 hover:text-amber-100"
              >
                Try again
              </button>
            </div>
          )}

          {slate && (slate as any).games?.length > 0 && !isGolf && (
            <div className={`px-3 sm:px-4 py-1.5 border-b bg-slate-950/80 ${pColors.border} flex items-center gap-2 overflow-x-auto`} data-testid="pro-slate-games-strip">
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex-shrink-0">Games:</span>
              <div className="flex items-center gap-1.5 flex-wrap">
                {((slate as any).games as string[]).map((g: string) => (
                  <span key={g} className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${pColors.border} bg-slate-800/60 text-slate-300`}>
                    {g}
                  </span>
                ))}
              </div>
              <span className="text-[10px] font-bold text-slate-600 flex-shrink-0 ml-auto">
                {new Date(slate.startTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZoneName: "short" })}
              </span>
            </div>
          )}

          {/* Golf Tournament Cards */}
          {isGolf && golfTournamentCards && (
            <div className="px-4 pb-3 pt-3 border-b border-lime-500/20">
              <div className="flex items-center gap-2 mb-3">
                <Trophy className="w-4 h-4 text-lime-400" />
                <span className="text-xs font-black text-white uppercase tracking-widest">Tournament Center</span>
                <Badge className="text-[10px] font-black bg-lime-500/20 text-lime-300 border-lime-500/30">LIVE</Badge>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 pb-2">
                <div className="rounded-xl overflow-hidden bg-gradient-to-br from-lime-500/10 via-emerald-500/10 to-slate-900 border border-lime-500/25" data-testid="pro-tournament-info-card">
                  <div className="px-4 py-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Flag className="w-4 h-4 text-lime-400" />
                      <span className="text-sm font-black text-white">{golfTournamentCards.tournamentName}</span>
                    </div>
                    {golfTournamentCards.courseName && (
                      <div className="flex items-center gap-1.5 mb-2">
                        <MapPin className="w-3 h-3 text-slate-400" />
                        <span className="text-xs text-slate-300 font-medium">{golfTournamentCards.courseName}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-3 mt-2">
                      <div className="flex items-center gap-1">
                        <Users className="w-3 h-3 text-slate-400" />
                        <span className="text-[11px] font-bold text-slate-300">{golfTournamentCards.fieldSize} Golfers</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-[11px] font-bold text-slate-300">Avg ${golfTournamentCards.avgSalary.toLocaleString()}</span>
                      </div>
                    </div>
                    {slate && (
                      <div className="mt-2 text-[10px] font-bold text-lime-400/70 uppercase tracking-wider">
                        {new Date(slate.startTime).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
                      </div>
                    )}
                  </div>
                </div>
                <div className="rounded-xl overflow-hidden bg-gradient-to-br from-amber-500/10 via-slate-900 to-slate-900 border border-amber-500/20" data-testid="pro-favorites-card">
                  <div className="px-4 py-3">
                    <div className="flex items-center gap-2 mb-2.5">
                      <Flame className="w-4 h-4 text-amber-400" />
                      <span className="text-xs font-black text-white uppercase tracking-widest">Top Favorites</span>
                    </div>
                    <div className="space-y-1.5">
                      {golfTournamentCards.favorites.map((p: any, i: number) => (
                        <div key={p.id} className="flex items-center justify-between group" data-testid={`pro-favorite-${i}`}>
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] font-black w-4 text-center ${i === 0 ? "text-amber-400" : i === 1 ? "text-slate-300" : "text-slate-500"}`}>{i + 1}</span>
                            <span className="text-xs font-bold text-white group-hover:text-lime-400 transition-colors">{p.name}</span>
                            <span className="text-[10px] text-slate-500 font-medium">{p.team}</span>
                          </div>
                          <span className="text-[11px] font-black text-amber-400 font-mono">{p.odds}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="rounded-xl overflow-hidden bg-gradient-to-br from-cyan-500/10 via-slate-900 to-slate-900 border border-cyan-500/20" data-testid="pro-value-picks-card">
                  <div className="px-4 py-3">
                    <div className="flex items-center gap-2 mb-2.5">
                      <Award className="w-4 h-4 text-cyan-400" />
                      <span className="text-xs font-black text-white uppercase tracking-widest">Value Picks</span>
                    </div>
                    <div className="space-y-1.5">
                      {golfTournamentCards.valuePicks.map((p: any, i: number) => (
                        <div key={p.id} className="flex items-center justify-between group" data-testid={`pro-value-pick-${i}`}>
                          <div className="flex items-center gap-2">
                            <Star className={`w-3 h-3 ${i === 0 ? "text-cyan-400 fill-cyan-400" : "text-cyan-400/40"}`} />
                            <span className="text-xs font-bold text-white group-hover:text-cyan-400 transition-colors">{p.name}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-slate-400 font-mono">${p.salary.toLocaleString()}</span>
                            <span className="text-[11px] font-black text-cyan-400 font-mono">{p.value.toFixed(1)}x</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Player Table - Desktop */}
          <div className={`hidden overflow-auto md:block ${playerFocus ? "min-h-0 flex-1" : "h-[60dvh] shrink-0"}`} data-testid="pro-player-pool-scroll">
            <table className="optimizer-data-table w-full text-left border-collapse min-w-[900px]">
              <thead className="sticky top-0 z-10 bg-slate-900 border-b border-slate-800">
                <tr className="text-slate-400">
                  <th className="px-3 py-3 w-10 text-center text-[11px] font-black uppercase">Lock</th>
                  <th className="px-3 py-3 w-10 text-center text-[11px] font-black uppercase">Excl</th>
                  <SortHeader label="Pos" field="position" />
                  <SortHeader label="Player" field="name" />
                  <SortHeader label="Team" field="team" />
                  <SortHeader label="Salary" field="salary" />
                  <th className="px-3 py-3 text-[11px] font-black uppercase tracking-widest text-cyan-400 hidden 2xl:table-cell">Avg</th>
                  <SortHeader label="Base Proj" field="projectedPoints" />
                  <th className="px-3 py-3 text-[11px] font-black uppercase tracking-widest text-emerald-400 text-center">My Proj</th>
                  <SortHeader label="Boosted Proj" field="boostedProj" />
                  <th className="px-3 py-3 text-[11px] font-black uppercase tracking-widest text-amber-400 text-center">Boost +pts</th>
                  {hasPaidAccess ? (
                    <SortHeader label="Proj. Own%" field="ownershipProjection" />
                  ) : (
                    <th className="px-3 py-3 text-[11px] font-black uppercase tracking-widest text-center">
                      <div className="flex items-center justify-center gap-1 text-amber-500/70">
                        <Lock className="w-3 h-3" />
                        <span>Own%</span>
                        <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-[8px] px-1 py-0 font-black">STAR+</Badge>
                      </div>
                    </th>
                  )}
                  {isPro ? (
                    <th className="px-3 py-3 text-[11px] font-black uppercase tracking-widest text-slate-400 text-center">Fade</th>
                  ) : (
                    <th className="px-3 py-3 text-[11px] font-black uppercase tracking-widest text-center">
                      <div className="flex items-center justify-center gap-1 text-amber-500/70">
                        <Lock className="w-3 h-3" />
                        <span>Fade</span>
                        <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-[8px] px-1 py-0 font-black">PRO</Badge>
                      </div>
                    </th>
                  )}
                  {isPro ? (
                    <th className="px-3 py-3 text-[11px] font-black uppercase tracking-widest text-cyan-400 text-center">
                      Max%
                    </th>
                  ) : (
                    <th className="px-3 py-3 text-[11px] font-black uppercase tracking-widest text-center">
                      <div className="flex items-center justify-center gap-1 text-amber-500/70">
                        <Lock className="w-3 h-3" />
                        <span>Max%</span>
                        <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-[8px] px-1 py-0 font-black">PRO</Badge>
                      </div>
                    </th>
                  )}
                  <th className="px-3 py-3 text-[11px] font-black uppercase tracking-widest text-slate-400 hidden 2xl:table-cell">Rating</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {filteredPlayers.slice(0, visiblePlayerCount).map(player => {
                  const isLocked = lockedIds.includes(player.id);
                  const hasInjury = player.injuryStatus && player.injuryStatus !== "Healthy";
                  const injuryColor = hasInjury ? (INJURY_COLORS[player.injuryStatus!] || INJURY_COLORS["Day-to-Day"]) : "";

                  return (
                    <tr
                      key={player.id}
                      className={`group transition-colors hover:bg-slate-800/30 ${isLocked ? "bg-amber-500/5" : ""} ${player.isFaded ? "bg-purple-500/5" : ""}`}
                      data-testid={`player-row-${player.id}`}
                    >
                      <td className="px-3 py-2 text-center">
                        <button
                          onClick={() => {
                            setLockedIds(prev => prev.includes(player.id) ? prev.filter(i => i !== player.id) : [...prev, player.id]);
                            setExcludedIds(prev => prev.filter(i => i !== player.id));
                          }}
                          data-testid={`lock-${player.id}`}
                          className={`p-1.5 rounded-md transition-all ${
                            isLocked
                              ? "bg-amber-500 text-black shadow-md"
                              : "text-slate-400 hover:text-amber-400 hover:bg-slate-800"
                          }`}
                        >
                          {isLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                        </button>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <button
                          onClick={() => {
                            setExcludedIds(prev => [...prev, player.id]);
                            setLockedIds(prev => prev.filter(i => i !== player.id));
                          }}
                          data-testid={`exclude-${player.id}`}
                          className="p-1.5 rounded-md text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-all"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="font-mono text-xs font-bold text-amber-400/80">{player.position}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <PlayerHistoryCard playerName={player.name} sport={sport} currentProjection={Number(player.projectedPoints)} currentSalary={player.salary} position={player.position} team={player.team} boostScore={player.boostScore}>
                            <span className="text-[15px] font-bold text-white transition-colors group-hover:text-amber-400 cursor-default" data-testid={`text-player-name-${player.id}`}>
                              {player.name}
                            </span>
                          </PlayerHistoryCard>
                          {player.isConfirmedStarter && (
                            <Badge variant="outline" className="text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border-emerald-500/30" data-testid={`badge-starter-${player.id}`}>
                              STARTER
                            </Badge>
                          )}
                          {hasInjury && (
                            <Badge variant="outline" className={`text-[11px] font-bold ${injuryColor}`} data-testid={`badge-injury-${player.id}`}>
                              {player.injuryStatus}
                            </Badge>
                          )}
                          {isPro && player.isFaded && (
                            <Badge variant="outline" className="text-[10px] font-bold bg-purple-500/10 text-purple-400 border-purple-500/30" data-testid={`badge-faded-${player.id}`}>
                              FADED
                            </Badge>
                          )}
                        </div>
                        {player.gameInfo && (
                        <div className="text-xs text-slate-400 font-medium">{sanitizeGameInfo(player.gameInfo)}</div>
                        )}
                        {player.belowMinProjection && (
                          <div
                            className="text-[10px] font-bold text-red-400/80"
                            data-testid={`below-min-projection-${player.id}`}
                            title={`Eligibility projection ${player.cutoffProjection.toFixed(1)} pts from base/custom projection plus manual +pts; automatic, Scout, and simulation adjustments are excluded.`}
                          >
                            Below {minProjection!.toFixed(1)}-pt cutoff · eligibility {player.cutoffProjection.toFixed(1)} pts
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-xs font-bold text-slate-400 uppercase" data-testid={`text-team-${player.id}`}>{player.team}</td>
                      <td className="px-3 py-2.5 font-mono text-[15px] font-bold text-white" data-testid={`text-salary-${player.id}`}>{platform === "yahoo" ? `$${player.salary}` : `$${player.salary.toLocaleString()}`}</td>
                      <td className="px-3 py-2 hidden 2xl:table-cell">
                        {(player as any).recentActualAvg != null ? (
                          <div className="flex flex-col items-end">
                            <span className="font-mono text-xs font-bold text-cyan-400" data-testid={`pro-actual-avg-${player.id}`}>{(player as any).recentActualAvg}</span>
                            <span className="text-[9px] text-slate-500">{(player as any).gamesTracked}g</span>
                          </div>
                        ) : (
                          <span className="text-[10px] text-slate-600">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-[15px] text-slate-400" data-testid={`text-base-proj-${player.id}`}>
                        {player.baseProj.toFixed(1)}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <Input
                          type="number"
                          min={0}
                          step="0.1"
                          value={player.customProj}
                          onChange={e => {
                            const value = e.target.value;
                            setCustomProjections(prev => {
                              const next = { ...prev };
                              if (value === "") {
                                delete next[player.id.toString()];
                              } else {
                                const parsed = Number(value);
                                if (Number.isFinite(parsed) && parsed >= 0) next[player.id.toString()] = parsed;
                              }
                              return next;
                            });
                          }}
                          aria-label={`Custom projection for ${player.name}`}
                          className="w-16 h-7 bg-slate-950 border-emerald-500/30 text-right font-mono font-bold text-xs px-1 text-emerald-400"
                          data-testid={`proj-${player.id}`}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1" data-testid={`text-boosted-proj-${player.id}`}>
                          <span className={`font-mono text-[15px] font-bold ${player.boost > 0 ? "text-emerald-400" : player.boost < 0 ? "text-red-400" : "text-slate-400"}`}>
                            {player.boostedProj.toFixed(1)}
                          </span>
                          {player.boost !== 0 && (
                            <span className={`flex items-center text-[11px] font-bold ${player.boost > 0 ? "text-emerald-400" : "text-red-400"}`} data-testid={`boost-indicator-${player.id}`}>
                              {player.boost > 0 ? <TrendingUp className="w-3 h-3 mr-0.5" /> : <TrendingDown className="w-3 h-3 mr-0.5" />}
                              {player.boost > 0 ? "+" : ""}{player.boost.toFixed(1)}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <Input
                          type="number"
                          min={0}
                          step="0.1"
                          value={boosts[player.id] ?? ""}
                          placeholder="0"
                          aria-label={`Manual boost for ${player.name}, points`}
                          onChange={e => {
                            const value = e.target.value;
                            setBoosts(prev => {
                              const updated = { ...prev };
                              if (value === "") {
                                delete updated[player.id];
                              } else {
                                const parsed = Number(value);
                                if (Number.isFinite(parsed) && parsed >= 0) updated[player.id] = parsed;
                              }
                              return updated;
                            });
                          }}
                          className="w-16 h-7 bg-slate-950 border-amber-500/30 text-right font-mono font-bold text-xs px-1 text-amber-400 placeholder:text-slate-600"
                          data-testid={`input-boost-${player.id}`}
                        />
                      </td>
                      {hasPaidAccess ? (
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1" data-testid={`text-own-${player.id}`}>
                            <Users className="w-3 h-3 text-slate-500" />
                            <span className={`font-mono text-[11px] font-bold ${
                              player.ownershipProjection >= 25 ? "text-red-400" :
                              player.ownershipProjection >= 15 ? "text-amber-400" :
                              player.ownershipProjection >= 8 ? "text-slate-300" :
                              "text-emerald-400"
                            }`}>
                              {player.ownershipProjection.toFixed(1)}%
                            </span>
                            <span
                              className="text-[9px] text-slate-400"
                              title={player.ownershipSourceLabel || "Model-estimated projected ownership"}
                              data-testid={`ownership-source-${player.id}`}
                            >
                              {player.ownershipSource === "supplied" ? "Supplied" : "Est."}
                            </span>
                          </div>
                        </td>
                      ) : (
                        <td className="px-3 py-2 text-center">
                          <span className="font-mono text-[11px] font-bold text-slate-600 blur-[3px] select-none">
                            {(Math.sin(player.id * 31) * 15 + 15).toFixed(1)}%
                          </span>
                        </td>
                      )}
                      {isPro ? (
                        <td className="px-3 py-2 text-center">
                          <button
                            onClick={() => {
                              setFadedIds(prev => prev.includes(player.id)
                                ? prev.filter(i => i !== player.id)
                                : [...prev, player.id]
                              );
                            }}
                            data-testid={`fade-${player.id}`}
                            className={`p-1.5 rounded-md transition-all ${
                              player.isFaded
                                ? "bg-purple-500/20 text-purple-400 border border-purple-500/30 shadow-sm"
                                : "text-slate-500 hover:text-purple-400 hover:bg-purple-500/10"
                            }`}
                            title={player.isFaded ? "Unfade player (restore projection)" : "Fade player (reduce projection by projected ownership %)"}
                          >
                            <Percent className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      ) : (
                        <td className="px-3 py-2 text-center">
                          <div className="p-1.5 text-slate-700 cursor-not-allowed" title="Upgrade to Champion to fade players">
                            <Lock className="w-3.5 h-3.5" />
                          </div>
                        </td>
                      )}
                      {isPro ? (
                        <>
                          <td className="px-1 py-2 text-center">
                            <Input
                              type="number"
                              min={0}
                              max={100}
                              placeholder="Max"
                              value={exposureLimits[player.id.toString()] ?? ""}
                              onChange={(e) => {
                                const val = e.target.value;
                                setExposureLimits(prev => {
                                  const next = { ...prev };
                                  if (val === "" || val === undefined) {
                                    delete next[player.id.toString()];
                                  } else {
                                    next[player.id.toString()] = Math.min(100, Math.max(0, Number(val)));
                                  }
                                  return next;
                                });
                              }}
                              className="w-14 h-7 text-center text-[11px] font-bold bg-slate-800 border-cyan-700/50 px-1 text-cyan-400 placeholder:text-slate-600"
                              data-testid={`input-exposure-${player.id}`}
                            />
                          </td>
                        </>
                      ) : (
                        <td className="px-3 py-2 text-center">
                          <div className="p-1.5 text-slate-700 cursor-not-allowed" title="Upgrade to Champion for exposure limits">
                            <Lock className="w-3.5 h-3.5" />
                          </div>
                        </td>
                      )}
                      <td className="px-3 py-2 hidden 2xl:table-cell" data-testid={`star-rating-${player.id}`}>
                        <PlayerStarRating stars={getPlayerStarCount(player.boostedProj)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Player Cards - Mobile */}
          <div className={`flex-1 overflow-auto p-2 md:hidden ${playerFocus ? "min-h-0" : "min-h-[52dvh]"}`} data-testid="pro-mobile-player-pool-scroll">
            {filteredPlayers.slice(0, visiblePlayerCount).map(player => {
              const isLocked = lockedIds.includes(player.id);
              const isExcluded = excludedIds.includes(player.id);
              const isFaded = fadedIds.includes(player.id);
              const ownershipPct = (player as PlayerWithOwnership).ownershipProjection;
              const isSwapEligible = swappingTarget ? (() => {
                const lineupIdx = swappingTarget.lineupIdx;
                const slot = swappingTarget.slot;
                const lineup = generatedLineups[lineupIdx];
                if (!lineup) return false;
                const slotPos = slot.replace(/\d+/g, '');
                if (!positionFitsSlot(player.position, slotPos, sport)) return false;
                const currentPlayer = lineup.find((_, i) => `${lineup[i].position}${i}` === slot || getSlotDisplayName(config.rosterSlots[i], i, config.rosterSlots) === slot);
                if (currentPlayer && player.id === currentPlayer.id) return false;
                return true;
              })() : false;
              const isSwapIneligible = swappingTarget && !isSwapEligible;
              return (
                <div
                  key={player.id}
                  data-testid={`mobile-pro-player-card-${player.id}`}
                    className={`mb-1.5 rounded-lg border p-3 transition-all ${
                    isSwapIneligible ? "opacity-30 border-slate-800 bg-slate-900/30" :
                    isSwapEligible ? "border-emerald-500/30 bg-emerald-500/5 cursor-pointer" :
                    isExcluded ? "border-red-500/30 bg-red-500/5 opacity-50" :
                    isLocked ? "border-amber-500/30 bg-amber-500/5" :
                    isFaded ? "border-slate-700 bg-slate-900/30 opacity-60" :
                    "border-slate-800 bg-slate-900/50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400">{player.position}</span>
                        <span className="text-[15px] font-bold text-white truncate">{player.name}</span>
                        {player.isConfirmedStarter && (
                          <Badge variant="outline" className="text-[8px] font-bold py-0 px-1 border-emerald-500/50 text-emerald-400 bg-emerald-500/10">STARTER</Badge>
                        )}
                        {player.injuryStatus && player.injuryStatus !== "Healthy" && (
                          <Badge variant="outline" className={`text-[8px] font-bold py-0 px-1 ${INJURY_COLORS[player.injuryStatus] || INJURY_COLORS["Day-to-Day"]}`}>
                            {player.injuryStatus}
                          </Badge>
                        )}
                        {isFaded && <Badge className="text-[8px] py-0 px-1 bg-slate-700 text-slate-400 border-slate-600">FADED</Badge>}
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-400">
                        <span className="font-bold">{player.team}</span>
                        {player.opponent && <span>vs {player.opponent}</span>}
                      </div>
                      <div className="flex items-center gap-3 mt-1.5">
                        <span className="text-[15px] font-mono font-bold text-white">${player.salary.toLocaleString()}</span>
                        <span className="text-[15px] font-mono font-bold text-amber-400">{Number(player.projectedPoints).toFixed(1)} pts</span>
                        {(player as any).recentActualAvg != null && (
                          <span className="text-[10px] font-mono font-bold text-cyan-400">{(player as any).recentActualAvg}<span className="text-slate-500">/{(player as any).gamesTracked}g</span></span>
                        )}
                        {player.boostedProj !== Number(player.projectedPoints) && (
                          <span
                            className="text-xs font-mono font-bold text-emerald-400"
                            title="Custom/manual projection with the local automatic boost only; server-only Scout and simulation adjustments are not included."
                          >
                            {player.boostedProj.toFixed(1)}
                          </span>
                        )}
                        {hasPaidAccess && ownershipPct != null && (
                          <span className="text-xs font-mono text-cyan-400">{ownershipPct.toFixed(1)}%</span>
                        )}
                      </div>
                      {player.belowMinProjection && (
                        <div
                          className="mt-1 text-[10px] font-bold text-red-400/80"
                          data-testid={`mobile-below-min-projection-${player.id}`}
                          title={`Eligibility projection ${player.cutoffProjection.toFixed(1)} pts from base/custom projection plus manual +pts; automatic, Scout, and simulation adjustments are excluded.`}
                        >
                          Below {minProjection!.toFixed(1)}-pt cutoff · eligibility {player.cutoffProjection.toFixed(1)} pts
                        </div>
                      )}
                      <div className="flex items-center gap-2 mt-2" onClick={e => e.stopPropagation()}>
                        <label className="text-[9px] font-black uppercase tracking-wide text-emerald-400 whitespace-nowrap" htmlFor={`mobile-proj-${player.id}`}>My Proj</label>
                        <input
                          id={`mobile-proj-${player.id}`}
                          type="number"
                          min={0}
                          step="0.1"
                          value={player.customProj}
                          onChange={e => {
                            const value = e.target.value;
                            setCustomProjections(prev => {
                              const next = { ...prev };
                              if (value === "") {
                                delete next[player.id.toString()];
                              } else {
                                const parsed = Number(value);
                                if (Number.isFinite(parsed) && parsed >= 0) next[player.id.toString()] = parsed;
                              }
                              return next;
                            });
                          }}
                          className="w-20 h-7 rounded border border-emerald-500/30 bg-slate-950 px-1 text-right font-mono text-xs font-bold text-emerald-400"
                          data-testid={`mobile-proj-${player.id}`}
                        />
                        <label className="text-[9px] font-black uppercase tracking-wide text-amber-400 whitespace-nowrap" htmlFor={`mobile-boost-${player.id}`}>Boost +pts</label>
                        <input
                          id={`mobile-boost-${player.id}`}
                          type="number"
                          min={0}
                          step="0.1"
                          placeholder="0"
                          value={boosts[player.id] ?? ""}
                          onChange={e => {
                            const value = e.target.value;
                            setBoosts(prev => {
                              const updated = { ...prev };
                              if (value === "") {
                                delete updated[player.id];
                              } else {
                                const parsed = Number(value);
                                if (Number.isFinite(parsed) && parsed >= 0) updated[player.id] = parsed;
                              }
                              return updated;
                            });
                          }}
                          className="w-20 h-7 rounded border border-amber-500/30 bg-slate-950 px-1 text-right font-mono text-xs font-bold text-amber-400 placeholder:text-slate-600"
                          data-testid={`input-boost-mobile-${player.id}`}
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        onClick={() => {
                          setLockedIds(prev => prev.includes(player.id) ? prev.filter(i => i !== player.id) : [...prev, player.id]);
                          setExcludedIds(prev => prev.filter(i => i !== player.id));
                          setFadedIds(prev => prev.filter(i => i !== player.id));
                        }}
                        data-testid={`mobile-pro-lock-${player.id}`}
                        className={`p-1.5 rounded-md transition-all ${
                          isLocked ? "bg-amber-500 text-white" : "text-slate-600 hover:text-amber-400"
                        }`}
                      >
                        {isLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        onClick={() => {
                          setFadedIds(prev => prev.includes(player.id) ? prev.filter(i => i !== player.id) : [...prev, player.id]);
                          setLockedIds(prev => prev.filter(i => i !== player.id));
                        }}
                        data-testid={`mobile-pro-fade-${player.id}`}
                        className={`p-1.5 rounded-md transition-all ${
                          isFaded ? "bg-slate-600 text-white" : "text-slate-600 hover:text-slate-300"
                        }`}
                      >
                        <TrendingDown className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => {
                          setExcludedIds(prev => [...prev, player.id]);
                          setLockedIds(prev => prev.filter(i => i !== player.id));
                        }}
                        data-testid={`mobile-pro-exclude-${player.id}`}
                        className="p-1.5 rounded-md text-slate-600 hover:text-red-400"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Excluded Players Bar */}
          {filteredPlayers.length > visiblePlayerCount && (
            <button
              type="button"
              className="shrink-0 border-t border-slate-800 bg-slate-900 px-4 py-2 text-xs font-bold text-amber-400"
              data-testid="show-more-players"
              onClick={() => setVisiblePlayerCount(count => count + 75)}
            >
              Show more players ({visiblePlayerCount} of {filteredPlayers.length})
            </button>
          )}
          {excludedPlayers.length > 0 && (
            <div className="border-t border-slate-800 bg-slate-900/60 px-4 py-2 flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-black text-red-400 uppercase tracking-widest">Excluded:</span>
              {excludedPlayers.map(p => (
                <Badge
                  key={p.id}
                  variant="outline"
                  className="border-red-500/30 text-red-400 text-[11px] font-bold cursor-pointer"
                  onClick={() => setExcludedIds(prev => prev.filter(i => i !== p.id))}
                  data-testid={`excluded-badge-${p.id}`}
                >
                  {p.name} <X className="w-3 h-3 ml-1" />
                </Badge>
              ))}
            </div>
          )}

          {!hasPaidAccess && (
            <div className="border-t border-amber-500/20 bg-gradient-to-r from-amber-500/5 via-amber-500/10 to-amber-500/5 px-4 py-3" data-testid="pro-upgrade-banner">
              <Link href="/pricing">
                <div className="flex items-center justify-between cursor-pointer group">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center flex-shrink-0">
                      <Crown className="w-4 h-4 text-amber-400" />
                    </div>
                    <div>
                      <p className="text-xs font-black text-amber-400 uppercase tracking-wider">Unlock Sharpshooter Features</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">Projected ownership, player fading, and contrarian lineup building</p>
                    </div>
                  </div>
                  <Badge className="bg-amber-500 text-black font-black text-[10px] px-2 py-1 group-hover:bg-amber-400 transition-colors flex-shrink-0">
                    Upgrade
                  </Badge>
                </div>
              </Link>
            </div>
          )}

          {/* Faded Players Bar (Pro only) */}
          {isPro && fadedIds.length > 0 && players && (
            <div className="border-t border-slate-800 bg-slate-900/60 px-4 py-2 flex items-center gap-2 flex-wrap" data-testid="faded-players-bar">
              <span className="text-[11px] font-black text-purple-400 uppercase tracking-widest">Faded:</span>
              {players.filter(p => fadedIds.includes(p.id)).map(p => (
                <Badge
                  key={p.id}
                  variant="outline"
                  className="border-purple-500/30 text-purple-400 text-[11px] font-bold cursor-pointer"
                  onClick={() => setFadedIds(prev => prev.filter(i => i !== p.id))}
                  data-testid={`faded-badge-${p.id}`}
                >
                  {p.name} ({((p as any).ownershipProjection ?? 0).toFixed(0)}%) <X className="w-3 h-3 ml-1" />
                </Badge>
              ))}
            </div>
          )}
        </div>

        {/* RIGHT: Results & Summary Panels */}
        <div className={`w-full 2xl:w-[440px] flex-col bg-slate-900/30 2xl:overflow-hidden ${playerFocus ? "hidden" : mobileView !== "lineup" ? "hidden 2xl:flex" : "flex"}`}>
          <div className="min-h-0 flex-1 overflow-auto p-4 space-y-4 xl:max-h-[75dvh]" data-testid="pro-lineup-scroll">
            {/* GOLF Tournament Analysis */}
            {isGolf && golfAnalysis && (
              <>
                {/* Tournament Header */}
                <div data-testid="golf-tournament-header">
                  <div className="flex items-center gap-2 mb-3">
                    <Trophy className="w-4 h-4 text-lime-400" />
                    <span className="text-sm font-black text-white uppercase tracking-widest">Tournament Analysis</span>
                    <Badge className="text-[10px] font-black bg-lime-500/20 text-lime-300 border-lime-500/30">AI</Badge>
                  </div>
                  <Card className="bg-gradient-to-br from-lime-500/10 via-emerald-500/5 to-slate-900 border-lime-500/20 p-4" data-testid="tournament-overview-card">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <Flag className="w-4 h-4 text-lime-400" />
                          <span className="text-base font-black text-white">{golfAnalysis.tournament.name}</span>
                        </div>
                        {golfAnalysis.tournament.course && (
                          <div className="flex items-center gap-1.5">
                            <MapPin className="w-3 h-3 text-slate-400" />
                            <span className="text-xs text-slate-300">{golfAnalysis.tournament.course}</span>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1 bg-slate-800/80 rounded-lg px-2.5 py-1 border border-slate-700/50">
                        <Users className="w-3 h-3 text-slate-400" />
                        <span className="text-xs font-bold text-slate-300">{golfAnalysis.tournament.fieldSize}</span>
                      </div>
                    </div>
                    {golfAnalysis.courseProfile && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {golfAnalysis.courseProfile.traits.map((trait: string, i: number) => (
                          <Badge key={i} variant="outline" className="text-[10px] font-bold border-lime-500/20 text-lime-300/80 bg-lime-500/5">
                            {trait}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </Card>
                </div>

                {/* Weather & Course Conditions */}
                <div data-testid="golf-weather-panel">
                  <h3 className="text-sm font-black text-white uppercase tracking-widest flex items-center gap-2 mb-3">
                    {golfAnalysis.weather.icon === "sun" ? <Sun className="w-4 h-4 text-amber-400" /> :
                     golfAnalysis.weather.icon === "wind" ? <Wind className="w-4 h-4 text-cyan-400" /> :
                     golfAnalysis.weather.icon === "cloud-rain" ? <CloudRain className="w-4 h-4 text-blue-400" /> :
                     <Cloud className="w-4 h-4 text-slate-400" />}
                    Course Conditions
                  </h3>
                  <Card className="bg-slate-800/60 border-slate-700/50 p-3">
                    <div className="grid grid-cols-2 gap-3 mb-3">
                      <div className="bg-slate-900/60 rounded-lg p-2.5 border border-slate-700/30">
                        <div className="text-[10px] font-black text-slate-400 uppercase mb-1">Weather</div>
                        <div className="text-sm font-bold text-white">{golfAnalysis.weather.condition}</div>
                      </div>
                      <div className="bg-slate-900/60 rounded-lg p-2.5 border border-slate-700/30">
                        <div className="text-[10px] font-black text-slate-400 uppercase mb-1">Temperature</div>
                        <div className="text-sm font-bold text-amber-400">{golfAnalysis.weather.temp}</div>
                      </div>
                      <div className="bg-slate-900/60 rounded-lg p-2.5 border border-slate-700/30">
                        <div className="text-[10px] font-black text-slate-400 uppercase mb-1">Wind</div>
                        <div className="text-sm font-bold text-cyan-400">{golfAnalysis.weather.wind}</div>
                      </div>
                      <div className="bg-slate-900/60 rounded-lg p-2.5 border border-slate-700/30">
                        <div className="text-[10px] font-black text-slate-400 uppercase mb-1">Humidity</div>
                        <div className="text-sm font-bold text-blue-400">{golfAnalysis.weather.humidity}</div>
                      </div>
                    </div>
                    {golfAnalysis.courseProfile?.keyStats && (
                      <div className="border-t border-slate-700/50 pt-2.5">
                        <div className="text-[10px] font-black text-slate-400 uppercase mb-2">Key Stats for This Course</div>
                        <div className="flex flex-wrap gap-1.5">
                          {golfAnalysis.courseProfile.keyStats.map((stat: string, i: number) => (
                            <Badge key={i} className="text-[10px] font-bold bg-amber-500/10 text-amber-300 border-amber-500/20">
                              <BarChart3 className="w-2.5 h-2.5 mr-1" />
                              {stat}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </Card>
                </div>

                {/* Algorithm Top Picks */}
                <div data-testid="golf-algo-picks">
                  <h3 className="text-sm font-black text-white uppercase tracking-widest flex items-center gap-2 mb-3">
                    <Flame className="w-4 h-4 text-amber-400" />
                    Algorithm Top Picks
                    <Badge className="text-[10px] font-black bg-amber-500/15 text-amber-300 border-amber-500/20">TOP 6</Badge>
                  </h3>
                  <Card className="bg-slate-800/60 border-slate-700/50 p-3">
                    <div className="space-y-2">
                      {golfAnalysis.topAlgoPicks?.map((p: any, i: number) => (
                        <div key={p.playerId} className="flex items-center gap-2 group" data-testid={`algo-pick-${i}`}>
                          <span className={`text-[11px] font-black w-5 text-center rounded-full ${
                            i === 0 ? "bg-amber-500/20 text-amber-400" :
                            i === 1 ? "bg-slate-500/20 text-slate-300" :
                            i === 2 ? "bg-orange-500/20 text-orange-400" :
                            "text-slate-500"
                          }`}>
                            {i + 1}
                          </span>
                          <div className="flex-1 min-w-0">
                            <span className="text-xs font-bold text-white group-hover:text-lime-400 transition-colors truncate block">{p.name}</span>
                            <span className="text-[10px] text-slate-500">{p.team}</span>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <div className="text-right">
                              <div className="text-[10px] text-slate-500 font-bold">Course Fit</div>
                              <div className={`text-[11px] font-black ${p.courseFitScore >= 80 ? "text-lime-400" : p.courseFitScore >= 65 ? "text-amber-400" : "text-slate-400"}`}>
                                {p.courseFitScore}%
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-[10px] text-slate-500 font-bold">Algo</div>
                              <div className="text-[11px] font-black text-amber-400">{p.algoScore}</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>
                </div>

                {/* Value Plays */}
                <div data-testid="golf-value-plays">
                  <h3 className="text-sm font-black text-white uppercase tracking-widest flex items-center gap-2 mb-3">
                    <Award className="w-4 h-4 text-cyan-400" />
                    Value Plays
                  </h3>
                  <Card className="bg-slate-800/60 border-slate-700/50 p-3">
                    <div className="space-y-2">
                      {golfAnalysis.valuePlays?.map((p: any, i: number) => (
                        <div key={p.playerId} className="flex items-center gap-2 group" data-testid={`value-play-${i}`}>
                          <Target className="w-3 h-3 text-cyan-400/60 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <span className="text-xs font-bold text-white group-hover:text-cyan-400 transition-colors truncate block">{p.name}</span>
                          </div>
                          <span className="text-[10px] font-mono text-slate-400 flex-shrink-0">${p.salary.toLocaleString()}</span>
                          <span className={`text-[11px] font-black flex-shrink-0 ${p.courseFitScore >= 75 ? "text-lime-400" : "text-amber-400"}`}>
                            {p.courseFitScore}% fit
                          </span>
                          <span className="text-[11px] font-black text-cyan-400 flex-shrink-0">{p.algoScore}</span>
                        </div>
                      ))}
                    </div>
                  </Card>
                </div>

                {/* Contrarian Picks */}
                {golfAnalysis.contrarianPicks?.length > 0 && (
                  <div data-testid="golf-contrarian-picks">
                    <h3 className="text-sm font-black text-white uppercase tracking-widest flex items-center gap-2 mb-3">
                      <Percent className="w-4 h-4 text-purple-400" />
                      Low Proj. Ownership Gems
                    </h3>
                    <Card className="bg-gradient-to-br from-purple-500/10 via-slate-900 to-slate-900 border-purple-500/20 p-3">
                      <div className="space-y-2">
                        {golfAnalysis.contrarianPicks.map((p: any, i: number) => (
                          <div key={p.playerId} className="flex items-center gap-2 group" data-testid={`contrarian-pick-${i}`}>
                            <div className="flex-1 min-w-0">
                              <span className="text-xs font-bold text-white group-hover:text-purple-400 transition-colors truncate block">{p.name}</span>
                              <span className="text-[10px] text-slate-500">{p.team} · ${p.salary.toLocaleString()}</span>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              {hasPaidAccess && (
                                <div className="text-right">
                                  <div className="text-[10px] text-slate-500 font-bold">Own%</div>
                                  <div className="text-[11px] font-black text-purple-400">{p.ownershipProjection}%</div>
                                </div>
                              )}
                              <div className="text-right">
                                <div className="text-[10px] text-slate-500 font-bold">Score</div>
                                <div className="text-[11px] font-black text-amber-400">{p.algoScore}</div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </Card>
                  </div>
                )}

                {/* Strokes Gained Leaders */}
                {golfAnalysis.topAlgoPicks && (
                  <div data-testid="golf-sg-leaders">
                    <h3 className="text-sm font-black text-white uppercase tracking-widest flex items-center gap-2 mb-3">
                      <BarChart3 className="w-4 h-4 text-emerald-400" />
                      Strokes Gained Leaders
                    </h3>
                    <Card className="bg-slate-800/60 border-slate-700/50 p-3">
                      <div className="grid grid-cols-3 gap-2 mb-2">
                        <div className="text-[10px] font-black text-slate-400 uppercase text-center">SG: Approach</div>
                        <div className="text-[10px] font-black text-slate-400 uppercase text-center">SG: Putting</div>
                        <div className="text-[10px] font-black text-slate-400 uppercase text-center">SG: Off-Tee</div>
                      </div>
                      {golfAnalysis.playerAnalysis?.slice(0, 5).map((p: any) => (
                        <div key={p.playerId} className="grid grid-cols-3 gap-2 py-1 border-t border-slate-700/30">
                          <div className="text-center">
                            <div className="text-[10px] text-slate-500 truncate">{p.name.split(' ').pop()}</div>
                            <div className={`text-[11px] font-black ${p.sgApproach > 0 ? "text-emerald-400" : "text-red-400"}`}>
                              {p.sgApproach > 0 ? "+" : ""}{p.sgApproach.toFixed(2)}
                            </div>
                          </div>
                          <div className="text-center">
                            <div className="text-[10px] text-slate-500 truncate">{p.name.split(' ').pop()}</div>
                            <div className={`text-[11px] font-black ${p.sgPutting > 0 ? "text-emerald-400" : "text-red-400"}`}>
                              {p.sgPutting > 0 ? "+" : ""}{p.sgPutting.toFixed(2)}
                            </div>
                          </div>
                          <div className="text-center">
                            <div className="text-[10px] text-slate-500 truncate">{p.name.split(' ').pop()}</div>
                            <div className={`text-[11px] font-black ${p.sgOffTee > 0 ? "text-emerald-400" : "text-red-400"}`}>
                              {p.sgOffTee > 0 ? "+" : ""}{p.sgOffTee.toFixed(2)}
                            </div>
                          </div>
                        </div>
                      ))}
                    </Card>
                  </div>
                )}

                {/* Round-by-Round Forecast */}
                <div data-testid="golf-rounds-forecast">
                  <h3 className="text-sm font-black text-white uppercase tracking-widest flex items-center gap-2 mb-3">
                    <Activity className="w-4 h-4 text-amber-400" />
                    Round Schedule
                  </h3>
                  <Card className="bg-slate-800/60 border-slate-700/50 p-3">
                    <div className="space-y-2">
                      {golfAnalysis.rounds?.map((r: any, i: number) => (
                        <div key={i} className="flex items-center justify-between py-1 border-b border-slate-700/30 last:border-0" data-testid={`round-${i}`}>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-[10px] font-black border-amber-500/20 text-amber-300 bg-amber-500/5 w-10 justify-center">
                              R{i + 1}
                            </Badge>
                            <div>
                              <span className="text-xs font-bold text-white">{r.day}</span>
                              <span className="text-[10px] text-slate-500 ml-2">{r.time}</span>
                            </div>
                          </div>
                          <span className="text-[11px] font-bold text-slate-400">{r.conditions}</span>
                        </div>
                      ))}
                    </div>
                  </Card>
                </div>
              </>
            )}

            {/* Slate Games (non-golf) */}
            {!isGolf && games.length > 0 && (
              <div data-testid="pro-games-panel">
                <h3 className="text-sm font-black text-white uppercase tracking-widest flex items-center gap-2 mb-3">
                  <Activity className="w-4 h-4 text-amber-400" />
                  Scheduled Games ({games.length})
                </h3>
                <div className="flex flex-wrap gap-2 justify-center">
                  {games.map((game, i) => (
                    <div
                      key={i}
                      className="bg-slate-800/60 border border-slate-700/50 rounded-lg px-3 py-2 min-w-[100px] transition-colors cursor-default hover:border-amber-500/30"
                      data-testid={`pro-game-card-${i}`}
                    >
                      <div className="flex items-center justify-between gap-3 mb-1">
                        <span className="text-xs font-black text-white">{game.away}</span>
                        <span className="text-xs font-bold text-slate-500">0</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-xs font-black text-white">{game.home}</span>
                        <span className="text-xs font-bold text-slate-500">0</span>
                      </div>
                      <div className="text-[11px] font-bold mt-1.5 pt-1.5 border-t border-slate-700/50 text-center text-amber-400/60">
                        {game.time}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Generated Lineups */}
            {!portfolio.report?.searchDiagnostics && (
              <QualitySearchDiagnostics
                diagnostics={(simMode ? simMutation.data : optimizeMutation.data as any)?.searchDiagnostics}
                partial={(simMode ? simMutation.data : optimizeMutation.data as any)?.partial}
                mode={simMode ? "sim" : "projection"}
                className="mb-3"
              />
            )}
            {generatedLineups.length > 0 && (
              <div ref={lineupsRef} data-testid="generated-lineups-section">
                <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
                  <h3 className="text-sm font-black text-white uppercase tracking-widest flex items-center gap-2">
                    {simMutation.data?.simsRun ? (
                      <Activity className="w-4 h-4 text-violet-400" />
                    ) : (
                      <Crown className="w-4 h-4 text-amber-400" />
                    )}
                    Generated Lineups ({generatedLineups.length})
                  </h3>
                </div>

                {/* Sim run summary */}
                {simMutation.data?.simsRun && generatedLineups.length > 0 && (
                  <div className="bg-violet-500/5 border border-violet-500/20 rounded-xl px-3 py-2.5 mb-3 grid grid-cols-4 gap-2 text-center" data-testid="sim-summary-bar">
                    {[
                      { label: "Sims Run",    value: simMutation.data.simsRun,                       color: "text-violet-400" },
                      { label: "Unique",      value: simMutation.data.uniqueLineups,                  color: "text-slate-300" },
                      { label: "Games",       value: simMutation.data.gamesRepresented,               color: "text-blue-400" },
                      { label: "Time",        value: `${(simMutation.data.elapsedMs / 1000).toFixed(1)}s`, color: "text-slate-400" },
                    ].map(stat => (
                      <div key={stat.label}>
                        <div className={`text-sm font-black tabular-nums ${stat.color}`}>{stat.value}</div>
                        <div className="text-[9px] text-slate-600 uppercase tracking-wider">{stat.label}</div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Sort Controls + Save Top X */}
                {generatedLineups.length > 0 && (
                  <div className="flex flex-col gap-2 mb-3">
                    <div className="flex gap-2 flex-wrap items-center">
                      <span className="text-[11px] font-black text-slate-400 uppercase self-center">Sort:</span>
                      {[
                        { key: "index", label: "Order", sim: false },
                        { key: "projected", label: "Projected", sim: false },
                        { key: "salary", label: "Salary", sim: false },
                        { key: "ceiling", label: "P75", sim: true },
                        { key: "p90", label: "P90", sim: true },
                        { key: "median", label: "Median", sim: true },
                        { key: "freq", label: "Freq%", sim: true },
                      ].filter(opt => !opt.sim || (generatedLineups[0] as any)?.simData).map(opt => (
                        <button
                          key={opt.key}
                          onClick={() => { setLineupSortBy(opt.key as typeof lineupSortBy); setVisibleLineupCount(10); }}
                          className={`px-2 py-1 rounded text-[10px] font-black transition-all border ${
                            lineupSortBy === opt.key
                              ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
                              : "text-slate-400 border-slate-700/50 hover:text-slate-300"
                          }`}
                          data-testid={`sort-lineups-${opt.key}`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    {generatedLineups.length > 1 && (
                      <div className="flex gap-2 items-center flex-wrap">
                        <span className="text-[11px] font-black text-slate-400 uppercase self-center">Save Top:</span>
                        <input
                          type="number"
                          min={1}
                          max={sortedLineups.length}
                          value={saveTopCount}
                          onChange={e => setSaveTopCount(Math.max(1, Math.min(sortedLineups.length, parseInt(e.target.value) || 1)))}
                          className="w-16 px-2 py-1 rounded text-[11px] font-black bg-slate-800 border border-slate-600/50 text-white tabular-nums text-center focus:border-amber-500/50 focus:outline-none"
                          data-testid="input-save-top-count"
                        />
                        <span className="text-[10px] text-slate-500 self-center">of {sortedLineups.length}</span>
                        <Button
                          onClick={handleSaveTopX}
                          disabled={isSavingAll || saveLineupMutation.isPending}
                          variant="outline"
                          size="sm"
                          className="font-black text-[10px] h-7 px-3 border-violet-500/30 text-violet-400 hover:bg-violet-500/10"
                          data-testid="button-save-top-x"
                        >
                          {isSavingAll ? (
                            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                          ) : (
                            <SaveAll className="w-3 h-3 mr-1" />
                          )}
                          Save Top {Math.min(saveTopCount, sortedLineups.length)}{lineupSortBy !== "index" ? ` by ${lineupSortBy === "ceiling" ? "P75" : lineupSortBy === "projected" ? "Proj" : lineupSortBy.toUpperCase()}` : ""}
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                <div className="space-y-3">
                  {sortedLineups.slice(0, visibleLineupCount).map((lineupData) => {
                    const idx = lineupData._origIdx;
                    const lineupPlayers = lineupData.lineup || [];
                    const slots = assignPlayersToSlots(lineupPlayers, config.slots, sport);
                    const lineupGrade = lineupPlayers.length > 0
                      ? gradeLineup(lineupPlayers, sport, platform, lineupData.totalSalary || 0, lineupData.totalProjectedPoints || 0)
                      : null;
                    const sd = (lineupData as any).simData;
                    return (
                      <Card key={idx} className={`border-slate-700/50 p-3 ${swappingTarget?.lineupIdx === idx ? "bg-slate-800/80 border-amber-500/30 ring-1 ring-amber-500/10" : sd ? "bg-slate-800/60 border-violet-500/10" : "bg-slate-800/60"}`} data-testid={`lineup-card-${idx}`}>
                        <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge className={`${sd ? "bg-violet-500/20 text-violet-400 border-violet-500/30" : "bg-amber-500/20 text-amber-400 border-amber-500/30"} text-[11px] font-black`}>
                              #{idx + 1}
                            </Badge>
                            {/* Median / projected score */}
                            <div className="flex items-center gap-1.5 bg-emerald-500/10 rounded px-2 py-0.5 border border-emerald-500/20" data-testid={`text-lineup-proj-${idx}`}>
                              <span className="text-[10px] font-bold text-emerald-500/70 uppercase">{sd ? "Med" : "FP"}</span>
                              <span className="text-sm font-black text-emerald-400 tabular-nums">{lineupData.totalProjectedPoints?.toFixed(1)}</span>
                            </div>
                            {/* Sim ceiling scores */}
                            {sd && (
                              <>
                                <div className="flex items-center gap-1 bg-emerald-500/10 rounded px-1.5 py-0.5 border border-emerald-500/15" title="75th percentile score across simulations">
                                  <TrendingUp className="w-2.5 h-2.5 text-emerald-400" />
                                  <span className="text-[10px] font-black text-emerald-400 tabular-nums">{sd.p75Score}</span>
                                </div>
                                <div className="flex items-center gap-1 bg-amber-500/10 rounded px-1.5 py-0.5 border border-amber-500/15" title="90th percentile ceiling across simulations">
                                  <Flame className="w-2.5 h-2.5 text-amber-400" />
                                  <span className="text-[10px] font-black text-amber-400 tabular-nums">{sd.p90Score}</span>
                                </div>
                                <div className="flex items-center gap-1 bg-violet-500/10 rounded px-1.5 py-0.5 border border-violet-500/15" title="% of simulations this lineup was optimal">
                                  <Percent className="w-2.5 h-2.5 text-violet-400" />
                                  <span className="text-[10px] font-black text-violet-400 tabular-nums">{sd.freqPct}%</span>
                                </div>
                                {sd.evScore != null && (
                                  <div
                                    className="flex items-center gap-1 bg-cyan-500/10 rounded px-1.5 py-0.5 border border-cyan-500/20"
                                    title={`Tournament EV: ${sd.evScore}x entry vs simulated field · win ${sd.winPct ?? 0}% · cash ${sd.cashPct ?? 0}%`}
                                  >
                                    <span className="text-[10px]">🏆</span>
                                    <span className="text-[10px] font-black text-cyan-300 tabular-nums">{sd.evScore}x</span>
                                    {sd.cashPct != null && (
                                      <span className="text-[9px] font-bold text-cyan-500/70 tabular-nums">{sd.cashPct}%💰</span>
                                    )}
                                  </div>
                                )}
                              </>
                            )}
                            {/* Salary */}
                            <div className="flex items-center gap-1.5 bg-slate-700/50 rounded px-2 py-0.5 border border-slate-600/30" data-testid={`text-lineup-salary-${idx}`}>
                              <span className="text-sm font-black text-white tabular-nums">${lineupData.totalSalary?.toLocaleString()}</span>
                            </div>
                            {/* Grade */}
                            {lineupGrade && (
                              <div className={`flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] font-black ${GRADE_COLORS[lineupGrade.grade]?.bg || ""} ${GRADE_COLORS[lineupGrade.grade]?.text || "text-slate-400"} ${GRADE_COLORS[lineupGrade.grade]?.border || ""}`} data-testid={`lineup-grade-${idx}`}>
                                {lineupGrade.grade === "S" && <Star className="w-3 h-3 fill-current" />}
                                {lineupGrade.grade}
                              </div>
                            )}
                            {/* Stack label */}
                            {sd?.stackedGame && sd.stackCount >= 2 && (
                              <div className="flex items-center gap-1 bg-blue-500/10 rounded px-1.5 py-0.5 border border-blue-500/15" title={`${sd.stackCount}-player game stack`}>
                                <Users className="w-2.5 h-2.5 text-blue-400" />
                                <span className="text-[10px] font-black text-blue-400 tabular-nums">
                                  {sd.stackTeams?.join("/")} ×{sd.stackCount}
                                </span>
                              </div>
                            )}
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            className={`font-bold text-[11px] ${savedIndices.has(idx) ? "text-emerald-400" : "text-amber-400"}`}
                            onClick={() => handleSaveLineup(lineupData, idx)}
                            disabled={saveLineupMutation.isPending || isSavingAll || savedIndices.has(idx)}
                            data-testid={`button-save-lineup-${idx}`}
                          >
                            {savedIndices.has(idx) ? (
                              <><Trophy className="w-3.5 h-3.5 mr-1" /> Saved</>
                            ) : (
                              <><Save className="w-3.5 h-3.5 mr-1" /> Save</>
                            )}
                          </Button>
                        </div>
                        <div className="space-y-1">
                          {config.slots.map(slot => {
                            const p = slots[slot];
                            const isSwapping = swappingTarget?.lineupIdx === idx && swappingTarget?.slot === slot;
                            return (
                              <div key={slot} className={`flex items-center gap-2 text-[11px] rounded px-1 py-0.5 transition-all ${isSwapping ? "bg-amber-500/10 ring-1 ring-amber-500/30" : ""}`} data-testid={`lineup-slot-${idx}-${slot}`}>
                                <span className={`font-black w-8 text-right ${isSwapping ? "text-amber-400" : "text-amber-400/70"}`}>{getSlotDisplayName(slot)}</span>
                                {p ? (
                                  <>
                                    <PlayerInfoHoverCard player={p} platform={platform}>
                                      <span className={`font-bold flex-1 truncate cursor-pointer hover:underline decoration-dotted underline-offset-2 ${fadedIds.includes(p.id) ? "text-purple-300" : "text-white"}`}>{p.name}</span>
                                    </PlayerInfoHoverCard>
                                    <PlayerStarRating stars={getPlayerStarCount(Number(p.projectedPoints))} />
                                    <span className="text-slate-400 font-mono">${p.salary.toLocaleString()}</span>
                                    {hasPaidAccess && <span className="text-purple-400/70 font-mono text-[10px] w-10 text-right">{((p as any).ownershipProjection ?? 0).toFixed(0)}%</span>}
                                    <span className="text-emerald-400 font-mono font-bold">{Number(p.projectedPoints).toFixed(1)}</span>
                                    <button
                                      onClick={() => handleProSwap(idx, slot)}
                                      className={`p-0.5 rounded transition-all ${
                                        isSwapping
                                          ? "bg-amber-500 text-white shadow-md"
                                          : "text-slate-500 hover:text-amber-400 hover:bg-amber-500/10"
                                      }`}
                                      data-testid={`pro-swap-${idx}-${slot}`}
                                      title="Swap player"
                                    >
                                      <ArrowLeftRight className="w-3 h-3" />
                                    </button>
                                  </>
                                ) : (
                                  <span className="text-slate-500 italic flex-1">—</span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                        {swappingTarget?.lineupIdx === idx && (
                          <div className="mt-2 pt-2 border-t border-amber-500/20" data-testid={`swap-panel-${idx}`}>
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <ArrowLeftRight className="w-3.5 h-3.5 text-amber-400" />
                                <span className="text-[11px] font-black text-amber-400">
                                  Swap {slots[swappingTarget.slot]?.name} — {proSwapEligiblePlayers.length} eligible
                                </span>
                              </div>
                              <button
                                onClick={() => setSwappingTarget(null)}
                                className="text-slate-400 hover:text-white p-0.5 rounded hover:bg-slate-700 transition-all"
                                data-testid={`cancel-pro-swap-${idx}`}
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <div className="max-h-40 overflow-auto space-y-0.5">
                              {proSwapEligiblePlayers.slice(0, 30).map(ep => (
                                <button
                                  key={ep.id}
                                  onClick={() => handleProSwapSelect(ep)}
                                  className="w-full flex items-center gap-2 text-[11px] px-1.5 py-1 rounded hover:bg-amber-500/10 transition-all group"
                                  data-testid={`pro-swap-pick-${idx}-${ep.id}`}
                                >
                                  <Plus className="w-3 h-3 text-amber-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                                  <span className="font-bold text-white flex-1 truncate text-left">{ep.name}</span>
                                  <span className="text-slate-500 font-mono">{ep.position}</span>
                                  <span className="text-slate-400 font-mono">${ep.salary.toLocaleString()}</span>
                                  <span className="text-emerald-400 font-mono font-bold">{Number(ep.projectedPoints).toFixed(1)}</span>
                                </button>
                              ))}
                              {proSwapEligiblePlayers.length === 0 && (
                                <div className="text-[11px] text-slate-500 text-center py-2">No eligible replacements within salary cap</div>
                              )}
                            {proSwapEligiblePlayers.length > 30 && (
                              <div className="text-[10px] text-slate-500 text-center py-1">
                                Showing 30 of {proSwapEligiblePlayers.length} eligible players
                              </div>
                            )}
                            </div>
                          </div>
                        )}
                      </Card>
                    );
                  })}
                  {visibleLineupCount < sortedLineups.length && (
                    <div className="flex items-center justify-center gap-3 pt-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setVisibleLineupCount(prev => Math.min(prev + 25, sortedLineups.length))}
                        className="font-black text-xs border-slate-600/50 text-slate-300 hover:bg-slate-700/50"
                        data-testid="button-load-more-lineups"
                      >
                        Show More ({Math.min(visibleLineupCount, sortedLineups.length)} of {sortedLineups.length})
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setVisibleLineupCount(sortedLineups.length)}
                        className="font-black text-xs border-slate-600/50 text-slate-400 hover:bg-slate-700/50"
                        data-testid="button-show-all-lineups"
                      >
                        Show All
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Exposure Tracking */}
            {isPro && exposureTracking.length > 0 && (
              <div data-testid="exposure-tracking-panel">
                <h3 className="text-sm font-black text-white uppercase tracking-widest flex items-center gap-2 mb-3">
                  <Target className="w-4 h-4 text-cyan-400" />
                  Player Exposure · Current Generated Batch ({generatedLineups.length} lineups)
                  {globalMaxExposure && (
                    <Badge className="bg-cyan-500/20 text-cyan-400 border-cyan-500/30 text-[9px] font-black ml-1" data-testid="badge-global-exposure">
                      Max {globalMaxExposure}%
                    </Badge>
                  )}
                </h3>
                <Card className="bg-slate-800/60 border-slate-700/50 p-3">
                  <p className="mb-2 text-[10px] leading-relaxed text-slate-400" data-testid="exposure-batch-scope">
                    Exposure uses this generated batch as the denominator. A max cap limits concentration within this batch; 80% still allows a player in up to 80% of lineups and cannot guarantee one injury will not affect results.
                  </p>
                  <div className="space-y-1.5">
                    {exposureTracking.slice(0, 20).map((ep) => (
                      <div key={ep.playerId} className="flex items-center gap-2" data-testid={`exposure-row-${ep.playerId}`}>
                        <span className="text-[10px] font-bold text-amber-400/70 w-8 text-right">{ep.position}</span>
                        <span className="text-xs font-bold text-white flex-1 truncate">
                          {ep.playerName}
                          {ep.injuryStatus && (
                            <span className={`ml-1.5 text-[9px] font-black px-1 py-0 rounded-sm ${
                              ep.injuryStatus === "OUT" || ep.injuryStatus === "IR" || ep.injuryStatus === "Doubtful"
                                ? "bg-red-500/20 text-red-400"
                                : ep.injuryStatus === "Questionable" || ep.injuryStatus === "GTD"
                                  ? "bg-amber-500/20 text-amber-400"
                                  : ep.injuryStatus === "Probable" || ep.injuryStatus === "DTD"
                                    ? "bg-green-500/20 text-green-400"
                                    : "bg-blue-500/20 text-blue-400"
                            }`} data-testid={`exposure-status-${ep.playerId}`}>
                              {ep.injuryStatus === "Questionable" ? "Q" : ep.injuryStatus === "Probable" ? "P" : ep.injuryStatus.toUpperCase()}
                            </span>
                          )}
                        </span>
                        <span className="text-[11px] font-mono text-slate-400">{ep.count}/{ep.total}</span>
                        <div className="w-12 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${ep.overLimit ? "bg-red-400" : "bg-cyan-400"}`}
                            style={{ width: `${Math.min(ep.pct, 100)}%` }}
                          />
                        </div>
                        <span className={`text-[11px] font-black min-w-[36px] text-right ${ep.overLimit ? "text-red-400" : "text-cyan-400"}`} data-testid={`text-exposure-pct-${ep.playerId}`}>
                          {ep.pct.toFixed(0)}%
                        </span>
                        {ep.limit !== undefined && (
                          <span className={`text-[10px] font-bold ${ep.overLimit ? "text-red-400" : "text-slate-500"}`} data-testid={`text-exposure-limit-${ep.playerId}`}>
                            {ep.limit}%{ep.isPlayerSpecific ? "" : " g"}↓
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            )}

            {/* AI Boosts Summary */}
            {boostedPlayers.length > 0 && (
              <div data-testid="boosts-summary-panel">
                <h3 className="text-sm font-black text-white uppercase tracking-widest flex items-center gap-2 mb-3">
                  <TrendingUp className="w-4 h-4 text-emerald-400" />
                  AI Boosts
                </h3>
                <Card className="bg-slate-800/60 border-slate-700/50 p-3">
                  <div className="space-y-2">
                    {boostedPlayers.map((bp) => (
                      <div key={bp.playerId} className="flex items-center gap-2" data-testid={`boost-row-${bp.playerId}`}>
                        <span className={`text-[11px] font-black ${bp.boostScore > 0 ? "text-emerald-400" : "text-red-400"}`}>
                          {bp.boostScore > 0 ? "+" : ""}{bp.boostScore.toFixed(1)}
                        </span>
                        <span className="text-sm font-bold text-white flex-1 truncate">{bp.playerName}</span>
                        <span className="text-[11px] text-slate-400 truncate max-w-[180px]">{bp.boostReason}</span>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            )}

            {/* Injury Report Summary */}
            {injuredPlayers.length > 0 && (
              <div data-testid="injury-summary-panel">
                <h3 className="text-sm font-black text-white uppercase tracking-widest flex items-center gap-2 mb-3">
                  <ShieldAlert className="w-4 h-4 text-red-400" />
                  Injury Report
                </h3>
                <Card className="bg-slate-800/60 border-slate-700/50 p-3">
                  <div className="space-y-2">
                    {injuredPlayers.map((ip) => {
                      const color = INJURY_COLORS[ip.status] || INJURY_COLORS["Day-to-Day"];
                      return (
                        <div key={ip.playerId} className="flex items-center gap-2" data-testid={`injury-row-${ip.playerId}`}>
                          <Badge variant="outline" className={`text-[11px] font-bold ${color}`}>
                            {ip.status}
                          </Badge>
                          <span className="text-sm font-bold text-white flex-1 truncate">{ip.playerName}</span>
                          <span className="text-[11px] text-slate-400 truncate max-w-[180px]">{ip.detail}</span>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              </div>
            )}

            {/* Empty State */}
            {generatedLineups.length === 0 && !isOptimizing && (
              <div className="flex flex-col items-center justify-center py-16 text-center" data-testid="empty-state">
                <div className="w-16 h-16 rounded-full bg-amber-500/10 flex items-center justify-center mb-4">
                  <Crown className="w-8 h-8 text-amber-400" />
                </div>
                <h3 className="text-lg font-black text-white mb-2">Ready to Optimize</h3>
                <p className="text-sm text-slate-400 max-w-xs">
                  {simMode
                    ? `Choose a Sim lineup count and simulate up to ${numSims} unique lineups.`
                    : `Configure your settings and click Generate to create ${lineupCount} optimized lineup${lineupCount > 1 ? "s" : ""}.`}
                </p>
              </div>
            )}

            {isOptimizing && (
              <div className="flex flex-col items-center justify-center py-16" data-testid="loading-state">
                <Loader2 className="w-10 h-10 text-amber-400 animate-spin mb-4" />
                <p className="text-sm font-bold text-slate-400">Generating {lineupCount} lineup{lineupCount > 1 ? "s" : ""}...</p>
              </div>
            )}

            {optimizeMutation.isError && (
              <Card className="bg-red-500/10 border-red-500/30 p-4" data-testid="error-state">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-red-400" />
                  <span className="text-sm font-bold text-red-400">{optimizeMutation.error?.message || "Optimization failed"}</span>
                </div>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

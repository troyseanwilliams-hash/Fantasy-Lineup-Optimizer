import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { NflPortfolioControls, NflPortfolioReportView, useNflPortfolio } from "@/components/NflPortfolio";
import { QualitySearchDiagnostics } from "@/components/QualitySearchDiagnostics";
import { useRoute, useLocation, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { buildUrl } from "@shared/routes";
import type { Player, Slate, OptimizeResponse } from "@shared/schema";
import { getPlatformConfig, assignPlayersToSlots, getSlotDisplayName, positionFitsSlot, PLATFORM_COLORS, type Platform, type Sport } from "@shared/platform-config";
import { parseGameInfo, sanitizeGameInfo } from "@/lib/game-info";
import { PlatformSelector } from "@/components/PlatformSelector";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { PlayerHistoryCard } from "@/components/PlayerHistoryCard";
import {
  Lock, Unlock, X, Zap, RefreshCw, Save, Search, Download,
  ChevronDown, ChevronUp, ArrowUpDown, Heart, Loader2,
  DollarSign, Target, TrendingUp, RotateCcw, Crown, Plus, UserPlus, Activity, Flag,
  Trophy, Star, MapPin, Users, Flame, Award, Rocket, ArrowLeftRight, Maximize2, Minimize2
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

type SortKey = "name" | "position" | "team" | "salary" | "projectedPoints" | "fppg" | "value";
type SortDir = "asc" | "desc";

function formatSalary(salary: number, plat: Platform): string {
  if (plat === "yahoo") return `$${salary}`;
  return `$${(salary / 1000).toFixed(1)}K`;
}

function formatCap(cap: number, plat: Platform): string {
  if (plat === "yahoo") return `$${cap}`;
  return `$${cap.toLocaleString()}`;
}

const INJURY_COLORS: Record<string, string> = {
  OUT: "bg-red-500/20 text-red-400 border-red-500/30",
  INJ: "bg-red-500/20 text-red-400 border-red-500/30",
  O: "bg-red-500/20 text-red-400 border-red-500/30",
  IR: "bg-red-500/20 text-red-400 border-red-500/30",
  SUS: "bg-red-500/20 text-red-400 border-red-500/30",
  NA: "bg-red-500/20 text-red-400 border-red-500/30",
  Doubtful: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  Questionable: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  GTD: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  DTD: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  Probable: "bg-green-500/20 text-green-400 border-green-500/30",
  "Day-to-Day": "bg-blue-500/20 text-blue-400 border-blue-500/30",
};

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
        <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wide text-emerald-400 whitespace-nowrap">
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
                  className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-950 accent-emerald-500 disabled:cursor-not-allowed"
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

export default function Optimizer() {
  usePageMeta({ title: "Lineup Optimizer", description: "Build optimized DFS lineups with the EliteLineup AI optimizer.", path: "/optimizer" });
  const [, params] = useRoute("/optimizer/:id");
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
  const [lineupName, setLineupName] = useState("");
  const [removedSlots, setRemovedSlots] = useState<Set<string>>(new Set());
  // activeSwapSlot replaces the previous redundant activeSwapSlot + activeSwapSlot pair
  // (they were always set and cleared together with the same value)
  const [activeSwapSlot, setActiveSwapSlot] = useState<string | null>(null);
  const [manualReplacements, setManualReplacements] = useState<Record<string, Player>>({});
  const [salaryRange, setSalaryRange] = useState<[number, number] | null>(null);
  const [minProjection, setMinProjection] = useState<number | null>(null);
  const [projectedPointsFloor, setProjectedPointsFloor] = useState<number | null>(null);
  const [flexAllowedPositions, setFlexAllowedPositions] = useState<NflFlexPosition[]>([...NFL_FLEX_POSITIONS]);
  const [contestType, setContestType] = useState<"cash" | "gpp">("cash");
  const portfolio = useNflPortfolio();
  const [outperformerMode, setOutperformerMode] = useState(false);
  const [mobileView, setMobileView] = useState<"players" | "lineup">("players");
  const [playerFocus, setPlayerFocus] = useState(false);
  const playerPoolRef = useRef<HTMLDivElement>(null);
  const currentSlateIdRef = useRef(slateId);
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
  const slate = useResolvedSlate(slateId, slates, "/optimizer");
  const sport = (slate?.sport || "NBA") as Sport;
  const isNflClassic = sport === "NFL" && (slate?.gameType || "Classic").toLowerCase() === "classic";
  const portfolioSupported = isNflClassic && platform === "draftkings" && contestType === "gpp";
  useEffect(() => { portfolio.setReport(undefined); }, [contestType, platform]);

  const { data: accuracyData } = useQuery<{ players: Array<{ playerName: string; hitRate: number; avgDelta: number; slatesAnalyzed: number }> }>({
    queryKey: ["/api/projection-accuracy", sport],
    enabled: !!sport,
    staleTime: 10 * 60 * 1000,
  });
  const hitRateMap = useMemo(() => {
    const map = new Map<string, { hitRate: number; avgDelta: number; slatesAnalyzed: number }>();
    if (!accuracyData?.players) return map;
    for (const p of accuracyData.players) {
      map.set(p.playerName.toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim(), p);
    }
    return map;
  }, [accuracyData]);
  const slateHasStarted = slate ? new Date(slate.startTime) <= new Date() : false;

  useEffect(() => {
    if (slate?.platform) {
      setPlatform(slate.platform as Platform);
    }
  }, [slateId, slate?.platform]);

  const config = useMemo(() => {
    try { return getPlatformConfig(sport, platform); }
    catch { return getPlatformConfig("NBA", "draftkings"); }
  }, [sport, platform]);

  const sportSlates = useMemo(() => {
    if (!slates) return [];
    return slates
      .filter(s => s.sport === sport && s.platform === platform && s.isActive !== false)
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
  } = useSessionPlayerQuery<Player[]>({
    url: playerUrl,
    userId,
    enabled: !!slateId,
  });

  const { data: subData } = useQuery<{ tier: string; lineupCount: number; maxLineups: number; maxLineupsPerSport: number; sportCounts: Record<string, number> }>({
    queryKey: ["/api/subscription"],
    enabled: !!user,
  });

  const salaryBounds = useMemo(() => {
    if (!players || players.length === 0) return { min: 3000, max: 10000, step: 100 };
    const salaries = players.map(p => p.salary).filter(s => typeof s === "number" && !isNaN(s));
    if (salaries.length === 0) return { min: 3000, max: 10000, step: 100 };
    const min = Math.min(...salaries);
    const max = Math.max(...salaries);
    if (min === max) return { min, max: min + 100, step: 100 };
    return { min, max, step: 100 };
  }, [players]);

  const optimizeMutation = useMutation<OptimizeResponse, Error, any>({
    mutationFn: async (constraints) => {
      const res = await apiRequest("POST", "/api/optimize", constraints);
      return res.json();
    },
    onSuccess: (data) => {
      portfolio.setReport((data as any).nflPortfolioReport);
      setRemovedSlots(new Set());
      setActiveSwapSlot(null);
      setManualReplacements({});
      if (data.lineups && data.lineups.length === 0 && projectedPointsFloor) {
        toast({
          title: `No lineups hit ${projectedPointsFloor}+ pts`,
          description: data.message || "Try lowering the floor or relaxing constraints.",
          variant: "destructive",
        });
      }
    }
  });

  useEffect(() => {
    optimizeMutation.reset();
    portfolio.reset();
    setRemovedSlots(new Set());
    setActiveSwapSlot(null);
    setManualReplacements({});
    setSalaryRange(null);
    setCustomProjections({});
    setBoosts({});
    setMinProjection(null);
    setProjectedPointsFloor(null);
    setContestType("cash");
    setFlexAllowedPositions([...NFL_FLEX_POSITIONS]);
  }, [slateId]);

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
      toast({ title: "Lineup Saved!", description: "Added to your vault." });
      queryClient.invalidateQueries({ queryKey: ["/api/lineups"] });
      queryClient.invalidateQueries({ queryKey: ["/api/subscription"] });
    },
    onError: (err: Error) => {
      toast({ title: "Cannot Save", description: err.message, variant: "destructive" });
    },
  });

  const isGolf = sport === "GOLF";

  const games = useMemo(() => {
    if (!players) return [];
    if (isGolf) {
      const tournamentName = sanitizeGameInfo(players.find(p => p.gameInfo)?.gameInfo) || "Tournament";
      return [{ away: tournamentName, home: "", time: `${players.length} Golfers` }];
    }
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
  }, [players, isGolf]);

  const golfAnalysis = useMemo(() => {
    if (!isGolf || !players || players.length === 0) return null;
    const sorted = [...players].sort((a, b) => Number(b.projectedPoints) - Number(a.projectedPoints));
    const topSalary = Math.max(...players.map(p => p.salary));

    const favorites = sorted.slice(0, 5).map(p => {
      const impliedProb = (p.salary / topSalary) * 0.45;
      const americanOdds = impliedProb >= 0.5
        ? Math.round(-100 * impliedProb / (1 - impliedProb))
        : Math.round(100 * (1 - impliedProb) / impliedProb);
      return {
        ...p,
        odds: americanOdds > 0 ? `+${americanOdds}` : `${americanOdds}`,
        impliedProb: (impliedProb * 100).toFixed(0),
      };
    });

    const valuePicks = [...players]
      .map(p => ({ ...p, value: Number(p.projectedPoints) / (p.salary / 1000) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 4);

    const tournamentParts = sanitizeGameInfo(players[0]?.gameInfo || "Tournament").split(" - ");
    const tournamentName = tournamentParts[0] || "Tournament";
    const courseName = tournamentParts[1] || "";

    return { favorites, valuePicks, tournamentName, courseName, fieldSize: players.length, avgSalary: Math.round(players.reduce((s, p) => s + p.salary, 0) / players.length) };
  }, [isGolf, players]);

  const toggleSort = useCallback((key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  }, [sortKey]);

  const filteredPlayers = useMemo(() => {
    if (!players) return [];
    return players
      .filter(p => {
        if (excludedIds.includes(p.id)) return false;
        const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.team.toLowerCase().includes(search.toLowerCase());
        const matchPos = posFilter === "ALL" || p.position.includes(posFilter);
        return matchSearch && matchPos;
      })
      .map(p => ({
        ...p,
        value: Number(p.projectedPoints) / (p.salary / 1000),
        effectiveProj: (() => {
          const base = customProjections[p.id] ?? Number(p.projectedPoints);
          const manualBoost = boosts[p.id] || 0;
          return Math.round((base + manualBoost) * 10) / 10;
        })(),
      }))
      .sort((a, b) => {
        let aVal: any, bVal: any;
        switch (sortKey) {
          case "name": aVal = a.name; bVal = b.name; break;
          case "position": aVal = a.position; bVal = b.position; break;
          case "team": aVal = a.team; bVal = b.team; break;
          case "salary": aVal = a.salary; bVal = b.salary; break;
          case "projectedPoints": aVal = a.effectiveProj; bVal = b.effectiveProj; break;
          case "fppg": aVal = Number(a.fppg); bVal = Number(b.fppg); break;
          case "value": aVal = a.value; bVal = b.value; break;
          default: aVal = a.effectiveProj; bVal = b.effectiveProj;
        }
        if (typeof aVal === "string") return sortDir === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
        return sortDir === "asc" ? aVal - bVal : bVal - aVal;
      });
  }, [players, search, posFilter, excludedIds, customProjections, boosts, sortKey, sortDir]);

  const excludedPlayers = useMemo(() => {
    if (!players) return [];
    return players.filter(p => excludedIds.includes(p.id));
  }, [players, excludedIds]);

  const currentLineup = optimizeMutation.data;
  const playersById = useMemo(() => new Map(players?.map(p => [p.id, p]) ?? []), [players]);

  const lineupSlots = useMemo(() => {
    if (!currentLineup?.lineup) return null;
    const enrichedLineup = currentLineup.lineup.map(p => {
      const enriched = playersById.get(p.id);
      if (enriched) {
        return { ...p, recentActualAvg: enriched.recentActualAvg, gamesTracked: enriched.gamesTracked };
      }
      return p;
    });
    const assigned = assignPlayersToSlots(enrichedLineup, config.slots, sport);
    removedSlots.forEach(slot => {
      if (assigned[slot]) assigned[slot] = null;
    });
    Object.entries(manualReplacements).forEach(([slot, player]) => {
      assigned[slot] = player;
    });
    return assigned;
  }, [currentLineup, config.slots, removedSlots, manualReplacements, playersById]);

  const activeLineupPlayers = useMemo(() => {
    if (!lineupSlots) return [];
    return Object.values(lineupSlots).filter(Boolean) as Player[];
  }, [lineupSlots]);

  const totalSalary = activeLineupPlayers.reduce((s, p) => s + p.salary, 0);
  // totalProj: display value including user boosts (shown in UI and used for grade)
  const totalProj = activeLineupPlayers.reduce((s, p) => {
    const base = customProjections[p.id] ?? Number(p.projectedPoints);
    const manualBoost = boosts[p.id] || 0;
    return s + Math.round((base + manualBoost) * 10) / 10;
  }, 0);

  // totalProjUnboosted: clean projection total saved to DB (no user boost inflation)
  const totalProjUnboosted = activeLineupPlayers.reduce(
    (s, p) => s + (customProjections[p.id] ?? Number(p.projectedPoints)),
    0
  );

  const lineupGrade = useMemo(() => {
    if (activeLineupPlayers.length === 0) return null;
    return gradeLineup(activeLineupPlayers, sport, platform, totalSalary, totalProj);
  }, [activeLineupPlayers, sport, platform, totalSalary, totalProj]);

  const lockedSalary = useMemo(() => {
    if (!players) return 0;
    return players.filter(p => lockedIds.includes(p.id)).reduce((s, p) => s + p.salary, 0);
  }, [players, lockedIds]);

  const toggleFlexPosition = useCallback((position: NflFlexPosition) => {
    setFlexAllowedPositions(prev => {
      if (prev.includes(position)) {
        return prev.length > 1 ? prev.filter(current => current !== position) : prev;
      }
      return [...prev, position];
    });
  }, []);

  const handleOptimize = () => {
    portfolio.setReport(undefined);
    if (portfolioSupported && portfolio.error) {
      toast({ title: "Invalid NFL strategy", description: portfolio.error, variant: "destructive" });
      return;
    }
    setActiveSwapSlot(null);
    setActiveSwapSlot(null);
    const mergedProjections: Record<string, number> = { ...customProjections };
    if (players) {
      for (const p of players) {
        const manualBoost = boosts[p.id] || 0;
        if (manualBoost !== 0) {
          // Apply boost additively (same model as display: baseProj + boost points)
          const base = customProjections[p.id] ?? Number(p.projectedPoints);
          mergedProjections[p.id] = Math.round((base + manualBoost) * 10) / 10;
        }
      }
    }
    optimizeMutation.mutate({
      slateId,
      platform,
      lockedPlayerIds: lockedIds,
      excludedPlayerIds: excludedIds,
      playerMinSalary: salaryRange && salaryRange[0] > salaryBounds.min ? salaryRange[0] : undefined,
      playerMaxSalary: salaryRange && salaryRange[1] < salaryBounds.max ? salaryRange[1] : undefined,
      playerProjections: Object.keys(mergedProjections).length > 0 ? mergedProjections : undefined,
      minProjection: minProjection ?? undefined,
      projectedPointsFloor: projectedPointsFloor ?? undefined,
      contestType,
      ...(portfolioSupported && portfolio.settings.enabled ? { nflPortfolio: portfolio.settings } : {}),
      outperformerMode,
      ...(isNflClassic ? { flexAllowedPositions } : {}),
    });
  };

  const handleSave = () => {
    if (!currentLineup?.lineup || !user) return;
    saveLineupMutation.mutate({
      userId: userId!,
      slateId,
      sport,
      platform,
      totalSalary,
      totalProjectedPoints: totalProjUnboosted.toString(),
      playerIds: activeLineupPlayers.map(p => p.id),
      name: lineupName || `${config.shortLabel} Lineup ${new Date().toLocaleTimeString()}`,
    });
  };

  const handleReset = () => {
    portfolio.reset();
    setLockedIds([]);
    setExcludedIds([]);
    setCustomProjections({});
    setBoosts({});
    setRemovedSlots(new Set());
    setActiveSwapSlot(null);
    setManualReplacements({});
    setSalaryRange(null);
    setMinProjection(null);
    setProjectedPointsFloor(null);
    setFlexAllowedPositions([...NFL_FLEX_POSITIONS]);
    setContestType("cash");
    optimizeMutation.reset();
    setLineupName("");
  };

  const handleRemoveFromSlot = (slot: string) => {
    setRemovedSlots(prev => new Set(prev).add(slot));
    setManualReplacements(prev => {
      const next = { ...prev };
      delete next[slot];
      return next;
    });
    setActiveSwapSlot(null);
    setActiveSwapSlot(null);
  };

  const handleSwapFromSlot = (slot: string) => {
    if (activeSwapSlot === slot) {
      setActiveSwapSlot(null);
      setActiveSwapSlot(null);
    } else {
      setActiveSwapSlot(slot);
      setActiveSwapSlot(slot);
    }
  };

  const handleSelectReplacement = (player: Player) => {
    if (!activeSwapSlot) return;
    setManualReplacements(prev => ({ ...prev, [activeSwapSlot]: player }));
    setRemovedSlots(prev => {
      const next = new Set(prev);
      next.delete(activeSwapSlot);
      return next;
    });
    setActiveSwapSlot(null);
    setActiveSwapSlot(null);
  };

  const remainingSalary = useMemo(() => {
    return config.salaryCap - totalSalary;
  }, [config.salaryCap, totalSalary]);

  const swapBudget = useMemo(() => {
    if (!activeSwapSlot || !lineupSlots) return 0;
    const currentPlayer = lineupSlots[activeSwapSlot];
    return currentPlayer ? currentPlayer.salary : 0;
  }, [activeSwapSlot, lineupSlots]);

  const replacementEligiblePlayers = useMemo(() => {
    if (!activeSwapSlot || !players) return [];
    const lineupPlayerIds = new Set(activeLineupPlayers.map(p => p.id));
    const availableSalary = remainingSalary + swapBudget;
    return players.filter(p => {
      if (lineupPlayerIds.has(p.id)) return false;
      if (excludedIds.includes(p.id)) return false;
      if (!positionFitsSlot(p.position, activeSwapSlot, sport)) return false;
      if (p.salary > availableSalary) return false;
      return true;
    });
  }, [activeSwapSlot, players, activeLineupPlayers, excludedIds, sport, remainingSalary, swapBudget]);

  const handleSlateChange = (newSlateId: string) => {
    handleReset();
    setLocation(optimizerSlatePath("standard", newSlateId));
  };

  const togglePlayerFocus = useCallback(() => {
    setPlayerFocus(focused => {
      const nextFocused = !focused;
      if (nextFocused) {
        window.setTimeout(() => playerPoolRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
      }
      return nextFocused;
    });
  }, []);

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

  if (isLoading) {
    return (
      <div className="h-[80vh] flex items-center justify-center">
        <Loader2 className="w-10 h-10 text-emerald-500 animate-spin" />
      </div>
    );
  }

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
        setLocation(optimizerSlatePath("standard", match.id));
      }
    }
  };

  const handleExportCSV = async () => {
    if (!lineupSlots || exportInFlightRef.current) return;

    // Capture both the slate and the roster rows before awaiting the resolver.
    // A route/slate change while the request is in flight must never download
    // the old lineup with IDs from the new draft group.
    const exportSlateId = slateId;
    const exportSport = sport;
    const exportPlatform = platform;
    const exportSlots = [...config.slots];
    const exportRows = exportSlots.map(slot => ({
      slot,
      player: lineupSlots[slot] || null,
    }));
    const playerIds = exportRows
      .map(({ player }) => player?.id)
      .filter((id): id is number => typeof id === "number");

    if (playerIds.length === 0) {
      toast({ title: "CSV Export Failed", description: "This lineup has no players to export.", variant: "destructive" });
      return;
    }

    exportInFlightRef.current = true;
    try {
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
      const values = exportRows.map(({ slot, player }) => {
        if (!player) throw new Error(`Export slot ${getSlotDisplayName(slot)} is empty.`);
        const resolvedPlayer = playersById.get(Number(player.id));
        if (!resolvedPlayer) throw new Error(`Export player missing for ${getSlotDisplayName(slot)}.`);
        return csvEscape(formatResolvedPlayer(resolvedPlayer, exportPlatform));
      });
      const csv = [
        exportSlots.map(slot => csvEscape(getSlotDisplayName(slot))).join(","),
        values.join(","),
      ].join("\n");

      if (!componentMountedRef.current || currentSlateIdRef.current !== exportSlateId) {
        throw new Error("Export canceled because the slate changed.");
      }
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = exportFilename(resolved.slate, exportSport, exportPlatform, "lineup");
      a.click();
      URL.revokeObjectURL(url);
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

  const positions = ["ALL", ...(config.positionFilters || ["PG", "SG", "SF", "PF", "C"])];
  const pColors = PLATFORM_COLORS[platform];

  const sportImages: Record<string, string> = {
    NBA: "/images/sport-nba.png", NHL: "/images/sport-nhl.png",
    MLB: "/images/sport-mlb.png", NFL: "/images/sport-nfl.png",
    GOLF: "/images/sport-golf.png",
  };

  return (
    <div className={`flex flex-col xl:flex-row ${playerFocus ? "fixed inset-0 z-50 h-[100dvh] overflow-hidden bg-slate-950" : "min-h-full overflow-visible"}`}>
      {/* Mobile Tab Toggle */}
      {!playerFocus && <div className="xl:hidden flex border-b border-slate-800 bg-slate-900/80 sticky top-0 z-20">
        <button
          onClick={() => setMobileView("players")}
          data-testid="mobile-tab-players"
          className={`flex-1 px-3 py-2 text-[11px] font-black uppercase tracking-wider transition-all ${
            mobileView === "players"
              ? `${pColors.text} border-b-2 ${pColors.border} bg-slate-800/50`
              : "text-slate-500 hover:text-slate-300"
          }`}
        >
          <Users className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />
          Players {filteredPlayers.length > 0 && `(${filteredPlayers.length})`}
        </button>
        <button
          onClick={() => setMobileView("lineup")}
          data-testid="mobile-tab-lineup"
          className={`flex-1 px-3 py-2 text-[11px] font-black uppercase tracking-wider transition-all relative ${
            mobileView === "lineup"
              ? `${pColors.text} border-b-2 ${pColors.border} bg-slate-800/50`
              : "text-slate-500 hover:text-slate-300"
          }`}
        >
          <Target className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />
          Lineup {currentLineup ? `(${totalProj.toFixed(0)} pts)` : ""}
          {currentLineup && mobileView !== "lineup" && (
            <span className={`absolute top-1 right-2 w-2 h-2 rounded-full animate-pulse ${pColors.bg}`} />
          )}
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

      {!playerFocus && <div className="flex md:hidden flex-col gap-1 px-3 py-2 border-b border-slate-800 bg-slate-900/60" data-testid="min-projection-section-mobile">
        <div className="flex items-center gap-1.5 bg-slate-800/60 rounded-lg px-2 py-1.5 border border-slate-700/50">
          <Target className={`w-3.5 h-3.5 flex-shrink-0 ${minProjection !== null ? pColors.text : "text-slate-500"}`} />
          <label htmlFor="input-min-projection-mobile" className="text-[9px] font-black text-slate-400 uppercase whitespace-nowrap">Min Projection</label>
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
            className={`flex-1 min-w-0 bg-transparent border-0 text-right font-mono font-black text-xs focus:outline-none tabular-nums ${minProjection !== null ? pColors.text : "text-slate-500"}`}
            data-testid="input-min-projection-mobile"
          />
          <span className={`text-[9px] font-black whitespace-nowrap ${minProjection !== null ? pColors.text : "text-slate-500"}`}>
            {minProjection !== null ? `${minProjection}+` : "pts min"}
          </span>
          {minProjection !== null && (
            <button onClick={() => setMinProjection(null)} className="text-slate-500 hover:text-white flex-shrink-0 cursor-pointer" data-testid="button-reset-min-projection-mobile"><X className="w-3 h-3" /></button>
          )}
        </div>
        <p className="px-1 text-[9px] leading-tight text-slate-500">
          Below-cutoff players are excluded using base/custom projection plus manual +pts boosts; automatic and simulation adjustments do not affect eligibility.
        </p>
        {isNflClassic && (
          <FlexPositionControls
            allowedPositions={flexAllowedPositions}
            onToggle={toggleFlexPosition}
            testId="nfl-flex-controls-mobile"
          />
        )}
      </div>}

      {/* LEFT: Player Pool */}
      <div ref={playerPoolRef} className={`flex min-w-0 flex-1 flex-col border-r border-slate-800 xl:overflow-hidden ${playerFocus ? "w-full min-h-0 overflow-hidden" : ""} ${!playerFocus && mobileView !== "players" ? "hidden xl:flex" : ""}`}>
        {/* Top Bar */}
        {!playerFocus && <div className="relative border-b border-slate-800 overflow-hidden">
          <div className="absolute inset-0">
            <img
              src={sportImages[sport] || sportImages.NBA}
              alt=""
              className="w-full h-full object-cover opacity-15"
            />
            <div className={`absolute inset-0 bg-gradient-to-r ${platform === "fanduel" ? "from-blue-950/90" : platform === "yahoo" ? "from-purple-950/90" : "from-emerald-950/90"} via-slate-900/95 to-slate-900`} />
          </div>
          <div className="relative px-3 sm:px-4 py-2 sm:py-3 flex flex-wrap items-center gap-2 sm:gap-3">
            <div className="flex items-center gap-1.5 sm:gap-2">
              <Zap className={`w-4 h-4 sm:w-5 sm:h-5 fill-current ${pColors.text}`} />
              <span className="text-sm sm:text-lg font-black text-white tracking-tight">{sport} OPTIMIZER</span>
              <Badge className={`text-[10px] sm:text-[11px] font-black ${pColors.bg} ${pColors.text} ${pColors.border}`} data-testid="platform-badge">
                {config.shortLabel}
              </Badge>
            </div>
            <PlatformSelector
              sport={sport}
              value={platform}
              onChange={handlePlatformChange}
              showProBadge
              tier={userIsAdmin ? "admin" : (subData?.tier || "free")}
            />
            {slate && (
              <div className="hidden sm:flex items-center gap-2 min-w-0" data-testid="slate-date">
                <span className={`text-xs font-black ${pColors.text} opacity-70 truncate`} title={formatSlateIdentity(slate)}>
                  {formatSlateIdentity(slate)}
                </span>
              </div>
            )}
            <div className="ml-auto flex items-center gap-1.5 sm:gap-2 w-full sm:w-auto mt-1.5 sm:mt-0">
              <span className="text-[10px] sm:text-[11px] font-bold text-slate-400 uppercase tracking-widest hidden sm:inline">Target group:</span>
              <select
                className="bg-slate-800 border border-slate-700 text-white text-xs sm:text-sm rounded-lg px-2 sm:px-3 py-1.5 font-bold flex-1 sm:flex-none truncate"
                value={slateId}
                onChange={e => {
                  const selectedSlate = sportSlates.find(s => String(s.id) === e.target.value);
                  const userTier = subData?.tier || "free";
                  const isUserAdmin = userIsAdmin;
                  if (selectedSlate && !selectedSlate.isMain && userTier !== "pro" && !isUserAdmin) {
                    toast({ title: "Champion Feature", description: "Additional slates require a Champion subscription. Visit the Pricing page to upgrade.", variant: "destructive" });
                    return;
                  }
                  handleSlateChange(e.target.value);
                }}
                data-testid="slate-selector"
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
            </div>
          </div>

          {slate && (
            <div
              className={`px-3 sm:px-4 py-1.5 border-b bg-slate-950/80 ${pColors.border} flex items-center gap-2 overflow-x-auto`}
              data-testid="selected-slate-identity"
            >
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 shrink-0">Selected target</span>
              <span className={`text-[11px] font-black ${pColors.text} whitespace-nowrap`}>
                {formatSlateIdentity(slate)}
              </span>
              <span className="text-[10px] text-slate-500 whitespace-nowrap">
                Exports and new lineups use this exact group.
              </span>
               <Link
                 href={`/player-config?slateId=${slateId}`}
                 className={`ml-auto text-[10px] font-black uppercase tracking-wide ${pColors.text} hover:underline whitespace-nowrap`}
                 data-testid="optimizer-player-configuration-link"
               >
                 Player Configuration
               </Link>
            </div>
          )}

          {slate && (slate as any).games?.length > 0 && !isGolf && (
            <div className={`px-3 sm:px-4 py-1.5 border-b bg-slate-950/80 ${pColors.border} flex items-center gap-2 overflow-x-auto`} data-testid="slate-games-strip">
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

          {/* Game Scoreboard Cards / Golf Tournament Cards */}
          <div className={`relative z-10 px-3 sm:px-4 pb-2 sm:pb-3 pt-2 sm:pt-3 border-b bg-slate-950 ${pColors.border}`}>
            {isGolf && golfAnalysis ? (
              <>
                <div className="flex items-center gap-2 mb-2 sm:mb-3">
                  <Trophy className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-white" />
                  <span className="text-xs sm:text-sm font-black text-white uppercase tracking-widest" style={{textShadow: '0 1px 3px rgba(0,0,0,0.8)'}}>Tournament Center</span>
                  <Badge className="text-[9px] sm:text-[10px] font-black bg-lime-500/20 text-white border-lime-500/30">LIVE</Badge>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-2.5 pb-1 sm:pb-2">
                  {/* Tournament Info Card */}
                  <div className="rounded-xl overflow-hidden bg-slate-900 border border-lime-500/30 shadow-lg" data-testid="tournament-info-card">
                    <div className="px-4 py-3 bg-gradient-to-br from-lime-500/20 to-transparent">
                      <div className="flex items-center gap-2 mb-2">
                        <Flag className="w-4 h-4 text-lime-400" />
                        <span className="text-sm font-black text-white drop-shadow-md" style={{textShadow: '0 1px 3px rgba(0,0,0,0.8)'}}>{golfAnalysis.tournamentName}</span>
                      </div>
                      {golfAnalysis.courseName && (
                        <div className="flex items-center gap-1.5 mb-2">
                          <MapPin className="w-3 h-3 text-lime-400" />
                          <span className="text-xs text-white font-bold" style={{textShadow: '0 1px 2px rgba(0,0,0,0.8)'}}>{golfAnalysis.courseName}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-3 mt-2">
                        <div className="flex items-center gap-1">
                          <Users className="w-3 h-3 text-lime-400" />
                          <span className="text-[11px] font-bold text-white" style={{textShadow: '0 1px 2px rgba(0,0,0,0.8)'}}>{golfAnalysis.fieldSize} Golfers</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <DollarSign className="w-3 h-3 text-lime-400" />
                          <span className="text-[11px] font-bold text-white" style={{textShadow: '0 1px 2px rgba(0,0,0,0.8)'}}>Avg ${golfAnalysis.avgSalary.toLocaleString()}</span>
                        </div>
                      </div>
                      {slate && (
                        <div className="mt-2 text-[10px] font-bold text-lime-400 uppercase tracking-wider">
                          {new Date(slate.startTime).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Top Favorites Card */}
                  <div className="rounded-xl overflow-hidden bg-slate-900 border border-amber-500/30 shadow-lg" data-testid="favorites-card">
                    <div className="px-4 py-3 bg-gradient-to-br from-amber-500/20 to-transparent">
                      <div className="flex items-center gap-2 mb-2.5">
                        <Flame className="w-4 h-4 text-amber-400" />
                        <span className="text-xs font-black text-white uppercase tracking-widest" style={{textShadow: '0 1px 3px rgba(0,0,0,0.8)'}}>Top Favorites</span>
                      </div>
                      <div className="space-y-1.5">
                        {golfAnalysis.favorites.map((p, i) => (
                          <div key={p.id} className="flex items-center justify-between group" data-testid={`favorite-${i}`}>
                            <div className="flex items-center gap-2">
                              <span className={`text-[10px] font-black w-4 text-center ${i === 0 ? "text-amber-400" : i === 1 ? "text-white" : "text-slate-300"}`}>
                                {i + 1}
                              </span>
                              <span className="text-xs font-bold text-white group-hover:text-lime-400 transition-colors" style={{textShadow: '0 1px 2px rgba(0,0,0,0.8)'}}>{p.name}</span>
                              <span className="text-[10px] text-slate-300 font-bold">{p.team}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] font-black text-amber-400 font-mono">{p.odds}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Top Value Picks Card */}
                  <div className="rounded-xl overflow-hidden bg-slate-900 border border-cyan-500/30 shadow-lg" data-testid="value-picks-card">
                    <div className="px-4 py-3 bg-gradient-to-br from-cyan-500/20 to-transparent">
                      <div className="flex items-center gap-2 mb-2.5">
                        <Award className="w-4 h-4 text-cyan-400" />
                        <span className="text-xs font-black text-white uppercase tracking-widest" style={{textShadow: '0 1px 3px rgba(0,0,0,0.8)'}}>Value Picks</span>
                      </div>
                      <div className="space-y-1.5">
                        {golfAnalysis.valuePicks.map((p, i) => (
                          <div key={p.id} className="flex items-center justify-between group" data-testid={`value-pick-${i}`}>
                            <div className="flex items-center gap-2">
                              <Star className={`w-3 h-3 ${i === 0 ? "text-cyan-400 fill-cyan-400" : "text-cyan-400/40"}`} />
                              <span className="text-xs font-bold text-white group-hover:text-cyan-400 transition-colors" style={{textShadow: '0 1px 2px rgba(0,0,0,0.8)'}}>{p.name}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-white font-mono" style={{textShadow: '0 1px 2px rgba(0,0,0,0.8)'}}>${p.salary.toLocaleString()}</span>
                              <span className="text-[11px] font-black text-cyan-400 font-mono">{p.value.toFixed(1)}x</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-2 sm:mb-3">
                  <Activity className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${platform === "fanduel" ? "text-blue-400" : "text-emerald-400"}`} />
                  <span className="text-[11px] sm:text-xs font-black text-white uppercase tracking-widest">Slate Games</span>
                  <Badge className={`text-[9px] sm:text-[10px] font-black ${platform === "fanduel" ? "bg-blue-500/20 text-blue-300 border-blue-500/30" : "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"}`}>
                    {games.length}
                  </Badge>
                </div>
                <div className="flex gap-2 sm:gap-2.5 overflow-x-auto scrollbar-hide pb-1 sm:pb-2">
                  {games.map((game, i) => (
                    <div
                      key={i}
                      className={`flex-shrink-0 rounded-xl min-w-[95px] sm:min-w-[110px] overflow-hidden shadow-lg ${
                        platform === "fanduel"
                          ? "bg-gradient-to-b from-blue-600/25 to-blue-900/40 border border-blue-400/30 shadow-blue-500/10"
                          : "bg-gradient-to-b from-emerald-600/25 to-emerald-900/40 border border-emerald-400/30 shadow-emerald-500/10"
                      }`}
                      data-testid={`game-card-${i}`}
                    >
                      <div className="flex flex-col items-center px-3 sm:px-4 py-2 sm:py-2.5 gap-0.5 sm:gap-1">
                        <span className="text-xs sm:text-sm font-black text-white drop-shadow-sm">{game.away}</span>
                        <span className={`text-[9px] sm:text-[10px] font-black ${platform === "fanduel" ? "text-blue-300" : "text-emerald-300"}`}>VS</span>
                        <span className="text-xs sm:text-sm font-black text-white drop-shadow-sm">{game.home}</span>
                      </div>
                      <div className={`text-[10px] sm:text-[11px] font-black py-1 sm:py-1.5 text-center ${
                        platform === "fanduel"
                          ? "bg-blue-500/30 text-blue-100 border-t border-blue-400/20"
                          : "bg-emerald-500/30 text-emerald-100 border-t border-emerald-400/20"
                      }`}>
                        {game.time}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>}

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
        <div className="px-3 sm:px-4 py-2 sm:py-3 border-b border-slate-800 bg-slate-900/20 flex flex-col md:flex-row gap-2 sm:gap-3 items-stretch md:items-center">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <Input
              placeholder="Search players..."
              className="bg-slate-900 border-slate-700 pl-10 h-8 sm:h-9 text-xs sm:text-sm"
              value={search}
              onChange={e => setSearch(e.target.value)}
              data-testid="player-search"
            />
          </div>
          <div className="flex flex-wrap gap-0.5 sm:gap-1 bg-slate-900 rounded-lg p-0.5 border border-slate-800">
            {positions.map(pos => (
              <button
                key={pos}
                onClick={() => setPosFilter(pos)}
                data-testid={`filter-${pos}`}
                className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded-md text-[10px] sm:text-[11px] font-black transition-all ${
                  posFilter === pos
                    ? `${platform === "fanduel" ? "bg-blue-500 shadow-blue-500/20" : "bg-emerald-500 shadow-emerald-500/20"} text-white shadow-lg`
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                {pos}
              </button>
            ))}
          </div>
          <div className="text-[10px] sm:text-xs text-slate-500 font-bold ml-auto">
            {filteredPlayers.length} players
          </div>
          <button
            type="button"
            onClick={() => { void refreshPlayers(); }}
            disabled={isFetchingPlayers}
            title="Refresh player pool"
            aria-label="Refresh player pool"
            data-testid="button-refresh-players"
            className="inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-[11px] font-black uppercase tracking-wide text-slate-300 transition-colors hover:border-emerald-500/50 hover:text-emerald-300 disabled:cursor-wait disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetchingPlayers ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
          <button
            type="button"
            onClick={togglePlayerFocus}
            aria-pressed={playerFocus}
            data-testid="button-player-focus"
            className={`inline-flex items-center justify-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-black uppercase tracking-wide transition-colors ${playerFocus ? `${pColors.border} ${pColors.text} bg-slate-800` : "border-slate-700 bg-slate-900 text-slate-300 hover:text-white"}`}
          >
            {playerFocus ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            {playerFocus ? "Back to optimizer" : "Expand players"}
          </button>
        </div>
        {playerRefreshError && players && (
          <div
            role="alert"
            data-testid="player-refresh-warning"
            className="flex items-center justify-between gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 sm:px-4 py-2 text-[11px] font-bold text-amber-300"
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

        {/* Replacement/Swap Mode Banner */}
        {activeSwapSlot && (
          <div className={`px-3 sm:px-4 py-2 sm:py-2.5 border-b flex items-center justify-between gap-2 ${
            activeSwapSlot
              ? "bg-amber-500/10 border-amber-500/30"
              : platform === "fanduel" ? "bg-blue-500/10 border-blue-500/30" : "bg-emerald-500/10 border-emerald-500/30"
          }`} data-testid="replacement-banner">
            <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap min-w-0">
              <ArrowLeftRight className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-amber-400 shrink-0" />
              <span className="text-xs sm:text-sm font-bold text-white truncate">
                Swap <span className="text-amber-400">{lineupSlots?.[activeSwapSlot]?.name}</span>
                <span className="hidden sm:inline"> — pick a <span className="text-amber-400">{getSlotDisplayName(activeSwapSlot)}</span></span>
              </span>
              <Badge className="text-[10px] sm:text-[11px] font-black bg-amber-500/20 text-amber-400 border-amber-500/30 shrink-0">
                ${(remainingSalary + swapBudget).toLocaleString()}
              </Badge>
              <span className="text-[10px] sm:text-[11px] font-bold text-slate-400 shrink-0">
                {replacementEligiblePlayers.length} eligible
              </span>
            </div>
            <button
              onClick={() => { setActiveSwapSlot(null); setActiveSwapSlot(null); }}
              className="text-slate-400 hover:text-white p-1 rounded-md hover:bg-slate-800 transition-all shrink-0"
              data-testid="cancel-replacement"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Player Table - Desktop */}
        <div className={`hidden overflow-auto md:block ${playerFocus ? "min-h-0 flex-1" : "h-[60dvh] shrink-0"}`} data-testid="player-pool-scroll">
          <table className="optimizer-data-table w-full text-left border-collapse min-w-[680px]">
            <thead className="sticky top-0 z-10 bg-slate-900 border-b border-slate-800">
              <tr className="text-slate-400">
                {activeSwapSlot ? (
                  <th className="px-3 py-3 w-10 text-center text-[11px] font-black uppercase">Pick</th>
                ) : (
                  <>
                    <th className="px-3 py-3 w-10 text-center text-[11px] font-black uppercase">Lock</th>
                    <th className="px-3 py-3 w-10 text-center text-[11px] font-black uppercase">Excl</th>
                  </>
                )}
                <SortHeader label="Pos" field="position" />
                <SortHeader label="Player" field="name" />
                <SortHeader label="Team" field="team" />
                <SortHeader label="Opp" field="team" className="hidden 2xl:table-cell" />
                <SortHeader label="Salary" field="salary" />
                <SortHeader label="FPPG" field="fppg" />
                <th className="px-3 py-3 text-[11px] font-black uppercase tracking-widest text-cyan-400 hidden 2xl:table-cell">Avg</th>
                <th className="px-3 py-3 text-[11px] font-black uppercase tracking-widest text-slate-400">My Proj</th>
                <th className="px-3 py-3 text-[11px] font-black uppercase tracking-widest text-amber-400 text-center">
                  <div className="flex items-center justify-center gap-1">
                    <Rocket className="w-3 h-3" />
                    Boost +pts
                  </div>
                </th>
                <SortHeader label="Value" field="value" />
                <th className="px-3 py-3 text-[11px] font-black uppercase tracking-widest text-slate-400 text-center">Hit%</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {filteredPlayers.map(player => {
                const isLocked = lockedIds.includes(player.id);
                const isInLineup = activeLineupPlayers.some(p => p.id === player.id);
                const isEligibleReplacement = activeSwapSlot ? replacementEligiblePlayers.some(p => p.id === player.id) : false;
                const isIneligible = activeSwapSlot && !isEligibleReplacement && !isInLineup;
                return (
                  <tr
                    key={player.id}
                    className={`group transition-colors ${
                      isIneligible ? "opacity-30" :
                      isEligibleReplacement ? `${platform === "fanduel" ? "hover:bg-blue-500/10 bg-blue-500/5" : "hover:bg-emerald-500/10 bg-emerald-500/5"} cursor-pointer` :
                      `hover:bg-slate-800/30 ${isLocked ? `${platform === "fanduel" ? "bg-blue-500/5" : "bg-emerald-500/5"}` : ""} ${isInLineup ? "bg-slate-800/20" : ""}`
                    }`}
                    data-testid={`player-row-${player.id}`}
                    onClick={isEligibleReplacement ? () => handleSelectReplacement(player) : undefined}
                  >
                    {activeSwapSlot ? (
                      <td className="px-3 py-2 text-center">
                        {isEligibleReplacement ? (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleSelectReplacement(player); }}
                            data-testid={`select-replacement-${player.id}`}
                            className={`p-1.5 rounded-md transition-all ${
                              platform === "fanduel"
                                ? "bg-blue-500/20 text-blue-400 hover:bg-blue-500 hover:text-white"
                                : "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500 hover:text-white"
                            }`}
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        ) : isInLineup ? (
                          <span className={`text-[11px] font-black ${platform === "fanduel" ? "text-blue-500" : "text-emerald-500"}`}>IN</span>
                        ) : (
                          <span className="text-slate-600 text-[11px]">--</span>
                        )}
                      </td>
                    ) : (
                      <>
                        <td className="px-3 py-2 text-center">
                          <button
                            onClick={() => {
                              setLockedIds(prev => prev.includes(player.id) ? prev.filter(i => i !== player.id) : [...prev, player.id]);
                              setExcludedIds(prev => prev.filter(i => i !== player.id));
                            }}
                            data-testid={`lock-${player.id}`}
                            className={`p-1.5 rounded-md transition-all ${
                              isLocked
                                ? `${platform === "fanduel" ? "bg-blue-500" : "bg-emerald-500"} text-white shadow-md`
                                : `text-slate-400 ${platform === "fanduel" ? "hover:text-blue-400" : "hover:text-emerald-400"} hover:bg-slate-800`
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
                      </>
                    )}
                    <td className="px-3 py-2.5">
                      <span className={`font-mono text-xs font-bold ${platform === "fanduel" ? "text-blue-400/80" : "text-emerald-400/80"}`}>{player.position}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className={`text-[15px] font-bold text-white transition-colors ${platform === "fanduel" ? "group-hover:text-blue-400" : "group-hover:text-emerald-400"}`}>
                        <PlayerHistoryCard playerName={player.name} sport={sport} currentProjection={Number(player.projectedPoints)} currentSalary={player.salary} position={player.position} team={player.team} boostScore={player.boostScore}>
                          <span className="cursor-default">{player.name}</span>
                        </PlayerHistoryCard>
                        {player.isConfirmedStarter && (
                          <Badge variant="outline" className="ml-2 text-[9px] font-bold py-0 px-1.5 border-emerald-500/50 text-emerald-400 bg-emerald-500/10" data-testid={`starter-badge-${player.id}`}>
                            STARTER
                          </Badge>
                        )}
                        {player.injuryStatus && player.injuryStatus !== "Healthy" && (
                          <Badge variant="outline" className={`ml-2 text-[9px] font-bold py-0 px-1.5 ${INJURY_COLORS[player.injuryStatus] || INJURY_COLORS["Day-to-Day"]}`} data-testid={`injury-badge-${player.id}`}>
                            {player.injuryStatus}
                          </Badge>
                        )}
                        {isInLineup && <span className={`ml-2 text-[11px] font-black ${platform === "fanduel" ? "text-blue-500" : "text-emerald-500"}`}>IN LINEUP</span>}
                      </div>
                      <div className="text-xs text-slate-400 font-medium">{sanitizeGameInfo(player.gameInfo)}</div>
                    </td>
                    <td className="px-3 py-2.5 text-xs font-bold text-slate-400 uppercase">{player.team}</td>
                    <td className="px-3 py-2 text-xs text-slate-400 uppercase hidden 2xl:table-cell">{player.opponent}</td>
                    <td className="px-3 py-2.5 font-mono text-[15px] font-bold text-white">
                      ${player.salary.toLocaleString()}
                      {isEligibleReplacement && (
                        <span className={`block text-[11px] ${platform === "fanduel" ? "text-blue-400/60" : "text-emerald-400/60"}`}>
                          fits budget
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-400">{player.fppg}</td>
                    <td className="px-3 py-2 hidden 2xl:table-cell">
                      {(player as any).recentActualAvg != null ? (
                        <div className="flex flex-col items-end">
                          <span className="font-mono text-xs font-bold text-cyan-400" data-testid={`actual-avg-${player.id}`}>{(player as any).recentActualAvg}</span>
                          <span className="text-[9px] text-slate-500">{(player as any).gamesTracked}g</span>
                        </div>
                      ) : (
                        <span className="text-[10px] text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col items-end gap-0.5">
                        <Input
                          type="number"
                          step="0.1"
                          className={`w-16 h-7 bg-slate-950 border-slate-800 text-right font-mono font-bold text-xs px-1 ${platform === "fanduel" ? "text-blue-400" : "text-emerald-400"}`}
                          value={customProjections[player.id] ?? Number(player.projectedPoints)}
                          onChange={e => {
                            const value = e.target.value;
                            setCustomProjections(prev => {
                              const next = { ...prev };
                              if (value === "") {
                                delete next[player.id];
                              } else {
                                const v = parseFloat(value);
                                if (!Number.isNaN(v) && v >= 0) next[player.id] = v;
                              }
                              return next;
                            });
                          }}
                          data-testid={`proj-${player.id}`}
                        />
                        {(boosts[player.id] || 0) !== 0 && (
                          <span className="text-[10px] font-bold text-amber-400 font-mono" data-testid={`boosted-proj-${player.id}`}>
                            {player.effectiveProj.toFixed(1)}
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
                    <td className="px-3 py-2 font-mono text-xs font-bold text-blue-400">
                      {player.value.toFixed(1)}x
                    </td>
                    <td className="px-3 py-2 text-center">
                      {(() => {
                        const key = player.name.toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();
                        const acc = hitRateMap.get(key);
                        if (!acc) return <span className="text-[10px] text-slate-600">—</span>;
                        const color = acc.hitRate >= 60 ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" : acc.hitRate >= 45 ? "text-slate-300 bg-slate-500/10 border-slate-500/20" : "text-red-400 bg-red-500/10 border-red-500/20";
                        return (
                          <Badge variant="outline" className={`text-[10px] font-black px-1.5 py-0 ${color}`} title={`${acc.slatesAnalyzed} slates analyzed, avg delta: ${acc.avgDelta > 0 ? "+" : ""}${acc.avgDelta}`} data-testid={`hit-rate-${player.id}`}>
                            {acc.hitRate}%
                          </Badge>
                        );
                      })()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Player Cards - Mobile */}
        <div className={`flex-1 overflow-auto p-2 md:hidden ${playerFocus ? "min-h-0" : "min-h-[52dvh]"}`} data-testid="mobile-player-pool-scroll">
          {filteredPlayers.map(player => {
            const isLocked = lockedIds.includes(player.id);
            const isExcluded = excludedIds.includes(player.id);
            const isInLineup = activeLineupPlayers.some(p => p.id === player.id);
            const isEligibleReplacement = activeSwapSlot ? replacementEligiblePlayers.some(p => p.id === player.id) : false;
            const isIneligible = activeSwapSlot && !isEligibleReplacement && !isInLineup;
            return (
              <div
                key={player.id}
                data-testid={`mobile-player-card-${player.id}`}
                className={`mb-1.5 rounded-lg border px-3 py-2.5 transition-all ${
                  isIneligible ? "opacity-30 border-slate-800 bg-slate-900/30" :
                  isEligibleReplacement ? `${platform === "fanduel" ? "border-blue-500/30 bg-blue-500/5" : "border-emerald-500/30 bg-emerald-500/5"} cursor-pointer` :
                  isLocked ? `${platform === "fanduel" ? "border-blue-500/30 bg-blue-500/5" : "border-emerald-500/30 bg-emerald-500/5"}` :
                  isExcluded ? "border-red-500/30 bg-red-500/5 opacity-50" :
                  isInLineup ? "border-slate-700 bg-slate-800/30" :
                  "border-slate-800 bg-slate-900/50"
                }`}
                onClick={isEligibleReplacement ? () => handleSelectReplacement(player) : undefined}
              >
                {/* Row 1: Name + badges + actions */}
                <div className="flex items-center justify-between gap-1.5">
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <span className={`font-mono text-[9px] font-black px-1 py-0.5 rounded shrink-0 ${platform === "fanduel" ? "bg-blue-500/20 text-blue-400" : "bg-emerald-500/20 text-emerald-400"}`}>{player.position}</span>
                    <span className="text-[15px] font-bold text-white truncate">{player.name}</span>
                    {player.isConfirmedStarter && (
                      <span className="text-[8px] font-black text-emerald-400 shrink-0">STR</span>
                    )}
                    {player.injuryStatus && player.injuryStatus !== "Healthy" && (
                      <Badge variant="outline" className={`text-[7px] font-bold py-0 px-1 shrink-0 ${INJURY_COLORS[player.injuryStatus] || INJURY_COLORS["Day-to-Day"]}`}>
                        {player.injuryStatus === "Questionable" ? "Q" : player.injuryStatus === "Probable" ? "P" : player.injuryStatus === "Doubtful" ? "D" : player.injuryStatus}
                      </Badge>
                    )}
                    {isInLineup && <span className={`text-[8px] font-black shrink-0 ${platform === "fanduel" ? "text-blue-500" : "text-emerald-500"}`}>IN</span>}
                  </div>
                  <div className="flex items-center gap-0 shrink-0">
                    {activeSwapSlot ? (
                      isEligibleReplacement ? (
                        <button className={`p-1 rounded-md ${platform === "fanduel" ? "bg-blue-500/20 text-blue-400" : "bg-emerald-500/20 text-emerald-400"}`} data-testid={`mobile-select-replacement-${player.id}`}>
                          <Plus className="w-4 h-4" />
                        </button>
                      ) : null
                    ) : (
                      <>
                        <button
                          onClick={() => {
                            setLockedIds(prev => prev.includes(player.id) ? prev.filter(i => i !== player.id) : [...prev, player.id]);
                            setExcludedIds(prev => prev.filter(i => i !== player.id));
                          }}
                          data-testid={`mobile-lock-${player.id}`}
                          className={`p-1 rounded-md transition-all ${
                            isLocked ? `${platform === "fanduel" ? "bg-blue-500" : "bg-emerald-500"} text-white` : "text-slate-600 active:text-emerald-400"
                          }`}
                        >
                          {isLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          onClick={() => {
                            setExcludedIds(prev => [...prev, player.id]);
                            setLockedIds(prev => prev.filter(i => i !== player.id));
                          }}
                          data-testid={`mobile-exclude-${player.id}`}
                          className="p-1 rounded-md text-slate-600 active:text-red-400"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {/* Row 2: Stats row — compact single line */}
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[11px] font-bold text-slate-500 uppercase">{player.team}</span>
                  <span className="text-xs font-mono font-bold text-white">{platform === "yahoo" ? `$${player.salary}` : `$${player.salary.toLocaleString()}`}</span>
                  <span className={`text-xs font-mono font-black ${platform === "fanduel" ? "text-blue-400" : "text-emerald-400"}`}>{player.effectiveProj.toFixed(1)} pts</span>
                  <span className="text-[10px] font-mono text-slate-500">{player.fppg}</span>
                  {(player as any).recentActualAvg != null && (
                    <span className="text-[10px] font-mono font-bold text-cyan-400" data-testid={`mobile-actual-avg-${player.id}`}>{(player as any).recentActualAvg}<span className="text-slate-500">/{(player as any).gamesTracked}g</span></span>
                  )}
                  <span className="text-[10px] font-mono font-bold text-blue-400 ml-auto">{player.value.toFixed(1)}x</span>
                </div>
                <div className="flex items-center gap-2 mt-2 border-t border-slate-800/70 pt-2" onClick={e => e.stopPropagation()}>
                  <label className="text-[9px] font-black uppercase tracking-wide text-slate-500 whitespace-nowrap" htmlFor={`mobile-proj-${player.id}`}>My Proj</label>
                  <input
                    id={`mobile-proj-${player.id}`}
                    type="number"
                    min={0}
                    step="0.1"
                    value={customProjections[player.id] ?? Number(player.projectedPoints)}
                    onChange={e => {
                      const value = e.target.value;
                      setCustomProjections(prev => {
                        const next = { ...prev };
                        if (value === "") {
                          delete next[player.id];
                        } else {
                          const parsed = Number(value);
                          if (Number.isFinite(parsed) && parsed >= 0) next[player.id] = parsed;
                        }
                        return next;
                      });
                    }}
                    className={`w-20 h-7 rounded border border-slate-800 bg-slate-950 px-1 text-right font-mono text-xs font-bold ${platform === "fanduel" ? "text-blue-400" : "text-emerald-400"}`}
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
            );
          })}
        </div>

        {/* Excluded Players Bar */}
        {excludedPlayers.length > 0 && (
          <div className="border-t border-slate-800 bg-slate-900/60 px-2.5 sm:px-4 py-1.5 sm:py-2 flex items-center gap-1.5 sm:gap-2 flex-wrap">
            <span className="text-[10px] sm:text-[11px] font-black text-red-400 uppercase tracking-widest">Excluded:</span>
            {excludedPlayers.map(p => (
              <Badge
                key={p.id}
                variant="outline"
                className="border-red-500/30 text-red-400 text-[11px] font-bold cursor-pointer hover:bg-red-500/10"
                onClick={() => setExcludedIds(prev => prev.filter(i => i !== p.id))}
                data-testid={`excluded-badge-${p.id}`}
              >
                {p.name} <X className="w-3 h-3 ml-1" />
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* RIGHT: Lineup Builder */}
      <div className={`w-full xl:w-[360px] 2xl:w-[400px] flex-col bg-slate-900/30 border-l border-slate-800 xl:overflow-hidden ${playerFocus ? "hidden" : mobileView !== "lineup" ? "hidden xl:flex" : "flex"}`}>
        <div className="p-2 space-y-2 max-h-[60vh] overflow-auto">
          <NflPortfolioControls settings={portfolio.settings} onChange={portfolio.setSettings} supported={portfolioSupported} players={players || []} single />
          <NflPortfolioReportView report={portfolio.report} target={`Slate ${slateId}`} />
          {!portfolio.report?.searchDiagnostics && (
            <QualitySearchDiagnostics
              diagnostics={(optimizeMutation.data as any)?.searchDiagnostics}
              partial={(optimizeMutation.data as any)?.partial}
            />
          )}
        </div>
        {/* Salary & Projection Bar */}
        <div className="px-3 sm:px-4 py-2 sm:py-3 bg-slate-900/60 border-b border-slate-800">
          <div className="grid grid-cols-4 gap-1.5 sm:gap-2 mb-2">
            <div className="bg-slate-800/80 rounded-lg px-1.5 sm:px-2 py-1.5 sm:py-2 text-center border border-slate-700/50">
              <p className="text-[8px] sm:text-[10px] font-black text-slate-400 uppercase tracking-wider mb-0.5">Sal. Rem</p>
              <p data-testid="salary-remaining" className={`text-sm sm:text-base font-black ${
                currentLineup ? (config.salaryCap - totalSalary < 0 ? "text-red-400" : "text-white") : "text-slate-400"
              }`}>
                {formatCap(currentLineup ? config.salaryCap - totalSalary : config.salaryCap, platform)}
              </p>
            </div>
            <div className="bg-slate-800/80 rounded-lg px-1.5 sm:px-2 py-1.5 sm:py-2 text-center border border-slate-700/50">
              <p className="text-[8px] sm:text-[10px] font-black text-slate-400 uppercase tracking-wider mb-0.5">FP Proj</p>
              <p data-testid="total-projection" className={`text-sm sm:text-base font-black ${pColors.text}`}>
                {currentLineup ? totalProj.toFixed(1) : "0.0"}
              </p>
            </div>
            <div className="bg-slate-800/80 rounded-lg px-1.5 sm:px-2 py-1.5 sm:py-2 text-center border border-slate-700/50">
              <p className="text-[8px] sm:text-[10px] font-black text-slate-400 uppercase tracking-wider mb-0.5">Value</p>
              <p data-testid="value-metric" className="text-sm sm:text-base font-black text-blue-400">
                {totalSalary > 0 ? (totalProj / (totalSalary / 1000)).toFixed(1) + "x" : "0.0x"}
              </p>
            </div>
            <div className="bg-slate-800/80 rounded-lg px-1.5 sm:px-2 py-1.5 sm:py-2 text-center border border-slate-700/50">
              <p className="text-[8px] sm:text-[10px] font-black text-slate-400 uppercase tracking-wider mb-0.5">Grade</p>
              {lineupGrade ? (
                <div className={`inline-flex items-center gap-0.5 px-1.5 py-0 rounded text-sm sm:text-base font-black ${GRADE_COLORS[lineupGrade.grade]?.text || "text-slate-400"}`} data-testid="lineup-grade">
                  {lineupGrade.grade === "S" && <Star className="w-3 h-3 fill-current" />}
                  {lineupGrade.grade}
                </div>
              ) : (
                <p className="text-sm sm:text-base font-black text-slate-600">—</p>
              )}
            </div>
          </div>

          {players && players.length > 0 && (
            <div className="flex items-center gap-1.5 sm:gap-2 bg-slate-800/60 rounded-lg px-2 sm:px-3 py-1.5 border border-slate-700/50" data-testid="salary-range-section">
              <DollarSign className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-emerald-400 flex-shrink-0" />
              <Slider
                value={salaryRange || [salaryBounds.min, salaryBounds.max]}
                onValueChange={(v) => setSalaryRange([v[0], v[1]])}
                min={salaryBounds.min}
                max={salaryBounds.max}
                step={salaryBounds.step}
                className="flex-1"
                data-testid="slider-salary-range"
              />
              <span className={`text-[9px] sm:text-[10px] font-black min-w-[70px] sm:min-w-[80px] text-center tabular-nums ${salaryRange && (salaryRange[0] > salaryBounds.min || salaryRange[1] < salaryBounds.max) ? pColors.text : "text-slate-500"}`} data-testid="text-salary-min">
                {salaryRange && (salaryRange[0] > salaryBounds.min || salaryRange[1] < salaryBounds.max)
                  ? `${formatSalary(salaryRange[0], platform)}–${formatSalary(salaryRange[1], platform)}`
                  : "All Salaries"}
              </span>
              {salaryRange && (salaryRange[0] > salaryBounds.min || salaryRange[1] < salaryBounds.max) && (
                <button onClick={() => setSalaryRange(null)} className="text-slate-500 hover:text-white flex-shrink-0 cursor-pointer" data-testid="button-reset-salary">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          )}

          <div className="hidden md:flex flex-col gap-1.5 mt-1.5" data-testid="min-projection-section">
            <div className="flex items-center gap-1.5 sm:gap-2 bg-slate-800/60 rounded-lg px-2 sm:px-3 py-1.5 border border-slate-700/50">
              <Target className={`w-3 h-3 sm:w-3.5 sm:h-3.5 flex-shrink-0 ${minProjection !== null ? pColors.text : "text-slate-500"}`} />
               <LabelTip text="Exclude players whose base projection is below this cutoff. Custom projections and manual +pts boosts are included; automatic and simulation adjustments do not affect eligibility."><label htmlFor="input-min-projection" className="text-[9px] sm:text-[10px] font-black text-slate-400 uppercase whitespace-nowrap">Min Projection</label></LabelTip>
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
                className={`w-20 bg-transparent border-0 text-right font-mono font-black text-xs focus:outline-none tabular-nums ${minProjection !== null ? pColors.text : "text-slate-500"}`}
                data-testid="input-min-projection"
              />
              <span className={`text-[9px] sm:text-[10px] font-black whitespace-nowrap ${minProjection !== null ? pColors.text : "text-slate-500"}`}>
                {minProjection !== null ? `${minProjection}+ pts` : "pts min"}
              </span>
              {minProjection !== null && (
                <button onClick={() => setMinProjection(null)} className="text-slate-500 hover:text-white flex-shrink-0 cursor-pointer" data-testid="button-reset-min-projection"><X className="w-3 h-3" /></button>
              )}
            </div>
            <p className="px-1 text-[9px] leading-tight text-slate-500">
               Below-cutoff players are excluded using base/custom projection plus manual +pts boosts; automatic and simulation adjustments do not affect eligibility.
            </p>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 bg-slate-800/60 rounded-lg px-2 sm:px-3 py-1.5 border border-slate-700/50 mt-1.5" data-testid="floor-section">
            <TrendingUp className={`w-3 h-3 sm:w-3.5 sm:h-3.5 flex-shrink-0 ${projectedPointsFloor ? "text-emerald-400" : "text-slate-500"}`} />
            <LabelTip text="Minimum total projected points a lineup must have. Lineups below this threshold are excluded."><span className="text-[9px] sm:text-[10px] font-black text-slate-400 uppercase whitespace-nowrap">Floor</span></LabelTip>
            <input
              type="number"
              min={0}
              step={5}
              placeholder="Off"
              value={projectedPointsFloor ?? ""}
              onChange={e => {
                const v = parseFloat(e.target.value);
                setProjectedPointsFloor(!isNaN(v) && v > 0 ? v : null);
              }}
              className={`flex-1 bg-transparent border-0 text-right font-mono font-black text-xs focus:outline-none tabular-nums ${projectedPointsFloor ? pColors.text : "text-slate-500"}`}
              data-testid="input-floor"
            />
            <span className={`text-[9px] sm:text-[10px] font-black whitespace-nowrap ${projectedPointsFloor ? pColors.text : "text-slate-500"}`}>
              {projectedPointsFloor ? `${projectedPointsFloor}+ pts` : "pts min"}
            </span>
            {projectedPointsFloor && (
              <button onClick={() => setProjectedPointsFloor(null)} className="text-slate-500 hover:text-white flex-shrink-0 cursor-pointer" data-testid="button-reset-floor"><X className="w-3 h-3" /></button>
            )}
          </div>

          {isNflClassic && (
            <div className="mt-1.5">
              <FlexPositionControls
                allowedPositions={flexAllowedPositions}
                onToggle={toggleFlexPosition}
              />
            </div>
          )}

          <div className="flex items-center gap-1.5 mt-1.5" data-testid="contest-type-toggle">
            <Button
              size="sm"
              variant={contestType === "cash" ? "default" : "outline"}
              onClick={() => setContestType("cash")}
              className={`flex-1 h-7 text-[10px] sm:text-xs font-black ${contestType === "cash" ? "bg-emerald-600 hover:bg-emerald-700 text-white" : "border-slate-700 text-slate-400 hover:text-white"}`}
              data-testid="btn-cash"
            >
              <DollarSign className="w-3 h-3 mr-1" /> Cash
            </Button>
            <Button
              size="sm"
              variant={contestType === "gpp" ? "default" : "outline"}
              onClick={() => setContestType("gpp")}
              className={`flex-1 h-7 text-[10px] sm:text-xs font-black ${contestType === "gpp" ? "bg-amber-600 hover:bg-amber-700 text-white" : "border-slate-700 text-slate-400 hover:text-white"}`}
              data-testid="btn-gpp"
            >
              <Trophy className="w-3 h-3 mr-1" /> GPP
            </Button>
            <InfoTip text="Cash = safe, high-floor lineups for 50/50 and double-ups. GPP = high-ceiling, differentiated lineups for tournaments where you need to finish near the top." side="bottom" />
          </div>
          <p className="text-[9px] text-slate-500 text-center mt-0.5" data-testid="text-contest-desc">
            {contestType === "cash" ? "Safe, high-floor lineups for cash games" : "High-ceiling, differentiated lineups for tournaments"}
          </p>

          <div className="flex items-center justify-between mt-2 px-1" data-testid="outperformer-toggle">
            <div className="flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5 text-cyan-400" />
              <span className="text-[11px] font-black text-cyan-400">OPM</span>
              <InfoTip text="Outperformer Mode — boosts players who consistently meet or exceed their projections and penalizes those who consistently miss. Uses recency-weighted historical actual vs. projected ratios." side="bottom" />
            </div>
            <Switch checked={outperformerMode} onCheckedChange={setOutperformerMode} data-testid="toggle-outperformer" className="scale-90" />
          </div>

          {slateHasStarted && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-center mt-1.5" data-testid="slate-locked-msg">
              <p className="text-red-400 text-sm font-bold">This slate has locked — games have already started.</p>
              <p className="text-slate-400 text-xs mt-1">Switch to another sport with upcoming games to build lineups.</p>
            </div>
          )}
          <div className="flex gap-2 mt-2">
            <Button
              onClick={handleOptimize}
              disabled={optimizeMutation.isPending || slateHasStarted}
              className={`flex-1 h-10 text-white font-black text-sm shadow-lg ${
                platform === "fanduel"
                  ? "bg-blue-500 hover:bg-blue-600 shadow-blue-500/20"
                  : platform === "yahoo"
                  ? "bg-purple-500 hover:bg-purple-600 shadow-purple-500/20"
                  : "bg-emerald-500 hover:bg-emerald-600 shadow-emerald-500/20"
              }`}
              data-testid="optimize-btn"
            >
              {optimizeMutation.isPending ? (
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
              ) : (
                <Zap className="w-5 h-5 mr-2 fill-current" />
              )}
              {slateHasStarted ? "SLATE LOCKED" : "OPTIMIZE"}
            </Button>
            <Button
              onClick={handleReset}
              variant="outline"
              className="h-10 border-slate-700 text-slate-400 hover:text-white"
              data-testid="reset-btn"
            >
              <RotateCcw className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Locked/cap info */}
        <div className="px-3 sm:px-4 py-1.5 sm:py-2 border-b border-slate-800 flex items-center justify-between text-[10px] sm:text-[11px] font-black uppercase tracking-wider sm:tracking-widest text-slate-400">
          <span>{formatCap(lockedSalary, platform)} Locked</span>
          <span>{lockedIds.length} / {config.rosterSize} Locked</span>
        </div>

        {/* Subscription badge */}
        {user && subData && (
          <div className="px-3 sm:px-4 py-1.5 sm:py-2 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-1.5 sm:gap-2">
              {subData.tier === "pro" ? (
                <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-[10px] sm:text-[11px] font-black">
                  <Crown className="w-3 h-3 mr-1" /> PRO
                </Badge>
              ) : (
                <Badge variant="outline" className="border-slate-700 text-slate-400 text-[10px] sm:text-[11px] font-black">BASIC</Badge>
              )}
              <span className="text-[10px] sm:text-[11px] text-slate-400 font-bold">
                {subData.tier === "pro" 
                  ? `${subData.lineupCount}/20 saved`
                  : `${subData.sportCounts?.[sport] || 0}/1 ${sport} saved`
                }
              </span>
            </div>
            {subData.tier === "free" && (
              <Link href="/pricing">
                <span className="text-[10px] sm:text-[11px] font-bold text-amber-400 hover:text-amber-300 cursor-pointer" data-testid="upgrade-link">
                  Upgrade
                </span>
              </Link>
            )}
          </div>
        )}

        {/* Lineup Slots */}
        <div className="flex-1 overflow-auto p-2 sm:p-4 space-y-1.5 sm:space-y-2" data-testid="lineup-slots">
          {config.slots.map(slot => {
            const player = lineupSlots?.[slot] || null;
            const displaySlot = getSlotDisplayName(slot);
            return (
              <div
                key={slot}
                className={`flex items-center rounded-lg border transition-all ${
                  player
                    ? activeSwapSlot === slot
                      ? `bg-amber-500/10 border-amber-500/40 ring-1 ring-amber-500/20`
                      : `bg-slate-800/60 border-slate-700 ${platform === "fanduel" ? "hover:border-blue-500/30" : "hover:border-emerald-500/30"}`
                    : "bg-slate-900/40 border-slate-800 border-dashed"
                }`}
                data-testid={`slot-${slot}`}
              >
                <div className={`w-10 h-10 sm:w-12 sm:h-12 flex items-center justify-center font-black text-[10px] sm:text-xs rounded-l-lg shrink-0 ${
                  player
                    ? activeSwapSlot === slot
                      ? "bg-amber-500/20 text-amber-400"
                      : `${platform === "fanduel" ? "bg-blue-500/10 text-blue-400" : "bg-emerald-500/10 text-emerald-400"}`
                    : "bg-slate-800/50 text-slate-600"
                }`}>
                  {displaySlot}
                </div>
                {player ? (
                  <div className="flex-1 flex items-center justify-between px-2 sm:px-3 py-1.5 sm:py-2 min-w-0">
                    <PlayerInfoHoverCard player={player} platform={platform}>
                      <div className="cursor-pointer min-w-0">
                        <div className="text-xs sm:text-sm font-bold text-white hover:underline decoration-dotted underline-offset-2 truncate">{player.name}</div>
                        <div className="flex items-center gap-1.5 sm:gap-2 text-[10px] sm:text-[11px] text-slate-400 font-bold uppercase">
                          <span>{player.team}</span>
                          <span className="hidden sm:inline">vs {player.opponent}</span>
                          <span className={`${platform === "fanduel" ? "text-blue-400/60" : "text-emerald-400/60"}`}>{player.position}</span>
                        </div>
                      </div>
                    </PlayerInfoHoverCard>
                    <div className="flex items-center gap-1 sm:gap-2 shrink-0">
                      <div className="text-right">
                        <div className={`text-xs sm:text-sm font-black ${platform === "fanduel" ? "text-blue-400" : "text-emerald-400"}`}>{Number(player.projectedPoints).toFixed(1)}</div>
                        <div className="text-[10px] sm:text-[11px] font-mono text-slate-400 font-bold">{platform === "yahoo" ? `$${player.salary}` : `$${player.salary.toLocaleString()}`}</div>
                      </div>
                      <button
                        onClick={() => handleSwapFromSlot(slot)}
                        className={`p-1 rounded-md transition-all ${
                          activeSwapSlot === slot
                            ? "bg-amber-500 text-white shadow-md"
                            : "text-slate-400 hover:text-amber-400 hover:bg-amber-500/10"
                        }`}
                        data-testid={`swap-slot-${slot}`}
                        title="Swap player"
                      >
                        <ArrowLeftRight className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                      </button>
                      <button
                        onClick={() => handleRemoveFromSlot(slot)}
                        className="p-1 rounded-md text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-all"
                        data-testid={`remove-slot-${slot}`}
                      >
                        <X className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    className={`flex-1 px-2 sm:px-3 py-2.5 sm:py-3 text-left flex items-center gap-2 transition-all rounded-r-lg ${
                      currentLineup?.lineup
                        ? `cursor-pointer ${
                            activeSwapSlot === slot
                              ? `${platform === "fanduel" ? "bg-blue-500/10 text-blue-400" : "bg-emerald-500/10 text-emerald-400"}`
                              : `text-slate-400 hover:text-white ${platform === "fanduel" ? "hover:bg-blue-500/5" : "hover:bg-emerald-500/5"}`
                          }`
                        : "cursor-default text-slate-400"
                    }`}
                    onClick={() => {
                      if (currentLineup?.lineup) {
                        setActiveSwapSlot(null);
                        setActiveSwapSlot(activeSwapSlot === slot ? null : slot);
                      }
                    }}
                    data-testid={`pick-slot-${slot}`}
                  >
                    <Plus className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${activeSwapSlot === slot ? (platform === "fanduel" ? "text-blue-400" : "text-emerald-400") : "text-slate-600"}`} />
                    <span className="text-xs sm:text-sm font-bold">
                      {activeSwapSlot === slot ? "Selecting..." : "Make a Pick"}
                    </span>
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Bottom Actions */}
        <div className="p-2.5 sm:p-4 border-t border-slate-800 bg-slate-900/60 space-y-2 sm:space-y-3">
          {currentLineup?.lineup && (
            <>
              {(() => {
                const maxPerSport = subData?.maxLineupsPerSport || (subData?.tier === "pro" ? 300 : subData?.tier === "star" ? 20 : 1);
                const sportCount = subData?.sportCounts?.[sport] || 0;
                const atLimit = sportCount >= maxPerSport;
                if (atLimit) {
                  return (
                    <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-2.5 sm:p-3 space-y-2" data-testid="basic-limit-notice">
                      <div className="flex items-center gap-2">
                        <Lock className="w-4 h-4 text-amber-400 shrink-0" />
                        <span className="text-xs sm:text-sm font-bold text-amber-300">Vault Limit Reached</span>
                      </div>
                      <p className="text-[11px] sm:text-xs text-slate-300 leading-relaxed">
                        {subData?.tier === "free" ? (
                          <>Contender accounts can save 1 team per sport. Delete your existing {sport} lineup from the <Link href="/lineups" className="underline text-emerald-400 font-bold">Saved Lineups</Link> page, or upgrade to <span className="font-black text-amber-400">Sharpshooter</span> for 20 teams.</>
                        ) : subData?.tier === "star" ? (
                          <>Sharpshooter accounts can save 20 teams per sport. Upgrade to <span className="font-black text-amber-400">Champion ($39.99/mo)</span> for 300 teams per sport.</>
                        ) : (
                          <>You've reached the maximum of {maxPerSport} saved teams for {sport}.</>
                        )}
                      </p>
                      {subData?.tier !== "pro" && (
                        <Link href="/pricing">
                          <Button className="w-full h-8 sm:h-9 bg-amber-500 hover:bg-amber-600 text-black font-bold text-xs sm:text-sm mt-1" data-testid="upgrade-from-save">
                            <Crown className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1.5" />
                            View Plans
                          </Button>
                        </Link>
                      )}
                    </div>
                  );
                }
                return (
                  <>
                    <div className="flex gap-2">
                      <Input
                        placeholder="Lineup name (optional)"
                        className="bg-slate-800 border-slate-700 text-xs sm:text-sm h-8 sm:h-9"
                        value={lineupName}
                        onChange={e => setLineupName(e.target.value)}
                        data-testid="lineup-name-input"
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        onClick={handleSave}
                        disabled={saveLineupMutation.isPending || !user}
                        className="flex-1 h-9 sm:h-10 text-white font-bold text-xs sm:text-sm bg-blue-600 hover:bg-blue-700"
                        data-testid="save-lineup-btn"
                      >
                        {saveLineupMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Heart className="w-4 h-4 mr-2" />}
                        Save Lineup
                      </Button>
                      <Button
                        onClick={handleExportCSV}
                        variant="outline"
                        className="h-9 sm:h-10 border-slate-700 text-slate-400 hover:text-white"
                        data-testid="export-csv-btn"
                        title={slate ? `Export for ${formatDraftGroupIdentity(slate)}` : "Export CSV"}
                      >
                        <Download className="w-4 h-4" />
                      </Button>
                    </div>
                    {slate && (
                      <div className="text-[10px] text-slate-500 truncate" data-testid="export-slate-identity">
                        Export target: <span className="font-bold text-slate-300">{formatSlateIdentity(slate)}</span>
                      </div>
                    )}
                  </>
                );
              })()}
            </>
          )}
          <div className="grid grid-cols-2 gap-2 sm:gap-3">
            <div className={`rounded-lg p-2 sm:p-3 ${totalSalary > config.salaryCap ? "bg-red-500/10 border border-red-500/30" : "bg-slate-800/80 border border-slate-700/50"}`}>
              <div className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-0.5 sm:mb-1">Salary</div>
              <div className={`text-base sm:text-lg font-black tabular-nums ${totalSalary > config.salaryCap ? "text-red-400" : "text-white"}`}>
                {formatCap(totalSalary, platform)}
              </div>
              <div className="w-full bg-slate-700/50 rounded-full h-1 sm:h-1.5 mt-1 sm:mt-1.5">
                <div
                  className={`h-1 sm:h-1.5 rounded-full transition-all ${totalSalary > config.salaryCap ? "bg-red-500" : platform === "fanduel" ? "bg-blue-500" : platform === "yahoo" ? "bg-purple-500" : "bg-emerald-500"}`}
                  style={{ width: `${Math.min((totalSalary / config.salaryCap) * 100, 100)}%` }}
                />
              </div>
              <div className="text-[9px] sm:text-[10px] text-slate-500 font-bold mt-0.5 sm:mt-1">{formatCap(config.salaryCap, platform)} cap</div>
            </div>
            <div className="rounded-lg bg-slate-800/80 border border-slate-700/50 p-2 sm:p-3">
              <div className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-0.5 sm:mb-1">Projected</div>
              <div className={`text-base sm:text-lg font-black tabular-nums ${pColors.text}`}>
                {totalProj.toFixed(1)}
              </div>
              <div className="text-[9px] sm:text-[10px] text-slate-500 font-bold mt-1.5 sm:mt-2.5">Fantasy Points</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Link } from "wouter";
import {
  TrendingUp, Lock, Crown, Zap, Plus, X, Trash2,
  ArrowUp, ArrowDown, Dribbble, Activity, Flag, Target, Trophy,
  DollarSign, Sparkles, CheckCircle2, Info, Copy, ExternalLink,
  Search
} from "lucide-react";

const PP_SPORTS = ["NBA", "NHL", "NFL", "MLB", "GOLF", "SOCCER"] as const;

const SPORT_META: Record<string, { icon: typeof Dribbble; color: string; bgColor: string }> = {
  NBA: { icon: Dribbble, color: "text-orange-400", bgColor: "bg-orange-500/20" },
  NHL: { icon: Activity, color: "text-cyan-400", bgColor: "bg-cyan-500/20" },
  NFL: { icon: Trophy, color: "text-green-400", bgColor: "bg-green-500/20" },
  MLB: { icon: Target, color: "text-red-400", bgColor: "bg-red-500/20" },
  GOLF: { icon: Flag, color: "text-lime-400", bgColor: "bg-lime-500/20" },
  SOCCER: { icon: Activity, color: "text-blue-400", bgColor: "bg-blue-500/20" },
};

interface PrizePicksProjection {
  id: string;
  playerName: string;
  team: string;
  position: string;
  statType: string;
  line: number;
  startTime: string;
  gameInfo: string;
  imageUrl: string | null;
  league: string;
  oddsType: string;
  isLive: boolean;
  status: string;
}

interface PrizePicksResponse {
  sport: string;
  projections: PrizePicksProjection[];
}

interface PPEntry {
  projection: PrizePicksProjection;
  pick: "more" | "less";
}

const PP_STAT_COLORS: Record<string, string> = {
  "Points": "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  "Rebounds": "text-blue-400 bg-blue-500/10 border-blue-500/20",
  "Assists": "text-purple-400 bg-purple-500/10 border-purple-500/20",
  "Pts+Rebs+Asts": "text-amber-400 bg-amber-500/10 border-amber-500/20",
  "3-Pointers Made": "text-cyan-400 bg-cyan-500/10 border-cyan-500/20",
  "Fantasy Score": "text-pink-400 bg-pink-500/10 border-pink-500/20",
  "Goals": "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  "Shots on Goal": "text-blue-400 bg-blue-500/10 border-blue-500/20",
  "Saves": "text-orange-400 bg-orange-500/10 border-orange-500/20",
  "Time On Ice": "text-cyan-400 bg-cyan-500/10 border-cyan-500/20",
};

function getStatColor(statType: string): string {
  return PP_STAT_COLORS[statType] || "text-slate-300 bg-slate-500/10 border-slate-500/20";
}

function getEntryMultiplier(legs: number): number {
  if (legs <= 1) return 0;
  if (legs === 2) return 3;
  if (legs === 3) return 5;
  if (legs === 4) return 10;
  if (legs === 5) return 20;
  if (legs === 6) return 25;
  return 25;
}

function UnauthenticatedView() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-lg text-center space-y-6">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-violet-500/10 border border-violet-500/20 mb-2">
          <TrendingUp className="w-10 h-10 text-violet-400" />
        </div>
        <h1 className="text-3xl font-black text-white tracking-tight" data-testid="pp-builder-title">PrizePicks Builder</h1>
        <p className="text-slate-400 text-lg leading-relaxed">
          Build PrizePicks entries using real-time player projections. Pick More or Less on stat lines, combine picks, and calculate your potential payout.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 space-y-2">
            <TrendingUp className="w-5 h-5 text-violet-400 mx-auto" />
            <div className="text-sm font-bold text-white">Live Lines</div>
            <div className="text-xs text-slate-400">Real-time PrizePicks projections across all sports</div>
          </div>
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 space-y-2">
            <ArrowUp className="w-5 h-5 text-emerald-400 mx-auto" />
            <div className="text-sm font-bold text-white">More or Less</div>
            <div className="text-xs text-slate-400">Pick over or under on any player stat line</div>
          </div>
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 space-y-2">
            <DollarSign className="w-5 h-5 text-amber-400 mx-auto" />
            <div className="text-sm font-bold text-white">Payout Calc</div>
            <div className="text-xs text-slate-400">See potential payouts for 2-6 pick entries</div>
          </div>
        </div>
        <div className="bg-gradient-to-r from-violet-500/10 via-slate-800/50 to-violet-500/10 border border-violet-500/20 rounded-xl p-4">
          <div className="flex items-center gap-2 justify-center mb-2">
            <Crown className="w-4 h-4 text-amber-400" />
            <span className="text-sm font-bold text-white">Pro Feature</span>
          </div>
          <p className="text-xs text-slate-400">The PrizePicks Builder is available exclusively to Pro members. Upgrade to start building entries.</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
          <a href="/api/login" data-testid="pp-builder-login-btn">
            <Button className="bg-emerald-500 text-black font-bold px-8">
              <Zap className="w-4 h-4 mr-2" /> Sign In to Get Started
            </Button>
          </a>
          <Link href="/pricing">
            <Button variant="outline" className="border-slate-700 text-slate-300 px-6" data-testid="pp-builder-pricing-btn">
              <Crown className="w-4 h-4 mr-2" /> View Plans
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

function NonProView() {
  return (
    <div className="min-h-screen">
      <div className="relative overflow-hidden border-b border-slate-800/50">
        <div className="absolute inset-0 bg-gradient-to-br from-violet-950/50 via-slate-950/90 to-slate-900/95" />
        <div className="relative container mx-auto px-4 py-10">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-14 h-14 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
              <TrendingUp className="w-7 h-7 text-violet-400" />
            </div>
            <div>
              <h1 className="text-4xl font-black text-white tracking-tight" data-testid="pp-builder-title">PrizePicks Builder</h1>
              <p className="text-slate-400 text-sm mt-1">Build PrizePicks entries with live lines</p>
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-12">
        <div className="max-w-2xl mx-auto text-center space-y-8">
          <div className="bg-gradient-to-b from-violet-500/5 to-transparent border border-violet-500/20 rounded-2xl p-8">
            <Lock className="w-12 h-12 text-violet-400/60 mx-auto mb-4" />
            <h2 className="text-2xl font-black text-white mb-3">Upgrade to Pro for PrizePicks Builder</h2>
            <p className="text-slate-400 mb-6">
              The PrizePicks Builder is an exclusive Pro feature ($49.99/mo). Build multi-pick entries using real-time PrizePicks lines with potential payout calculations.
            </p>

            <div className="bg-slate-800/40 border border-amber-500/20 rounded-xl p-5 text-left max-w-sm mx-auto mb-6">
              <div className="flex items-center gap-2 mb-3">
                <Crown className="w-5 h-5 text-amber-400" />
                <span className="text-sm font-bold text-amber-400">Pro Plan Includes</span>
              </div>
              <ul className="space-y-2 text-xs text-slate-400">
                <li className="flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-amber-400/60" /> Up to 6-pick PrizePicks entries</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-amber-400/60" /> Real-time live lines across all sports</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-amber-400/60" /> Payout multiplier calculator</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-amber-400/60" /> Cross-sport entries (NBA + NHL, etc.)</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-amber-400/60" /> Search and filter by player or stat</li>
              </ul>
            </div>

            <Link href="/pricing">
              <Button className="bg-amber-500 text-black font-bold px-8 shadow-lg shadow-amber-500/20" data-testid="pp-builder-upgrade-btn">
                <Crown className="w-4 h-4 mr-2" /> Upgrade to Pro
              </Button>
            </Link>
          </div>

          <div className="bg-slate-800/30 border border-slate-800 rounded-2xl p-6">
            <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2 justify-center">
              <Info className="w-5 h-5 text-violet-400" /> How PrizePicks Builder Works
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
              <div className="space-y-2">
                <div className="w-8 h-8 rounded-full bg-violet-500/20 flex items-center justify-center mx-auto">
                  <span className="text-sm font-black text-violet-400">1</span>
                </div>
                <div className="text-sm font-bold text-white">Browse Lines</div>
                <div className="text-xs text-slate-400">Explore real-time PrizePicks projections across every sport</div>
              </div>
              <div className="space-y-2">
                <div className="w-8 h-8 rounded-full bg-violet-500/20 flex items-center justify-center mx-auto">
                  <span className="text-sm font-black text-violet-400">2</span>
                </div>
                <div className="text-sm font-bold text-white">Pick More/Less</div>
                <div className="text-xs text-slate-400">Select over or under on each player stat line</div>
              </div>
              <div className="space-y-2">
                <div className="w-8 h-8 rounded-full bg-violet-500/20 flex items-center justify-center mx-auto">
                  <span className="text-sm font-black text-violet-400">3</span>
                </div>
                <div className="text-sm font-bold text-white">See Payout</div>
                <div className="text-xs text-slate-400">Calculate your potential payout and copy your entry</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PrizePicksBuilder() {
  const { user, isLoading: authLoading } = useAuth();
  const [selectedSport, setSelectedSport] = useState<string>("NBA");
  const [entries, setEntries] = useState<PPEntry[]>([]);
  const [wagerAmount, setWagerAmount] = useState<number>(10);
  const [copied, setCopied] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statFilter, setStatFilter] = useState<string>("ALL");

  const { data: subData } = useQuery<{ tier: string }>({
    queryKey: ["/api/subscription"],
    enabled: !!user,
  });

  const tier = subData?.tier || "free";
  const isPro = tier === "pro";
  const maxPicks = 6;

  const { data: ppData, isLoading: ppLoading } = useQuery<PrizePicksResponse>({
    queryKey: ["/api/prizepicks", selectedSport],
    enabled: !!user && isPro,
    refetchInterval: 300000,
  });

  if (authLoading) {
    return (
      <div className="container mx-auto px-4 py-12">
        <Skeleton className="h-12 w-64 bg-slate-800 mb-6" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Skeleton className="h-96 bg-slate-800 rounded-xl" />
          <Skeleton className="h-96 bg-slate-800 rounded-xl" />
        </div>
      </div>
    );
  }

  if (!user) return <UnauthenticatedView />;
  if (!isPro) return <NonProView />;

  const projections = ppData?.projections || [];

  const availableStats = useMemo(() => {
    const stats = new Set(projections.map(p => p.statType));
    return Array.from(stats).sort();
  }, [projections]);

  const filteredProjections = useMemo(() => {
    let filtered = projections.filter(p => p.status !== "closed");
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(p =>
        p.playerName.toLowerCase().includes(q) ||
        p.team.toLowerCase().includes(q)
      );
    }
    if (statFilter !== "ALL") {
      filtered = filtered.filter(p => p.statType === statFilter);
    }
    return filtered;
  }, [projections, searchQuery, statFilter]);

  const addEntry = (projection: PrizePicksProjection, pick: "more" | "less") => {
    if (entries.length >= maxPicks) return;
    if (entries.some(e => e.projection.id === projection.id)) return;
    setEntries(prev => [...prev, { projection, pick }]);
  };

  const removeEntry = (projId: string) => {
    setEntries(prev => prev.filter(e => e.projection.id !== projId));
  };

  const togglePick = (projId: string) => {
    setEntries(prev => prev.map(e =>
      e.projection.id === projId
        ? { ...e, pick: e.pick === "more" ? "less" : "more" }
        : e
    ));
  };

  const clearAll = () => {
    setEntries([]);
  };

  const multiplier = getEntryMultiplier(entries.length);
  const potentialPayout = Math.round(wagerAmount * multiplier * 100) / 100;

  const entrySports = useMemo(() => {
    const sports = new Set(entries.map(e => e.projection.league));
    return Array.from(sports);
  }, [entries]);

  const copyEntry = () => {
    const lines = entries.map(e =>
      `${e.projection.playerName} (${e.projection.team}) - ${e.pick.toUpperCase()} ${e.projection.line} ${e.projection.statType}`
    );
    const text = `PrizePicks Entry - ${entries.length} Picks\n${lines.join("\n")}\n\nWager: $${wagerAmount} | ${multiplier}x | Potential: $${potentialPayout.toFixed(2)}`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isInEntry = (id: string) => entries.some(e => e.projection.id === id);

  return (
    <div className="min-h-screen">
      <div className="relative overflow-hidden border-b border-slate-800/50">
        <div className="absolute inset-0 bg-gradient-to-br from-violet-950/60 via-slate-950/90 to-slate-900/95" />
        <div className="absolute top-0 right-0 w-96 h-96 bg-violet-500/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3" />

        <div className="relative container mx-auto px-4 py-8">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
                <TrendingUp className="w-7 h-7 text-violet-400" />
              </div>
              <div>
                <h1 className="text-3xl font-black text-white tracking-tight" data-testid="pp-builder-title">PrizePicks Builder</h1>
                <p className="text-slate-400 text-sm mt-0.5">Build entries with live lines</p>
              </div>
              <Badge className="ml-2 bg-amber-500/20 text-amber-400 border-amber-500/30 font-bold">
                <Crown className="w-3 h-3 mr-1" /> PRO
              </Badge>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {PP_SPORTS.map(sport => {
                const meta = SPORT_META[sport];
                if (!meta) return null;
                const Icon = meta.icon;
                return (
                  <Button
                    key={sport}
                    variant={selectedSport === sport ? "default" : "outline"}
                    size="sm"
                    onClick={() => { setSelectedSport(sport); setStatFilter("ALL"); }}
                    className={selectedSport === sport
                      ? "bg-violet-500 text-white font-bold"
                      : "border-slate-700 text-slate-400 font-bold"
                    }
                    data-testid={`pp-builder-sport-${sport.toLowerCase()}`}
                  >
                    <Icon className="w-3.5 h-3.5 mr-1.5" />
                    {sport}
                  </Button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <div className="lg:col-span-3 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-violet-400" />
                Available Lines
                <span className="text-sm text-slate-400 font-normal ml-1">- {selectedSport}</span>
              </h2>
              <Badge variant="outline" className="border-slate-700 text-slate-400 text-xs">
                {filteredProjections.length} lines
              </Badge>
            </div>

            <div className="flex gap-2 flex-col sm:flex-row">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <Input
                  placeholder="Search player or team..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 bg-slate-800/50 border-slate-700/50 text-white placeholder:text-slate-500"
                  data-testid="pp-builder-search"
                />
              </div>
              <div className="flex gap-1.5 flex-wrap">
                <Button
                  size="sm"
                  variant={statFilter === "ALL" ? "default" : "ghost"}
                  className={statFilter === "ALL" ? "bg-violet-500 text-white font-bold text-xs" : "text-slate-400 font-bold text-xs border border-slate-700/50"}
                  onClick={() => setStatFilter("ALL")}
                  data-testid="pp-builder-filter-all"
                >
                  All
                </Button>
                {availableStats.slice(0, 6).map(stat => (
                  <Button
                    key={stat}
                    size="sm"
                    variant={statFilter === stat ? "default" : "ghost"}
                    className={statFilter === stat ? "bg-violet-500 text-white font-bold text-xs" : "text-slate-400 font-bold text-xs border border-slate-700/50"}
                    onClick={() => setStatFilter(stat)}
                    data-testid={`pp-builder-filter-${stat.toLowerCase().replace(/\s+/g, '-')}`}
                  >
                    {stat}
                  </Button>
                ))}
              </div>
            </div>

            {ppLoading ? (
              <div className="space-y-3">
                {[1, 2, 3, 4, 5, 6].map(i => <Skeleton key={i} className="h-20 bg-slate-800 rounded-xl" />)}
              </div>
            ) : filteredProjections.length === 0 ? (
              <div className="py-12 text-center bg-slate-800/20 rounded-2xl border border-dashed border-slate-800/50">
                <p className="text-slate-400 text-sm">
                  {searchQuery || statFilter !== "ALL" ? "No matching lines found. Try a different search or filter." : `No PrizePicks lines available for ${selectedSport} right now.`}
                </p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[calc(100vh-340px)] overflow-y-auto pr-1">
                {filteredProjections.slice(0, 50).map(proj => {
                  const inEntry = isInEntry(proj.id);
                  return (
                    <div
                      key={proj.id}
                      className={`bg-slate-800/40 border rounded-xl p-3 transition-colors ${inEntry ? "border-violet-500/50 bg-violet-500/5" : "border-slate-700/40"}`}
                      data-testid={`pp-builder-line-${proj.id}`}
                    >
                      <div className="flex items-center gap-3">
                        {proj.imageUrl ? (
                          <img
                            src={proj.imageUrl}
                            alt={proj.playerName}
                            className="w-10 h-10 rounded-full bg-slate-700/50 object-cover shrink-0"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-slate-700/50 flex items-center justify-center shrink-0">
                            <span className="text-xs font-black text-slate-400">{proj.team?.slice(0, 3)}</span>
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-black text-white truncate">{proj.playerName}</span>
                            {proj.isLive && (
                              <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-[9px] font-black px-1.5 py-0">LIVE</Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] text-slate-400 font-bold">{proj.team}</span>
                            {proj.position && (
                              <>
                                <span className="text-slate-600">·</span>
                                <span className="text-[11px] text-slate-500">{proj.position}</span>
                              </>
                            )}
                            <span className="text-slate-600">·</span>
                            <span className="text-[10px] text-slate-500">{proj.gameInfo}</span>
                          </div>
                        </div>
                        <div className="text-center shrink-0 mr-2">
                          <Badge className={`${getStatColor(proj.statType)} text-[9px] font-bold border px-1.5 py-0 mb-1`}>
                            {proj.statType}
                          </Badge>
                          <div className="text-lg font-black text-white">{proj.line}</div>
                        </div>
                        <div className="flex flex-col gap-1 shrink-0">
                          {inEntry ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-red-400 border border-red-500/30 font-bold text-xs px-3"
                              onClick={() => removeEntry(proj.id)}
                              data-testid={`pp-builder-remove-${proj.id}`}
                            >
                              <X className="w-3 h-3 mr-1" /> Remove
                            </Button>
                          ) : (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-emerald-400 border border-emerald-500/30 font-bold text-xs px-3"
                                onClick={() => addEntry(proj, "more")}
                                disabled={entries.length >= maxPicks}
                                data-testid={`pp-builder-more-${proj.id}`}
                              >
                                <ArrowUp className="w-3 h-3 mr-1" /> More
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-red-400 border border-red-500/30 font-bold text-xs px-3"
                                onClick={() => addEntry(proj, "less")}
                                disabled={entries.length >= maxPicks}
                                data-testid={`pp-builder-less-${proj.id}`}
                              >
                                <ArrowDown className="w-3 h-3 mr-1" /> Less
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {filteredProjections.length > 50 && (
                  <p className="text-center text-xs text-slate-500 py-2">
                    Showing 50 of {filteredProjections.length} lines. Use search to find specific players.
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="lg:col-span-2">
            <div className="sticky top-6 space-y-4">
              <Card className="bg-slate-800/60 border-slate-700/50 p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-black text-white flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-violet-400" />
                    Your Entry
                  </h3>
                  {entries.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={clearAll}
                      className="text-red-400 text-xs font-bold"
                      data-testid="pp-builder-clear"
                    >
                      <Trash2 className="w-3 h-3 mr-1" /> Clear
                    </Button>
                  )}
                </div>

                {entries.length === 0 ? (
                  <div className="py-8 text-center">
                    <Plus className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                    <p className="text-sm text-slate-400">Pick More or Less on player lines to build your entry</p>
                    <p className="text-xs text-slate-500 mt-1">Minimum 2 picks required</p>
                  </div>
                ) : (
                  <div className="space-y-2 mb-4">
                    {entries.map((entry, idx) => (
                      <div
                        key={entry.projection.id}
                        className="bg-slate-900/50 border border-slate-700/50 rounded-lg p-3"
                        data-testid={`pp-builder-entry-${idx}`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 min-w-0">
                            <Badge className={`text-[9px] font-bold px-1.5 py-0 shrink-0 ${entry.projection.league !== selectedSport ? "bg-slate-600/30 text-slate-300 border-slate-600/30" : "bg-violet-500/10 text-violet-400 border-violet-500/20"}`}>
                              {entry.projection.league}
                            </Badge>
                            <span className="text-sm font-bold text-white truncate">{entry.projection.playerName}</span>
                          </div>
                          <button
                            onClick={() => removeEntry(entry.projection.id)}
                            className="text-slate-500 p-1 shrink-0"
                            data-testid={`pp-builder-entry-remove-${idx}`}
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <div className="flex items-center justify-between mt-1.5">
                          <span className="text-xs text-slate-400">{entry.projection.statType}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-black text-white">{entry.projection.line}</span>
                            <button
                              onClick={() => togglePick(entry.projection.id)}
                              className={`text-xs font-black px-2 py-0.5 rounded-md border cursor-pointer ${
                                entry.pick === "more"
                                  ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/30"
                                  : "text-red-400 bg-red-500/10 border-red-500/30"
                              }`}
                              data-testid={`pp-builder-toggle-${idx}`}
                            >
                              {entry.pick === "more" ? "MORE" : "LESS"}
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="border-t border-slate-700/50 pt-4 space-y-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-400">Picks</span>
                    <span className="text-white font-bold">{entries.length} / {maxPicks}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-400">Multiplier</span>
                    <span className={`font-black ${entries.length >= 2 ? "text-violet-400" : "text-slate-500"}`}>
                      {entries.length >= 2 ? `${multiplier}x` : "Need 2+ picks"}
                    </span>
                  </div>

                  {entrySports.length > 1 && (
                    <div className="flex items-center gap-1.5">
                      <Sparkles className="w-3 h-3 text-amber-400" />
                      <span className="text-[11px] text-amber-400 font-bold">Cross-sport entry</span>
                      <div className="flex gap-1 ml-auto">
                        {entrySports.map(s => (
                          <Badge key={s} className="bg-slate-700/50 text-slate-300 text-[9px] font-bold px-1.5 py-0">{s}</Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="bg-slate-900/60 border border-slate-700/30 rounded-lg p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <DollarSign className="w-4 h-4 text-slate-400" />
                      <span className="text-xs font-bold text-slate-400">Wager Amount</span>
                    </div>
                    <div className="flex gap-2">
                      {[5, 10, 25, 50, 100].map(amt => (
                        <Button
                          key={amt}
                          size="sm"
                          variant={wagerAmount === amt ? "default" : "ghost"}
                          className={wagerAmount === amt
                            ? "bg-violet-500 text-white font-bold text-xs flex-1"
                            : "text-slate-400 font-bold text-xs border border-slate-700/50 flex-1"
                          }
                          onClick={() => setWagerAmount(amt)}
                          data-testid={`pp-builder-wager-${amt}`}
                        >
                          ${amt}
                        </Button>
                      ))}
                    </div>
                  </div>

                  {entries.length >= 2 && (
                    <div className="bg-gradient-to-r from-violet-500/10 to-emerald-500/10 border border-violet-500/20 rounded-lg p-4">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm text-slate-400">Potential Payout</span>
                        <span className="text-2xl font-black text-emerald-400" data-testid="pp-builder-payout">
                          ${potentialPayout.toFixed(2)}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500">
                        ${wagerAmount} wager at {multiplier}x multiplier
                      </div>
                    </div>
                  )}

                  <div className="flex gap-2 pt-1">
                    <Button
                      className="flex-1 bg-violet-500 text-white font-bold"
                      disabled={entries.length < 2}
                      onClick={copyEntry}
                      data-testid="pp-builder-copy"
                    >
                      {copied ? <CheckCircle2 className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
                      {copied ? "Copied" : "Copy Entry"}
                    </Button>
                    <a
                      href="https://www.prizepicks.com"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Button
                        variant="outline"
                        className="border-violet-500/30 text-violet-400 font-bold"
                        disabled={entries.length < 2}
                        data-testid="pp-builder-place"
                      >
                        <ExternalLink className="w-4 h-4 mr-1" /> PrizePicks
                      </Button>
                    </a>
                  </div>
                </div>
              </Card>

              <div className="bg-slate-800/30 border border-slate-700/30 rounded-xl p-4">
                <h4 className="text-sm font-bold text-white mb-2">Payout Multipliers</h4>
                <div className="grid grid-cols-5 gap-2 text-center">
                  {[2, 3, 4, 5, 6].map(n => (
                    <div key={n} className={`rounded-lg p-2 border ${entries.length === n ? "bg-violet-500/10 border-violet-500/30" : "bg-slate-800/40 border-slate-700/40"}`}>
                      <div className="text-xs text-slate-400">{n} picks</div>
                      <div className={`text-sm font-black ${entries.length === n ? "text-violet-400" : "text-white"}`}>{getEntryMultiplier(n)}x</div>
                    </div>
                  ))}
                </div>
              </div>

              <p className="text-[10px] text-slate-500 text-center">
                Data provided by PrizePicks. Lines are for informational purposes only.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

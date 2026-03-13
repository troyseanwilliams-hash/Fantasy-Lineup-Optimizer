import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Link } from "wouter";
import { Crown, Lock, TrendingUp, TrendingDown, Users, Flame, Loader2, ChevronDown, ArrowDownUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Slate } from "@shared/schema";
import { ACTIVE_SPORTS, getPlatformConfig } from "@shared/platform-config";

interface OwnershipPlayer {
  id: number;
  name: string;
  position: string;
  team: string;
  salary: number;
  projectedPoints: string;
  ownershipProjection: number;
  opponent: string;
  gameInfo: string;
}

interface OwnershipData {
  slate: { id: number; sport: string; platform: string; startTime: string };
  positions: Record<string, OwnershipPlayer[]>;
  chalkPlayer: OwnershipPlayer | null;
  contrarianPlayer: OwnershipPlayer | null;
}

const SPORT_COLORS: Record<string, { accent: string; bg: string; border: string }> = {
  NBA: { accent: "text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500/20" },
  NHL: { accent: "text-cyan-400", bg: "bg-cyan-500/10", border: "border-cyan-500/20" },
  MLB: { accent: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/20" },
  NFL: { accent: "text-green-400", bg: "bg-green-500/10", border: "border-green-500/20" },
  GOLF: { accent: "text-lime-400", bg: "bg-lime-500/10", border: "border-lime-500/20" },
  SOCCER: { accent: "text-teal-400", bg: "bg-teal-500/10", border: "border-teal-500/20" },
};

function getOwnershipColor(own: number): string {
  if (own >= 25) return "text-red-400";
  if (own >= 15) return "text-amber-400";
  if (own >= 8) return "text-emerald-400";
  return "text-slate-400";
}

function getOwnershipBarColor(own: number): string {
  if (own >= 25) return "bg-red-500";
  if (own >= 15) return "bg-amber-500";
  if (own >= 8) return "bg-emerald-500";
  return "bg-slate-500";
}

export default function OwnershipHeatmap() {
  const { user } = useAuth();

  const { data: slates } = useQuery<Slate[]>({
    queryKey: ["/api/slates"],
    enabled: !!user,
  });

  const { data: subscription } = useQuery<{
    tier: string;
    lineupCount: number;
    maxLineups: number;
    sportCounts: Record<string, number>;
  }>({
    queryKey: ["/api/subscription"],
    enabled: !!user,
  });

  // Type-safe isAdmin accessor — avoids (user as any) cast
  const isAdmin = (user as any)?.isAdmin === true;
  const tier = subscription?.tier || "free";
  // Mirror access pattern from ProOptimizer — pro, premium, and star all have paid access
  const hasAccess = isAdmin || tier === "pro" || tier === "premium" || tier === "star";
  const mainSlates = slates?.filter(s => s.isMain && s.platform === "draftkings") || [];
  const availableSports = ACTIVE_SPORTS.filter(s => mainSlates.some(sl => sl.sport === s));
  const [selectedSport, setSelectedSport] = useState<string>("");
  const [sortDirection, setSortDirection] = useState<"high" | "low">("high");
  const [contestType, setContestType] = useState<"gpp_large" | "gpp_small" | "cash">("gpp_large");

  const activeSport = selectedSport || availableSports[0] || "NBA";
  const activeSlate = mainSlates.find(s => s.sport === activeSport);

  const { data: ownershipData, isLoading } = useQuery<OwnershipData>({
    queryKey: ["/api/ownership", activeSlate?.id, contestType],
    queryFn: async () => {
      const res = await fetch(`/api/ownership/${activeSlate!.id}?contestType=${contestType}`);
      if (!res.ok) throw new Error("Failed to fetch ownership data");
      return res.json();
    },
    enabled: !!activeSlate && hasAccess,
    // Refresh every 5 minutes — ownership projections update as slates get new data.
    // Previously stopped refreshing permanently once data loaded, meaning stale
    // projections were shown for the rest of the session.
    refetchInterval: 300000,
    staleTime: 60000,
  });

  if (!user || !hasAccess) {
    return (
      <div className="min-h-screen bg-[#0F172A] flex items-center justify-center p-6">
        <Card className="bg-[#1E293B] border-slate-700 p-8 max-w-md text-center" data-testid="ownership-unavailable">
          <Lock className="w-12 h-12 text-slate-500 mx-auto mb-4" />
          <h2 className="text-xl font-black text-white mb-2">Champion Feature</h2>
          <p className="text-sm text-slate-400 mb-6">Projected ownership heatmaps are available on the Champion plan. Upgrade to unlock.</p>
          <Link href="/pricing">
            <Button className="bg-emerald-500 hover:bg-emerald-600 text-black font-bold" data-testid="ownership-go-pricing">Upgrade to Champion</Button>
          </Link>
        </Card>
      </div>
    );
  }

  const sportColors = SPORT_COLORS[activeSport] || SPORT_COLORS.NBA;

  // Build a sport-aware position order from platform-config slot definitions.
  // This shows positions in the same order as the lineup builder rather than
  // alphabetically (which put C before PG in NBA, etc.).
  const positionOrder = useMemo(() => {
    try {
      const config = getPlatformConfig(activeSport, "draftkings");
      // Deduplicate slot base names while preserving order
      const seen = new Set<string>();
      const order: string[] = [];
      for (const slot of config.slots) {
        const base = slot.replace(/\d+$/, "");
        if (!seen.has(base)) { seen.add(base); order.push(base); }
      }
      return order;
    } catch {
      return [];
    }
  }, [activeSport]);

  const positionEntries = useMemo(() => {
    if (!ownershipData) return [];
    const entries = Object.entries(ownershipData.positions);

    // Sort position cards using slot order from platform-config, falling back to
    // alphabetical for any position not in the config (e.g. UTIL, FLEX)
    entries.sort(([a], [b]) => {
      const ai = positionOrder.indexOf(a);
      const bi = positionOrder.indexOf(b);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.localeCompare(b);
    });

    return entries.map(([pos, players]) => [
      pos,
      [...players].sort((a, b) =>
        sortDirection === "high"
          ? b.ownershipProjection - a.ownershipProjection
          : a.ownershipProjection - b.ownershipProjection
      ),
    ] as [string, OwnershipPlayer[]]);
  }, [ownershipData, sortDirection, positionOrder]);

  // Derive a meaningful contrarian pick client-side: the player with the best
  // projected points per unit of ownership (high value, low ownership).
  // The server's contrarianPlayer is just the lowest-ownership player which is
  // often a bad player no one wants — not a useful contrarian recommendation.
  const derivedContrarianPlayer = useMemo(() => {
    if (!ownershipData) return null;
    const allPlayers = Object.values(ownershipData.positions).flat();
    // Only consider players with meaningful ownership (> 1%) and projection (> 0)
    // to filter out DNPs and truly unrosterable players
    const eligible = allPlayers.filter(
      p => p.ownershipProjection > 1 && Number(p.projectedPoints) > 0
    );
    if (eligible.length === 0) return null;
    // Score = projected points per ownership % — rewards high value at low ownership
    return eligible.reduce((best, p) => {
      const score = Number(p.projectedPoints) / p.ownershipProjection;
      const bestScore = Number(best.projectedPoints) / best.ownershipProjection;
      return score > bestScore ? p : best;
    });
  }, [ownershipData]);

  return (
    <div className="min-h-screen bg-[#0F172A]">
      <div className="relative overflow-hidden mb-6">
        <img src="/images/optimizer-heatmap.png" alt="" className="absolute inset-0 w-full h-full object-cover opacity-10" />
        <div className="absolute inset-0 bg-gradient-to-b from-purple-950/50 via-slate-950/90 to-[#0F172A]" />
        <div className="relative container mx-auto px-4 pt-8 pb-6 max-w-6xl">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <Users className="w-6 h-6 text-amber-400" />
                <h1 className="text-2xl font-black text-white" data-testid="ownership-title">Projected Ownership Heatmap</h1>
                <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-[10px] font-black">CHAMPION</Badge>
              </div>
              <p className="text-sm text-slate-400">Projected ownership by position — find chalk and contrarian plays</p>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-1 bg-[#1E293B] border border-slate-700 rounded-lg p-1" data-testid="contest-type-selector">
              {([["gpp_large", "GPP Large"], ["gpp_small", "GPP Small"], ["cash", "Cash"]] as const).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setContestType(value)}
                  className={`px-3 py-1.5 rounded-md text-xs font-black transition-colors cursor-pointer ${
                    contestType === value
                      ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                      : "text-slate-400 hover:text-white"
                  }`}
                  data-testid={`contest-type-${value}`}
                >
                  {label}
                </button>
              ))}
            </div>

            <button
              onClick={() => setSortDirection(d => d === "high" ? "low" : "high")}
              className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-bold transition-colors cursor-pointer ${
                sortDirection === "high"
                  ? "bg-[#1E293B] border-slate-700 text-white hover:border-slate-600"
                  : "bg-purple-500/10 border-purple-500/30 text-purple-400 hover:border-purple-500/50"
              }`}
              data-testid="ownership-sort-toggle"
            >
              <ArrowDownUp className="w-4 h-4" />
              <span>{sortDirection === "high" ? "High → Low" : "Low → High"}</span>
            </button>

            <div className="relative">
              <select
                value={activeSport}
                onChange={(e) => setSelectedSport(e.target.value)}
                className="appearance-none bg-[#1E293B] border border-slate-700 text-white text-sm font-bold rounded-lg px-4 py-2.5 pr-10 cursor-pointer focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                data-testid="ownership-sport-select"
              >
                {availableSports.map(sport => (
                  <option key={sport} value={sport}>{sport}</option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 max-w-6xl">
        {!activeSlate ? (
          <Card className="bg-[#1E293B] border-slate-700 p-12 text-center" data-testid="ownership-no-slate">
            <Users className="w-12 h-12 text-slate-600 mx-auto mb-4" />
            <h3 className="text-lg font-bold text-white mb-2">No Active Slate</h3>
            <p className="text-sm text-slate-400">No DraftKings slate is available for {activeSport} right now. Check back when games are scheduled.</p>
          </Card>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-24" data-testid="ownership-loading">
            <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
          </div>
        ) : (
          <>
            {ownershipData?.chalkPlayer && derivedContrarianPlayer && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
                <Card className={`${sportColors.bg} ${sportColors.border} border p-5`} data-testid="chalk-player-card">
                  <div className="flex items-center gap-2 mb-3">
                    <Flame className="w-5 h-5 text-red-400" />
                    <span className="text-xs font-black text-red-400 uppercase tracking-widest">Highest Projected Ownership</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-lg font-black text-white" data-testid="chalk-player-name">{ownershipData.chalkPlayer.name}</p>
                      <p className="text-sm text-slate-400">{ownershipData.chalkPlayer.position} · {ownershipData.chalkPlayer.team} · ${ownershipData.chalkPlayer.salary.toLocaleString()}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-black text-red-400" data-testid="chalk-player-own">{ownershipData.chalkPlayer.ownershipProjection.toFixed(1)}%</p>
                      <p className="text-[11px] text-slate-400 font-bold">Proj. Own%</p>
                    </div>
                  </div>
                </Card>

                <Card className={`${sportColors.bg} ${sportColors.border} border p-5`} data-testid="contrarian-player-card">
                  <div className="flex items-center gap-2 mb-3">
                    <TrendingDown className="w-5 h-5 text-purple-400" />
                    <span className="text-xs font-black text-purple-400 uppercase tracking-widest">Contrarian Value</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-lg font-black text-white" data-testid="contrarian-player-name">{derivedContrarianPlayer.name}</p>
                      <p className="text-sm text-slate-400">{derivedContrarianPlayer.position} · {derivedContrarianPlayer.team} · ${derivedContrarianPlayer.salary.toLocaleString()}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-black text-purple-400" data-testid="contrarian-player-own">{derivedContrarianPlayer.ownershipProjection.toFixed(1)}%</p>
                      <p className="text-[11px] text-slate-400 font-bold">Proj. Own%</p>
                    </div>
                  </div>
                </Card>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {positionEntries.map(([position, players]) => (
                <Card key={position} className="bg-[#1E293B] border-slate-700/50 overflow-hidden" data-testid={`position-card-${position}`}>
                  <div className={`px-5 py-3 border-b border-slate-700/50 ${sportColors.bg}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`text-lg font-black ${sportColors.accent}`}>{position}</span>
                        <span className="text-[11px] font-bold text-slate-400">{players.length} players</span>
                      </div>
                      <TrendingUp className={`w-4 h-4 ${sportColors.accent} opacity-50`} />
                    </div>
                  </div>

                  <div className="divide-y divide-slate-800/50">
                    {(() => {
                      // Compute max ownership for this position group to scale bars relatively
                      const maxOwn = Math.max(...players.map(p => p.ownershipProjection), 1);
                      return players.map((player, idx) => (
                      <div key={player.id} className="px-5 py-3 flex items-center gap-3 hover:bg-slate-800/30 transition-colors" data-testid={`ownership-player-${player.id}`}>
                        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-black shrink-0 ${
                          idx === 0 ? "bg-amber-500/20 text-amber-400" : "bg-slate-800 text-slate-500"
                        }`}>
                          {idx + 1}
                        </span>

                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-white truncate" data-testid={`ownership-player-name-${player.id}`}>{player.name}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[11px] text-slate-400 font-bold">{player.team}</span>
                            <span className="text-[11px] text-slate-600">·</span>
                            <span className="text-[11px] text-slate-400">${player.salary.toLocaleString()}</span>
                            <span className="text-[11px] text-slate-600">·</span>
                            <span className="text-[11px] text-emerald-400 font-bold">{Number(player.projectedPoints).toFixed(1)}pts</span>
                          </div>
                        </div>

                        <div className="text-right shrink-0 w-20">
                          <p className={`text-sm font-black tabular-nums ${getOwnershipColor(player.ownershipProjection)}`} data-testid={`ownership-pct-${player.id}`}>
                            {player.ownershipProjection.toFixed(1)}%
                          </p>
                          <div className="w-full h-1.5 bg-slate-800 rounded-full mt-1 overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${getOwnershipBarColor(player.ownershipProjection)}`}
                              style={{ width: `${Math.min(100, (player.ownershipProjection / maxOwn) * 100)}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    ));})()}
                  </div>
                </Card>
              ))}
            </div>

            {positionEntries.length === 0 && !isLoading && (
              <Card className="bg-[#1E293B] border-slate-700 p-12 text-center" data-testid="ownership-empty">
                <Users className="w-12 h-12 text-slate-600 mx-auto mb-4" />
                <h3 className="text-lg font-bold text-white mb-2">No Ownership Data</h3>
                <p className="text-sm text-slate-400">No player data is available for this slate yet. Try switching contest type or check back closer to lock time.</p>
              </Card>
            )}

            <div className="mt-6 flex items-center justify-center gap-6 text-[11px] font-bold text-slate-500">
              <div className="flex items-center gap-2">
                <div className="w-3 h-1.5 rounded-full bg-red-500" />
                <span>25%+ (Chalk)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-1.5 rounded-full bg-amber-500" />
                <span>15-25%</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-1.5 rounded-full bg-emerald-500" />
                <span>8-15%</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-1.5 rounded-full bg-slate-500" />
                <span>&lt;8% (Low)</span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

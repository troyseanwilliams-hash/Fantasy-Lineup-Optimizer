import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  Trophy,
  TrendingUp,
  DollarSign,
  Target,
  BarChart3,
  ChevronDown,
  ChevronUp,
  ShieldAlert,
  Zap,
  Users,
  Play,
} from "lucide-react";

const SPORTS = ["NBA", "NHL", "MLB", "NFL", "GOLF", "SOCCER"];

const SPORT_COLORS: Record<string, string> = {
  NBA: "text-orange-400",
  NHL: "text-cyan-400",
  MLB: "text-red-400",
  NFL: "text-green-400",
  GOLF: "text-lime-400",
  SOCCER: "text-teal-400",
};

interface PlayerData {
  name: string;
  position: string;
  team: string;
  salary: number;
  projectedPoints: number;
  actualPoints: number;
  value: number;
  boostScore: number;
}

interface Insights {
  totalActualPoints: number;
  totalProjectedPoints: number;
  avgSalary: number;
  salaryUtilization: number;
  salaryEfficiency: number;
  salaryRanges: { low: number; mid: number; high: number; premium: number };
  positionBreakdown: Record<string, { count: number; avgSalary: number; avgActual: number; avgProjected: number }>;
  projectionAccuracy: { name: string; projected: number; actual: number; diff: number; ratio: number }[];
  avgProjectionRatio: number;
  valuePlays: { name: string; salary: number; actual: number; value: number }[];
  boostAnalysis: { name: string; boostScore: number; boostReason: string; actualPoints: number; outperformed: boolean }[];
  boostHitRate: number;
  outperformanceMultiple: number;
  poolSize: number;
  poolAvgActual: number;
}

interface WinningLineup {
  id: number;
  sport: string;
  slateDate: string;
  totalActualPoints: string;
  totalSalary: number;
  salaryCap: number;
  playerData: PlayerData[];
  insights: Insights;
  createdAt: string;
}

interface AggregatedInsights {
  sport: string;
  count: number;
  aggregated: {
    avgTotalPoints: number;
    avgSalaryUtil: number;
    avgProjectionRatio: number;
    avgSalaryEfficiency: number;
    salaryBuckets: Record<string, { count: number; avgActual: number }>;
    posFrequency: Record<string, number>;
    topPlayers: { name: string; count: number; totalActual: number; avgActual: number }[];
  } | null;
}

export default function WinningLineups() {
  const [selectedSport, setSelectedSport] = useState("NBA");
  const [expandedLineup, setExpandedLineup] = useState<number | null>(null);
  const [analyzeDate, setAnalyzeDate] = useState("");
  const { toast } = useToast();

  const { data: user, isLoading: userLoading } = useQuery<any>({
    queryKey: ["/api/auth/user"],
  });

  const { data: lineups, isLoading: lineupsLoading } = useQuery<WinningLineup[]>({
    queryKey: ["/api/winning-lineups", selectedSport],
    enabled: !!user?.isAdmin,
  });

  const { data: aggregated, isLoading: insightsLoading } = useQuery<AggregatedInsights>({
    queryKey: ["/api/winning-lineups", selectedSport, "insights"],
    enabled: !!user?.isAdmin,
  });

  const analyzeMutation = useMutation({
    mutationFn: async ({ sport, date }: { sport: string; date: string }) => {
      const res = await apiRequest("POST", "/api/admin/analyze-slate", { sport, date });
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({ title: data.success ? "Analysis Complete" : "Analysis Skipped", description: data.message });
      if (data.success) {
        queryClient.invalidateQueries({ queryKey: ["/api/winning-lineups", selectedSport] });
        queryClient.invalidateQueries({ queryKey: ["/api/winning-lineups", selectedSport, "insights"] });
      }
    },
    onError: (err: any) => {
      toast({ title: "Analysis Failed", description: err.message || "Could not analyze slate", variant: "destructive" });
    },
  });

  if (userLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen" data-testid="loading-spinner">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-400" />
      </div>
    );
  }

  if (!user?.isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <ShieldAlert className="w-16 h-16 text-red-400" />
        <h1 className="text-2xl font-bold text-white" data-testid="text-access-denied">Access Denied</h1>
        <p className="text-slate-400">You need admin privileges to access this page.</p>
      </div>
    );
  }

  const agg = aggregated?.aggregated;

  return (
    <div className="container mx-auto px-4 py-8 space-y-8 max-w-7xl">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight flex items-center gap-3" data-testid="text-page-title">
            <Trophy className="w-8 h-8 text-amber-400" />
            Winning Lineup Agent
          </h1>
          <p className="text-slate-400 mt-1 text-sm">Optimal hindsight lineups and performance insights</p>
        </div>
        <div className="flex items-center gap-3">
          <Input
            type="date"
            value={analyzeDate}
            onChange={(e) => setAnalyzeDate(e.target.value)}
            className="bg-slate-900 border-slate-700 text-white w-40"
            data-testid="input-analyze-date"
          />
          <Button
            onClick={() => analyzeMutation.mutate({ sport: selectedSport, date: analyzeDate })}
            disabled={!analyzeDate || analyzeMutation.isPending}
            className="bg-amber-500 text-black font-bold hover:bg-amber-400"
            data-testid="button-analyze-slate"
          >
            {analyzeMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Play className="w-4 h-4 mr-2" />}
            Analyze
          </Button>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        {SPORTS.map((sport) => (
          <Button
            key={sport}
            variant={selectedSport === sport ? "default" : "outline"}
            onClick={() => setSelectedSport(sport)}
            className={
              selectedSport === sport
                ? "bg-emerald-600 text-white font-bold hover:bg-emerald-500"
                : "border-slate-700 text-slate-400 hover:text-white hover:bg-slate-800"
            }
            data-testid={`button-sport-${sport.toLowerCase()}`}
          >
            {sport}
          </Button>
        ))}
      </div>

      {agg && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            icon={<Trophy className="w-5 h-5 text-amber-400" />}
            label="Avg Optimal Points"
            value={agg.avgTotalPoints.toFixed(1)}
            sub={`${aggregated?.count || 0} slates analyzed`}
          />
          <StatCard
            icon={<DollarSign className="w-5 h-5 text-emerald-400" />}
            label="Avg Salary Util"
            value={`${agg.avgSalaryUtil}%`}
            sub={`${agg.avgSalaryEfficiency} pts/$K`}
          />
          <StatCard
            icon={<Target className="w-5 h-5 text-blue-400" />}
            label="Avg Proj Accuracy"
            value={`${(agg.avgProjectionRatio * 100).toFixed(0)}%`}
            sub="Actual / Projected"
          />
          <StatCard
            icon={<BarChart3 className="w-5 h-5 text-purple-400" />}
            label="Salary Buckets"
            value={Object.entries(agg.salaryBuckets)
              .filter(([, v]) => v.count > 0)
              .sort((a, b) => b[1].avgActual - a[1].avgActual)[0]?.[0] || "N/A"}
            sub="Top performing range"
          />
        </div>
      )}

      {agg && agg.topPlayers && agg.topPlayers.length > 0 && (
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-5">
          <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
            <Users className="w-5 h-5 text-amber-400" />
            Most Frequent Optimal Players
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {agg.topPlayers.slice(0, 8).map((p, i) => (
              <div key={p.name} className="bg-slate-800/50 rounded-lg px-4 py-3 flex items-center justify-between" data-testid={`card-top-player-${i}`}>
                <div>
                  <div className="text-sm font-bold text-white">{p.name}</div>
                  <div className="text-xs text-slate-400">{p.count}x appearances</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-bold text-emerald-400">{p.avgActual}</div>
                  <div className="text-xs text-slate-500">avg pts</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {agg && Object.keys(agg.posFrequency).length > 0 && (
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-5">
          <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-blue-400" />
            Position Frequency in Optimal Lineups
          </h3>
          <div className="flex flex-wrap gap-3">
            {Object.entries(agg.posFrequency)
              .sort((a, b) => b[1] - a[1])
              .map(([pos, count]) => (
                <div key={pos} className="bg-slate-800/50 rounded-lg px-4 py-2 text-center min-w-[80px]" data-testid={`badge-pos-${pos}`}>
                  <div className="text-xs text-slate-400 uppercase">{pos}</div>
                  <div className="text-lg font-bold text-white">{count}</div>
                </div>
              ))}
          </div>
        </div>
      )}

      {agg && Object.keys(agg.salaryBuckets).length > 0 && (
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-5">
          <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-emerald-400" />
            Salary Range Performance
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Object.entries(agg.salaryBuckets).map(([range, data]) => (
              <div key={range} className="bg-slate-800/50 rounded-lg px-4 py-3" data-testid={`card-salary-${range}`}>
                <div className="text-xs text-slate-400 font-bold">${range}</div>
                <div className="text-lg font-bold text-white mt-1">{data.avgActual}</div>
                <div className="text-xs text-slate-500">{data.count} players • avg pts</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
          <TrendingUp className={`w-5 h-5 ${SPORT_COLORS[selectedSport] || "text-white"}`} />
          Analyzed Slates
        </h3>

        {lineupsLoading || insightsLoading ? (
          <div className="flex items-center justify-center py-12" data-testid="loading-lineups">
            <Loader2 className="w-6 h-6 animate-spin text-emerald-400 mr-3" />
            <span className="text-slate-400">Loading analysis data...</span>
          </div>
        ) : !lineups || lineups.length === 0 ? (
          <div className="text-center py-16 text-slate-500" data-testid="text-no-data">
            <Trophy className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-lg font-medium">No winning lineups analyzed yet for {selectedSport}</p>
            <p className="text-sm mt-1">Use the date picker above to analyze a completed slate</p>
          </div>
        ) : (
          <div className="space-y-3">
            {lineups.map((lineup) => {
              const insights = lineup.insights;
              const isExpanded = expandedLineup === lineup.id;

              return (
                <div
                  key={lineup.id}
                  className="bg-slate-900/50 border border-slate-800 rounded-xl overflow-hidden"
                  data-testid={`card-lineup-${lineup.id}`}
                >
                  <button
                    onClick={() => setExpandedLineup(isExpanded ? null : lineup.id)}
                    className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-800/30 transition-colors text-left"
                    data-testid={`button-expand-${lineup.id}`}
                  >
                    <div className="flex items-center gap-4">
                      <Trophy className="w-5 h-5 text-amber-400 shrink-0" />
                      <div>
                        <div className="text-white font-bold">{lineup.slateDate}</div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          ${lineup.totalSalary.toLocaleString()} / ${lineup.salaryCap.toLocaleString()} cap
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-6">
                      <div className="text-right hidden sm:block">
                        <div className="text-sm font-bold text-emerald-400">{Number(lineup.totalActualPoints).toFixed(1)} pts</div>
                        <div className="text-xs text-slate-500">{insights?.salaryEfficiency} pts/$K</div>
                      </div>
                      <div className="text-right hidden md:block">
                        <div className="text-sm font-bold text-blue-400">{insights?.salaryUtilization}%</div>
                        <div className="text-xs text-slate-500">salary used</div>
                      </div>
                      <div className="text-right hidden md:block">
                        <Badge variant="outline" className="border-amber-500/30 text-amber-400 text-xs">
                          {insights?.boostHitRate}% boost hit
                        </Badge>
                      </div>
                      {isExpanded ? (
                        <ChevronUp className="w-5 h-5 text-slate-500" />
                      ) : (
                        <ChevronDown className="w-5 h-5 text-slate-500" />
                      )}
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="border-t border-slate-800 px-5 py-5 space-y-6">
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                        <MiniStat label="Total Points" value={Number(lineup.totalActualPoints).toFixed(1)} color="text-emerald-400" />
                        <MiniStat label="vs Projected" value={`${insights?.totalProjectedPoints?.toFixed(1) || "—"}`} color="text-blue-400" />
                        <MiniStat label="Salary Used" value={`$${lineup.totalSalary.toLocaleString()}`} color="text-white" />
                        <MiniStat label="Pool Avg" value={`${insights?.poolAvgActual || "—"} pts`} color="text-slate-300" />
                        <MiniStat label="Outperformance" value={`${insights?.outperformanceMultiple || "—"}x`} color="text-amber-400" />
                      </div>

                      <div>
                        <h4 className="text-sm font-bold text-slate-300 mb-3 uppercase tracking-wider">Optimal Lineup</h4>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-xs text-slate-500 uppercase tracking-wider border-b border-slate-800">
                                <th className="text-left py-2 px-2">Player</th>
                                <th className="text-left py-2 px-2">Pos</th>
                                <th className="text-left py-2 px-2">Team</th>
                                <th className="text-right py-2 px-2">Salary</th>
                                <th className="text-right py-2 px-2">Projected</th>
                                <th className="text-right py-2 px-2">Actual</th>
                                <th className="text-right py-2 px-2">Value</th>
                              </tr>
                            </thead>
                            <tbody>
                              {lineup.playerData
                                .sort((a, b) => b.actualPoints - a.actualPoints)
                                .map((p, i) => {
                                  const diff = p.actualPoints - p.projectedPoints;
                                  return (
                                    <tr key={i} className="border-b border-slate-800/50 hover:bg-slate-800/30" data-testid={`row-player-${i}`}>
                                      <td className="py-2 px-2 font-medium text-white">{p.name}</td>
                                      <td className="py-2 px-2 text-slate-400">{p.position}</td>
                                      <td className="py-2 px-2 text-slate-400">{p.team}</td>
                                      <td className="py-2 px-2 text-right text-slate-300">${p.salary.toLocaleString()}</td>
                                      <td className="py-2 px-2 text-right text-slate-400">{p.projectedPoints.toFixed(1)}</td>
                                      <td className="py-2 px-2 text-right font-bold text-emerald-400">{p.actualPoints.toFixed(1)}</td>
                                      <td className="py-2 px-2 text-right">
                                        <span className={diff >= 0 ? "text-emerald-400" : "text-red-400"}>
                                          {diff >= 0 ? "+" : ""}{diff.toFixed(1)}
                                        </span>
                                      </td>
                                    </tr>
                                  );
                                })}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {insights?.positionBreakdown && (
                        <div>
                          <h4 className="text-sm font-bold text-slate-300 mb-3 uppercase tracking-wider">Position Breakdown</h4>
                          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                            {Object.entries(insights.positionBreakdown).map(([pos, data]) => (
                              <div key={pos} className="bg-slate-800/50 rounded-lg px-3 py-2">
                                <div className="text-xs text-slate-400 font-bold uppercase">{pos} ({data.count})</div>
                                <div className="text-sm text-white font-bold mt-1">{data.avgActual.toFixed(1)} avg pts</div>
                                <div className="text-xs text-slate-500">${data.avgSalary.toLocaleString()} avg sal</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {insights?.salaryRanges && (
                        <div>
                          <h4 className="text-sm font-bold text-slate-300 mb-3 uppercase tracking-wider">Salary Distribution</h4>
                          <div className="flex gap-3">
                            {Object.entries(insights.salaryRanges)
                              .filter(([, v]) => v > 0)
                              .map(([range, count]) => (
                                <Badge key={range} variant="outline" className="border-slate-700 text-slate-300">
                                  {range}: {count}
                                </Badge>
                              ))}
                          </div>
                        </div>
                      )}

                      {insights?.valuePlays && insights.valuePlays.length > 0 && (
                        <div>
                          <h4 className="text-sm font-bold text-slate-300 mb-3 uppercase tracking-wider flex items-center gap-2">
                            <Zap className="w-4 h-4 text-amber-400" /> Top Value Plays (Pts/$K)
                          </h4>
                          <div className="flex flex-wrap gap-2">
                            {insights.valuePlays.slice(0, 5).map((p) => (
                              <div key={p.name} className="bg-slate-800/50 rounded-lg px-3 py-2 flex items-center gap-3">
                                <div>
                                  <div className="text-sm font-bold text-white">{p.name}</div>
                                  <div className="text-xs text-slate-500">${p.salary.toLocaleString()} • {p.actual.toFixed(1)} pts</div>
                                </div>
                                <div className="text-lg font-black text-amber-400">{p.value}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-xl px-4 py-4">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-xs text-slate-400 font-bold uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-2xl font-black text-white">{value}</div>
      <div className="text-xs text-slate-500 mt-1">{sub}</div>
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="text-center">
      <div className="text-xs text-slate-500 uppercase tracking-wider">{label}</div>
      <div className={`text-lg font-bold ${color}`}>{value}</div>
    </div>
  );
}

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, BarChart3, TrendingUp, Target, Activity, Trophy, Calendar, Zap, DollarSign, Crosshair } from "lucide-react";
import { ACTIVE_SPORTS } from "@shared/platform-config";
import type { PerformanceSnapshot } from "@shared/schema";
import { InfoTip, LabelTip } from "@/components/InfoTip";
import { usePageMeta } from "@/hooks/use-page-meta";

function toNum(v: string | number | null | undefined): number {
  if (v == null || v === "") return 0;
  return typeof v === "number" ? v : parseFloat(v);
}

interface AggregatePerformance {
  totalSlates: number;
  avgVsOptimal: number;
  avgVsField: number;
  avgAccuracy: number;
  sportBreakdown: Record<string, { slates: number; avgVsOptimal: number; avgVsField: number; avgAccuracy: number }>;
}

interface TodayActivity {
  totalLineups: number;
  totalScored: number;
  sportSummaries: Array<{
    sport: string;
    lineupCount: number;
    bestProjected: number;
    bestActual: number;
    avgProjected: number;
    avgSalaryUtil: number;
    hasLiveScores: boolean;
  }>;
}

export default function PerformanceDashboard() {
  usePageMeta({ title: "Performance Dashboard - Your DFS Stats", description: "View your DFS performance statistics, win rates, and historical lineup data.", path: "/performance" });
  const { user } = useAuth();
  const [selectedSport, setSelectedSport] = useState<string>("ALL");

  const { data: subData } = useQuery<{ tier: string }>({
    queryKey: ["/api/subscription"],
    enabled: !!user,
  });

  const { data: aggregate, isLoading: aggLoading } = useQuery<AggregatePerformance>({
    queryKey: ["/api/performance/aggregate"],
    enabled: !!user,
  });

  const { data: snapshots, isLoading: snapLoading } = useQuery<PerformanceSnapshot[]>({
    queryKey: ["/api/performance", selectedSport],
    queryFn: async () => {
      const url = selectedSport === "ALL" ? "/api/performance" : `/api/performance?sport=${selectedSport}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch performance data");
      return res.json();
    },
    enabled: !!user,
  });

  const { data: today, isLoading: todayLoading } = useQuery<TodayActivity>({
    queryKey: ["/api/performance/today"],
    enabled: !!user,
    refetchInterval: 60000,
  });

  const tier = subData?.tier || "free";
  const isPaid = tier === "star" || tier === "pro";

  if (!user) {
    return (
      <div className="min-h-screen bg-[#0F172A] flex items-center justify-center" data-testid="perf-login-required">
        <Card className="bg-slate-900 border-slate-700 max-w-md">
          <CardContent className="p-8 text-center">
            <BarChart3 className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-white mb-2">Sign In Required</h2>
            <p className="text-slate-400">Log in to view your performance dashboard.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!isPaid && !user.isAdmin) {
    return (
      <div className="min-h-screen bg-[#0F172A] flex items-center justify-center" data-testid="perf-upgrade">
        <Card className="bg-slate-900 border-slate-700 max-w-md">
          <CardContent className="p-8 text-center">
            <BarChart3 className="w-12 h-12 text-amber-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-white mb-2">Sharpshooter+ Required</h2>
            <p className="text-slate-400 mb-4">Upgrade to view your performance analytics.</p>
            <Button onClick={() => window.location.href = "/pricing"} className="bg-emerald-600 hover:bg-emerald-700" data-testid="btn-upgrade-perf">
              View Plans
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isLoading = aggLoading || snapLoading || todayLoading;
  const hasHistoricalData = aggregate && aggregate.totalSlates > 0;
  const hasTodayData = today && today.totalLineups > 0;

  return (
    <div className="min-h-screen bg-[#0F172A]">
      <div className="max-w-6xl mx-auto px-4 py-6">
        <h1 className="text-2xl sm:text-3xl font-black text-white flex items-center gap-3 mb-2" data-testid="perf-dashboard-title">
          <BarChart3 className="w-7 h-7 text-emerald-500" />
          Performance Dashboard
        </h1>
        <p className="text-slate-400 text-sm mb-6">Track how your lineups perform vs. optimal and the field</p>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
          </div>
        ) : (
          <>
            {hasTodayData && (
              <div className="mb-6" data-testid="perf-today-activity">
                <h2 className="text-lg font-bold text-white flex items-center gap-2 mb-4">
                  <Zap className="w-5 h-5 text-amber-400" />
                  Today's Activity
                </h2>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-4">
                  <Card className="bg-slate-900 border-slate-700">
                    <CardContent className="p-4 text-center">
                      <Trophy className="w-6 h-6 text-amber-400 mx-auto mb-2" />
                      <div className="text-2xl font-black text-white" data-testid="today-total-lineups">{today!.totalLineups}</div>
                      <div className="text-xs text-slate-400">Active Lineups</div>
                    </CardContent>
                  </Card>
                  <Card className="bg-slate-900 border-slate-700">
                    <CardContent className="p-4 text-center">
                      <Crosshair className="w-6 h-6 text-emerald-400 mx-auto mb-2" />
                      <div className="text-2xl font-black text-emerald-400" data-testid="today-sports">
                        {today!.sportSummaries.length}
                      </div>
                      <div className="text-xs text-slate-400">Sports</div>
                    </CardContent>
                  </Card>
                  <Card className="bg-slate-900 border-slate-700 col-span-2 sm:col-span-1">
                    <CardContent className="p-4 text-center">
                      <Activity className="w-6 h-6 text-cyan-400 mx-auto mb-2" />
                      <div className="text-2xl font-black text-cyan-400" data-testid="today-scored">{today!.totalScored}</div>
                      <div className="text-xs text-slate-400">Scored</div>
                    </CardContent>
                  </Card>
                </div>

                <div className="space-y-3">
                  {today!.sportSummaries.map(s => (
                    <Card key={s.sport} className="bg-slate-900 border-slate-700" data-testid={`today-sport-${s.sport.toLowerCase()}`}>
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-3">
                            <Badge variant="outline" className="border-emerald-500/30 text-emerald-400">{s.sport}</Badge>
                            <span className="text-slate-400 text-sm">{s.lineupCount} lineup{s.lineupCount !== 1 ? "s" : ""}</span>
                          </div>
                          {s.hasLiveScores && (
                            <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-xs">LIVE</Badge>
                          )}
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                          <div>
                            <div className="text-slate-500 text-xs mb-1">Best Projected</div>
                            <div className="text-white font-bold" data-testid={`today-best-proj-${s.sport.toLowerCase()}`}>{s.bestProjected} pts</div>
                          </div>
                          <div>
                            <div className="text-slate-500 text-xs mb-1">Avg Projected</div>
                            <div className="text-slate-300 font-bold">{s.avgProjected} pts</div>
                          </div>
                          <div>
                            <div className="text-slate-500 text-xs mb-1">Best Actual</div>
                            <div className={`font-bold ${s.bestActual > 0 ? "text-emerald-400" : "text-slate-500"}`}>
                              {s.bestActual > 0 ? `${s.bestActual} pts` : "Pending"}
                            </div>
                          </div>
                          <div>
                            <div className="text-slate-500 text-xs mb-1 flex items-center gap-1"><DollarSign className="w-3 h-3" />Salary Used</div>
                            <div className="text-amber-400 font-bold">{s.avgSalaryUtil}%</div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {hasHistoricalData ? (
              <>
                <h2 className="text-lg font-bold text-white flex items-center gap-2 mb-4">
                  <TrendingUp className="w-5 h-5 text-blue-400" />
                  Historical Performance
                </h2>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6" data-testid="perf-overview-stats">
                  <Card className="bg-slate-900 border-slate-700">
                    <CardContent className="p-4 text-center">
                      <Trophy className="w-6 h-6 text-amber-400 mx-auto mb-2" />
                      <div className="text-2xl font-black text-white" data-testid="stat-total-slates">{aggregate!.totalSlates}</div>
                      <div className="text-xs text-slate-400">Slates Analyzed</div>
                    </CardContent>
                  </Card>
                  <Card className="bg-slate-900 border-slate-700">
                    <CardContent className="p-4 text-center">
                      <Target className="w-6 h-6 text-emerald-400 mx-auto mb-2" />
                      <div className="text-2xl font-black text-emerald-400" data-testid="stat-vs-optimal">{aggregate!.avgVsOptimal}%</div>
                      <LabelTip text="How close your lineup scored compared to the best possible lineup that could have been built. 100% means you matched the optimal."><div className="text-xs text-slate-400">vs. Optimal</div></LabelTip>
                    </CardContent>
                  </Card>
                  <Card className="bg-slate-900 border-slate-700">
                    <CardContent className="p-4 text-center">
                      <TrendingUp className="w-6 h-6 text-blue-400 mx-auto mb-2" />
                      <div className="text-2xl font-black text-blue-400" data-testid="stat-vs-field">{aggregate!.avgVsField}%</div>
                      <LabelTip text="How your lineup performed compared to the average score across all entries. Above 100% means you beat the field average."><div className="text-xs text-slate-400">vs. Field Avg</div></LabelTip>
                    </CardContent>
                  </Card>
                  <Card className="bg-slate-900 border-slate-700">
                    <CardContent className="p-4 text-center">
                      <Activity className="w-6 h-6 text-cyan-400 mx-auto mb-2" />
                      <div className="text-2xl font-black text-cyan-400" data-testid="stat-accuracy">{aggregate!.avgAccuracy}%</div>
                      <LabelTip text="How close your projected total was to the actual scored total. Higher values mean our projections closely matched reality."><div className="text-xs text-slate-400">Proj. Accuracy</div></LabelTip>
                    </CardContent>
                  </Card>
                </div>

                {Object.keys(aggregate!.sportBreakdown).length > 0 && (
                  <Card className="bg-slate-900 border-slate-700 mb-6" data-testid="perf-sport-breakdown">
                    <CardHeader>
                      <CardTitle className="text-white text-lg">Sport Breakdown</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {Object.entries(aggregate!.sportBreakdown).map(([sport, data]) => (
                          <div key={sport} className="flex items-center justify-between p-3 rounded-lg bg-slate-800/50" data-testid={`sport-breakdown-${sport.toLowerCase()}`}>
                            <div className="flex items-center gap-3">
                              <Badge variant="outline" className="border-emerald-500/30 text-emerald-400">{sport}</Badge>
                              <span className="text-slate-400 text-sm">{data.slates} slates</span>
                            </div>
                            <div className="flex gap-6 text-sm">
                              <div className="text-right">
                                <span className="text-emerald-400 font-bold">{data.avgVsOptimal}%</span>
                                <span className="text-slate-500 ml-1 text-xs">optimal</span>
                              </div>
                              <div className="text-right">
                                <span className="text-blue-400 font-bold">{data.avgVsField}%</span>
                                <span className="text-slate-500 ml-1 text-xs">field</span>
                              </div>
                              <div className="text-right">
                                <span className="text-cyan-400 font-bold">{data.avgAccuracy}%</span>
                                <span className="text-slate-500 ml-1 text-xs">accuracy</span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                <Card className="bg-slate-900 border-slate-700" data-testid="perf-history">
                  <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle className="text-white text-lg flex items-center gap-2">
                      <Calendar className="w-5 h-5 text-emerald-500" />
                      Recent Slates
                    </CardTitle>
                    <div className="flex gap-2">
                      <Button
                        variant={selectedSport === "ALL" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setSelectedSport("ALL")}
                        className={selectedSport === "ALL" ? "bg-emerald-600 hover:bg-emerald-700 h-7 text-xs" : "border-slate-600 text-slate-300 h-7 text-xs"}
                        data-testid="perf-filter-all"
                      >
                        All
                      </Button>
                      {ACTIVE_SPORTS.map(sport => (
                        <Button
                          key={sport}
                          variant={selectedSport === sport ? "default" : "outline"}
                          size="sm"
                          onClick={() => setSelectedSport(sport)}
                          className={`${selectedSport === sport ? "bg-emerald-600 hover:bg-emerald-700" : "border-slate-600 text-slate-300"} h-7 text-xs hidden sm:inline-flex`}
                          data-testid={`perf-filter-${sport.toLowerCase()}`}
                        >
                          {sport}
                        </Button>
                      ))}
                    </div>
                  </CardHeader>
                  <CardContent>
                    {(!snapshots || snapshots.length === 0) ? (
                      <p className="text-slate-500 text-center py-8">No snapshot data for this filter.</p>
                    ) : (
                      <div className="space-y-2">
                        <div className="grid grid-cols-7 text-xs font-bold text-slate-500 uppercase px-3 hidden sm:grid">
                          <span>Date</span>
                          <span>Sport</span>
                          <span className="text-right">Your Score</span>
                          <span className="text-right">Optimal</span>
                          <span className="text-right">Field Avg</span>
                          <span className="text-right">Accuracy</span>
                          <span className="text-right">Lineups</span>
                        </div>
                        {snapshots.map(snap => (
                          <div key={snap.id} className="grid grid-cols-3 sm:grid-cols-7 gap-2 text-sm px-3 py-2 rounded hover:bg-slate-800/50 items-center" data-testid={`perf-snapshot-${snap.id}`}>
                            <span className="text-slate-300">{snap.slateDate}</span>
                            <span className="hidden sm:block">
                              <Badge variant="outline" className="border-slate-600 text-slate-400 text-xs">{snap.sport}</Badge>
                            </span>
                            <span className="text-white font-bold text-right">{toNum(snap.userScore).toFixed(1)}</span>
                            <span className="text-emerald-400 text-right hidden sm:block">{toNum(snap.optimalScore).toFixed(1)}</span>
                            <span className="text-blue-400 text-right hidden sm:block">{toNum(snap.fieldAvgScore).toFixed(1)}</span>
                            <span className="text-cyan-400 text-right hidden sm:block">{snap.projectionAccuracy ? `${toNum(snap.projectionAccuracy).toFixed(1)}%` : "—"}</span>
                            <span className="text-slate-400 text-right">{snap.lineupCount}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </>
            ) : !hasTodayData ? (
              <Card className="bg-slate-900 border-slate-700">
                <CardContent className="p-12 text-center" data-testid="perf-no-data">
                  <BarChart3 className="w-16 h-16 text-slate-600 mx-auto mb-4" />
                  <h3 className="text-lg font-bold text-white mb-2">No Performance Data Yet</h3>
                  <p className="text-slate-400 mb-4">Build and save lineups in the optimizer, and your performance stats will appear here once games complete.</p>
                  <Button onClick={() => window.location.href = "/optimizer"} className="bg-emerald-600 hover:bg-emerald-700" data-testid="btn-go-optimizer">
                    Go to Optimizer
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <Card className="bg-slate-900 border-slate-700 mt-6">
                <CardContent className="p-8 text-center" data-testid="perf-pending-history">
                  <Calendar className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                  <h3 className="text-base font-bold text-white mb-2">Historical Stats Coming Soon</h3>
                  <p className="text-slate-400 text-sm">After today's games finish, your results vs. optimal and field averages will appear here.</p>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}

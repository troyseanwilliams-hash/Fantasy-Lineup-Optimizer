import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Activity, TrendingUp, Clock, Trophy, RefreshCw, ChevronDown, ChevronUp } from "lucide-react";
import { ACTIVE_SPORTS } from "@shared/platform-config";
import type { Lineup, LineupScore } from "@shared/schema";
import { InfoTip, LabelTip } from "@/components/InfoTip";

function toNum(v: string | number | null | undefined): number {
  if (v == null || v === "") return 0;
  return typeof v === "number" ? v : parseFloat(v);
}

export default function LiveScoreTracker() {
  const { user } = useAuth();
  const [selectedSport, setSelectedSport] = useState<string>("ALL");
  const [expandedLineup, setExpandedLineup] = useState<number | null>(null);

  const { data: subData } = useQuery<{ tier: string }>({
    queryKey: ["/api/subscription"],
    enabled: !!user,
  });

  const { data: lineups, isLoading: lineupsLoading } = useQuery<Lineup[]>({
    queryKey: ["/api/lineups"],
    enabled: !!user,
  });

  const { data: scores, isLoading: scoresLoading, refetch } = useQuery<LineupScore[]>({
    queryKey: ["/api/lineup-scores"],
    enabled: !!user,
    refetchInterval: 60000,
  });

  const tier = subData?.tier || "free";
  const isPaid = tier === "star" || tier === "pro";

  if (!user) {
    return (
      <div className="min-h-screen bg-[#0F172A] flex items-center justify-center" data-testid="live-scores-login-required">
        <Card className="bg-slate-900 border-slate-700 max-w-md">
          <CardContent className="p-8 text-center">
            <Activity className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-white mb-2">Sign In Required</h2>
            <p className="text-slate-400">Log in to track your lineup scores live.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!isPaid && !user.isAdmin) {
    return (
      <div className="min-h-screen bg-[#0F172A] flex items-center justify-center" data-testid="live-scores-upgrade">
        <Card className="bg-slate-900 border-slate-700 max-w-md">
          <CardContent className="p-8 text-center">
            <Activity className="w-12 h-12 text-amber-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-white mb-2">Sharpshooter+ Required</h2>
            <p className="text-slate-400 mb-4">Upgrade to Sharpshooter or Champion to access live score tracking.</p>
            <Button onClick={() => window.location.href = "/pricing"} className="bg-emerald-600 hover:bg-emerald-700" data-testid="btn-upgrade-live-scores">
              View Plans
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isLoading = lineupsLoading || scoresLoading;
  const activeLineups = (lineups || []).filter(l => l.status === "active" || l.status === "review");
  const filteredLineups = selectedSport === "ALL" ? activeLineups : activeLineups.filter(l => l.sport === selectedSport);

  const scoreMap = new Map<number, LineupScore>();
  for (const s of (scores || [])) {
    scoreMap.set(s.lineupId, s);
  }

  return (
    <div className="min-h-screen bg-[#0F172A]">
      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-black text-white flex items-center gap-3" data-testid="live-scores-title">
              <Activity className="w-7 h-7 text-emerald-500" />
              Live Score Tracker
            </h1>
            <p className="text-slate-400 text-sm mt-1">Track your lineup performance in real-time</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            className="border-slate-600 text-slate-300 hover:bg-slate-800"
            data-testid="btn-refresh-scores"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </div>

        <div className="flex gap-2 mb-6 overflow-x-auto pb-2" data-testid="sport-filter-bar">
          <Button
            variant={selectedSport === "ALL" ? "default" : "outline"}
            size="sm"
            onClick={() => setSelectedSport("ALL")}
            className={selectedSport === "ALL" ? "bg-emerald-600 hover:bg-emerald-700" : "border-slate-600 text-slate-300"}
            data-testid="filter-all"
          >
            All Sports
          </Button>
          {ACTIVE_SPORTS.map(sport => (
            <Button
              key={sport}
              variant={selectedSport === sport ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedSport(sport)}
              className={selectedSport === sport ? "bg-emerald-600 hover:bg-emerald-700" : "border-slate-600 text-slate-300"}
              data-testid={`filter-${sport.toLowerCase()}`}
            >
              {sport}
            </Button>
          ))}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
          </div>
        ) : filteredLineups.length === 0 ? (
          <Card className="bg-slate-900 border-slate-700">
            <CardContent className="p-12 text-center" data-testid="no-lineups-message">
              <Trophy className="w-16 h-16 text-slate-600 mx-auto mb-4" />
              <h3 className="text-lg font-bold text-white mb-2">No Active Lineups</h3>
              <p className="text-slate-400">Save some lineups from the optimizer to start tracking scores.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {filteredLineups.map(lineup => {
              const score = scoreMap.get(lineup.id);
              const isExpanded = expandedLineup === lineup.id;
              const liveTotal = toNum(score?.totalLivePoints);
              const projTotal = toNum(score?.totalProjectedPoints) || toNum(lineup.totalProjection);
              const pctComplete = score?.percentComplete || 0;
              const playerScores = score?.playerScores || [];

              return (
                <Card key={lineup.id} className="bg-slate-900 border-slate-700 overflow-hidden" data-testid={`lineup-score-card-${lineup.id}`}>
                  <div
                    className="p-4 cursor-pointer hover:bg-slate-800/50 transition-colors"
                    onClick={() => setExpandedLineup(isExpanded ? null : lineup.id)}
                    data-testid={`lineup-score-toggle-${lineup.id}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Badge variant="outline" className="border-emerald-500/30 text-emerald-400 text-xs" data-testid={`lineup-sport-badge-${lineup.id}`}>
                          {lineup.sport}
                        </Badge>
                        <span className="text-white font-bold text-sm">
                          {lineup.platform === "draftkings" ? "DraftKings" : "FanDuel"} Lineup
                        </span>
                        <Badge variant="outline" className="border-slate-600 text-slate-400 text-xs">
                          ${toNum(lineup.totalSalary).toLocaleString()}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <div className="text-emerald-400 font-black text-lg" data-testid={`lineup-live-pts-${lineup.id}`}>
                            {liveTotal.toFixed(1)}
                          </div>
                          <div className="text-slate-500 text-xs">
                            / {projTotal.toFixed(1)} proj
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-24 h-2 bg-slate-700 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-emerald-500 rounded-full transition-all"
                              style={{ width: `${Math.min(pctComplete, 100)}%` }}
                            />
                          </div>
                          <LabelTip text="Percentage of games completed for this lineup. 100% means all games have finished and scores are final."><span className="text-slate-400 text-xs w-10 text-right">{pctComplete}%</span></LabelTip>
                        </div>
                        {isExpanded ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
                      </div>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-slate-700 px-4 py-3" data-testid={`lineup-score-details-${lineup.id}`}>
                      {playerScores.length > 0 ? (
                        <div className="space-y-2">
                          <div className="grid grid-cols-6 text-xs font-bold text-slate-500 uppercase px-2">
                            <span>Player</span>
                            <span>Pos</span>
                            <span>Team</span>
                            <span className="text-right">Salary</span>
                            <span className="text-right">Live Pts</span>
                            <span className="text-right">Status</span>
                          </div>
                          {playerScores.map((ps, idx) => (
                            <div key={idx} className="grid grid-cols-6 text-sm px-2 py-1.5 rounded hover:bg-slate-800/50 items-center" data-testid={`player-score-row-${idx}`}>
                              <span className="text-white font-medium truncate">{ps.playerName}</span>
                              <span className="text-slate-400">{ps.position}</span>
                              <span className="text-slate-400">{ps.team}</span>
                              <span className="text-slate-400 text-right">${ps.salary?.toLocaleString()}</span>
                              <span className="text-emerald-400 font-bold text-right">{ps.livePoints?.toFixed(1) || "0.0"}</span>
                              <span className="text-right">
                                <Badge variant="outline" className={`text-[10px] ${
                                  ps.gameStatus === "Final" ? "border-slate-600 text-slate-400" :
                                  ps.gameStatus === "In Progress" ? "border-emerald-500/30 text-emerald-400" :
                                  "border-amber-500/30 text-amber-400"
                                }`}>
                                  {ps.gameStatus || "Upcoming"}
                                </Badge>
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-center py-6 text-slate-500">
                          <Clock className="w-8 h-8 mx-auto mb-2" />
                          <p className="text-sm">Live scoring data will appear once games begin.</p>
                        </div>
                      )}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}

        {scores && scores.length > 0 && (
          <Card className="bg-slate-900 border-slate-700 mt-6" data-testid="scoring-summary">
            <CardHeader>
              <CardTitle className="text-white text-lg flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-emerald-500" />
                Session Summary
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="text-center">
                  <div className="text-2xl font-black text-white" data-testid="stat-total-lineups">{scores.length}</div>
                  <div className="text-xs text-slate-400">Tracked Lineups</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-black text-emerald-400" data-testid="stat-total-pts">
                    {scores.reduce((sum, s) => sum + toNum(s.totalLivePoints), 0).toFixed(1)}
                  </div>
                  <div className="text-xs text-slate-400">Total Live Points</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-black text-amber-400" data-testid="stat-avg-completion">
                    {Math.round(scores.reduce((sum, s) => sum + (s.percentComplete || 0), 0) / scores.length)}%
                  </div>
                  <div className="text-xs text-slate-400">Avg Completion</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-black text-cyan-400" data-testid="stat-best-score">
                    {Math.max(...scores.map(s => toNum(s.totalLivePoints))).toFixed(1)}
                  </div>
                  <div className="text-xs text-slate-400">Best Score</div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

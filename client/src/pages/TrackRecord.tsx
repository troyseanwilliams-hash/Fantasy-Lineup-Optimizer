import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { usePageMeta } from "@/hooks/use-page-meta";
import { Loader2, Award, TrendingUp, Target, BarChart3, Trophy, Layers, Activity } from "lucide-react";

function toNum(v: string | number | null | undefined): number {
  if (v == null || v === "") return 0;
  return typeof v === "number" ? v : parseFloat(v);
}

const TIER_LABELS: Record<string, { label: string; color: string; bgColor: string }> = {
  free: { label: "Contender", color: "text-slate-400", bgColor: "bg-slate-500/20" },
  star: { label: "Sharpshooter", color: "text-blue-400", bgColor: "bg-blue-500/20" },
  pro: { label: "Champion", color: "text-amber-400", bgColor: "bg-amber-500/20" },
};

interface TrackRecordData {
  tier: string;
  totalLineups: number;
  activeLineups: number;
  sportBreakdown: Record<string, number>;
  performance: {
    totalSlates: number;
    avgVsOptimal: number;
    avgVsField: number;
    avgAccuracy: number;
    sportBreakdown: Record<string, { slates: number; avgVsOptimal: number; avgVsField: number; avgAccuracy: number }>;
  };
  recentPerformance: Array<{
    id: number;
    sport: string;
    slateDate: string;
    userScore: string;
    optimalScore: string;
    lineupCount: number;
  }>;
}

export default function TrackRecord() {
  usePageMeta({ title: "Track Record - Optimizer Performance History", description: "View EliteLineup AI's optimizer performance track record. See historical accuracy, win rates, and lineup performance data across all sports.", path: "/track-record" });
  const { user } = useAuth();

  const { data, isLoading } = useQuery<TrackRecordData>({
    queryKey: ["/api/track-record"],
    enabled: !!user,
  });

  if (!user) {
    return (
      <div className="min-h-screen bg-[#0F172A] flex items-center justify-center" data-testid="track-login-required">
        <Card className="bg-slate-900 border-slate-700 max-w-md">
          <CardContent className="p-8 text-center">
            <Award className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-white mb-2">Sign In Required</h2>
            <p className="text-slate-400">Log in to view your track record.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0F172A] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
      </div>
    );
  }

  const tierInfo = TIER_LABELS[data?.tier || "free"] || TIER_LABELS.free;
  const perf = data?.performance;
  const sportLineups = data?.sportBreakdown || {};

  return (
    <div className="min-h-screen bg-[#0F172A]">
      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="flex items-center gap-4 mb-6">
          <h1 className="text-2xl sm:text-3xl font-black text-white flex items-center gap-3" data-testid="track-record-title">
            <Award className="w-7 h-7 text-emerald-500" />
            Track Record
          </h1>
          <Badge className={`${tierInfo.bgColor} ${tierInfo.color} border-0 font-bold`} data-testid="track-tier-badge">
            {tierInfo.label}
          </Badge>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6" data-testid="track-overview">
          <Card className="bg-slate-900 border-slate-700">
            <CardContent className="p-4 text-center">
              <Layers className="w-6 h-6 text-emerald-400 mx-auto mb-2" />
              <div className="text-2xl font-black text-white" data-testid="track-total-lineups">{data?.totalLineups || 0}</div>
              <div className="text-xs text-slate-400">Total Lineups</div>
            </CardContent>
          </Card>
          <Card className="bg-slate-900 border-slate-700">
            <CardContent className="p-4 text-center">
              <Activity className="w-6 h-6 text-blue-400 mx-auto mb-2" />
              <div className="text-2xl font-black text-blue-400" data-testid="track-active-lineups">{data?.activeLineups || 0}</div>
              <div className="text-xs text-slate-400">Active Lineups</div>
            </CardContent>
          </Card>
          <Card className="bg-slate-900 border-slate-700">
            <CardContent className="p-4 text-center">
              <Trophy className="w-6 h-6 text-amber-400 mx-auto mb-2" />
              <div className="text-2xl font-black text-amber-400" data-testid="track-slates-analyzed">{perf?.totalSlates || 0}</div>
              <div className="text-xs text-slate-400">Slates Analyzed</div>
            </CardContent>
          </Card>
          <Card className="bg-slate-900 border-slate-700">
            <CardContent className="p-4 text-center">
              <Target className="w-6 h-6 text-cyan-400 mx-auto mb-2" />
              <div className="text-2xl font-black text-cyan-400" data-testid="track-accuracy">{perf?.avgAccuracy || 0}%</div>
              <div className="text-xs text-slate-400">Proj. Accuracy</div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          <Card className="bg-slate-900 border-slate-700" data-testid="track-sport-lineups">
            <CardHeader>
              <CardTitle className="text-white text-lg flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-emerald-500" />
                Lineups by Sport
              </CardTitle>
            </CardHeader>
            <CardContent>
              {Object.keys(sportLineups).length === 0 ? (
                <p className="text-slate-500 text-center py-6">No lineups saved yet.</p>
              ) : (
                <div className="space-y-3">
                  {Object.entries(sportLineups)
                    .sort(([, a], [, b]) => b - a)
                    .map(([sport, count]) => {
                      const maxCount = Math.max(...Object.values(sportLineups));
                      const pct = maxCount > 0 ? (count / maxCount) * 100 : 0;
                      return (
                        <div key={sport} className="space-y-1" data-testid={`track-sport-${sport.toLowerCase()}`}>
                          <div className="flex justify-between text-sm">
                            <span className="text-white font-bold">{sport}</span>
                            <span className="text-slate-400">{count} lineups</span>
                          </div>
                          <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden">
                            <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </CardContent>
          </Card>

          {perf && perf.totalSlates > 0 && (
            <Card className="bg-slate-900 border-slate-700" data-testid="track-performance-summary">
              <CardHeader>
                <CardTitle className="text-white text-lg flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-emerald-500" />
                  Performance Summary
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-3 rounded-lg bg-slate-800/50">
                    <span className="text-slate-300">Avg vs. Optimal</span>
                    <span className={`font-black text-lg ${perf.avgVsOptimal >= 85 ? "text-emerald-400" : perf.avgVsOptimal >= 70 ? "text-amber-400" : "text-red-400"}`}>
                      {perf.avgVsOptimal}%
                    </span>
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-lg bg-slate-800/50">
                    <span className="text-slate-300">Avg vs. Field</span>
                    <span className={`font-black text-lg ${perf.avgVsField >= 110 ? "text-emerald-400" : perf.avgVsField >= 95 ? "text-amber-400" : "text-red-400"}`}>
                      {perf.avgVsField}%
                    </span>
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-lg bg-slate-800/50">
                    <span className="text-slate-300">Projection Accuracy</span>
                    <span className={`font-black text-lg ${perf.avgAccuracy >= 80 ? "text-emerald-400" : perf.avgAccuracy >= 60 ? "text-amber-400" : "text-red-400"}`}>
                      {perf.avgAccuracy}%
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {data?.recentPerformance && data.recentPerformance.length > 0 && (
          <Card className="bg-slate-900 border-slate-700" data-testid="track-recent-performance">
            <CardHeader>
              <CardTitle className="text-white text-lg">Recent Performance</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="grid grid-cols-5 text-xs font-bold text-slate-500 uppercase px-3 hidden sm:grid">
                  <span>Date</span>
                  <span>Sport</span>
                  <span className="text-right">Your Score</span>
                  <span className="text-right">Optimal</span>
                  <span className="text-right">Lineups</span>
                </div>
                {data.recentPerformance.map((snap) => (
                  <div key={snap.id} className="grid grid-cols-3 sm:grid-cols-5 gap-2 text-sm px-3 py-2 rounded hover:bg-slate-800/50 items-center" data-testid={`track-recent-${snap.id}`}>
                    <span className="text-slate-300">{snap.slateDate}</span>
                    <span className="hidden sm:block">
                      <Badge variant="outline" className="border-slate-600 text-slate-400 text-xs">{snap.sport}</Badge>
                    </span>
                    <span className="text-white font-bold text-right">{toNum(snap.userScore).toFixed(1)}</span>
                    <span className="text-emerald-400 text-right hidden sm:block">{toNum(snap.optimalScore).toFixed(1)}</span>
                    <span className="text-slate-400 text-right">{snap.lineupCount}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

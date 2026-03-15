import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Zap, RefreshCw, TrendingUp, AlertTriangle, ShieldAlert,
  DollarSign, Flame, Clock, Activity, ChevronRight, BarChart3,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const SPORTS = ["NBA", "NFL", "MLB", "NHL", "GOLF"] as const;

const SIGNAL_META: Record<string, { label: string; colorClass: string }> = {
  starter_out: { label: "Starter Out", colorClass: "text-red-400 bg-red-500/10 border-red-500/30" },
  injury_opp: { label: "Injury Opp", colorClass: "text-orange-400 bg-orange-500/10 border-orange-500/30" },
  lineup_promotion: { label: "Usage Bump", colorClass: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30" },
  weather_boost: { label: "Weather", colorClass: "text-cyan-400 bg-cyan-500/10 border-cyan-500/30" },
  matchup_upgrade: { label: "Matchup", colorClass: "text-blue-400 bg-blue-500/10 border-blue-500/30" },
  confirmed_starter: { label: "Confirmed", colorClass: "text-green-400 bg-green-500/10 border-green-500/30" },
  value_spike: { label: "Value Play", colorClass: "text-yellow-400 bg-yellow-500/10 border-yellow-500/30" },
  hot_streak: { label: "Hot Streak", colorClass: "text-amber-400 bg-amber-500/10 border-amber-500/30" },
  negative_news: { label: "Negative", colorClass: "text-slate-400 bg-slate-800 border-slate-700" },
  out: { label: "OUT", colorClass: "text-red-400 bg-red-500/20 border-red-500/40" },
};

const BOOST_WEIGHTS: Record<string, number> = {
  starter_out: 5, injury_opp: 4, lineup_promotion: 3.5, weather_boost: 2,
  matchup_upgrade: 2, confirmed_starter: 1.5, value_spike: 1.5, hot_streak: 1,
  negative_news: -3, out: -99,
};

function fmtTimer(secs: number): string {
  const m = Math.floor(secs / 60), s = secs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function ScoutDashboard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeSport, setActiveSport] = useState<string>("NBA");
  const [filterType, setFilterType] = useState<string>("all");

  const { data: status } = useQuery<any>({
    queryKey: ["/api/scout/status"],
    refetchInterval: 30_000,
  });

  const { data: signalData, isLoading } = useQuery<any>({
    queryKey: ["/api/scout/signals", activeSport],
    queryFn: () => apiRequest("GET", `/api/scout/signals/${activeSport}`).then(r => r.json()),
    refetchInterval: 60_000,
  });

  const refreshMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/scout/refresh", { sport: activeSport }).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Scanning...", description: "AI Scout is scanning the web right now." });
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/scout/signals", activeSport] });
        queryClient.invalidateQueries({ queryKey: ["/api/scout/status"] });
      }, 5000);
    },
  });

  const signals: any[] = signalData?.signals || [];
  const filtered = signals.filter(s => {
    if (filterType === "all") return true;
    if (filterType === "boost") return BOOST_WEIGHTS[s.signal_type] > 0;
    if (filterType === "injury") return ["out", "negative_news", "starter_out"].includes(s.signal_type);
    if (filterType === "value") return s.signal_type === "value_spike";
    return true;
  });

  const boostCount = signals.filter(s => BOOST_WEIGHTS[s.signal_type] > 0).length;
  const injuryCount = signals.filter(s => ["out", "negative_news", "starter_out"].includes(s.signal_type)).length;
  const sportStatus = status?.per_sport?.[activeSport];

  return (
    <div className="min-h-screen bg-slate-950 text-white" data-testid="scout-dashboard">
      <div className="border-b border-slate-800 px-4 sm:px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center">
              <Zap className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-lg font-black text-white tracking-tight">AI Scout</h1>
              <p className="text-[11px] text-slate-400 font-mono">
                Live DFS intelligence — scanning every hour
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {sportStatus && (
              <div className="text-[11px] text-slate-500 flex items-center gap-1.5 font-mono">
                <Clock className="w-3.5 h-3.5" />
                Next scan: {fmtTimer(sportStatus.next_refresh)}
              </div>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => refreshMutation.mutate()}
              disabled={refreshMutation.isPending}
              className="border-slate-700 text-slate-300 hover:text-white h-8 text-xs"
              data-testid="scout-scan-now"
            >
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
              Scan Now
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3" data-testid="stat-total-signals">
            <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Total Signals</div>
            <div className="text-2xl font-black text-white">{signals.length}</div>
            <div className="text-[10px] text-slate-500 mt-0.5">{activeSport} today</div>
          </div>
          <div className="bg-slate-900 border border-emerald-900/40 rounded-xl p-3" data-testid="stat-boosts">
            <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Boost Plays</div>
            <div className="text-2xl font-black text-emerald-400">{boostCount}</div>
            <div className="text-[10px] text-slate-500 mt-0.5">projection bumps</div>
          </div>
          <div className="bg-slate-900 border border-red-900/40 rounded-xl p-3" data-testid="stat-injuries">
            <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Injuries</div>
            <div className="text-2xl font-black text-red-400">{injuryCount}</div>
            <div className="text-[10px] text-slate-500 mt-0.5">active flags</div>
          </div>
          <div className="bg-slate-900 border border-yellow-900/40 rounded-xl p-3" data-testid="stat-value">
            <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Value Plays</div>
            <div className="text-2xl font-black text-yellow-400">
              {signals.filter(s => s.signal_type === "value_spike").length}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">salary discounts</div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          {SPORTS.map(s => {
            const ss = status?.per_sport?.[s];
            return (
              <button
                key={s}
                onClick={() => setActiveSport(s)}
                data-testid={`scout-sport-${s}`}
                className={`px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider transition-all flex items-center gap-1.5 ${
                  activeSport === s
                    ? "bg-emerald-600 text-white"
                    : "bg-slate-800 text-slate-400 hover:text-white border border-slate-700"
                }`}
              >
                {s}
                {ss?.signal_count > 0 && (
                  <span className={`text-[9px] font-black rounded px-1 ${
                    activeSport === s ? "bg-emerald-500/30 text-emerald-100" : "bg-slate-700 text-slate-400"
                  }`}>
                    {ss.signal_count}
                  </span>
                )}
              </button>
            );
          })}

          <div className="ml-auto flex gap-1">
            {[
              { key: "all", label: "All" },
              { key: "boost", label: "Boosts" },
              { key: "injury", label: "Injuries" },
              { key: "value", label: "Value" },
            ].map(f => (
              <button
                key={f.key}
                onClick={() => setFilterType(f.key)}
                data-testid={`scout-dash-filter-${f.key}`}
                className={`px-2.5 py-1 rounded text-[11px] font-black uppercase tracking-wider transition-all ${
                  filterType === f.key ? "bg-slate-700 text-white" : "text-slate-500 hover:text-slate-300"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          {isLoading && (
            <div className="flex items-center justify-center gap-2 py-16 text-slate-500">
              <RefreshCw className="w-5 h-5 animate-spin" />
              <span className="text-sm">Scanning the web...</span>
            </div>
          )}
          {!isLoading && filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Activity className="w-10 h-10 text-slate-700 mb-3" />
              <p className="text-slate-500 text-sm">No signals found for {activeSport}.</p>
              <p className="text-slate-600 text-xs mt-1">Try scanning now or check back in a few minutes.</p>
            </div>
          )}
          {filtered.map((sig, i) => {
            const meta = SIGNAL_META[sig.signal_type] || SIGNAL_META["hot_streak"];
            const boost = BOOST_WEIGHTS[sig.signal_type] || 0;
            return (
              <div
                key={i}
                className="bg-slate-900 border border-slate-800 rounded-xl p-3 sm:p-4 flex items-start gap-3 hover:border-slate-700 transition-colors"
                data-testid={`scout-dash-signal-${i}`}
              >
                <div className={`p-2 rounded-lg border shrink-0 ${meta.colorClass}`}>
                  <Zap className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-black text-white">{sig.player_name}</span>
                    <Badge variant="outline" className={`text-[10px] font-black ${meta.colorClass}`}>
                      {meta.label}
                    </Badge>
                    <Badge variant="outline" className="text-[10px] text-slate-500 border-slate-700">
                      {Math.round(sig.confidence * 100)}% confidence
                    </Badge>
                  </div>
                  <p className="text-sm text-slate-300 mt-1 leading-snug">{sig.reason}</p>
                  {sig.beneficiary_names?.length > 0 && (
                    <p className="text-[12px] text-emerald-400 mt-1 flex items-center gap-1">
                      <TrendingUp className="w-3 h-3" />
                      Beneficiaries: {sig.beneficiary_names.join(", ")}
                    </p>
                  )}
                  {sig.ownership_delta !== 0 && (
                    <p className={`text-[11px] mt-1 ${sig.ownership_delta > 0 ? "text-blue-400" : "text-slate-500"}`}>
                      Ownership: {sig.ownership_delta > 0 ? "+" : ""}{sig.ownership_delta}% projected shift
                    </p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  {boost !== 0 && (
                    <div className={`text-base font-black tabular-nums ${boost > 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {boost > 0 ? "+" : ""}{boost.toFixed(1)}
                    </div>
                  )}
                  <div className="text-[10px] text-slate-600 mt-0.5">pts adj</div>
                </div>
              </div>
            );
          })}
        </div>

        {filtered.length > 0 && (
          <div className="rounded-xl border border-emerald-900/50 bg-emerald-950/30 p-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-black text-white">Ready to build your lineup?</p>
              <p className="text-xs text-slate-400 mt-0.5">These boosts are automatically applied in the optimizer.</p>
            </div>
            <Link href="/">
              <Button className="bg-emerald-600 hover:bg-emerald-500 text-white font-black text-sm h-9 shrink-0" data-testid="scout-open-optimizer">
                Open Optimizer
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

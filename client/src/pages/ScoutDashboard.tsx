import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Zap, RefreshCw, TrendingUp, Clock, Activity, ChevronRight, Lock,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { BOOST_WEIGHTS } from "@/hooks/useScoutBoosts";
import { usePageMeta } from "@/hooks/use-page-meta";

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

const SERVER_INTERVAL_MS = 3_600_000;
const SCAN_SETTLE_MS = 8_000;
const STATUS_POLL_MS = 60_000;

function fmtTimer(secs: number): string {
  const m = Math.floor(secs / 60), s = secs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function ScoutUpgradeGate() {
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4" data-testid="scout-upgrade-gate">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto">
          <Lock className="w-8 h-8 text-emerald-400" />
        </div>
        <div>
          <h1 className="text-2xl font-black text-white mb-2">AI Scout</h1>
          <p className="text-slate-400 text-sm leading-relaxed">
            Live injury intelligence, lineup promotions, and ownership shifts —
            automatically applied to your optimizer projections.
          </p>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-left space-y-3">
          {[
            { icon: "🚨", label: "Starter-out alerts", desc: "Know who's out before lock" },
            { icon: "⚡", label: "Injury beneficiaries", desc: "Auto-targets the right stacks" },
            { icon: "💰", label: "Value spikes", desc: "Salary-down, usage-up plays" },
            { icon: "📈", label: "Lineup promotions", desc: "Usage bumps from beat reporters" },
            { icon: "🎯", label: "Matchup upgrades", desc: "Key defender ruled out signals" },
          ].map(f => (
            <div key={f.label} className="flex items-center gap-3">
              <span className="text-lg">{f.icon}</span>
              <div>
                <p className="text-sm font-bold text-white">{f.label}</p>
                <p className="text-xs text-slate-500">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <Link href="/pricing">
            <Button className="w-full bg-emerald-600 hover:bg-emerald-500 font-black text-white" data-testid="scout-upgrade-btn">
              Upgrade to Sharpshooter or Champion
              <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </Link>
          <Link href="/optimizer">
            <Button variant="ghost" className="w-full text-slate-500 hover:text-slate-300 text-sm" data-testid="scout-back-optimizer">
              Back to Optimizer
            </Button>
          </Link>
        </div>
        <p className="text-[11px] text-slate-600">
          Available on Sharpshooter and Champion plans · Refreshes every hour
        </p>
      </div>
    </div>
  );
}

export default function ScoutDashboard() {
  usePageMeta({ title: "AI Scout - Player Signal Dashboard", description: "AI-powered player signals detecting value spikes, injury impacts, and hot streaks.", path: "/scout" });
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [activeSport, setActiveSport] = useState<string>("NBA");
  const [filterType, setFilterType] = useState<string>("all");
  const [secondsUntilRefresh, setSecondsUntilRefresh] = useState(SERVER_INTERVAL_MS / 1000);
  const nearRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: subscription } = useQuery<{ tier: string }>({
    queryKey: ["/api/subscription"],
    enabled: !!user,
  });
  const isAdmin = (user as any)?.isAdmin === true;
  const tier = subscription?.tier || "free";
  const entitled = isAdmin || tier === "star" || tier === "pro";

  if (!user || (!entitled && subscription !== undefined)) {
    if (!user || subscription !== undefined) {
      return <ScoutUpgradeGate />;
    }
  }

  const { data: activeSportsData } = useQuery<string[]>({
    queryKey: ["/api/active-sports"],
    enabled: entitled,
  });

  const displaySports = activeSportsData && activeSportsData.length > 0
    ? SPORTS.filter(s => activeSportsData.includes(s))
    : SPORTS;

  useEffect(() => {
    if (displaySports.length > 0 && !displaySports.includes(activeSport as any)) {
      setActiveSport(displaySports[0]);
    }
  }, [displaySports.join(",")]);

  const { data: status } = useQuery<any>({
    queryKey: ["/api/scout/status"],
    enabled: entitled,
    refetchInterval: STATUS_POLL_MS,
    refetchOnWindowFocus: false,
  });

  const { data: signalData, isLoading } = useQuery<any>({
    queryKey: ["/api/scout/signals", activeSport],
    queryFn: () =>
      apiRequest("GET", `/api/scout/signals/${activeSport}`).then(r => r.json()),
    enabled: entitled,
    staleTime: SERVER_INTERVAL_MS,
    refetchInterval: SERVER_INTERVAL_MS,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    const secs = signalData?.seconds_until_refresh;
    if (secs === undefined) return;
    setSecondsUntilRefresh(secs);
    if (secs <= 30) {
      if (nearRefreshTimerRef.current) clearTimeout(nearRefreshTimerRef.current);
      nearRefreshTimerRef.current = setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/scout/signals", activeSport] });
        queryClient.invalidateQueries({ queryKey: ["/api/scout/status"] });
      }, (secs + 5) * 1000);
    }
    return () => { if (nearRefreshTimerRef.current) clearTimeout(nearRefreshTimerRef.current); };
  }, [signalData?.seconds_until_refresh, activeSport, queryClient]);

  useEffect(() => {
    const t = setInterval(() => setSecondsUntilRefresh(p => Math.max(0, p - 1)), 1000);
    return () => clearInterval(t);
  }, []);

  const refreshMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/scout/refresh", { sport: activeSport }).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Scanning...", description: "AI Scout is scrubbing the web right now." });
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/scout/signals", activeSport] });
        queryClient.invalidateQueries({ queryKey: ["/api/scout/status"] });
        setSecondsUntilRefresh(SERVER_INTERVAL_MS / 1000);
      }, SCAN_SETTLE_MS);
    },
  });

  const signals: any[] = signalData?.signals || [];
  const filtered = signals.filter(s => {
    if (filterType === "all") return true;
    if (filterType === "boost") return (BOOST_WEIGHTS[s.signal_type] ?? 0) > 0;
    if (filterType === "injury") return ["out", "negative_news", "starter_out"].includes(s.signal_type);
    if (filterType === "value") return s.signal_type === "value_spike";
    return true;
  });

  const boostCount = signals.filter(s => (BOOST_WEIGHTS[s.signal_type] ?? 0) > 0).length;
  const injuryCount = signals.filter(s => ["out", "negative_news", "starter_out"].includes(s.signal_type)).length;

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
            <span className={`text-[10px] font-black px-2 py-0.5 rounded border ${
              tier === "pro"
                ? "text-purple-300 bg-purple-500/10 border-purple-500/20"
                : "text-amber-300 bg-amber-500/10 border-amber-500/20"
            }`} data-testid="scout-tier-badge">
              {isAdmin ? "ADMIN" : tier.toUpperCase()}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-[11px] text-slate-500 flex items-center gap-1.5 font-mono">
              <Clock className="w-3.5 h-3.5" />
              Next scan: {fmtTimer(secondsUntilRefresh)}
            </div>
            {isAdmin && (
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
            )}
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
          {displaySports.map(s => {
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
              <span className="text-sm">Fetching signals...</span>
            </div>
          )}
          {!isLoading && filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Activity className="w-10 h-10 text-slate-700 mb-3" />
              <p className="text-slate-500 text-sm">No signals found for {activeSport}.</p>
              <p className="text-slate-600 text-xs mt-1">
                Check back in {fmtTimer(secondsUntilRefresh)}.
              </p>
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
            <Link href="/optimizer">
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

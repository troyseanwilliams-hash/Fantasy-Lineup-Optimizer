import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { Player } from "@shared/schema";
import { Badge } from "@/components/ui/badge";
import {
  Zap, AlertTriangle, TrendingUp, RefreshCw, ChevronDown,
  ChevronUp, Activity, Clock, Flame, ShieldAlert, DollarSign,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ScoutSignal {
  player_name: string;
  signal_type: string;
  reason: string;
  beneficiary_names: string[];
  ownership_delta: number;
  confidence: number;
}

interface ScoutStatus {
  next_refresh: number;
  per_sport: Record<string, {
    signal_count: number;
    boost_count: number;
    injury_count: number;
    next_refresh: number;
  }>;
}

interface ScoutPanelProps {
  sport: string;
  players?: Player[];
  compact?: boolean;
  onBoostApply?: (projections: Record<string, number>) => void;
}

const SIGNAL_META: Record<string, { label: string; color: string; icon: any }> = {
  starter_out: { label: "Starter Out", color: "text-red-400 bg-red-500/10 border-red-500/30", icon: ShieldAlert },
  injury_opp: { label: "Injury Opp", color: "text-orange-400 bg-orange-500/10 border-orange-500/30", icon: AlertTriangle },
  lineup_promotion: { label: "Usage Bump", color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30", icon: TrendingUp },
  weather_boost: { label: "Weather", color: "text-cyan-400 bg-cyan-500/10 border-cyan-500/30", icon: Activity },
  matchup_upgrade: { label: "Matchup", color: "text-blue-400 bg-blue-500/10 border-blue-500/30", icon: TrendingUp },
  confirmed_starter: { label: "Confirmed", color: "text-green-400 bg-green-500/10 border-green-500/30", icon: Activity },
  value_spike: { label: "Value Play", color: "text-yellow-400 bg-yellow-500/10 border-yellow-500/30", icon: DollarSign },
  hot_streak: { label: "Hot Streak", color: "text-amber-400 bg-amber-500/10 border-amber-500/30", icon: Flame },
  negative_news: { label: "Negative", color: "text-slate-400 bg-slate-500/10 border-slate-500/30", icon: AlertTriangle },
  out: { label: "OUT", color: "text-red-400 bg-red-500/20 border-red-500/40", icon: ShieldAlert },
};

const BOOST_WEIGHTS: Record<string, number> = {
  starter_out: 5.0, injury_opp: 4.0, lineup_promotion: 3.5, weather_boost: 2.0,
  matchup_upgrade: 2.0, confirmed_starter: 1.5, value_spike: 1.5, hot_streak: 1.0,
  negative_news: -3.0, out: -99.0,
};

function fmtTimer(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function ScoutPanel({ sport, players, compact = false, onBoostApply }: ScoutPanelProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(!compact);
  const [activeFilter, setActiveFilter] = useState<string>("all");
  const [countdown, setCountdown] = useState(3600);

  const { data: status } = useQuery<ScoutStatus>({
    queryKey: ["/api/scout/status"],
    refetchInterval: 30_000,
  });

  const { data: signalData, isLoading } = useQuery<{ signals: ScoutSignal[]; seconds_until_refresh: number }>({
    queryKey: ["/api/scout/signals", sport],
    queryFn: () => apiRequest("GET", `/api/scout/signals/${sport}`).then(r => r.json()),
    refetchInterval: 60_000,
    enabled: !!sport,
  });

  const signals: ScoutSignal[] = signalData?.signals || [];

  useEffect(() => {
    const sportStatus = status?.per_sport?.[sport];
    if (sportStatus) setCountdown(sportStatus.next_refresh);
  }, [status, sport]);

  useEffect(() => {
    const t = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          queryClient.invalidateQueries({ queryKey: ["/api/scout/signals", sport] });
          queryClient.invalidateQueries({ queryKey: ["/api/scout/status"] });
          return 3600;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [sport, queryClient]);

  const refreshMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/scout/refresh", { sport }).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Scout Scanning", description: "AI is scanning the web for latest news..." });
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/scout/signals", sport] });
        queryClient.invalidateQueries({ queryKey: ["/api/scout/status"] });
      }, 4000);
    },
  });

  const handleApplyBoosts = useCallback(() => {
    if (!players || signals.length === 0 || !onBoostApply) return;

    const nameMap: Record<string, Player> = {};
    players.forEach(p => { nameMap[p.name.toLowerCase()] = p; });

    const projections: Record<string, number> = {};
    signals.forEach(sig => {
      const target = nameMap[sig.player_name.toLowerCase()];
      if (target) {
        const weight = (BOOST_WEIGHTS[sig.signal_type] || 0) * sig.confidence;
        const base = Number(target.projectedPoints) || 0;
        const existing = projections[target.id] ?? base;
        projections[target.id] = Math.max(0, Math.round((existing + weight) * 10) / 10);
      }
      sig.beneficiary_names?.forEach(bname => {
        const bplayer = nameMap[bname.toLowerCase()];
        if (bplayer) {
          const bboost = (BOOST_WEIGHTS["injury_opp"] || 4.0) * sig.confidence;
          const bbase = Number(bplayer.projectedPoints) || 0;
          const bexisting = projections[bplayer.id] ?? bbase;
          projections[bplayer.id] = Math.max(0, Math.round((bexisting + bboost) * 10) / 10);
        }
      });
    });

    onBoostApply(projections);
    toast({
      title: "AI Boosts Applied",
      description: `Adjusted projections for ${Object.keys(projections).length} players based on today's news.`,
    });
  }, [players, signals, onBoostApply, toast]);

  const filteredSignals = signals.filter(s => {
    if (activeFilter === "all") return true;
    if (activeFilter === "boost") return ["injury_opp", "lineup_promotion", "matchup_upgrade", "confirmed_starter", "value_spike", "hot_streak"].includes(s.signal_type);
    if (activeFilter === "injury") return ["out", "negative_news", "starter_out"].includes(s.signal_type);
    if (activeFilter === "value") return s.signal_type === "value_spike";
    return true;
  });

  const boostCount = signals.filter(s => BOOST_WEIGHTS[s.signal_type] > 0).length;
  const injuryCount = signals.filter(s => ["out", "negative_news", "starter_out"].includes(s.signal_type)).length;

  return (
    <div className="border border-slate-700/50 rounded-xl overflow-hidden bg-slate-900/60 mb-3" data-testid="scout-panel">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-slate-800/40 transition-colors"
        data-testid="scout-panel-toggle"
      >
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <Zap className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-xs font-black text-white uppercase tracking-widest">AI Scout</span>
          </div>
          {signals.length > 0 && (
            <div className="flex items-center gap-1.5">
              {boostCount > 0 && (
                <Badge className="text-[10px] font-black bg-emerald-500/20 text-emerald-400 border-emerald-500/30 px-1.5 py-0">
                  +{boostCount} boost{boostCount !== 1 ? "s" : ""}
                </Badge>
              )}
              {injuryCount > 0 && (
                <Badge className="text-[10px] font-black bg-red-500/20 text-red-400 border-red-500/30 px-1.5 py-0">
                  {injuryCount} injury
                </Badge>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 text-[10px] text-slate-500 font-mono">
            <Clock className="w-3 h-3" />
            <span>{fmtTimer(countdown)}</span>
          </div>
          <button
            onClick={e => { e.stopPropagation(); refreshMutation.mutate(); }}
            disabled={refreshMutation.isPending}
            className="p-1 rounded text-slate-500 hover:text-emerald-400 transition-colors"
            title="Force refresh"
            data-testid="scout-refresh-btn"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
          </button>
          {expanded ? <ChevronUp className="w-3.5 h-3.5 text-slate-500" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-500" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-slate-700/50">
          <div className="flex gap-1 px-3 py-2 border-b border-slate-800">
            {[
              { key: "all", label: `All (${signals.length})` },
              { key: "boost", label: `Boost (${boostCount})` },
              { key: "injury", label: `Injury (${injuryCount})` },
              { key: "value", label: "Value" },
            ].map(f => (
              <button
                key={f.key}
                onClick={() => setActiveFilter(f.key)}
                className={`px-2.5 py-1 rounded text-[10px] font-black uppercase tracking-wider transition-all ${
                  activeFilter === f.key
                    ? "bg-emerald-500/20 text-emerald-400"
                    : "text-slate-500 hover:text-slate-300"
                }`}
                data-testid={`scout-filter-${f.key}`}
              >
                {f.label}
              </button>
            ))}
            {onBoostApply && signals.length > 0 && (
              <button
                onClick={handleApplyBoosts}
                className="ml-auto px-2.5 py-1 rounded text-[10px] font-black uppercase tracking-wider bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
                data-testid="scout-apply-boosts"
              >
                Apply Boosts
              </button>
            )}
          </div>

          <div className="max-h-64 overflow-y-auto divide-y divide-slate-800/60">
            {isLoading && (
              <div className="flex items-center justify-center gap-2 py-6 text-slate-500 text-xs">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                Scanning for news...
              </div>
            )}
            {!isLoading && filteredSignals.length === 0 && (
              <div className="py-6 text-center text-xs text-slate-500">
                No signals yet — next scan in {fmtTimer(countdown)}
              </div>
            )}
            {filteredSignals.slice(0, compact ? 6 : 20).map((sig, i) => {
              const meta = SIGNAL_META[sig.signal_type] || SIGNAL_META["hot_streak"];
              const Icon = meta.icon;
              const boost = BOOST_WEIGHTS[sig.signal_type] || 0;
              return (
                <div key={i} className="flex items-start gap-2.5 px-3 py-2.5 hover:bg-slate-800/30 transition-colors" data-testid={`scout-signal-${i}`}>
                  <div className={`mt-0.5 p-1 rounded border ${meta.color} shrink-0`}>
                    <Icon className="w-3 h-3" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs font-black text-white">{sig.player_name}</span>
                      <Badge variant="outline" className={`text-[9px] font-black px-1 py-0 ${meta.color}`}>
                        {meta.label}
                      </Badge>
                      {sig.confidence >= 0.8 && (
                        <Badge variant="outline" className="text-[9px] font-black px-1 py-0 text-slate-400 border-slate-600">
                          {Math.round(sig.confidence * 100)}% conf
                        </Badge>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">{sig.reason}</p>
                    {sig.beneficiary_names?.length > 0 && (
                      <p className="text-[10px] text-emerald-400/70 mt-0.5">
                        ↑ Boost: {sig.beneficiary_names.join(", ")}
                      </p>
                    )}
                  </div>
                  {boost !== 0 && (
                    <div className={`text-xs font-black tabular-nums shrink-0 ${boost > 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {boost > 0 ? "+" : ""}{boost.toFixed(1)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function ScoutStatusBar({ sport }: { sport: string }) {
  const { data: status } = useQuery<ScoutStatus>({
    queryKey: ["/api/scout/status"],
    refetchInterval: 30_000,
  });

  const sportStatus = status?.per_sport?.[sport];
  if (!sportStatus) return null;

  return (
    <div className="flex items-center gap-3 px-3 py-1.5 bg-emerald-950/40 border-b border-emerald-900/30 text-[11px]" data-testid="scout-status-bar">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
      <span className="text-emerald-400 font-black uppercase tracking-wider">AI Scout Live</span>
      <span className="text-slate-400">
        {sportStatus.boost_count} boosts · {sportStatus.injury_count} injuries detected
      </span>
      <span className="ml-auto text-slate-500 font-mono flex items-center gap-1">
        <Clock className="w-3 h-3" />
        Next scan: {fmtTimer(sportStatus.next_refresh)}
      </span>
    </div>
  );
}

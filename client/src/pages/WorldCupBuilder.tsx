import { useState, useMemo, type ReactNode } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import {
  Trophy, Lock, Crown, Zap, X, Trash2, ArrowUp, ArrowDown, Flag,
  DollarSign, Sparkles, CheckCircle2, Info, Copy, Bot, Loader2,
  Save, Clock, Globe, ChevronDown, ChevronUp,
} from "lucide-react";
import { usePageMeta } from "@/hooks/use-page-meta";

// ── Types ──────────────────────────────────────────────────────────────────
interface WCProjection {
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

interface WorldCupResponse {
  league: string;
  projections: WCProjection[];
  hasWorldCup: boolean;
  soccerCount: number;
  lineMovements?: Record<string, unknown>;
}

interface SoccerResponse {
  sport: string;
  projections: WCProjection[];
  lineMovements?: Record<string, unknown>;
}

interface WCPick {
  projection: WCProjection;
  pick: "more" | "less";
}

interface AIBuiltPick {
  projection: WCProjection;
  pick: "more" | "less";
  confidence: number;
  reasoning: string;
}
interface AIBuiltEntry {
  picks: AIBuiltPick[];
  multiplier: number;
  overallConfidence: number;
  label: string;
}
interface AIBuildResponse {
  sport: string;
  entries: AIBuiltEntry[];
}

interface AnalysisResult {
  analyzedPicks: Array<{
    projectionId: string;
    playerName: string;
    statType: string;
    line: number;
    pick: "more" | "less";
    confidence: number;
    suggestedPick: "more" | "less";
    reasoning: string;
    dataSources: string[];
  }>;
  overallConfidence: number;
}

// PrizePicks payout multipliers by number of legs (2-6 pick entries).
function getEntryMultiplier(legs: number): number {
  if (legs <= 1) return 0;
  if (legs === 2) return 3;
  if (legs === 3) return 5;
  if (legs === 4) return 10;
  if (legs === 5) return 20;
  if (legs === 6) return 25;
  return 25;
}

const STAT_COLORS: Record<string, string> = {
  "Goals": "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  "Shots": "text-blue-400 bg-blue-500/10 border-blue-500/20",
  "Shots on Goal": "text-blue-400 bg-blue-500/10 border-blue-500/20",
  "Shots On Target": "text-blue-400 bg-blue-500/10 border-blue-500/20",
  "Saves": "text-orange-400 bg-orange-500/10 border-orange-500/20",
  "Passes": "text-purple-400 bg-purple-500/10 border-purple-500/20",
  "Assists": "text-purple-400 bg-purple-500/10 border-purple-500/20",
  "Tackles": "text-cyan-400 bg-cyan-500/10 border-cyan-500/20",
  "Fantasy Score": "text-pink-400 bg-pink-500/10 border-pink-500/20",
};
const statColor = (s: string) => STAT_COLORS[s] || "text-slate-300 bg-slate-500/10 border-slate-500/20";

function kickoff(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
}

// ── Gating views ─────────────────────────────────────────────────────────────
function GateHero({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <div className="relative overflow-hidden border-b border-slate-800/50">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-950/60 via-slate-950/90 to-slate-900/95" />
        <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3" />
        <div className="relative container mx-auto px-4 py-10">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <Trophy className="w-7 h-7 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-4xl font-black text-white tracking-tight" data-testid="wc-builder-title">World Cup Builder</h1>
              <p className="text-slate-400 text-sm mt-1">Build FIFA World Cup PrizePicks entries</p>
            </div>
          </div>
        </div>
      </div>
      <div className="container mx-auto px-4 py-12">{children}</div>
    </div>
  );
}

function UnauthenticatedView() {
  return (
    <GateHero>
      <div className="max-w-lg mx-auto text-center space-y-6">
        <p className="text-slate-400 text-lg leading-relaxed">
          Build FIFA World Cup entries from real player projections. Pick More or Less on national-team stat lines,
          combine 2–6 picks, and see your potential payout.
        </p>
        <div className="bg-gradient-to-r from-emerald-500/10 via-slate-800/50 to-emerald-500/10 border border-emerald-500/20 rounded-xl p-4">
          <div className="flex items-center gap-2 justify-center mb-2">
            <Crown className="w-4 h-4 text-amber-400" />
            <span className="text-sm font-bold text-white">Champion Feature</span>
          </div>
          <p className="text-xs text-slate-400">The World Cup Builder is available to Champion members. Sign in to get started.</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
          <a href="/login" data-testid="wc-builder-login-btn">
            <Button className="bg-emerald-500 text-black font-bold px-8"><Zap className="w-4 h-4 mr-2" /> Sign In</Button>
          </a>
          <Link href="/pricing">
            <Button variant="outline" className="border-slate-700 text-slate-300 px-6"><Crown className="w-4 h-4 mr-2" /> View Plans</Button>
          </Link>
        </div>
      </div>
    </GateHero>
  );
}

function NonProView() {
  return (
    <GateHero>
      <div className="max-w-2xl mx-auto text-center space-y-8">
        <div className="bg-gradient-to-b from-emerald-500/5 to-transparent border border-emerald-500/20 rounded-2xl p-8">
          <Lock className="w-12 h-12 text-emerald-400/60 mx-auto mb-4" />
          <h2 className="text-2xl font-black text-white mb-3">Upgrade to Champion for the World Cup Builder</h2>
          <p className="text-slate-400 mb-6">
            Build multi-pick FIFA World Cup entries with payout calculations, AI pick analysis, and auto-built entries.
          </p>
          <div className="bg-slate-800/40 border border-amber-500/20 rounded-xl p-5 text-left max-w-sm mx-auto mb-6">
            <div className="flex items-center gap-2 mb-3">
              <Crown className="w-5 h-5 text-amber-400" />
              <span className="text-sm font-bold text-amber-400">Champion Plan Includes</span>
            </div>
            <ul className="space-y-2 text-xs text-slate-400">
              <li className="flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-amber-400/60" /> Up to 6-pick World Cup entries</li>
              <li className="flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-amber-400/60" /> Grouped by match &amp; country</li>
              <li className="flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-amber-400/60" /> AI pick analysis &amp; auto-build</li>
              <li className="flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-amber-400/60" /> Payout multiplier calculator</li>
            </ul>
          </div>
          <Link href="/pricing">
            <Button className="bg-amber-500 text-black font-bold px-8 shadow-lg shadow-amber-500/20" data-testid="wc-builder-upgrade-btn">
              <Crown className="w-4 h-4 mr-2" /> Upgrade to Champion
            </Button>
          </Link>
        </div>
      </div>
    </GateHero>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function WorldCupBuilder() {
  usePageMeta({
    title: "World Cup Builder - FIFA PrizePicks Entries",
    description: "Build FIFA World Cup PrizePicks entries with projections, AI analysis and payout calculations.",
    path: "/world-cup-builder",
  });
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();

  const [entries, setEntries] = useState<WCPick[]>([]);
  const [wagerAmount, setWagerAmount] = useState<number>(10);
  const [copied, setCopied] = useState(false);
  const [showAllSoccer, setShowAllSoccer] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [aiBuilding, setAiBuilding] = useState(false);
  const [aiEntries, setAiEntries] = useState<AIBuiltEntry[] | null>(null);
  const [expandedAI, setExpandedAI] = useState<number | null>(null);

  const { data: subData } = useQuery<{ tier: string }>({
    queryKey: ["/api/subscription"],
    enabled: !!user,
  });
  const isPro = (subData?.tier || "free") === "pro";

  // World Cup slate (with soccer fallback available via toggle).
  const { data: wcData, isLoading: wcLoading } = useQuery<WorldCupResponse>({
    queryKey: ["/api/prizepicks/worldcup"],
    enabled: !!user && isPro,
  });
  const { data: soccerData, isLoading: soccerLoading } = useQuery<SoccerResponse>({
    queryKey: ["/api/prizepicks/SOCCER"],
    enabled: !!user && isPro && showAllSoccer,
  });

  const hasWorldCup = !!wcData?.hasWorldCup;
  const usingFallback = showAllSoccer && !hasWorldCup;
  const projections = usingFallback ? (soccerData?.projections || []) : (wcData?.projections || []);
  const loading = wcLoading || (usingFallback && soccerLoading);

  // Group projections by match (fixture), then by country within the match.
  const matches = useMemo(() => {
    const byMatch = new Map<string, { key: string; startTime: string; teams: Map<string, WCProjection[]> }>();
    for (const p of projections) {
      const key = (p.gameInfo && p.gameInfo.trim()) || "Other fixtures";
      let m = byMatch.get(key);
      if (!m) { m = { key, startTime: p.startTime, teams: new Map() }; byMatch.set(key, m); }
      if (p.startTime && (!m.startTime || new Date(p.startTime) < new Date(m.startTime))) m.startTime = p.startTime;
      const team = p.team || "—";
      if (!m.teams.has(team)) m.teams.set(team, []);
      m.teams.get(team)!.push(p);
    }
    return Array.from(byMatch.values()).sort((a, b) => {
      const ta = a.startTime ? new Date(a.startTime).getTime() : Infinity;
      const tb = b.startTime ? new Date(b.startTime).getTime() : Infinity;
      return ta - tb;
    });
  }, [projections]);

  const multiplier = getEntryMultiplier(entries.length);
  const potentialPayout = wagerAmount * multiplier;
  const maxPicks = 6;
  const isInEntry = (id: string) => entries.some(e => e.projection.id === id);
  const entryPick = (id: string) => entries.find(e => e.projection.id === id)?.pick;

  const togglePick = (projection: WCProjection, pick: "more" | "less") => {
    setAnalysisResult(null);
    setEntries(prev => {
      const existing = prev.find(e => e.projection.id === projection.id);
      if (existing) {
        if (existing.pick === pick) return prev.filter(e => e.projection.id !== projection.id); // toggle off
        return prev.map(e => e.projection.id === projection.id ? { ...e, pick } : e); // switch side
      }
      if (prev.length >= maxPicks) {
        toast({ title: "Entry full", description: `PrizePicks entries are capped at ${maxPicks} picks.`, variant: "destructive" });
        return prev;
      }
      return [...prev, { projection, pick }];
    });
  };
  const removeEntry = (id: string) => { setAnalysisResult(null); setEntries(prev => prev.filter(e => e.projection.id !== id)); };
  const clearEntries = () => { setEntries([]); setAnalysisResult(null); };

  // ── Save to vault ──
  const saveMutation = useMutation({
    mutationFn: async (data: {
      sport: string; picks: unknown[]; multiplier: number; wager: number;
      potentialPayout: number; label?: string; overallConfidence?: number;
    }) => (await apiRequest("POST", "/api/prizepicks/vault/entries", data)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/prizepicks/vault/entries"] });
      toast({ title: "Entry saved to vault", description: "Your World Cup entry has been saved." });
    },
    onError: (err: any) => toast({ title: "Failed to save", description: err?.message || "Could not save entry.", variant: "destructive" }),
  });

  const saveManualEntry = () => {
    if (entries.length < 2) return;
    saveMutation.mutate({
      sport: "SOCCER",
      picks: entries.map(e => ({
        projectionId: e.projection.id,
        playerName: e.projection.playerName,
        team: e.projection.team,
        statType: e.projection.statType,
        line: e.projection.line,
        pick: e.pick,
        confidence: 0,
        reasoning: "Manual pick",
        imageUrl: e.projection.imageUrl,
      })),
      multiplier,
      wager: wagerAmount,
      potentialPayout,
      label: "World Cup",
    });
  };

  const saveAIEntry = (entry: AIBuiltEntry) => {
    saveMutation.mutate({
      sport: "SOCCER",
      picks: entry.picks.map(p => ({
        projectionId: p.projection.id,
        playerName: p.projection.playerName,
        team: p.projection.team,
        statType: p.projection.statType,
        line: p.projection.line,
        pick: p.pick,
        confidence: p.confidence,
        reasoning: p.reasoning,
        imageUrl: p.projection.imageUrl,
      })),
      multiplier: entry.multiplier,
      wager: wagerAmount,
      potentialPayout: wagerAmount * entry.multiplier,
      label: entry.label || "World Cup (AI)",
      overallConfidence: entry.overallConfidence,
    });
  };

  const loadAIEntry = (entry: AIBuiltEntry) => {
    setAnalysisResult(null);
    setEntries(entry.picks.slice(0, maxPicks).map(p => ({ projection: p.projection, pick: p.pick })));
    toast({ title: "Loaded into builder", description: `${entry.picks.length} picks added. Tweak and save when ready.` });
  };

  // ── AI analyze ──
  const analyzeEntry = async () => {
    if (entries.length < 1) return;
    setAnalyzing(true);
    setAnalysisResult(null);
    try {
      const res = await fetch("/api/prizepicks/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          picks: entries.map(e => ({
            projectionId: e.projection.id,
            playerName: e.projection.playerName,
            team: e.projection.team,
            statType: e.projection.statType,
            line: e.projection.line,
            pick: e.pick,
            league: "SOCCER",
          })),
        }),
      });
      if (res.status === 401) { toast({ title: "Sign in required", description: "Please sign in to analyze picks.", variant: "destructive" }); return; }
      if (res.status === 403) { toast({ title: "Champion feature", description: "Pick analysis requires a Champion subscription.", variant: "destructive" }); return; }
      if (!res.ok) throw new Error("Analysis failed");
      setAnalysisResult(await res.json());
    } catch {
      toast({ title: "Analysis failed", description: "Could not analyze your picks. Try again.", variant: "destructive" });
    } finally {
      setAnalyzing(false);
    }
  };

  // ── AI auto-build ──
  const runAIBuilder = async () => {
    setAiBuilding(true);
    setAiEntries(null);
    try {
      const res = await fetch("/api/prizepicks/build/worldcup");
      if (res.status === 401) { toast({ title: "Sign in required", description: "Please sign in to auto-build entries.", variant: "destructive" }); return; }
      if (res.status === 403) { toast({ title: "Champion feature", description: "Auto-build requires a Champion subscription.", variant: "destructive" }); return; }
      if (!res.ok) throw new Error("Build failed");
      const data: AIBuildResponse = await res.json();
      setAiEntries(data.entries || []);
      setExpandedAI(data.entries?.length ? 0 : null);
      if (!data.entries?.length) toast({ title: "No entries built", description: "Not enough World Cup lines to build entries right now." });
    } catch {
      toast({ title: "Build failed", description: "Could not auto-build entries. Try again.", variant: "destructive" });
    } finally {
      setAiBuilding(false);
    }
  };

  const copyEntry = () => {
    const lines = entries.map(e => `${e.projection.playerName} (${e.projection.team}) - ${e.pick.toUpperCase()} ${e.projection.line} ${e.projection.statType}`);
    const text = `World Cup Entry - ${entries.length} Picks\n${lines.join("\n")}\n\nWager: $${wagerAmount} | ${multiplier}x | Potential: $${potentialPayout.toFixed(2)}`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ── Gating ──
  if (authLoading) {
    return <div className="min-h-screen container mx-auto px-4 py-12 space-y-4">
      <Skeleton className="h-24 w-full bg-slate-800/50" />
      <Skeleton className="h-64 w-full bg-slate-800/50" />
    </div>;
  }
  if (!user) return <UnauthenticatedView />;
  if (!isPro) return <NonProView />;

  return (
    <div className="min-h-screen">
      {/* Hero */}
      <div className="relative overflow-hidden border-b border-slate-800/50">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-950/70 via-slate-950/90 to-slate-900/95" />
        <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3" />
        <div className="relative container mx-auto px-4 py-8">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                <Trophy className="w-7 h-7 text-emerald-400" />
              </div>
              <div>
                <h1 className="text-3xl font-black text-white tracking-tight" data-testid="wc-builder-title">World Cup Builder</h1>
                <p className="text-slate-400 text-sm mt-0.5">
                  {hasWorldCup ? "Live FIFA World Cup lines" : usingFallback ? "Showing all soccer lines" : "FIFA World Cup entries"}
                </p>
              </div>
              <Badge className="ml-2 bg-amber-500/20 text-amber-400 border-amber-500/30 font-bold">
                <Crown className="w-3 h-3 mr-1" /> PRO
              </Badge>
            </div>
            <Button
              onClick={runAIBuilder}
              disabled={aiBuilding || loading || projections.length === 0}
              className="bg-gradient-to-r from-amber-500 to-orange-500 text-black font-black shadow-lg shadow-amber-500/20"
              size="sm"
              data-testid="wc-builder-ai-build"
            >
              {aiBuilding ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Building…</> : <><Sparkles className="w-4 h-4 mr-1.5" /> AI Auto-Build</>}
            </Button>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Left: lines grouped by match ── */}
        <div className="lg:col-span-2 space-y-5">
          {/* AI auto-built entries */}
          {aiEntries && aiEntries.length > 0 && (
            <Card className="bg-slate-900/60 border-amber-500/30 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-400" />
                <span className="font-bold text-white text-sm">AI Suggested Entries</span>
                <Badge className="bg-amber-500/15 text-amber-300 border-amber-500/30 text-[10px]">{aiEntries.length}</Badge>
              </div>
              {aiEntries.map((entry, idx) => (
                <div key={idx} className={`rounded-xl border overflow-hidden ${expandedAI === idx ? "border-amber-500/40" : "border-slate-700/40"}`}>
                  <button className="w-full flex items-center justify-between px-3 py-2.5 bg-slate-800/50" onClick={() => setExpandedAI(expandedAI === idx ? null : idx)}>
                    <div className="flex items-center gap-2 text-left">
                      <span className="text-sm font-bold text-white">{entry.label || `${entry.picks.length}-Pick Entry`}</span>
                      <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/30 text-[10px]">{entry.multiplier}x</Badge>
                      <Badge className="bg-slate-700/50 text-slate-300 border-slate-600/40 text-[10px]">{entry.overallConfidence}% conf</Badge>
                    </div>
                    {expandedAI === idx ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                  </button>
                  {expandedAI === idx && (
                    <div className="p-3 space-y-2">
                      {entry.picks.map((p, i) => (
                        <div key={i} className="flex items-center justify-between text-xs bg-slate-800/40 rounded-lg px-3 py-2">
                          <div className="min-w-0">
                            <span className="font-semibold text-white">{p.projection.playerName}</span>
                            <span className="text-slate-500"> · {p.projection.team}</span>
                            <div className="text-slate-400">{p.pick === "more" ? "More" : "Less"} {p.projection.line} {p.projection.statType}</div>
                          </div>
                          <Badge className={`shrink-0 ${p.pick === "more" ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" : "bg-rose-500/15 text-rose-300 border-rose-500/30"}`}>
                            {p.pick === "more" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                          </Badge>
                        </div>
                      ))}
                      <div className="flex gap-2 pt-1">
                        <Button size="sm" variant="outline" className="border-slate-700 text-slate-200 flex-1" onClick={() => loadAIEntry(entry)}>Load into builder</Button>
                        <Button size="sm" className="bg-emerald-500 text-black font-bold flex-1" onClick={() => saveAIEntry(entry)} disabled={saveMutation.isPending}>
                          <Save className="w-3.5 h-3.5 mr-1" /> Save
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </Card>
          )}

          {/* Empty / fallback state */}
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-32 w-full bg-slate-800/50" />
              <Skeleton className="h-32 w-full bg-slate-800/50" />
            </div>
          ) : projections.length === 0 ? (
            <Card className="bg-slate-900/60 border-slate-800 p-10 text-center space-y-4">
              <Globe className="w-12 h-12 text-slate-600 mx-auto" />
              <h3 className="text-lg font-bold text-white">
                {usingFallback ? "No soccer lines available right now" : "No World Cup games live right now"}
              </h3>
              <p className="text-sm text-slate-400 max-w-md mx-auto">
                {usingFallback
                  ? "There are no soccer projections posted at the moment. Check back closer to kickoff."
                  : `There's no live FIFA World Cup slate at the moment.${wcData?.soccerCount ? ` ${wcData.soccerCount} other soccer lines are available.` : ""}`}
              </p>
              {!usingFallback && (
                <Button variant="outline" className="border-slate-700 text-slate-200" onClick={() => setShowAllSoccer(true)} data-testid="wc-builder-show-soccer">
                  <Flag className="w-4 h-4 mr-2" /> Show all soccer lines
                </Button>
              )}
              {usingFallback && (
                <Button variant="ghost" className="text-slate-400" onClick={() => setShowAllSoccer(false)}>Back to World Cup only</Button>
              )}
            </Card>
          ) : (
            <>
              {usingFallback && (
                <div className="flex items-center justify-between bg-amber-500/5 border border-amber-500/20 rounded-lg px-3 py-2">
                  <span className="text-xs text-amber-300 flex items-center gap-1.5"><Info className="w-3.5 h-3.5" /> No World Cup slate live — showing all soccer lines.</span>
                  <Button variant="ghost" size="sm" className="text-slate-400 h-7" onClick={() => setShowAllSoccer(false)}>World Cup only</Button>
                </div>
              )}
              {matches.map((match) => (
                <Card key={match.key} className="bg-slate-900/60 border-slate-800 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 bg-slate-800/40 border-b border-slate-800">
                    <div className="flex items-center gap-2 min-w-0">
                      <Flag className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span className="font-bold text-white text-sm truncate">{match.key}</span>
                    </div>
                    {match.startTime && (
                      <span className="text-xs text-slate-400 flex items-center gap-1 shrink-0"><Clock className="w-3 h-3" /> {kickoff(match.startTime)}</span>
                    )}
                  </div>
                  <div className="p-3 space-y-4">
                    {Array.from(match.teams.entries()).map(([team, props]) => (
                      <div key={team} className="space-y-2">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-300 uppercase tracking-wide">
                          <Globe className="w-3.5 h-3.5 text-slate-500" /> {team}
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {props.map((p) => {
                            const picked = entryPick(p.id);
                            return (
                              <div key={p.id} className={`rounded-lg border p-2.5 transition-colors ${isInEntry(p.id) ? "border-emerald-500/40 bg-emerald-500/5" : "border-slate-700/40 bg-slate-800/30"}`}>
                                <div className="flex items-start justify-between gap-2 mb-2">
                                  <div className="min-w-0">
                                    <div className="text-sm font-semibold text-white truncate">{p.playerName}</div>
                                    <div className="text-xs text-slate-500">{p.position || team}</div>
                                  </div>
                                  <Badge className={`shrink-0 text-[10px] ${statColor(p.statType)}`}>{p.statType}</Badge>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-slate-400">Line <span className="font-bold text-white">{p.line}</span></span>
                                  <div className="ml-auto flex gap-1">
                                    <Button size="sm" onClick={() => togglePick(p, "more")}
                                      className={`h-7 px-2.5 text-xs font-bold ${picked === "more" ? "bg-emerald-500 text-black" : "bg-slate-700/60 text-slate-300 hover:bg-emerald-500/20"}`}
                                      data-testid={`wc-more-${p.id}`}>
                                      <ArrowUp className="w-3 h-3 mr-0.5" /> More
                                    </Button>
                                    <Button size="sm" onClick={() => togglePick(p, "less")}
                                      className={`h-7 px-2.5 text-xs font-bold ${picked === "less" ? "bg-rose-500 text-white" : "bg-slate-700/60 text-slate-300 hover:bg-rose-500/20"}`}
                                      data-testid={`wc-less-${p.id}`}>
                                      <ArrowDown className="w-3 h-3 mr-0.5" /> Less
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              ))}
            </>
          )}
        </div>

        {/* ── Right: entry slip ── */}
        <div className="lg:col-span-1">
          <div className="lg:sticky lg:top-4 space-y-4">
            <Card className="bg-slate-900/70 border-slate-800 p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Trophy className="w-4 h-4 text-emerald-400" />
                  <span className="font-bold text-white text-sm">Your Entry</span>
                  <Badge className="bg-slate-700/50 text-slate-300 border-slate-600/40 text-[10px]">{entries.length}/{maxPicks}</Badge>
                </div>
                {entries.length > 0 && (
                  <Button variant="ghost" size="sm" className="h-7 text-slate-400 hover:text-rose-400" onClick={clearEntries}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>

              {entries.length === 0 ? (
                <p className="text-xs text-slate-500 py-6 text-center">Pick More or Less on 2–6 lines to build an entry.</p>
              ) : (
                <div className="space-y-2 mb-3">
                  {entries.map((e) => (
                    <div key={e.projection.id} className="flex items-center gap-2 bg-slate-800/50 rounded-lg px-2.5 py-2">
                      <Badge className={`shrink-0 ${e.pick === "more" ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" : "bg-rose-500/15 text-rose-300 border-rose-500/30"}`}>
                        {e.pick === "more" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                      </Badge>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-semibold text-white truncate">{e.projection.playerName}</div>
                        <div className="text-[11px] text-slate-500 truncate">{e.pick === "more" ? "More" : "Less"} {e.projection.line} {e.projection.statType}</div>
                      </div>
                      <button onClick={() => removeEntry(e.projection.id)} className="text-slate-500 hover:text-rose-400 shrink-0"><X className="w-3.5 h-3.5" /></button>
                    </div>
                  ))}
                </div>
              )}

              {/* Payout */}
              <div className="border-t border-slate-800 pt-3 space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-slate-400 flex items-center gap-1"><DollarSign className="w-3.5 h-3.5" /> Wager</label>
                  <Input type="number" min={1} value={wagerAmount}
                    onChange={(e) => setWagerAmount(Math.max(0, Number(e.target.value) || 0))}
                    className="h-8 w-24 bg-slate-800 border-slate-700 text-white text-right text-sm" data-testid="wc-wager" />
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">Multiplier</span>
                  <span className="font-bold text-white">{multiplier ? `${multiplier}x` : "—"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-300">Potential payout</span>
                  <span className="text-lg font-black text-emerald-400" data-testid="wc-payout">${potentialPayout.toFixed(2)}</span>
                </div>
                {entries.length === 1 && <p className="text-[11px] text-amber-400/80">Add at least 1 more pick — entries need 2–6 picks.</p>}
              </div>

              {/* Actions */}
              <div className="grid grid-cols-2 gap-2 mt-3">
                <Button variant="outline" size="sm" className="border-slate-700 text-slate-200" disabled={entries.length < 2} onClick={copyEntry} data-testid="wc-copy">
                  {copied ? <><CheckCircle2 className="w-3.5 h-3.5 mr-1 text-emerald-400" /> Copied</> : <><Copy className="w-3.5 h-3.5 mr-1" /> Copy</>}
                </Button>
                <Button size="sm" className="bg-emerald-500 text-black font-bold" disabled={entries.length < 2 || saveMutation.isPending} onClick={saveManualEntry} data-testid="wc-save">
                  <Save className="w-3.5 h-3.5 mr-1" /> Save
                </Button>
              </div>
              <Button variant="outline" size="sm" className="w-full mt-2 border-violet-500/40 text-violet-300 hover:bg-violet-500/10"
                disabled={entries.length < 1 || analyzing} onClick={analyzeEntry} data-testid="wc-analyze">
                {analyzing ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Analyzing…</> : <><Bot className="w-3.5 h-3.5 mr-1.5" /> AI Analyze Picks</>}
              </Button>
            </Card>

            {/* Analysis result */}
            {analysisResult && (
              <Card className="bg-slate-900/70 border-violet-500/30 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white text-sm flex items-center gap-1.5"><Bot className="w-4 h-4 text-violet-400" /> Analysis</span>
                  <Badge className="bg-violet-500/15 text-violet-300 border-violet-500/30">{analysisResult.overallConfidence}% overall</Badge>
                </div>
                <div className="space-y-2">
                  {analysisResult.analyzedPicks.map((a) => {
                    const agrees = a.suggestedPick === a.pick;
                    return (
                      <div key={a.projectionId} className="bg-slate-800/50 rounded-lg px-3 py-2 space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-white truncate">{a.playerName}</span>
                          <Badge className={`text-[10px] ${a.confidence >= 60 ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" : a.confidence >= 45 ? "bg-amber-500/15 text-amber-300 border-amber-500/30" : "bg-rose-500/15 text-rose-300 border-rose-500/30"}`}>
                            {a.confidence}%
                          </Badge>
                        </div>
                        <div className="text-[11px] text-slate-400">
                          You: <span className="text-slate-200">{a.pick}</span> · AI leans: <span className={agrees ? "text-emerald-400" : "text-amber-400"}>{a.suggestedPick}</span>
                        </div>
                        {a.reasoning && <p className="text-[11px] text-slate-500 leading-snug">{a.reasoning}</p>}
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}

            <p className="text-[11px] text-slate-600 leading-snug px-1">
              Projections and analysis are informational only and not a guarantee of any outcome. Build responsibly.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

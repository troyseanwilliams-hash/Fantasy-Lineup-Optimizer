import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useLineups } from "@/hooks/use-lineups";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { usePageMeta } from "@/hooks/use-page-meta";
import { ArrowRight, Crown, Loader2, Lock, Repeat } from "lucide-react";

interface SwapPlayer {
  id: number;
  name: string;
  team: string;
  position: string;
  salary: number;
  projectedPoints: number;
  opponent: string | null;
  game: string;
  injuryStatus: string | null;
  locked: boolean;
  gameStart: string | null;
}

interface SwapResult {
  message?: string;
  original: SwapPlayer[];
  suggested: SwapPlayer[];
  swaps: { out: SwapPlayer; in: SwapPlayer | null }[];
  projectionBefore: number;
  projectionAfter: number;
  gain: number;
  salaryBefore?: number;
  salaryAfter?: number;
  lockedCount: number;
}

function PlayerRow({ p, tone }: { p: SwapPlayer; tone?: "out" | "in" }) {
  return (
    <div className={`flex items-center justify-between gap-3 px-3 py-2 rounded-lg border ${
      tone === "out" ? "border-red-500/30 bg-red-500/5" : tone === "in" ? "border-volt-500/40 bg-volt-500/5" : "border-slate-800 bg-slate-900/40"
    }`}>
      <div className="flex items-center gap-2 min-w-0">
        <span className="w-9 text-[11px] font-black text-slate-500">{p.position}</span>
        <div className="min-w-0">
          <p className="text-sm font-bold text-white truncate">{p.name}</p>
          <p className="text-[11px] text-slate-500 truncate">{p.team}{p.game ? ` · ${p.game}` : ""}</p>
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        {p.locked && <Lock className="w-3.5 h-3.5 text-slate-500" aria-label="Game started" />}
        {p.injuryStatus && <span className="text-[10px] font-black text-red-400 uppercase">{p.injuryStatus}</span>}
        <span className="text-xs text-slate-400">${(p.salary / 1000).toFixed(1)}K</span>
        <span className="text-sm font-black text-white w-12 text-right">{p.projectedPoints.toFixed(1)}</span>
      </div>
    </div>
  );
}

export default function LateSwap() {
  const { user } = useAuth();
  usePageMeta({
    title: "Late Swap - Re-optimize After Games Start",
    description: "Keep the players whose games have started and let the optimizer rebuild the rest of your lineup.",
    path: "/late-swap",
  });
  const { data: sub } = useQuery<{ tier: string }>({ queryKey: ["/api/subscription"], enabled: !!user });
  const isChampion = sub?.tier === "pro";
  const { data: lineups, isLoading } = useLineups();
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recent = useMemo(() => {
    const list = (lineups ?? []).filter(l => (l.platform || "draftkings") === "draftkings");
    return [...list]
      .sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())
      .slice(0, 30);
  }, [lineups]);

  const swapMutation = useMutation({
    mutationFn: async (lineupId: number): Promise<SwapResult> => {
      const res = await apiRequest("POST", "/api/late-swap", { lineupId });
      return res.json();
    },
    onMutate: () => setError(null),
    onError: (e: Error) => {
      const m = e.message.match(/"message":"([^"]+)"/);
      setError(m ? m[1] : e.message);
    },
  });

  if (!user) {
    return (
      <div className="container mx-auto px-4 py-16 max-w-xl text-center">
        <p className="text-slate-300 mb-4">Sign in to use Late Swap.</p>
        <Link href="/login"><Button className="bg-volt-500 text-black font-black">Sign in</Button></Link>
      </div>
    );
  }

  if (sub && !isChampion) {
    return (
      <div className="container mx-auto px-4 py-16 max-w-2xl text-center" data-testid="late-swap-upsell">
        <img src="/images/art/late-swap.svg" alt="" className="mx-auto w-full max-w-md mb-8" />
        <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/20 font-bold mb-4"><Crown className="w-3.5 h-3.5 mr-1" />Champion</Badge>
        <h1 className="text-4xl font-black text-white mb-3">Late Swap</h1>
        <p className="text-slate-400 mb-6">A player is out and half your games have started? Keep the locked players and rebuild the open slots in one click.</p>
        <Link href="/pricing"><Button className="bg-amber-500 hover:bg-amber-600 text-black font-black h-12 px-8">See Champion</Button></Link>
      </div>
    );
  }

  const result = swapMutation.data;

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl" data-testid="late-swap-page">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-11 h-11 rounded-xl bg-volt-500/10 flex items-center justify-center"><Repeat className="w-6 h-6 text-volt-400" /></div>
        <div>
          <h1 className="text-3xl font-black text-white tracking-tight">Late Swap</h1>
          <p className="text-sm text-slate-400">Games that have started stay locked. Only the open slots change.</p>
        </div>
      </div>

      <Card className="bg-slate-900/60 border-border p-5 mb-6">
        <h2 className="text-sm font-black text-white uppercase tracking-wider mb-3">Pick a saved lineup</h2>
        {isLoading ? (
          <Loader2 className="w-5 h-5 text-volt-400 animate-spin" />
        ) : recent.length === 0 ? (
          <p className="text-sm text-slate-400">No saved DraftKings lineups yet. Build one in an optimizer first.</p>
        ) : (
          <div className="flex flex-col sm:flex-row gap-3">
            <select
              value={selected ?? ""}
              onChange={e => setSelected(e.target.value ? Number(e.target.value) : null)}
              className="h-11 flex-1 rounded-md bg-slate-950 border border-border px-3 text-sm text-white"
              aria-label="Saved lineup"
              data-testid="late-swap-select"
            >
              <option value="">Choose a lineup</option>
              {recent.map(l => (
                <option key={l.id} value={l.id}>
                  {l.sport} · {l.name || `Lineup #${l.id}`} · {parseFloat(String(l.totalProjectedPoints)).toFixed(1)} pts
                </option>
              ))}
            </select>
            <Button
              className="h-11 bg-volt-500 hover:bg-volt-400 text-black font-black"
              disabled={selected == null || swapMutation.isPending}
              onClick={() => selected != null && swapMutation.mutate(selected)}
              data-testid="late-swap-run"
            >
              {swapMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Repeat className="w-4 h-4 mr-2" />}
              Find swaps
            </Button>
          </div>
        )}
        {error && <p className="text-sm text-red-400 mt-3" role="alert">{error}</p>}
      </Card>

      {result && (
        <div data-testid="late-swap-result">
          <div className="grid grid-cols-3 gap-3 mb-4">
            <Card className="bg-slate-900/60 border-border p-4">
              <p className="text-[11px] font-black text-slate-500 uppercase tracking-wider">Before</p>
              <p className="text-2xl font-black text-white">{result.projectionBefore.toFixed(1)}</p>
            </Card>
            <Card className="bg-slate-900/60 border-border p-4">
              <p className="text-[11px] font-black text-slate-500 uppercase tracking-wider">After</p>
              <p className="text-2xl font-black text-white">{result.projectionAfter.toFixed(1)}</p>
            </Card>
            <Card className="bg-slate-900/60 border-border p-4">
              <p className="text-[11px] font-black text-slate-500 uppercase tracking-wider">Change</p>
              <p className={`text-2xl font-black ${result.gain >= 0 ? "text-volt-400" : "text-red-400"}`}>{result.gain >= 0 ? "+" : ""}{result.gain.toFixed(1)}</p>
            </Card>
          </div>

          {result.message && <p className="text-sm text-slate-400 mb-4">{result.message}</p>}

          {result.swaps.length > 0 && (
            <Card className="bg-slate-900/60 border-border p-5 mb-4">
              <h3 className="text-sm font-black text-white uppercase tracking-wider mb-3">Suggested swaps</h3>
              <div className="space-y-3">
                {result.swaps.map((s, i) => (
                  <div key={i} className="grid md:grid-cols-[1fr_auto_1fr] items-center gap-2">
                    <PlayerRow p={s.out} tone="out" />
                    <ArrowRight className="w-4 h-4 text-slate-500 mx-auto rotate-90 md:rotate-0" />
                    {s.in ? <PlayerRow p={s.in} tone="in" /> : <span className="text-sm text-slate-500">Open slot</span>}
                  </div>
                ))}
              </div>
              <p className="text-xs text-slate-500 mt-4">Make these changes in DraftKings before each player's game starts. Your saved lineup here is not changed.</p>
            </Card>
          )}

          <Card className="bg-slate-900/60 border-border p-5">
            <h3 className="text-sm font-black text-white uppercase tracking-wider mb-3">Full lineup after swaps ({result.lockedCount} locked)</h3>
            <div className="space-y-2">{result.suggested.map(p => <PlayerRow key={p.id} p={p} />)}</div>
          </Card>
        </div>
      )}
    </div>
  );
}

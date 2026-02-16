import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { 
  Search, Filter, Lock, Unlock, X, Zap, 
  ChevronRight, ArrowLeft, RefreshCw, Save, 
  TrendingUp, DollarSign, Target, Loader2
} from "lucide-react";
import { useRoute, useLocation } from "wouter";
import { api, buildUrl } from "@shared/routes";
import { type Player, type OptimizeResponse } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

export default function Optimizer() {
  const [, params] = useRoute("/optimizer/:id");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const slateId = Number(params?.id);

  const [search, setSearch] = useState("");
  const [posFilter, setPosFilter] = useState("ALL");
  const [lockedIds, setLockedIds] = useState<number[]>([]);
  const [excludedIds, setExcludedIds] = useState<number[]>([]);
  const [customProjections, setCustomProjections] = useState<Record<string, number>>({});

  const { data: slates } = useQuery({
    queryKey: ["/api/slates"],
  });

  const slate = useMemo(() => slates?.find((s: any) => s.id === slateId), [slates, slateId]);

  const { data: players, isLoading: loadingPlayers } = useQuery<Player[]>({
    queryKey: [buildUrl(api.slates.getPlayers.path, { id: slateId })],
    enabled: !!slateId,
  });

  const optimizeMutation = useMutation<OptimizeResponse, Error, any>({
    mutationFn: async (constraints) => {
      const res = await fetch(api.optimizer.optimize.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(constraints),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    }
  });

  const saveLineupMutation = useMutation({
    mutationFn: async (lineupData: any) => {
      const res = await fetch(api.lineups.create.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(lineupData),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Lineup Saved", description: "Your optimized lineup is now in your vault." });
      queryClient.invalidateQueries({ queryKey: ["/api/lineups"] });
      setLocation("/lineups");
    }
  });

  const filteredPlayers = useMemo(() => {
    if (!players) return [];
    return players.filter(p => {
      const matchesSearch = p.name.toLowerCase().includes(search.toLowerCase()) || 
                           p.team.toLowerCase().includes(search.toLowerCase());
      const matchesPos = posFilter === "ALL" || p.position.includes(posFilter);
      const notExcluded = !excludedIds.includes(p.id);
      return matchesSearch && matchesPos && notExcluded;
    });
  }, [players, search, posFilter, excludedIds]);

  const handleOptimize = () => {
    optimizeMutation.mutate({
      slateId,
      lockedPlayerIds: lockedIds,
      excludedPlayerIds: excludedIds,
      playerProjections: customProjections
    });
  };

  const handleSave = () => {
    if (!optimizeMutation.data?.lineup) return;
    saveLineupMutation.mutate({
      slateId,
      sport: slate?.sport || "NBA",
      totalSalary: optimizeMutation.data.totalSalary,
      totalProjectedPoints: optimizeMutation.data.totalProjectedPoints.toString(),
      playerIds: optimizeMutation.data.lineup.map(p => p.id),
      name: `${slate?.name} Optimization`
    });
  };

  const toggleLock = (id: number) => {
    setLockedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const toggleExclude = (id: number) => {
    setExcludedIds(prev => [...prev, id]);
    setLockedIds(prev => prev.filter(i => i !== id));
  };

  if (loadingPlayers) {
    return (
      <div className="h-[80vh] flex items-center justify-center">
        <Loader2 className="w-12 h-12 text-[var(--primary)] animate-spin" />
      </div>
    );
  }

  const positions = slate?.sport === "NBA" 
    ? ["ALL", "PG", "SG", "SF", "PF", "C"] 
    : ["ALL", "QB", "RB", "WR", "TE", "DST"];

  return (
    <div className="container mx-auto px-4 py-8 max-w-[1600px]">
      <div className="flex items-center gap-4 mb-8">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/")} className="text-slate-400">
          <ArrowLeft className="w-6 h-6" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold text-white">{slate?.name || "Loading Slate..."}</h1>
          <p className="text-slate-400">{slate?.sport} Optimizer • DraftKings Format</p>
        </div>
        <div className="ml-auto flex gap-3">
          <Button variant="outline" onClick={() => { setLockedIds([]); setExcludedIds([]); setCustomProjections({}); }} className="border-slate-700 text-slate-300">
            Reset All
          </Button>
          <Button onClick={handleOptimize} disabled={optimizeMutation.isPending} className="btn-primary h-12 px-8 font-bold text-lg">
            {optimizeMutation.isPending ? <RefreshCw className="w-5 h-5 animate-spin mr-2" /> : <Zap className="w-5 h-5 mr-2" />}
            Run Optimization
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">
        {/* Left Column: Player Pool */}
        <div className="xl:col-span-8">
          <Card className="card p-0 overflow-hidden">
            <div className="p-6 border-b border-slate-700 bg-slate-800/20 flex flex-col md:flex-row gap-4 items-center">
              <div className="relative flex-grow w-full">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <Input 
                  placeholder="Search players or teams..." 
                  className="input-dark pl-10 h-11"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="flex gap-1 bg-slate-900 rounded-lg p-1 border border-slate-800">
                {positions.map(pos => (
                  <button
                    key={pos}
                    onClick={() => setPosFilter(pos)}
                    className={`px-4 py-2 rounded-md text-xs font-bold transition-all ${
                      posFilter === pos ? "bg-slate-700 text-white" : "text-slate-500 hover:text-slate-300"
                    }`}
                  >
                    {pos}
                  </button>
                ))}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-slate-900/50 text-[10px] font-black text-slate-500 uppercase tracking-widest">
                    <th className="px-6 py-4">Player</th>
                    <th className="px-6 py-4">Pos</th>
                    <th className="px-6 py-4">Team</th>
                    <th className="px-6 py-4">Salary</th>
                    <th className="px-6 py-4">FPPG</th>
                    <th className="px-6 py-4">Projected</th>
                    <th className="px-6 py-4 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {filteredPlayers.map(player => (
                    <tr key={player.id} className={`hover:bg-slate-800/30 transition-colors ${lockedIds.includes(player.id) ? "bg-emerald-500/5" : ""}`}>
                      <td className="px-6 py-4">
                        <div className="font-bold text-white">{player.name}</div>
                        <div className="text-[10px] text-slate-500">{player.gameInfo}</div>
                      </td>
                      <td className="px-6 py-4">
                        <Badge variant="outline" className="border-slate-700 text-slate-400 font-bold">{player.position}</Badge>
                      </td>
                      <td className="px-6 py-4 text-slate-300 font-medium">{player.team}</td>
                      <td className="px-6 py-4 font-mono font-bold text-slate-200">${player.salary.toLocaleString()}</td>
                      <td className="px-6 py-4 text-slate-400 font-medium">{player.fppg}</td>
                      <td className="px-6 py-4">
                        <Input 
                          type="number" 
                          step="0.1"
                          className="w-20 h-8 bg-slate-900 border-slate-700 text-xs font-bold text-[var(--primary)]"
                          defaultValue={player.projectedPoints}
                          onChange={(e) => setCustomProjections(prev => ({ ...prev, [player.id]: Number(e.target.value) }))}
                        />
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-center gap-2">
                          <button 
                            onClick={() => toggleLock(player.id)}
                            className={`p-2 rounded-lg transition-all ${lockedIds.includes(player.id) ? "bg-emerald-500 text-white" : "bg-slate-800 text-slate-500 hover:text-white"}`}
                          >
                            {lockedIds.includes(player.id) ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                          </button>
                          <button 
                            onClick={() => toggleExclude(player.id)}
                            className="p-2 rounded-lg bg-slate-800 text-slate-500 hover:bg-red-500/20 hover:text-red-400 transition-all"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        {/* Right Column: Results & Stats */}
        <div className="xl:col-span-4 space-y-8">
          <Card className="card border-[var(--primary)]/20 shadow-emerald-500/5">
            <CardHeader>
              <CardTitle className="text-xl font-bold text-white flex items-center">
                <Zap className="w-5 h-5 text-[var(--primary)] mr-2" />
                Optimized Lineup
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {optimizeMutation.data?.lineup ? (
                <>
                  <div className="space-y-3">
                    {optimizeMutation.data.lineup.map((player, i) => (
                      <div key={player.id} className="flex items-center justify-between p-4 bg-slate-900/50 rounded-xl border border-slate-800 hover:border-slate-700 transition-all">
                        <div className="flex items-center gap-4">
                          <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center text-[10px] font-black text-slate-500">
                            {player.position}
                          </div>
                          <div>
                            <div className="font-bold text-sm text-white">{player.name}</div>
                            <div className="text-[10px] text-slate-500 font-bold uppercase">{player.team}</div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-bold text-white">{player.projectedPoints} PTS</div>
                          <div className="text-[10px] font-mono text-slate-500 font-bold">${player.salary.toLocaleString()}</div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="pt-6 border-t border-slate-700 grid grid-cols-2 gap-4">
                    <div className="bg-slate-900/80 p-4 rounded-xl text-center">
                      <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Total Points</p>
                      <p className="text-2xl font-black text-[var(--primary)]">{optimizeMutation.data.totalProjectedPoints.toFixed(2)}</p>
                    </div>
                    <div className="bg-slate-900/80 p-4 rounded-xl text-center">
                      <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Total Salary</p>
                      <p className="text-2xl font-black text-white">${optimizeMutation.data.totalSalary.toLocaleString()}</p>
                    </div>
                  </div>

                  <Button 
                    onClick={handleSave} 
                    disabled={saveLineupMutation.isPending}
                    className="w-full h-14 btn-primary text-lg font-bold"
                  >
                    {saveLineupMutation.isPending ? <RefreshCw className="w-5 h-5 animate-spin mr-2" /> : <Save className="w-5 h-5 mr-2" />}
                    Save Optimized Lineup
                  </Button>
                </>
              ) : (
                <div className="py-20 text-center text-slate-500 space-y-4">
                  <Target className="w-16 h-16 mx-auto opacity-20" />
                  <p className="font-medium text-lg">No lineup generated yet.</p>
                  <p className="text-sm max-w-[200px] mx-auto">Set your constraints and run the optimizer to see the best possible lineup.</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="card">
            <CardHeader>
              <CardTitle className="text-lg font-bold text-white">Live Data Sources</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3 p-3 bg-slate-900/50 rounded-lg border border-slate-800">
                <div className="w-10 h-10 rounded bg-blue-500/10 flex items-center justify-center text-blue-400">
                  <TrendingUp className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs font-bold text-white">RotoWire Projections</div>
                  <div className="text-[10px] text-slate-500 font-bold uppercase">Sync: 12m ago</div>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 bg-slate-900/50 rounded-lg border border-slate-800">
                <div className="w-10 h-10 rounded bg-emerald-500/10 flex items-center justify-center text-emerald-400">
                  <Zap className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs font-bold text-white">Vegas Odds & Totals</div>
                  <div className="text-[10px] text-slate-500 font-bold uppercase">Sync: Live</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

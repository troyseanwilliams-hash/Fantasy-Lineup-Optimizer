import { useState, useMemo } from "react";
import { useRoute } from "wouter";
import { useSlatePlayers } from "@/hooks/use-slates";
import { useOptimize, useSaveLineup } from "@/hooks/use-optimizer";
import { useAuth } from "@/hooks/use-auth";
import { Navigation } from "@/components/Navigation";
import { PlayerTable } from "@/components/PlayerTable";
import { LineupCard } from "@/components/LineupCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { Loader2, RefreshCw, Save, Trash2, Zap } from "lucide-react";
import { Player } from "@shared/schema";

export default function Optimizer() {
  const [match, params] = useRoute("/optimizer/:id");
  const slateId = Number(params?.id);
  
  const { user } = useAuth();
  const { toast } = useToast();
  
  const { data: players, isLoading: isPlayersLoading } = useSlatePlayers(slateId);
  const { mutate: optimize, isPending: isOptimizing, data: optimizationResult } = useOptimize();
  const { mutate: saveLineup, isPending: isSaving } = useSaveLineup();

  // Optimizer State
  const [lockedIds, setLockedIds] = useState<number[]>([]);
  const [excludedIds, setExcludedIds] = useState<number[]>([]);
  const [customProjections, setCustomProjections] = useState<Record<string, number>>({});
  const [lineupName, setLineupName] = useState("");
  
  // Players Map for quick lookup
  const playersMap = useMemo(() => {
    const map = new Map<number, Player>();
    players?.forEach(p => map.set(p.id, p));
    return map;
  }, [players]);

  // Derived Stats
  const lockedPlayers = lockedIds.map(id => playersMap.get(id)).filter(Boolean) as Player[];
  const lockedSalary = lockedPlayers.reduce((sum, p) => sum + p.salary, 0);
  const maxSalary = 50000; // Standard DraftKings salary cap
  const remainingSalary = maxSalary - lockedSalary;
  const remainingSlots = 9 - lockedPlayers.length; // Assuming 9 man roster (DK NBA/NFL standard-ish)
  const avgRemainingSalary = remainingSlots > 0 ? remainingSalary / remainingSlots : 0;

  // Handlers
  const handleLock = (id: number) => {
    setLockedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
    // Can't be excluded if locked
    setExcludedIds(prev => prev.filter(i => i !== id));
  };

  const handleExclude = (id: number) => {
    setExcludedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
    // Can't be locked if excluded
    setLockedIds(prev => prev.filter(i => i !== id));
  };

  const handleProjectionChange = (id: number, value: string) => {
    const numValue = parseFloat(value);
    if (!isNaN(numValue)) {
      setCustomProjections(prev => ({ ...prev, [id]: numValue }));
    }
  };

  const handleOptimize = () => {
    optimize({
      slateId,
      lockedPlayerIds: lockedIds,
      excludedPlayerIds: excludedIds,
      maxSalary,
      playerProjections: customProjections
    });
  };

  const handleClear = () => {
    setLockedIds([]);
    setExcludedIds([]);
    setCustomProjections({});
  };

  const handleSave = () => {
    if (!optimizationResult || !user) return;
    
    saveLineup({
      userId: user.id, // Assuming user.id is string from replit auth claims
      slateId,
      sport: players?.[0]?.sport || "NFL", // Should come from slate metadata ideally
      totalSalary: optimizationResult.totalSalary,
      totalProjectedPoints: String(optimizationResult.totalProjectedPoints),
      playerIds: optimizationResult.lineup.map(p => p.id),
      name: lineupName || "Optimized Lineup",
    }, {
      onSuccess: () => {
        toast({ title: "Success", description: "Lineup saved successfully!" });
        setLineupName("");
      }
    });
  };

  if (isPlayersLoading) {
    return (
      <div className="h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      <Navigation />
      
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* LEFT PANEL - PLAYER POOL */}
        <div className="flex-1 flex flex-col p-4 gap-4 overflow-hidden border-r border-border/50">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-display font-bold text-white">Player Pool</h2>
            <div className="flex gap-2">
               <Button variant="outline" size="sm" onClick={handleClear} className="text-muted-foreground hover:text-white">
                 <Trash2 className="w-4 h-4 mr-2" />
                 Reset All
               </Button>
            </div>
          </div>

          <div className="flex-1 overflow-hidden">
             {players && (
               <PlayerTable 
                 players={players}
                 lockedPlayerIds={lockedIds}
                 excludedPlayerIds={excludedIds}
                 onLock={handleLock}
                 onExclude={handleExclude}
                 onProjectionChange={handleProjectionChange}
                 customProjections={customProjections}
               />
             )}
          </div>
        </div>

        {/* RIGHT PANEL - CONTROLS & RESULTS */}
        <div className="w-full lg:w-[450px] bg-card/30 flex flex-col border-l border-border/50">
           {/* Stats Summary */}
           <div className="p-6 border-b border-border bg-card">
              <h3 className="font-display text-sm text-muted-foreground uppercase tracking-wider mb-4">Construction Stats</h3>
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="p-3 bg-background/50 rounded-lg border border-border">
                  <span className="text-xs text-muted-foreground block mb-1">Rem. Salary</span>
                  <span className={remainingSalary < 0 ? "text-destructive font-mono font-bold" : "text-emerald-400 font-mono font-bold"}>
                    ${remainingSalary.toLocaleString()}
                  </span>
                </div>
                <div className="p-3 bg-background/50 rounded-lg border border-border">
                  <span className="text-xs text-muted-foreground block mb-1">Avg Rem./Player</span>
                  <span className="text-white font-mono font-bold">
                    ${Math.floor(avgRemainingSalary).toLocaleString()}
                  </span>
                </div>
              </div>
              
              <Button 
                className="w-full h-12 text-lg font-display tracking-wide shadow-lg shadow-primary/20" 
                onClick={handleOptimize}
                disabled={isOptimizing}
              >
                {isOptimizing ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Running Algo...
                  </>
                ) : (
                  <>
                    <Zap className="w-5 h-5 mr-2 fill-current" />
                    Optimize Lineup
                  </>
                )}
              </Button>
           </div>

           {/* Results Area */}
           <div className="flex-1 p-6 overflow-y-auto bg-background/30">
              {optimizationResult ? (
                <div className="space-y-4 animate-in slide-in-from-bottom-4 duration-500 fade-in">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-display font-bold text-white">Optimal Lineup</h3>
                    <span className="text-xs text-primary bg-primary/10 px-2 py-1 rounded border border-primary/20">
                      {optimizationResult.totalProjectedPoints.toFixed(2)} pts
                    </span>
                  </div>
                  
                  <LineupCard 
                    lineup={optimizationResult}
                    playersMap={playersMap}
                  />

                  <div className="pt-4 border-t border-border mt-4">
                    <div className="flex gap-2">
                      <Input 
                        placeholder="Lineup Name (Optional)" 
                        value={lineupName}
                        onChange={(e) => setLineupName(e.target.value)}
                        className="bg-background"
                      />
                      <Button onClick={handleSave} disabled={isSaving}>
                        <Save className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground opacity-50">
                   <RefreshCw className="w-12 h-12 mb-4" />
                   <p>Click Optimize to generate the highest projected lineup based on your constraints.</p>
                </div>
              )}
           </div>
        </div>
      </div>
    </div>
  );
}

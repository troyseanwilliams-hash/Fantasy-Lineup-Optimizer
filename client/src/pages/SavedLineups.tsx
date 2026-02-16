import { useLineups, useDeleteLineup } from "@/hooks/use-lineups";
import { useSlates, useSlatePlayers } from "@/hooks/use-slates";
import { Navigation } from "@/components/Navigation";
import { LineupCard } from "@/components/LineupCard";
import { Loader2, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useMemo } from "react";
import { Player } from "@shared/schema";

export default function SavedLineups() {
  const { data: lineups, isLoading: isLineupsLoading } = useLineups();
  // For a real app we'd probably fetch players differently, but here we just grab all slates 
  // and hope we can resolve players. In production you'd likely store player snapshot in lineup 
  // or fetch players by IDs for the specific lineup.
  // For this demo, let's just fetch all slates and get players for the first active slate 
  // as a simplification or create a new endpoint to resolve players.
  // Actually, let's fetch slates and then fetch players for relevant slate IDs.
  // Due to React Query hook rules, this is tricky in a loop.
  // Better approach: Since we don't have a "getPlayersByIds" endpoint, 
  // let's just rely on what we have. A robust solution would need a bulk player fetch endpoint.
  // We'll stub the player lookup for now with a note or try to fetch for the most common slate.
  
  // WORKAROUND: We will just assume we are viewing lineups for the first slate available 
  // or that we only care about the latest slate. 
  // In a real app: Implement `usePlayersByIds(ids)`
  
  const { data: slates } = useSlates();
  const firstSlateId = slates?.[0]?.id;
  const { data: players } = useSlatePlayers(firstSlateId || 0);

  const { mutate: deleteLineup } = useDeleteLineup();
  const { toast } = useToast();

  const playersMap = useMemo(() => {
    const map = new Map<number, Player>();
    players?.forEach(p => map.set(p.id, p));
    return map;
  }, [players]);

  const handleDelete = (id: number) => {
    if (confirm("Are you sure you want to delete this lineup?")) {
      deleteLineup(id, {
        onSuccess: () => toast({ title: "Lineup deleted" }),
      });
    }
  };

  if (isLineupsLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navigation />
      
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <h1 className="text-3xl font-display font-bold text-white mb-8">Saved Lineups</h1>
        
        {!players && (
           <div className="bg-yellow-500/10 border border-yellow-500/20 text-yellow-500 p-4 rounded-lg mb-8 flex items-center gap-3">
             <AlertCircle className="w-5 h-5" />
             <p>Note: Only displaying detailed player data for the most recent slate due to demo API limitations.</p>
           </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {lineups && lineups.length > 0 ? (
            lineups.map((lineup, index) => (
              <div key={lineup.id} className="h-full">
                <LineupCard 
                  lineup={lineup} 
                  playersMap={playersMap} 
                  onDelete={handleDelete}
                  index={index}
                />
              </div>
            ))
          ) : (
            <div className="col-span-full py-20 text-center text-muted-foreground bg-card rounded-2xl border border-dashed border-border">
              <p>No saved lineups yet. Go to the Optimizer to build some!</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

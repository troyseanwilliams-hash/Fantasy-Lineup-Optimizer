import { useQuery } from "@tanstack/react-query";
import { Trophy, TrendingUp, Zap, Search, Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export default function SavedLineups() {
  const { user } = useAuth();
  const { toast } = useToast();

  const { data: lineups, isLoading } = useQuery({
    queryKey: ["/api/lineups"],
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(buildUrl(api.lineups.delete.path, { id }), {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete lineup");
    },
    onSuccess: () => {
      toast({ title: "Lineup Deleted", description: "The lineup has been removed from your vault." });
      queryClient.invalidateQueries({ queryKey: ["/api/lineups"] });
    }
  });

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-12">
        <Skeleton className="h-12 w-48 bg-slate-800 mb-8" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-64 bg-slate-800 rounded-2xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-12">
      <div className="flex items-center justify-between mb-12">
        <div>
          <h1 className="text-4xl font-bold text-white mb-2 tracking-tight">Lineup Vault</h1>
          <p className="text-slate-400">Your optimized winning combinations.</p>
        </div>
        <Link href="/">
          <Button className="btn-primary">
            Build New Lineup
          </Button>
        </Link>
      </div>

      {lineups?.length ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {lineups.map((lineup: any) => (
            <Card key={lineup.id} className="card bg-slate-800/30 border-slate-800 hover:border-slate-700 p-8 transition-all">
              <div className="flex justify-between items-start mb-6">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="bg-emerald-500/10 text-emerald-400 text-[10px] font-black px-2 py-0.5 rounded uppercase">
                      {lineup.sport}
                    </span>
                    <span className="text-slate-500 text-[10px] font-bold">
                      {new Date(lineup.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <h3 className="text-2xl font-bold text-white">{lineup.name || "Optimized Lineup"}</h3>
                </div>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  onClick={() => deleteMutation.mutate(lineup.id)}
                  className="text-slate-500 hover:text-red-400"
                >
                  <Trash2 className="w-5 h-5" />
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-8">
                <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-800/50">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Projection</p>
                  <p className="text-2xl font-bold text-[var(--primary)]">{Number(lineup.totalProjectedPoints).toFixed(1)}</p>
                </div>
                <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-800/50">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Salary</p>
                  <p className="text-2xl font-bold text-white">${lineup.totalSalary.toLocaleString()}</p>
                </div>
              </div>

              <div className="flex items-center justify-between pt-6 border-t border-slate-800">
                <div className="flex -space-x-2">
                  {[1,2,3,4].map(i => (
                    <div key={i} className="w-8 h-8 rounded-full bg-slate-700 border-2 border-slate-800 flex items-center justify-center text-[10px] font-bold text-white">
                      P
                    </div>
                  ))}
                  <div className="w-8 h-8 rounded-full bg-slate-900 border-2 border-slate-800 flex items-center justify-center text-[10px] font-bold text-slate-500">
                    +{lineup.playerIds.length - 4}
                  </div>
                </div>
                <Button variant="outline" className="text-slate-300 border-slate-700">
                  View Full Roster
                </Button>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <div className="py-24 text-center bg-slate-800/20 rounded-3xl border-2 border-dashed border-slate-800/50">
          <Zap className="w-16 h-16 text-slate-700 mx-auto mb-6" />
          <h5 className="text-xl font-bold text-slate-300 mb-2">No Saved Lineups</h5>
          <p className="text-slate-500 max-w-sm mx-auto">Once you optimize a lineup, save it to your vault to track performance and export to DFS sites.</p>
        </div>
      )}
    </div>
  );
}

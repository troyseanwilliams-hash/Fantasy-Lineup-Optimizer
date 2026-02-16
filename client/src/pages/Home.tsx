import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Trophy, TrendingUp, Zap, Users, Search, ChevronRight } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";

export default function Home() {
  const { user } = useAuth();
  const [selectedSport, setSelectedSport] = useState("NBA");

  const { data: slates, isLoading: slatesLoading } = useQuery({
    queryKey: ["/api/slates"],
  });

  if (!user) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center bg-[var(--bg-dark)]">
        <div className="text-center px-4 max-w-4xl">
          <div className="inline-flex items-center px-4 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm font-semibold mb-8">
            <Zap className="w-4 h-4 mr-2" />
            Next-Gen AI Sports Analytics
          </div>
          <h1 className="text-6xl md:text-8xl font-bold text-white mb-8 leading-[1.1] tracking-tight">
            Dominate DFS with <span className="text-[var(--primary)]">AI Precision</span>
          </h1>
          <p className="text-xl text-slate-400 mb-12 max-w-2xl mx-auto leading-relaxed">
            ProLineup AI uses real-time web data and advanced machine learning to build optimal lineups and find winning prop bets.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-6">
            <Button onClick={() => window.location.href = '/api/login'} className="btn-primary h-16 px-10 text-xl font-bold shadow-2xl shadow-emerald-500/20">
              Start Building Now
            </Button>
            <Button variant="outline" className="h-16 px-10 text-xl font-bold text-white border-slate-700 hover:bg-slate-800 transition-all">
              View Sample Data
            </Button>
          </div>
          <div className="mt-20 grid grid-cols-2 md:grid-cols-4 gap-8 opacity-50 grayscale hover:grayscale-0 transition-all duration-500">
            {/* Logo placeholders or icons could go here */}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-12">
      <div className="flex flex-col md:flex-row md:items-end justify-between mb-12 gap-6">
        <div>
          <h2 className="text-4xl font-bold text-white mb-3">Welcome back, {user.firstName || user.email?.split('@')[0]}</h2>
          <p className="text-lg text-slate-400">Your AI-optimized sports command center.</p>
        </div>
        <div className="flex bg-slate-800/50 backdrop-blur-sm border border-slate-700 rounded-xl p-1.5">
          {["NBA", "NFL", "MLB"].map((sport) => (
            <button
              key={sport}
              onClick={() => setSelectedSport(sport)}
              className={`px-6 py-2.5 rounded-lg text-sm font-bold transition-all duration-300 ${
                selectedSport === sport
                  ? "bg-[var(--primary)] text-white shadow-lg shadow-emerald-500/20"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {sport}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16">
        {[
          { label: "Active Slates", value: slates?.length || 0, icon: Trophy, color: "text-emerald-400", bg: "bg-emerald-400/10" },
          { label: "Top Value", value: "NBA", icon: TrendingUp, color: "text-blue-400", bg: "bg-blue-400/10" },
          { label: "AI Predictions", value: "24", icon: Zap, color: "text-yellow-400", bg: "bg-yellow-400/10" }
        ].map((stat, i) => (
          <Card key={i} className="card bg-slate-800/40 border-slate-700/50 backdrop-blur-md hover:border-slate-600 transition-all duration-300">
            <CardHeader className="flex flex-row items-center justify-between pb-4">
              <CardTitle className="text-xs font-bold text-slate-500 uppercase tracking-[0.2em]">{stat.label}</CardTitle>
              <div className={`${stat.bg} p-2 rounded-lg`}>
                <stat.icon className={`h-5 w-5 ${stat.color}`} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold text-white">{stat.value}</div>
              <div className="flex items-center text-xs font-medium text-emerald-400 mt-2">
                <TrendingUp className="w-3 h-3 mr-1" />
                +12% from yesterday
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mb-8 flex items-center justify-between">
        <h3 className="text-2xl font-bold text-white flex items-center">
          <Zap className="w-6 h-6 text-[var(--primary)] mr-3" />
          Live {selectedSport} Slates
        </h3>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        {slatesLoading ? (
          [1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-56 w-full bg-slate-800/50 rounded-2xl border border-slate-700/50" />)
        ) : slates?.length ? (
          slates.filter(s => s.sport === selectedSport).map((slate) => (
            <Link key={slate.id} href={`/optimizer/${slate.id}`}>
              <Card className="card group cursor-pointer border-slate-800 hover:border-[var(--primary)]/50 bg-slate-800/30 hover:bg-slate-800/50 transition-all duration-500 p-8 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-[var(--primary)]/5 blur-[60px] group-hover:bg-[var(--primary)]/10 transition-all"></div>
                
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-6">
                  <div>
                    <div className="flex items-center gap-3 mb-3">
                      <span className="bg-[var(--primary)]/10 text-[var(--primary)] text-[10px] font-black px-2.5 py-1 rounded-md tracking-tighter uppercase">
                        {slate.sport}
                      </span>
                      <span className="text-slate-500 text-xs font-bold">Starts {new Date(slate.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    <h4 className="text-3xl font-bold text-white group-hover:text-[var(--primary)] transition-colors tracking-tight">
                      {slate.name}
                    </h4>
                  </div>
                  <div className="flex -space-x-3">
                    {[1,2,3].map(i => (
                      <div key={i} className="w-10 h-10 rounded-full border-2 border-slate-800 bg-slate-700 flex items-center justify-center text-[10px] font-bold text-white">
                        P{i}
                      </div>
                    ))}
                    <div className="w-10 h-10 rounded-full border-2 border-slate-800 bg-slate-900 flex items-center justify-center text-[10px] font-bold text-slate-500">
                      +37
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4 border-t border-slate-700/50 pt-8">
                  <div className="text-center">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Top Proj</p>
                    <p className="text-lg font-bold text-white">284.2</p>
                  </div>
                  <div className="text-center border-x border-slate-700/50">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Avg Val</p>
                    <p className="text-lg font-bold text-emerald-400">5.4x</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Entries</p>
                    <p className="text-lg font-bold text-white">1.2k</p>
                  </div>
                </div>

                <div className="mt-8 flex items-center text-[var(--primary)] font-bold text-sm">
                  Launch Optimizer
                  <ChevronRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
                </div>
              </Card>
            </Link>
          ))
        ) : (
          <div className="col-span-full py-24 text-center bg-slate-800/20 rounded-3xl border-2 border-dashed border-slate-800/50">
            <Search className="w-16 h-16 text-slate-700 mx-auto mb-6" />
            <h5 className="text-xl font-bold text-slate-300 mb-2">No Active {selectedSport} Slates</h5>
            <p className="text-slate-500">Check back later for updated professional projections.</p>
          </div>
        )}
      </div>
    </div>
  );
}

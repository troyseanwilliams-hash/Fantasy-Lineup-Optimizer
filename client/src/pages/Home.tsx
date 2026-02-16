import { useQuery } from "@tanstack/react-query";
import { Zap, Trophy, ChevronRight, Loader2, Calendar, Clock, Crown } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link, useLocation } from "wouter";
import type { Slate } from "@shared/schema";

export default function Home() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();

  const { data: slates, isLoading } = useQuery<Slate[]>({
    queryKey: ["/api/slates"],
  });

  const mainSlates = slates?.filter(s => s.isMain) || [];
  const nbaSlates = mainSlates.filter(s => s.sport === "NBA");
  const nflSlates = mainSlates.filter(s => s.sport === "NFL");

  if (!user) {
    return (
      <div className="min-h-[calc(100vh-80px)] flex items-center justify-center">
        <div className="text-center px-4 max-w-4xl">
          <div className="inline-flex items-center px-4 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm font-bold mb-8">
            <Zap className="w-4 h-4 mr-2 fill-current" />
            AI-Powered DFS Optimizer
          </div>
          <h1 className="text-6xl md:text-8xl font-black text-white mb-8 leading-[1.05] tracking-tight">
            Build Winning<br />
            <span className="text-emerald-400">DFS Lineups</span>
          </h1>
          <p className="text-xl text-slate-400 mb-6 max-w-2xl mx-auto leading-relaxed">
            Advanced lineup optimizer for DraftKings and FanDuel. Real player projections, LP-based optimization, and instant lineup building.
          </p>
          <div className="flex items-center justify-center gap-3 mb-12">
            <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 font-bold text-sm px-3 py-1">DraftKings</Badge>
            <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/20 font-bold text-sm px-3 py-1">FanDuel</Badge>
          </div>
          <Button
            onClick={() => (window.location.href = "/api/login")}
            className="h-16 px-12 text-xl font-black bg-emerald-500 hover:bg-emerald-600 text-white shadow-2xl shadow-emerald-500/20"
            data-testid="login-btn"
          >
            Get Started Free
          </Button>
          <p className="text-sm text-slate-500 mt-4">1 free optimized lineup. Upgrade for more.</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="h-[60vh] flex items-center justify-center">
        <Loader2 className="w-10 h-10 text-emerald-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-12 max-w-5xl">
      <div className="mb-12">
        <h2 className="text-4xl font-black text-white mb-3 tracking-tight">
          Welcome back, {user.firstName || (user.email as string)?.split("@")[0]}
        </h2>
        <p className="text-lg text-slate-400">Select a main slate to start building lineups.</p>
      </div>

      {nbaSlates.length > 0 && (
        <div className="mb-12">
          <div className="flex items-center gap-3 mb-6">
            <Trophy className="w-6 h-6 text-emerald-400" />
            <h3 className="text-2xl font-black text-white">NBA Main Slates</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {nbaSlates.map(slate => {
              const isFD = slate.platform === "fanduel";
              const accent = isFD ? "blue" : "emerald";
              return (
                <Link key={slate.id} href={`/optimizer/${slate.id}`}>
                  <Card className={`group cursor-pointer bg-slate-800/30 border-slate-800 hover:border-${accent}-500/40 p-6 transition-all duration-300 hover:shadow-xl hover:shadow-${accent}-500/5`} data-testid={`slate-card-${slate.id}`}>
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`inline-block bg-${accent}-500/10 text-${accent}-400 text-[10px] font-black px-2 py-0.5 rounded uppercase tracking-wider`}>
                            {slate.sport}
                          </span>
                          <Badge className={`text-[9px] font-black ${isFD ? "bg-blue-500/20 text-blue-400 border-blue-500/30" : "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"}`}>
                            {isFD ? "FanDuel" : "DraftKings"}
                          </Badge>
                        </div>
                        <h4 className={`text-xl font-bold text-white group-hover:text-${accent}-400 transition-colors`}>
                          {slate.name}
                        </h4>
                      </div>
                      <ChevronRight className={`w-5 h-5 text-slate-600 group-hover:text-${accent}-400 group-hover:translate-x-1 transition-all`} />
                    </div>
                    <div className="flex items-center gap-4 text-sm text-slate-500">
                      <div className="flex items-center gap-1.5">
                        <Calendar className="w-4 h-4" />
                        <span>{new Date(slate.startTime).toLocaleDateString()}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-4 h-4" />
                        <span>{new Date(slate.startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                      </div>
                      <span className="text-[10px] font-bold text-slate-600">
                        {isFD ? "$60K Cap • 9 Players" : "$50K Cap • 8 Players"}
                      </span>
                    </div>
                    <div className={`mt-4 pt-4 border-t border-slate-800 flex items-center text-${accent}-400 text-sm font-bold`}>
                      <Zap className="w-4 h-4 mr-2 fill-current" />
                      Open Optimizer
                    </div>
                  </Card>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {nflSlates.length > 0 && (
        <div>
          <div className="flex items-center gap-3 mb-6">
            <Trophy className="w-6 h-6 text-blue-400" />
            <h3 className="text-2xl font-black text-white">NFL Main Slates</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {nflSlates.map(slate => (
              <Link key={slate.id} href={`/optimizer/${slate.id}`}>
                <Card className="group cursor-pointer bg-slate-800/30 border-slate-800 hover:border-blue-500/40 p-6 transition-all duration-300" data-testid={`slate-card-${slate.id}`}>
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <span className="inline-block bg-blue-500/10 text-blue-400 text-[10px] font-black px-2 py-0.5 rounded uppercase tracking-wider mb-2">
                        {slate.sport}
                      </span>
                      <h4 className="text-xl font-bold text-white group-hover:text-blue-400 transition-colors">
                        {slate.name}
                      </h4>
                    </div>
                    <ChevronRight className="w-5 h-5 text-slate-600 group-hover:text-blue-400 group-hover:translate-x-1 transition-all" />
                  </div>
                  <div className="flex items-center gap-4 text-sm text-slate-500">
                    <div className="flex items-center gap-1.5">
                      <Calendar className="w-4 h-4" />
                      <span>{new Date(slate.startTime).toLocaleDateString()}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-4 h-4" />
                      <span>{new Date(slate.startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                    </div>
                  </div>
                  <div className="mt-4 pt-4 border-t border-slate-800 flex items-center text-blue-400 text-sm font-bold">
                    <Zap className="w-4 h-4 mr-2" />
                    Open Optimizer
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

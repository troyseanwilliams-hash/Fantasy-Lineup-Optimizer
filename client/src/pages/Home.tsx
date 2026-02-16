import { useEffect } from "react";
import { Zap, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useLocation } from "wouter";
import { ACTIVE_SPORTS } from "@shared/platform-config";

export default function Home() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (user) {
      const defaultSport = ACTIVE_SPORTS[0]?.toLowerCase() || "nba";
      setLocation(`/news/${defaultSport}`);
    }
  }, [user, setLocation]);

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
          <div className="flex items-center justify-center gap-3 mb-6">
            {ACTIVE_SPORTS.map(sport => (
              <Badge key={sport} className="bg-slate-800/50 text-slate-300 border-slate-700 font-bold text-sm px-3 py-1">
                {sport}
              </Badge>
            ))}
          </div>
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
          <p className="text-sm text-slate-400 mt-4">1 free optimized lineup. Upgrade for more.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[60vh] flex items-center justify-center">
      <Loader2 className="w-10 h-10 text-emerald-500 animate-spin" />
    </div>
  );
}

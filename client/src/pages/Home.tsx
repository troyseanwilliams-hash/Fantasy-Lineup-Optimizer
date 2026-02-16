import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Zap, Trophy, ChevronRight, Loader2, Calendar, Clock, Crown, TrendingUp } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link, useLocation } from "wouter";
import type { Slate } from "@shared/schema";
import { SPORT_ORDER, ACTIVE_SPORTS, getPlatformConfig, type Platform, type Sport } from "@shared/platform-config";

export default function Home() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();

  const { data: slates, isLoading } = useQuery<Slate[]>({
    queryKey: ["/api/slates"],
  });

  const mainSlates = slates?.filter(s => s.isMain) || [];

  const availableSports = useMemo(() => {
    const sports = new Set(mainSlates.map(s => s.sport));
    return ACTIVE_SPORTS.filter(s => sports.has(s));
  }, [mainSlates]);

  const [selectedSport, setSelectedSport] = useState<string | null>(null);

  const activeSport = selectedSport && availableSports.includes(selectedSport as Sport)
    ? selectedSport
    : availableSports[0] || "NBA";

  const sportSlates = mainSlates.filter(s => s.sport === activeSport);

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

  function getSlateCapInfo(slate: Slate) {
    try {
      const config = getPlatformConfig(slate.sport, (slate.platform || "draftkings") as Platform);
      return `$${(config.salaryCap / 1000).toFixed(0)}K Cap • ${config.rosterSize} Players`;
    } catch {
      return "";
    }
  }

  return (
    <div className="container mx-auto px-4 py-12 max-w-5xl">
      <div className="mb-8">
        <h2 className="text-4xl font-black text-white mb-3 tracking-tight">
          Welcome back, {user.firstName || (user.email as string)?.split("@")[0]}
        </h2>
        <p className="text-lg text-slate-400">Select a main slate to start building lineups.</p>
      </div>

      {availableSports.length > 1 && (
        <div className="flex gap-2 mb-8 bg-slate-900/60 rounded-xl p-1.5 border border-slate-800 w-fit" data-testid="sport-selector">
          {availableSports.map(sport => (
            <button
              key={sport}
              onClick={() => setSelectedSport(sport)}
              data-testid={`sport-tab-${sport}`}
              className={`px-5 py-2.5 rounded-lg text-sm font-black transition-all flex items-center gap-2 ${
                activeSport === sport
                  ? "bg-emerald-500 text-white shadow-lg shadow-emerald-500/20"
                  : "text-slate-400 hover:text-white hover:bg-slate-800"
              }`}
            >
              {sport}
            </button>
          ))}
        </div>
      )}

      <div className="mb-6">
        <div className="flex items-center gap-3 mb-6">
          <Trophy className="w-6 h-6 text-emerald-400" />
          <h3 className="text-2xl font-black text-white">
            {activeSport} Main Slates
          </h3>
        </div>

        {sportSlates.length === 0 ? (
          <Card className="bg-slate-800/20 border-slate-800 p-8 text-center">
            <p className="text-slate-500 font-bold">No {activeSport} slates available yet.</p>
            <p className="text-slate-600 text-sm mt-1">Check back later or seed data from the admin panel.</p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {sportSlates.map(slate => {
              const isFD = slate.platform === "fanduel";
              return (
                <Card
                  key={slate.id}
                  className="group cursor-pointer bg-slate-800/30 border-slate-800 p-6 transition-all hover-elevate"
                  data-testid={`slate-card-${slate.id}`}
                  onClick={() => setLocation(`/optimizer/${slate.id}`)}
                >
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`inline-block text-[10px] font-black px-2 py-0.5 rounded uppercase tracking-wider ${isFD ? "bg-blue-500/10 text-blue-400" : "bg-emerald-500/10 text-emerald-400"}`}>
                          {slate.sport}
                        </span>
                        <Badge className={`text-[9px] font-black ${isFD ? "bg-blue-500/20 text-blue-400 border-blue-500/30" : "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"}`}>
                          {isFD ? "FanDuel" : "DraftKings"}
                        </Badge>
                      </div>
                      <h4 className="text-xl font-bold text-white">
                        {slate.name}
                      </h4>
                    </div>
                    <ChevronRight className="w-5 h-5 text-slate-600" />
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
                      {getSlateCapInfo(slate)}
                    </span>
                  </div>
                  <div className={`mt-4 pt-4 border-t border-slate-800 flex items-center text-sm font-bold ${isFD ? "text-blue-400" : "text-emerald-400"}`}>
                    <Zap className="w-4 h-4 mr-2 fill-current" />
                    Open Optimizer
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-10 pt-8 border-t border-slate-800">
        <Link href="/props">
          <Card
            className="cursor-pointer bg-gradient-to-r from-emerald-900/20 to-slate-900/50 border-emerald-700/20 p-6 transition-all hover-elevate"
            data-testid="prop-bets-cta"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-emerald-500/20 flex items-center justify-center">
                  <TrendingUp className="w-6 h-6 text-emerald-400" />
                </div>
                <div>
                  <h4 className="text-lg font-black text-white mb-1">AI Prop Bets</h4>
                  <p className="text-sm text-slate-400">Daily AI-generated player prop picks across all sports</p>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-slate-600" />
            </div>
          </Card>
        </Link>
      </div>
    </div>
  );
}

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { Lock, TrendingUp, Crown, Zap, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { SPORT_ORDER, type Sport } from "@shared/platform-config";

interface PropBet {
  id: number;
  sport: string;
  playerName: string;
  team: string;
  opponent: string;
  propType: string;
  line: string;
  pick: string;
  confidence: string;
  gameInfo: string;
  isLocked: boolean;
}

interface PropsResponse {
  props: PropBet[];
  tier: string;
  totalCount: number;
  lockedCount?: number;
  freeCount: number;
}

export default function PropBets() {
  const { user } = useAuth();
  const [selectedSport, setSelectedSport] = useState<string>("ALL");

  const { data, isLoading } = useQuery<PropsResponse>({
    queryKey: ["/api/props", selectedSport === "ALL" ? undefined : selectedSport],
    queryFn: async () => {
      const params = selectedSport !== "ALL" ? `?sport=${selectedSport}` : "";
      const res = await fetch(`/api/props${params}`);
      return res.json();
    },
  });

  const isPro = data?.tier === "pro";

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-12">
        <Skeleton className="h-12 w-64 bg-slate-800 mb-8" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5, 6].map(i => <Skeleton key={i} className="h-48 bg-slate-800 rounded-2xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-12">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-10 gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-4xl font-black text-white tracking-tight" data-testid="prop-bets-title">Prop Bets</h1>
            <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-xs font-black">
              <Zap className="w-3 h-3 mr-1 fill-current" /> AI PICKS
            </Badge>
          </div>
          <p className="text-slate-400">
            Daily AI-generated player prop picks ranked by confidence.
            {!isPro && (
              <span className="text-amber-400 font-bold ml-1">
                {data?.freeCount || 3} free picks daily
              </span>
            )}
          </p>
        </div>
        {!isPro && (
          <Link href="/pricing">
            <Button className="bg-amber-500 hover:bg-amber-600 text-black font-black shadow-lg shadow-amber-500/20" data-testid="upgrade-props-btn">
              <Crown className="w-4 h-4 mr-2" /> Unlock All Picks
            </Button>
          </Link>
        )}
      </div>

      <div className="flex items-center gap-2 mb-8 overflow-x-auto pb-2" data-testid="sport-filter">
        {["ALL", ...SPORT_ORDER].map(sport => (
          <Button
            key={sport}
            variant={selectedSport === sport ? "default" : "outline"}
            size="sm"
            onClick={() => setSelectedSport(sport)}
            className={`font-bold text-xs px-4 ${
              selectedSport === sport
                ? "bg-emerald-500 text-white hover:bg-emerald-600"
                : "border-slate-700 text-slate-400 hover:text-white hover:border-slate-600"
            }`}
            data-testid={`sport-filter-${sport.toLowerCase()}`}
          >
            {sport}
          </Button>
        ))}
      </div>

      {(!data?.props || data.props.length === 0) && !data?.lockedCount ? (
        <div className="py-24 text-center bg-slate-800/20 rounded-3xl border-2 border-dashed border-slate-800/50">
          <TrendingUp className="w-16 h-16 text-slate-700 mx-auto mb-6" />
          <h5 className="text-xl font-bold text-slate-300 mb-2">No Props Available</h5>
          <p className="text-slate-500 max-w-sm mx-auto">Props are generated daily from player projections. Check back soon!</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6" data-testid="props-grid">
            {data?.props.map((prop, index) => (
              <Card
                key={prop.id}
                className="bg-slate-800/30 border-slate-800 hover:border-slate-700 p-6 transition-all group"
                data-testid={`prop-card-${index}`}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[10px] font-black">
                      {prop.sport}
                    </Badge>
                    <span className="text-[10px] font-bold text-slate-500">{prop.team} vs {prop.opponent}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className={`px-2 py-0.5 rounded text-[10px] font-black ${
                      Number(prop.confidence) >= 75
                        ? "bg-emerald-500/20 text-emerald-400"
                        : Number(prop.confidence) >= 65
                        ? "bg-amber-500/20 text-amber-400"
                        : "bg-slate-700/50 text-slate-400"
                    }`} data-testid={`prop-confidence-${index}`}>
                      {Number(prop.confidence).toFixed(0)}%
                    </div>
                  </div>
                </div>

                <h3 className="text-lg font-bold text-white mb-1" data-testid={`prop-player-${index}`}>{prop.playerName}</h3>
                <p className="text-sm text-slate-500 mb-4">{prop.gameInfo}</p>

                <div className="flex items-center justify-between bg-slate-900/50 rounded-xl px-4 py-3 border border-slate-800/50">
                  <div>
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">{prop.propType}</p>
                    <p className="text-xl font-black text-white">{prop.line}</p>
                  </div>
                  <div className={`flex items-center gap-1 px-3 py-1.5 rounded-lg font-black text-sm ${
                    prop.pick === "Over"
                      ? "bg-emerald-500/20 text-emerald-400"
                      : "bg-red-500/20 text-red-400"
                  }`} data-testid={`prop-pick-${index}`}>
                    {prop.pick === "Over" ? (
                      <ArrowUpRight className="w-4 h-4" />
                    ) : (
                      <ArrowDownRight className="w-4 h-4" />
                    )}
                    {prop.pick}
                  </div>
                </div>
              </Card>
            ))}

            {!isPro && data?.lockedCount && data.lockedCount > 0 && (
              Array.from({ length: Math.min(data.lockedCount, 6) }).map((_, i) => (
                <Card
                  key={`locked-${i}`}
                  className="bg-slate-800/20 border-slate-800/50 p-6 relative overflow-hidden"
                  data-testid={`prop-locked-${i}`}
                >
                  <div className="absolute inset-0 backdrop-blur-sm bg-slate-900/60 z-10 flex flex-col items-center justify-center">
                    <Lock className="w-8 h-8 text-amber-500/60 mb-3" />
                    <p className="text-sm font-bold text-slate-300 mb-1">Pro Pick</p>
                    <p className="text-[10px] text-slate-500 mb-3">Higher confidence pick</p>
                    <Link href="/pricing">
                      <Button size="sm" className="bg-amber-500 hover:bg-amber-600 text-black font-bold text-xs">
                        <Crown className="w-3 h-3 mr-1" /> Unlock
                      </Button>
                    </Link>
                  </div>
                  <div className="opacity-20">
                    <div className="flex items-center gap-2 mb-4">
                      <div className="w-12 h-3 bg-slate-700 rounded" />
                      <div className="w-16 h-3 bg-slate-700 rounded" />
                    </div>
                    <div className="w-32 h-5 bg-slate-700 rounded mb-2" />
                    <div className="w-24 h-3 bg-slate-700 rounded mb-4" />
                    <div className="bg-slate-900/50 rounded-xl px-4 py-3">
                      <div className="w-20 h-3 bg-slate-700 rounded mb-2" />
                      <div className="w-12 h-6 bg-slate-700 rounded" />
                    </div>
                  </div>
                </Card>
              ))
            )}
          </div>

          {!isPro && data?.lockedCount && data.lockedCount > 6 && (
            <div className="mt-8 text-center">
              <p className="text-slate-500 text-sm mb-4">
                + {data.lockedCount - 6} more locked picks available with Pro
              </p>
              <Link href="/pricing">
                <Button className="bg-amber-500 hover:bg-amber-600 text-black font-black">
                  <Crown className="w-4 h-4 mr-2" /> See All {data.totalCount} Picks
                </Button>
              </Link>
            </div>
          )}
        </>
      )}
    </div>
  );
}

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Zap, Newspaper, TrendingUp, ArrowRight, Clock, ExternalLink,
  ArrowUpRight, ArrowDownRight, Archive, Crown, Trophy, Dribbble,
  Activity, Target, Lock, Sparkles, Star, Flame, Shield, Swords, Flag
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { ACTIVE_SPORTS } from "@shared/platform-config";
import type { Slate } from "@shared/schema";

const SPORT_LOGO_PATH: Record<string, string> = {
  NBA: "nba", NHL: "nhl", MLB: "mlb", NFL: "nfl", GOLF: "golf",
};
const TEAM_ABBREV_MAP: Record<string, string> = {
  PHX: "phx", WSH: "wsh", WAS: "wsh", BKN: "bkn", NYK: "ny", NYM: "nym",
  NYY: "nyy", NYJ: "nyj", NYR: "nyr", NYI: "nyi", LAL: "lal", LAC: "lac",
  NOP: "no", SAS: "sa", GS: "gs", SA: "sa", NO: "no", TB: "tb", SF: "sf",
  GB: "gb", NE: "ne", KC: "kc", LV: "lv", JAX: "jax", IND: "ind",
};
function getTeamLogoUrl(team: string, sport: string): string {
  const sportPath = SPORT_LOGO_PATH[sport] || "nba";
  const abbrev = TEAM_ABBREV_MAP[team] || team.toLowerCase();
  return `https://a.espncdn.com/i/teamlogos/${sportPath}/500/${abbrev}.png`;
}
const SPORT_FALLBACK_IMAGE: Record<string, string> = {
  NBA: "/images/fallback-nba.png",
  NHL: "/images/fallback-nhl.png",
  MLB: "/images/fallback-mlb.png",
  NFL: "/images/fallback-nfl.png",
  GOLF: "/images/sport-golf.png",
};

function TeamLogo({ team, sport, size = 20 }: { team: string; sport: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <img
        src={SPORT_FALLBACK_IMAGE[sport] || SPORT_FALLBACK_IMAGE.NBA}
        alt={team}
        className="rounded-full bg-slate-800/60 object-contain shrink-0"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <img
      src={getTeamLogoUrl(team, sport)}
      alt={team}
      className="rounded-full bg-slate-800/50 object-contain shrink-0"
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
    />
  );
}

const heroBg = "/images/hero-bg.png";
const sportNba = "/images/sport-nba.png";
const sportNhl = "/images/sport-nhl.png";
const sportMlb = "/images/sport-mlb.png";
const sportNfl = "/images/sport-nfl.png";
const sportGolf = "/images/sport-golf.png";

interface DashboardPlayer {
  id: number;
  name: string;
  position: string;
  team: string;
  salary: number;
  projectedPoints: string;
  fppg: string;
  opponent: string;
  gameInfo: string;
}

interface TrendingPlayer extends DashboardPlayer {
  valueScore: string;
  direction: "up" | "down";
}

interface MatchupData {
  gameInfo: string;
  playerCount: number;
  avgProjection: string;
  topPlayer: {
    id: number;
    name: string;
    position: string;
    team: string;
    salary: number;
    projectedPoints: string;
  } | null;
}

interface DashboardResponse {
  sport: string;
  slateId: number | null;
  topScorers: DashboardPlayer[];
  trending: TrendingPlayer[];
  matchups: MatchupData[];
}

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
  maxPerSport: number;
}

interface NewsArticle {
  id: string;
  headline: string;
  description: string;
  published: string;
  linkUrl: string | null;
}

const SPORT_META: Record<string, {
  icon: typeof Dribbble;
  color: string;
  textColor: string;
  bgColor: string;
  borderColor: string;
  gradientFrom: string;
  image: string;
}> = {
  NBA: {
    icon: Dribbble, color: "text-orange-400", textColor: "text-orange-300",
    bgColor: "bg-orange-500/20", borderColor: "border-orange-500/30",
    gradientFrom: "from-orange-900/60", image: sportNba,
  },
  NHL: {
    icon: Activity, color: "text-cyan-400", textColor: "text-cyan-300",
    bgColor: "bg-cyan-500/20", borderColor: "border-cyan-500/30",
    gradientFrom: "from-cyan-900/60", image: sportNhl,
  },
  MLB: {
    icon: Target, color: "text-red-400", textColor: "text-red-300",
    bgColor: "bg-red-500/20", borderColor: "border-red-500/30",
    gradientFrom: "from-red-900/60", image: sportMlb,
  },
  NFL: {
    icon: Shield, color: "text-green-400", textColor: "text-green-300",
    bgColor: "bg-green-500/20", borderColor: "border-green-500/30",
    gradientFrom: "from-green-900/60", image: sportNfl,
  },
  GOLF: {
    icon: Flag, color: "text-lime-400", textColor: "text-lime-300",
    bgColor: "bg-lime-500/20", borderColor: "border-lime-500/30",
    gradientFrom: "from-lime-900/60", image: sportGolf,
  },
};

function timeAgo(dateStr: string): string {
  const now = new Date();
  const published = new Date(dateStr);
  const diffMs = now.getTime() - published.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  return `${Math.floor(diffHrs / 24)}d ago`;
}

function HeroBanner({ firstName, tier }: { firstName: string; tier: string }) {
  return (
    <div className="relative rounded-2xl overflow-hidden mb-8" data-testid="dashboard-hero">
      <img src={heroBg} alt="" className="absolute inset-0 w-full h-full object-cover" />
      <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/60 to-transparent" />
      <div className="relative z-10 px-8 py-10 md:py-14">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Zap className="w-5 h-5 text-emerald-400 fill-current" />
              <span className="text-emerald-400 text-sm font-black uppercase tracking-widest">EliteLineup AI</span>
            </div>
            <h1 className="text-3xl md:text-4xl font-black text-white tracking-tight leading-tight">
              Welcome back, <span className="text-emerald-400">{firstName}</span>
            </h1>
            <p className="text-slate-300 text-sm mt-2 font-bold">
              {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {tier === "pro" ? (
              <Badge className="bg-amber-500/30 text-amber-300 border-amber-500/40 text-sm font-black px-4 py-1.5 gap-1.5 backdrop-blur-sm">
                <Crown className="w-4 h-4" /> Pro Member
              </Badge>
            ) : tier === "star" ? (
              <Badge className="bg-emerald-500/30 text-emerald-300 border-emerald-500/40 text-sm font-black px-4 py-1.5 gap-1.5 backdrop-blur-sm">
                <Trophy className="w-4 h-4" /> Star Member
              </Badge>
            ) : (
              <Link href="/pricing">
                <Button size="sm" className="bg-emerald-500 hover:bg-emerald-600 text-white font-bold gap-1.5 shadow-lg shadow-emerald-500/20" data-testid="dashboard-upgrade-btn">
                  <Sparkles className="w-4 h-4" /> Upgrade Plan
                </Button>
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SportSelector({ activeSport, onSelect }: { activeSport: string; onSelect: (s: typeof ACTIVE_SPORTS[number]) => void }) {
  return (
    <div className="flex gap-3 mb-8" data-testid="dashboard-sport-selector">
      {ACTIVE_SPORTS.map(sport => {
        const meta = SPORT_META[sport] || SPORT_META.NBA;
        const Icon = meta.icon;
        const isActive = sport === activeSport;
        return (
          <button
            key={sport}
            onClick={() => onSelect(sport)}
            className={`relative flex-1 rounded-xl overflow-hidden transition-all cursor-pointer group ${
              isActive ? `ring-2 ring-offset-2 ring-offset-slate-950 ${meta.borderColor.replace("border-", "ring-")}` : "opacity-70 hover:opacity-100"
            }`}
            data-testid={`sport-tab-${sport.toLowerCase()}`}
          >
            <img src={meta.image} alt={sport} className="absolute inset-0 w-full h-full object-cover" />
            <div className={`absolute inset-0 bg-gradient-to-t ${meta.gradientFrom} to-black/70 group-hover:to-black/60 transition-colors`} />
            <div className="relative z-10 px-4 py-4 text-center">
              <Icon className={`w-6 h-6 mx-auto mb-1.5 ${isActive ? meta.color : "text-slate-300"}`} />
              <span className={`text-sm font-black tracking-wide ${isActive ? "text-white" : "text-slate-300"}`}>{sport}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function TopScorersSection({ players, slateId, sport }: { players: DashboardPlayer[]; slateId: number | null; sport: string }) {
  if (!players.length) return null;

  return (
    <div data-testid="top-scorers-section">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center">
            <Flame className="w-4 h-4 text-amber-400" />
          </div>
          <h2 className="text-lg font-black text-white tracking-tight">Top Fantasy Scorers</h2>
        </div>
        {slateId && (
          <Link href={`/optimizer/${slateId}`}>
            <Button variant="ghost" size="sm" className="text-emerald-400 hover:text-emerald-300 font-bold gap-1 text-xs" data-testid="optimize-from-scorers">
              Build Lineup <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </Link>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {players.slice(0, 8).map((player, idx) => (
          <Card
            key={player.id}
            className="bg-slate-800/40 border-slate-700/50 p-4 transition-all hover:bg-slate-800/60 hover:border-slate-600/50"
            data-testid={`top-scorer-${player.id}`}
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                <TeamLogo team={player.team} sport={sport} size={32} />
                <div>
                  <p className="text-sm font-bold text-white leading-tight">{player.name}</p>
                  <p className="text-[11px] text-slate-400 font-bold">{player.position} - {player.team}</p>
                </div>
              </div>
              <span className="text-lg font-black text-slate-700">#{idx + 1}</span>
            </div>
            <div className="flex items-center justify-between mt-2">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-slate-500 font-bold">vs</span>
                <TeamLogo team={player.opponent} sport={sport} size={16} />
                <span className="text-[11px] text-slate-500 font-bold">{player.opponent}</span>
              </div>
              <div className="text-right">
                <p className="text-lg font-black text-emerald-400">{parseFloat(player.projectedPoints).toFixed(1)}</p>
                <p className="text-[11px] text-slate-500 font-bold">${(player.salary / 1000).toFixed(1)}K</p>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function TrendingSection({ players, sport }: { players: TrendingPlayer[]; sport: string }) {
  const trendingUp = players.filter(p => p.direction === "up");
  const trendingDown = players.filter(p => p.direction === "down");

  if (!players.length) return null;

  return (
    <div data-testid="trending-section">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center">
          <TrendingUp className="w-4 h-4 text-emerald-400" />
        </div>
        <h2 className="text-lg font-black text-white tracking-tight">Trending Players</h2>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <div className="flex items-center gap-2 mb-3">
            <ArrowUpRight className="w-4 h-4 text-emerald-400" />
            <span className="text-sm font-black text-emerald-400 uppercase tracking-wider">Best Value</span>
          </div>
          <div className="space-y-2">
            {trendingUp.map(player => (
              <Card
                key={player.id}
                className="bg-emerald-950/30 border-emerald-800/30 p-3 flex items-center justify-between gap-3"
                data-testid={`trending-up-${player.id}`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <TeamLogo team={player.team} sport={sport} size={28} />
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-white truncate">{player.name}</p>
                    <p className="text-[11px] text-slate-400 font-bold">{player.position} - {player.team} vs {player.opponent}</p>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-black text-emerald-400">{parseFloat(player.projectedPoints).toFixed(1)} pts</p>
                  <p className="text-[11px] text-slate-500 font-bold">${(player.salary / 1000).toFixed(1)}K | {player.valueScore}x</p>
                </div>
              </Card>
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-center gap-2 mb-3">
            <ArrowDownRight className="w-4 h-4 text-red-400" />
            <span className="text-sm font-black text-red-400 uppercase tracking-wider">Overpriced</span>
          </div>
          <div className="space-y-2">
            {trendingDown.map(player => (
              <Card
                key={player.id}
                className="bg-red-950/20 border-red-800/20 p-3 flex items-center justify-between gap-3"
                data-testid={`trending-down-${player.id}`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <TeamLogo team={player.team} sport={sport} size={28} />
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-white truncate">{player.name}</p>
                    <p className="text-[11px] text-slate-400 font-bold">{player.position} - {player.team} vs {player.opponent}</p>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-black text-red-400">{parseFloat(player.projectedPoints).toFixed(1)} pts</p>
                  <p className="text-[11px] text-slate-500 font-bold">${(player.salary / 1000).toFixed(1)}K | {player.valueScore}x</p>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function MatchupsSection({ matchups, sport }: { matchups: MatchupData[]; sport: string }) {
  if (!matchups.length) return null;

  return (
    <div data-testid="matchups-section">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center">
          <Swords className="w-4 h-4 text-purple-400" />
        </div>
        <h2 className="text-lg font-black text-white tracking-tight">Best Matchups</h2>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {matchups.map((m, idx) => (
          <Card
            key={idx}
            className="bg-slate-800/40 border-slate-700/50 p-4 transition-all hover:bg-slate-800/60 hover:border-slate-600/50"
            data-testid={`matchup-${idx}`}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                {(() => {
                  const parts = m.gameInfo.match(/^(\w+)\s*[@vs]+\s*(\w+)/i);
                  if (parts) {
                    return (
                      <div className="flex items-center gap-1.5">
                        <TeamLogo team={parts[1]} sport={sport} size={22} />
                        <span className="text-[10px] font-black text-slate-500">vs</span>
                        <TeamLogo team={parts[2]} sport={sport} size={22} />
                      </div>
                    );
                  }
                  return null;
                })()}
                <p className="text-sm font-black text-white">{m.gameInfo}</p>
              </div>
              <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30 text-[11px] font-black px-1.5 py-0">
                {m.playerCount} players
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] text-slate-500 font-bold uppercase tracking-wider">Avg Proj</p>
                <p className="text-lg font-black text-white">{m.avgProjection}</p>
              </div>
              {m.topPlayer && (
                <div className="text-right">
                  <p className="text-[11px] text-slate-500 font-bold uppercase tracking-wider">Top Player</p>
                  <p className="text-sm font-bold text-emerald-400">{m.topPlayer.name}</p>
                  <p className="text-[11px] text-slate-500 font-bold">{m.topPlayer.projectedPoints} pts</p>
                </div>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function DailyPicksCompact() {
  const { data, isLoading } = useQuery<PropsResponse>({
    queryKey: ["/api/props"],
  });

  const visibleProps = data?.props?.filter(p => !p.isLocked).slice(0, 4) || [];
  const lockedCount = data?.props?.filter(p => p.isLocked).length || 0;
  const tier = data?.tier || "free";

  return (
    <div data-testid="daily-picks-section">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center">
            <Star className="w-4 h-4 text-amber-400" />
          </div>
          <h2 className="text-lg font-black text-white tracking-tight">Daily Pick Specials</h2>
        </div>
        <Link href="/props">
          <Button variant="ghost" size="sm" className="text-amber-400 hover:text-amber-300 font-bold gap-1 text-xs" data-testid="view-all-props">
            All Picks <ArrowRight className="w-3.5 h-3.5" />
          </Button>
        </Link>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="bg-slate-800/30 border-slate-800 p-4">
              <Skeleton className="h-4 w-1/2 mb-2" />
              <Skeleton className="h-3 w-3/4" />
            </Card>
          ))}
        </div>
      ) : visibleProps.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {visibleProps.map(prop => {
            const isOver = prop.pick.toLowerCase().includes("over");
            return (
              <Card key={prop.id} className="bg-slate-800/40 border-slate-700/50 p-4 transition-all hover:bg-slate-800/60" data-testid={`daily-pick-${prop.id}`}>
                <div className="flex items-center justify-between mb-2">
                  <Badge className="bg-slate-700/50 text-slate-300 border-slate-600/50 text-[11px] font-black px-1.5 py-0">{prop.sport}</Badge>
                  <Badge className={`text-[11px] font-black px-1.5 py-0 ${
                    prop.confidence === "high" ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" :
                    prop.confidence === "medium" ? "bg-amber-500/20 text-amber-400 border-amber-500/30" :
                    "bg-slate-700/50 text-slate-400 border-slate-700"
                  }`}>{prop.confidence}</Badge>
                </div>
                <p className="text-sm font-bold text-white truncate">{prop.playerName}</p>
                <div className="flex items-center justify-between mt-0.5">
                  <div className="flex items-center gap-1.5">
                    <TeamLogo team={prop.team} sport={prop.sport} size={16} />
                    <span className="text-[11px] text-slate-500 font-bold">vs</span>
                    <TeamLogo team={prop.opponent} sport={prop.sport} size={16} />
                    <span className="text-[11px] text-slate-500 font-bold">{prop.opponent}</span>
                  </div>
                  {prop.gameInfo && (() => {
                    const tm = prop.gameInfo.match(/(\d{1,2}:\d{2}\s*(?:AM|PM)(?:\s*ET)?)/i);
                    return tm ? (
                      <span className="text-[10px] font-bold text-emerald-400/80">{tm[1]}</span>
                    ) : null;
                  })()}
                </div>
                <div className="flex items-center justify-between mt-3">
                  <span className="text-[11px] text-slate-400 font-bold">{prop.propType}</span>
                  <div className="flex items-center gap-1">
                    {isOver ? <ArrowUpRight className="w-3.5 h-3.5 text-emerald-400" /> : <ArrowDownRight className="w-3.5 h-3.5 text-red-400" />}
                    <span className={`text-sm font-black ${isOver ? "text-emerald-400" : "text-red-400"}`}>{prop.pick} {prop.line}</span>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card className="bg-slate-800/30 border-slate-800 p-6 text-center">
          <p className="text-sm text-slate-400 font-bold">No picks available today</p>
        </Card>
      )}

      {lockedCount > 0 && (
        <div className="mt-3 flex items-center justify-between bg-gradient-to-r from-amber-900/20 to-slate-900/30 border border-amber-800/20 rounded-lg px-4 py-2.5" data-testid="picks-upgrade-banner">
          <div className="flex items-center gap-2">
            <Lock className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-xs text-slate-300 font-bold">{lockedCount} more picks available</span>
          </div>
          {tier === "free" ? (
            <Link href="/pricing">
              <Button size="sm" className="bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs gap-1 h-7" data-testid="upgrade-picks-btn">
                <Sparkles className="w-3 h-3" /> Unlock
              </Button>
            </Link>
          ) : (
            <Link href="/props">
              <Button size="sm" variant="ghost" className="text-amber-400 hover:text-amber-300 font-bold text-xs gap-1 h-7" data-testid="view-all-picks-btn">
                View All <ArrowRight className="w-3 h-3" />
              </Button>
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

function NewsCompact({ sport }: { sport: string }) {
  const { data } = useQuery<{ articles: NewsArticle[] }>({
    queryKey: [`/api/news/${sport.toLowerCase()}`],
  });

  const articles = data?.articles?.slice(0, 3) || [];
  if (!articles.length) return null;

  return (
    <div data-testid="news-compact-section">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-slate-700/50 flex items-center justify-center">
            <Newspaper className="w-4 h-4 text-slate-400" />
          </div>
          <h2 className="text-lg font-black text-white tracking-tight">Latest News</h2>
        </div>
        <Link href={`/news/${sport.toLowerCase()}`}>
          <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white font-bold gap-1 text-xs" data-testid="view-all-news">
            More News <ArrowRight className="w-3.5 h-3.5" />
          </Button>
        </Link>
      </div>
      <div className="space-y-2">
        {articles.map(article => (
          <a
            key={article.id}
            href={article.linkUrl || "#"}
            target="_blank"
            rel="noopener noreferrer"
            className="block group"
            data-testid={`news-item-${article.id}`}
          >
            <div className="flex items-start gap-3 p-3 rounded-lg hover:bg-slate-800/40 transition-colors">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-slate-300 group-hover:text-white transition-colors line-clamp-1">{article.headline}</p>
                {article.description && (
                  <p className="text-[11px] text-slate-500 line-clamp-1 mt-0.5">{article.description}</p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {article.published && (
                  <span className="text-[11px] text-slate-600 font-bold flex items-center gap-1">
                    <Clock className="w-3 h-3" /> {timeAgo(article.published)}
                  </span>
                )}
                <ExternalLink className="w-3 h-3 text-slate-600 group-hover:text-emerald-400 transition-colors" />
              </div>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}

function QuickActions({ slateId, tier }: { slateId: number | null; tier: string }) {
  return (
    <div className="flex gap-3 flex-wrap" data-testid="quick-actions">
      {slateId && (
        <>
          <Link href={`/optimizer/${slateId}`}>
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold gap-2 shadow-lg shadow-emerald-600/20" data-testid="quick-action-optimize">
              <Zap className="w-4 h-4 fill-current" /> Build Lineup
            </Button>
          </Link>
          {tier === "star" && (
            <Link href={`/optimizer-pro/${slateId}`}>
              <Button variant="outline" className="border-amber-700/50 text-amber-400 hover:bg-amber-900/20 font-bold gap-2" data-testid="quick-action-star-builder">
                <Trophy className="w-4 h-4" /> Star Builder
              </Button>
            </Link>
          )}
          {tier === "pro" && (
            <Link href={`/optimizer-pro/${slateId}`}>
              <Button variant="outline" className="border-emerald-700/50 text-emerald-400 hover:bg-emerald-900/20 font-bold gap-2" data-testid="quick-action-pro-builder">
                <Crown className="w-4 h-4" /> Pro Builder
              </Button>
            </Link>
          )}
        </>
      )}
      <Link href="/lineups">
        <Button variant="outline" className="border-slate-700 text-slate-300 hover:text-white font-bold gap-2" data-testid="quick-action-vault">
          <Archive className="w-4 h-4" /> Vault
        </Button>
      </Link>
      <Link href="/props">
        <Button variant="outline" className="border-slate-700 text-slate-300 hover:text-white font-bold gap-2" data-testid="quick-action-props">
          <TrendingUp className="w-4 h-4" /> Props
        </Button>
      </Link>
    </div>
  );
}

function AuthenticatedDashboard() {
  const { user } = useAuth();
  const [activeSport, setActiveSport] = useState(ACTIVE_SPORTS[0] || "NBA");

  const { data: subData } = useQuery<{ tier: string }>({
    queryKey: ["/api/subscription"],
  });

  const { data: dashData, isLoading: dashLoading, error: dashError } = useQuery<DashboardResponse>({
    queryKey: ["/api/dashboard", activeSport.toLowerCase()],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/${activeSport.toLowerCase()}`);
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  const tier = subData?.tier || "free";
  const firstName = user?.firstName || user?.email?.split("@")[0] || "Player";

  return (
    <div className="container mx-auto px-4 py-6 max-w-6xl">
      <HeroBanner firstName={firstName} tier={tier} />
      <SportSelector activeSport={activeSport} onSelect={setActiveSport} />

      <div className="mb-6">
        <QuickActions slateId={dashData?.slateId || null} tier={tier} />
      </div>

      {dashError ? (
        <Card className="bg-red-900/20 border-red-800/40 p-8 text-center" data-testid="dashboard-error">
          <Flame className="w-10 h-10 text-red-400/50 mx-auto mb-2" />
          <p className="text-sm text-red-400 font-bold">Unable to load player data</p>
          <p className="text-[11px] text-red-400/60 mt-1">Please try again later</p>
        </Card>
      ) : dashLoading ? (
        <div className="space-y-8">
          <div>
            <Skeleton className="h-6 w-48 mb-4" />
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Card key={i} className="bg-slate-800/30 border-slate-800 p-4">
                  <Skeleton className="h-8 w-8 rounded-full mb-2" />
                  <Skeleton className="h-4 w-3/4 mb-1" />
                  <Skeleton className="h-3 w-1/2" />
                </Card>
              ))}
            </div>
          </div>
          <div>
            <Skeleton className="h-6 w-40 mb-4" />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Skeleton className="h-40" />
              <Skeleton className="h-40" />
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-10">
          <TopScorersSection players={dashData?.topScorers || []} slateId={dashData?.slateId || null} sport={activeSport} />
          <TrendingSection players={dashData?.trending || []} sport={activeSport} />
          <MatchupsSection matchups={dashData?.matchups || []} sport={activeSport} />
        </div>
      )}

      <div className="mt-10 pt-8 border-t border-slate-800/50 space-y-8">
        <DailyPicksCompact />
        <NewsCompact sport={activeSport} />
      </div>

      <div className="mt-8 text-center">
        <p className="text-[11px] text-slate-600">News powered by <a href="https://www.rotoballer.com" target="_blank" rel="noopener noreferrer" className="text-emerald-500/50 hover:text-emerald-400">RotoBaller</a></p>
      </div>
    </div>
  );
}

export default function Home() {
  const { user } = useAuth();

  if (!user) {
    return (
      <div className="min-h-[calc(100vh-80px)] relative">
        <img src={heroBg} alt="" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/60 to-[#0F172A]" />
        <div className="relative z-10 flex items-center justify-center min-h-[calc(100vh-80px)]">
          <div className="text-center px-4 max-w-4xl">
            <div className="inline-flex items-center px-4 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm font-bold mb-8 backdrop-blur-sm">
              <Zap className="w-4 h-4 mr-2 fill-current" />
              AI-Powered DFS Optimizer
            </div>
            <h1 className="text-6xl md:text-8xl font-black text-white mb-8 leading-[1.05] tracking-tight drop-shadow-2xl">
              Build Winning<br />
              <span className="text-emerald-400">DFS Lineups</span>
            </h1>
            <p className="text-xl text-slate-300 mb-6 max-w-2xl mx-auto leading-relaxed">
              Advanced lineup optimizer for DraftKings. Real player projections, LP-based optimization, and instant lineup building.
            </p>
            <div className="flex items-center justify-center gap-3 flex-wrap mb-6">
              {ACTIVE_SPORTS.map(sport => {
                const meta = SPORT_META[sport];
                const Icon = meta?.icon || Zap;
                return (
                  <Badge key={sport} className="bg-white/10 text-white border-white/20 font-bold text-sm px-3 py-1 backdrop-blur-sm gap-1.5" data-testid={`unauth-sport-${sport.toLowerCase()}`}>
                    <Icon className="w-3.5 h-3.5" /> {sport}
                  </Badge>
                );
              })}
            </div>
            <div className="flex items-center justify-center gap-3 flex-wrap mb-8">
              <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 font-bold text-sm px-3 py-1 backdrop-blur-sm" data-testid="unauth-badge-dk">DraftKings</Badge>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl mx-auto mb-12">
              <div className="bg-white/5 border border-lime-500/20 rounded-xl p-5 backdrop-blur-sm text-left" data-testid="unauth-category-golf">
                <div className="flex items-center gap-2.5 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-lime-500/20 flex items-center justify-center">
                    <Flag className="w-4 h-4 text-lime-400" />
                  </div>
                  <h3 className="text-base font-black text-white">Golf</h3>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Tournament-style lineup builder for weekly PGA events. Pick 6 golfers, get AI-powered course fit analysis, and strokes gained insights.
                </p>
              </div>
              <div className="bg-white/5 border border-amber-500/20 rounded-xl p-5 backdrop-blur-sm text-left" data-testid="unauth-category-props">
                <div className="flex items-center gap-2.5 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center">
                    <TrendingUp className="w-4 h-4 text-amber-400" />
                  </div>
                  <h3 className="text-base font-black text-white">Prop Picks</h3>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Daily AI-generated prop bet picks across all sports with confidence ratings and line analysis for DraftKings Sportsbook.
                </p>
              </div>
            </div>
            <Button
              onClick={() => (window.location.href = "/api/login")}
              className="h-16 px-12 text-xl font-black bg-emerald-500 hover:bg-emerald-600 text-white shadow-2xl shadow-emerald-500/30"
              data-testid="login-btn"
            >
              Get Started Free
            </Button>
            <p className="text-sm text-slate-400 mt-4">1 free optimized lineup. Upgrade for more.</p>
          </div>
        </div>
      </div>
    );
  }

  return <AuthenticatedDashboard />;
}

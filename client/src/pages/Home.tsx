import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Zap, Newspaper, TrendingUp, ArrowRight, Clock, ExternalLink,
  ArrowUpRight, ArrowDownRight, Archive, Crown, Trophy, Dribbble,
  Activity, Target, Lock, Sparkles, Star, Flame, Shield, Swords, Flag,
  Radio, Circle
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { ACTIVE_SPORTS, SPORT_ORDER } from "@shared/platform-config";
import type { Slate } from "@shared/schema";

const SPORT_LOGO_PATH: Record<string, string> = {
  NBA: "nba", NHL: "nhl", MLB: "mlb", NFL: "nfl", GOLF: "golf", SOCCER: "soccer",
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
  SOCCER: "/images/fallback-nba.png",
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
const sportSoccer = "/images/sport-nba.png";

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
  SOCCER: {
    icon: Circle, color: "text-teal-400", textColor: "text-teal-300",
    bgColor: "bg-teal-500/20", borderColor: "border-teal-500/30",
    gradientFrom: "from-teal-900/60", image: sportSoccer,
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

function AIInsightsBanner({ players, matchups, sport }: { players: DashboardPlayer[]; matchups: MatchupData[]; sport: string }) {
  if (!players.length) return null;

  const totalPlayers = players.length;
  const avgProj = players.length > 0 ? (players.reduce((s, p) => s + parseFloat(p.projectedPoints), 0) / players.length).toFixed(1) : "0";
  const topValue = players.length > 0 ? Math.max(...players.map(p => parseFloat(p.projectedPoints) / (p.salary / 1000))).toFixed(1) : "0";
  const totalGames = matchups.length;

  const stats = [
    { label: "Players Analyzed", value: totalPlayers.toString(), icon: Target, color: "text-cyan-400" },
    { label: "Avg Projection", value: `${avgProj} pts`, icon: Activity, color: "text-emerald-400" },
    { label: "Best Value Score", value: `${topValue}x`, icon: TrendingUp, color: "text-amber-400" },
    { label: "Games on Slate", value: totalGames.toString(), icon: Swords, color: "text-purple-400" },
  ];

  return (
    <div className="relative rounded-xl overflow-hidden mb-8" data-testid="ai-insights-banner">
      <div className="absolute inset-0 bg-gradient-to-r from-emerald-950/80 via-slate-900/90 to-purple-950/70" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-emerald-500/10 via-transparent to-purple-500/10" />
      <div className="relative z-10 px-6 py-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-6 h-6 rounded-md bg-emerald-500/30 flex items-center justify-center">
            <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <span className="text-xs font-black text-emerald-400 uppercase tracking-widest">AI Analysis • {sport}</span>
          <div className="flex-1" />
          <span className="text-[10px] text-slate-500 font-bold flex items-center gap-1">
            <Clock className="w-3 h-3" /> Updated {new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
          </span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {stats.map((stat, idx) => {
            const Icon = stat.icon;
            return (
              <div key={idx} className="text-center" data-testid={`ai-stat-${idx}`}>
                <Icon className={`w-5 h-5 mx-auto mb-1.5 ${stat.color}`} />
                <p className="text-2xl font-black text-white tracking-tight">{stat.value}</p>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{stat.label}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function TopScorersSection({ players, slateId, sport }: { players: DashboardPlayer[]; slateId: number | null; sport: string }) {
  if (!players.length) return null;

  const hero = players[0];
  const rest = players.slice(1, 7);
  const heroValue = (parseFloat(hero.projectedPoints) / (hero.salary / 1000)).toFixed(1);

  return (
    <div data-testid="top-scorers-section">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500/30 to-orange-500/20 flex items-center justify-center">
            <Zap className="w-4 h-4 text-amber-400 fill-current" />
          </div>
          <div>
            <h2 className="text-lg font-black text-white tracking-tight">AI Top Plays</h2>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Highest projected fantasy output</p>
          </div>
        </div>
        {slateId && (
          <Link href={`/optimizer/${slateId}`}>
            <Button variant="ghost" size="sm" className="text-emerald-400 font-bold gap-1 text-xs" data-testid="optimize-from-scorers">
              Build Lineup <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </Link>
        )}
      </div>

      <div className="relative rounded-xl overflow-hidden mb-4 p-5 bg-gradient-to-r from-amber-950/40 via-slate-900/60 to-emerald-950/30 border border-amber-800/20" data-testid={`top-scorer-hero-${hero.id}`}>
        <div className="absolute top-0 right-0 w-40 h-40 bg-gradient-to-bl from-amber-500/10 to-transparent rounded-bl-full" />
        <div className="relative z-10 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <div className="relative">
              <TeamLogo team={hero.team} sport={sport} size={52} />
              <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-amber-500 flex items-center justify-center">
                <Crown className="w-3 h-3 text-white" />
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-xs font-black text-amber-400 uppercase tracking-wider">#1 AI Pick</span>
                <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px] font-black px-1.5 py-0" data-testid="hero-value-badge">{heroValue}x value</Badge>
              </div>
              <p className="text-xl font-black text-white">{hero.name}</p>
              <p className="text-xs text-slate-400 font-bold">{hero.position} • {hero.team} vs {hero.opponent}</p>
            </div>
          </div>
          <div className="flex items-center gap-6">
            <div className="text-center">
              <p className="text-3xl font-black text-emerald-400" data-testid="hero-proj-points">{parseFloat(hero.projectedPoints).toFixed(1)}</p>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Proj Points</p>
            </div>
            <div className="text-center">
              <p className="text-xl font-black text-white" data-testid="hero-salary">${(hero.salary / 1000).toFixed(1)}K</p>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Salary</p>
            </div>
            <div className="text-center">
              <p className="text-xl font-black text-slate-300" data-testid="hero-fppg">{parseFloat(hero.fppg).toFixed(1)}</p>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">FPPG</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {rest.map((player, idx) => {
          const val = (parseFloat(player.projectedPoints) / (player.salary / 1000)).toFixed(1);
          const projMax = parseFloat(hero.projectedPoints) || 1;
          const projPct = Math.min((parseFloat(player.projectedPoints) / projMax) * 100, 100);
          return (
            <Card
              key={player.id}
              className="bg-slate-800/40 border-border p-4 relative overflow-hidden"
              data-testid={`top-scorer-${player.id}`}
            >
              <div className="absolute bottom-0 left-0 h-0.5 bg-gradient-to-r from-emerald-500/60 to-emerald-500/0" style={{ width: `${projPct}%` }} />
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-lg font-black text-slate-600 w-5 text-center shrink-0">#{idx + 2}</span>
                  <TeamLogo team={player.team} sport={sport} size={30} />
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-white truncate">{player.name}</p>
                    <p className="text-[11px] text-slate-500 font-bold">{player.position} • {player.team} vs {player.opponent}</p>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-lg font-black text-emerald-400">{parseFloat(player.projectedPoints).toFixed(1)}</p>
                  <p className="text-[10px] text-slate-500 font-bold">${(player.salary / 1000).toFixed(1)}K • {val}x</p>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function TrendingSection({ players, sport }: { players: TrendingPlayer[]; sport: string }) {
  const trendingUp = players.filter(p => p.direction === "up");
  const trendingDown = players.filter(p => p.direction === "down");

  if (!players.length) return null;

  const maxValue = Math.max(...players.map(p => parseFloat(p.valueScore) || 0), 1);

  return (
    <div data-testid="trending-section">
      <div className="flex items-center gap-2.5 mb-5">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500/30 to-cyan-500/20 flex items-center justify-center">
          <TrendingUp className="w-4 h-4 text-emerald-400" />
        </div>
        <div>
          <h2 className="text-lg font-black text-white tracking-tight">AI Value Radar</h2>
          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Points per $1K salary analysis</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="relative rounded-xl overflow-hidden border border-emerald-800/20 bg-gradient-to-b from-emerald-950/30 to-slate-900/50 p-4">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-500 to-emerald-500/0" />
          <div className="flex items-center gap-2 mb-4">
            <ArrowUpRight className="w-4 h-4 text-emerald-400" />
            <span className="text-sm font-black text-emerald-400 uppercase tracking-wider">Smash Plays</span>
            <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px] font-black px-1.5 py-0 ml-auto" data-testid="smash-count">{trendingUp.length} picks</Badge>
          </div>
          <div className="space-y-3">
            {trendingUp.map(player => {
              const valuePct = (parseFloat(player.valueScore) / maxValue) * 100;
              return (
                <div key={player.id} data-testid={`trending-up-${player.id}`}>
                  <div className="flex items-center justify-between gap-3 mb-1.5">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <TeamLogo team={player.team} sport={sport} size={26} />
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-white truncate">{player.name}</p>
                        <p className="text-[10px] text-slate-500 font-bold">{player.position} • vs {player.opponent}</p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-sm font-black text-emerald-400">{player.valueScore}x</span>
                      <p className="text-[10px] text-slate-500 font-bold">{parseFloat(player.projectedPoints).toFixed(1)} pts • ${(player.salary / 1000).toFixed(1)}K</p>
                    </div>
                  </div>
                  <div className="h-1.5 bg-slate-800/60 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-full transition-all duration-700" style={{ width: `${valuePct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="relative rounded-xl overflow-hidden border border-red-800/15 bg-gradient-to-b from-red-950/20 to-slate-900/50 p-4">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-red-500 to-red-500/0" />
          <div className="flex items-center gap-2 mb-4">
            <ArrowDownRight className="w-4 h-4 text-red-400" />
            <span className="text-sm font-black text-red-400 uppercase tracking-wider">Fade Candidates</span>
            <Badge className="bg-red-500/15 text-red-400 border-red-500/20 text-[10px] font-black px-1.5 py-0 ml-auto" data-testid="fade-count">{trendingDown.length} picks</Badge>
          </div>
          <div className="space-y-3">
            {trendingDown.map(player => {
              const valuePct = (parseFloat(player.valueScore) / maxValue) * 100;
              return (
                <div key={player.id} data-testid={`trending-down-${player.id}`}>
                  <div className="flex items-center justify-between gap-3 mb-1.5">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <TeamLogo team={player.team} sport={sport} size={26} />
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-white truncate">{player.name}</p>
                        <p className="text-[10px] text-slate-500 font-bold">{player.position} • vs {player.opponent}</p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-sm font-black text-red-400">{player.valueScore}x</span>
                      <p className="text-[10px] text-slate-500 font-bold">{parseFloat(player.projectedPoints).toFixed(1)} pts • ${(player.salary / 1000).toFixed(1)}K</p>
                    </div>
                  </div>
                  <div className="h-1.5 bg-slate-800/60 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-red-500 to-red-400 rounded-full transition-all duration-700" style={{ width: `${valuePct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function MatchupsSection({ matchups, sport }: { matchups: MatchupData[]; sport: string }) {
  if (!matchups.length) return null;

  const maxAvg = Math.max(...matchups.map(m => parseFloat(m.avgProjection) || 0), 1);

  return (
    <div data-testid="matchups-section">
      <div className="flex items-center gap-2.5 mb-5">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500/30 to-violet-500/20 flex items-center justify-center">
          <Swords className="w-4 h-4 text-purple-400" />
        </div>
        <div>
          <h2 className="text-lg font-black text-white tracking-tight">Game Breakdown</h2>
          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">AI-ranked matchups by fantasy potential</p>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {matchups.map((m, idx) => {
          const avgPct = (parseFloat(m.avgProjection) / maxAvg) * 100;
          const isTop = idx === 0;
          return (
            <Card
              key={idx}
              className={`relative overflow-hidden p-4 ${
                isTop
                  ? "bg-gradient-to-br from-purple-950/40 to-slate-900/60 border-purple-800/30 ring-1 ring-purple-500/10"
                  : "bg-slate-800/40 border-border"
              }`}
              data-testid={`matchup-${idx}`}
            >
              {isTop && (
                <div className="absolute top-0 right-0">
                  <Badge className="bg-purple-500/30 text-purple-300 border-0 rounded-none rounded-bl-lg text-[9px] font-black px-2 py-0.5" data-testid="top-matchup-badge">
                    TOP GAME
                  </Badge>
                </div>
              )}
              <div className="flex items-center gap-2 mb-3">
                {(() => {
                  const parts = m.gameInfo.match(/^(\w+)\s*[@vs]+\s*(\w+)/i);
                  if (parts) {
                    return (
                      <div className="flex items-center gap-2">
                        <TeamLogo team={parts[1]} sport={sport} size={26} />
                        <span className="text-xs font-black text-slate-500">@</span>
                        <TeamLogo team={parts[2]} sport={sport} size={26} />
                      </div>
                    );
                  }
                  return null;
                })()}
                <p className="text-sm font-black text-white flex-1 truncate">{m.gameInfo}</p>
              </div>

              <div className="mb-3">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Fantasy Potential</span>
                  <span className="text-sm font-black text-white" data-testid={`matchup-avg-${idx}`}>{m.avgProjection} avg</span>
                </div>
                <div className="h-2 bg-slate-800/60 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${isTop ? "bg-gradient-to-r from-purple-500 to-violet-400" : "bg-gradient-to-r from-slate-500 to-slate-400"}`}
                    style={{ width: `${avgPct}%` }}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between gap-2">
                <Badge className="bg-slate-700/40 text-slate-400 border-slate-600/30 text-[10px] font-bold px-1.5 py-0" data-testid={`matchup-players-${idx}`}>
                  {m.playerCount} players
                </Badge>
                {m.topPlayer && (
                  <div className="flex items-center gap-1.5">
                    <Flame className="w-3 h-3 text-amber-400" />
                    <span className="text-xs font-bold text-amber-300">{m.topPlayer.name}</span>
                    <span className="text-[10px] text-slate-500 font-bold">{m.topPlayer.projectedPoints}pts</span>
                  </div>
                )}
              </div>
            </Card>
          );
        })}
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

  function getConfidenceValue(c: string): number {
    if (c === "high") return 85;
    if (c === "medium") return 65;
    return 45;
  }

  return (
    <div data-testid="daily-picks-section">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500/30 to-orange-500/20 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-amber-400" />
          </div>
          <div>
            <h2 className="text-lg font-black text-white tracking-tight">AI Prop Picks</h2>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Machine learning confidence analysis</p>
          </div>
        </div>
        <Link href="/props">
          <Button variant="ghost" size="sm" className="text-amber-400 font-bold gap-1 text-xs" data-testid="view-all-props">
            All Picks <ArrowRight className="w-3.5 h-3.5" />
          </Button>
        </Link>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="bg-slate-800/30 border-border p-4">
              <Skeleton className="h-4 w-1/2 mb-2" />
              <Skeleton className="h-3 w-3/4" />
            </Card>
          ))}
        </div>
      ) : visibleProps.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {visibleProps.map(prop => {
            const isOver = prop.pick.toLowerCase().includes("over") || prop.pick.toLowerCase().includes("more");
            const confVal = getConfidenceValue(prop.confidence);
            const dotClass = prop.confidence === "high" ? "bg-emerald-400" : prop.confidence === "medium" ? "bg-amber-400" : "bg-slate-400";
            const textClass = prop.confidence === "high" ? "text-emerald-400" : prop.confidence === "medium" ? "text-amber-400" : "text-slate-400";
            const barClass = prop.confidence === "high" ? "from-emerald-500 to-emerald-400" : prop.confidence === "medium" ? "from-amber-500 to-amber-400" : "from-slate-500 to-slate-400";
            return (
              <Card
                key={prop.id}
                className={`relative overflow-hidden p-4 ${
                  prop.confidence === "high"
                    ? "bg-gradient-to-br from-emerald-950/30 to-slate-900/50 border-emerald-800/20"
                    : "bg-slate-800/40 border-border"
                }`}
                data-testid={`daily-pick-${prop.id}`}
              >
                {prop.confidence === "high" && (
                  <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-emerald-500 to-emerald-500/0" />
                )}
                <div className="flex items-center justify-between gap-2 mb-2.5">
                  <Badge className="bg-slate-700/50 text-slate-300 border-slate-600/50 text-[10px] font-black px-1.5 py-0">{prop.sport}</Badge>
                  <div className="flex items-center gap-1.5">
                    <div className={`w-1.5 h-1.5 rounded-full ${dotClass}`} />
                    <span className={`text-[10px] font-black uppercase ${textClass}`} data-testid={`pick-confidence-${prop.id}`}>{confVal}%</span>
                  </div>
                </div>

                <p className="text-sm font-bold text-white truncate">{prop.playerName}</p>
                <div className="flex items-center gap-1.5 mt-0.5 mb-3">
                  <TeamLogo team={prop.team} sport={prop.sport} size={14} />
                  <span className="text-[10px] text-slate-500 font-bold">vs</span>
                  <TeamLogo team={prop.opponent} sport={prop.sport} size={14} />
                  <span className="text-[10px] text-slate-500 font-bold">{prop.opponent}</span>
                </div>

                <div className="h-1 bg-slate-800/60 rounded-full overflow-hidden mb-2.5">
                  <div className={`h-full rounded-full bg-gradient-to-r ${barClass}`} style={{ width: `${confVal}%` }} />
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] text-slate-500 font-bold truncate">{prop.propType}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    {isOver ? <ArrowUpRight className="w-3.5 h-3.5 text-emerald-400" /> : <ArrowDownRight className="w-3.5 h-3.5 text-red-400" />}
                    <span className={`text-sm font-black ${isOver ? "text-emerald-400" : "text-red-400"}`}>{prop.pick} {prop.line}</span>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card className="bg-slate-800/30 border-border p-6 text-center">
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

interface LiveGameScore {
  id: string;
  sport: string;
  status: "pre" | "in" | "post";
  statusDetail: string;
  shortDetail: string;
  startTime?: string;
  homeTeam?: { name: string; abbreviation: string; score: string };
  awayTeam?: { name: string; abbreviation: string; score: string };
  period?: number;
  clock?: string;
  tournamentName?: string;
  leaderboard?: { playerName: string; position: string; score: string; round: number; thru: string }[];
}

function getStatusColor(status: string) {
  if (status === "in") return "text-emerald-400";
  if (status === "post") return "text-slate-500";
  return "text-amber-400";
}

function getStatusBg(status: string) {
  if (status === "in") return "bg-emerald-500/20 border-emerald-500/30";
  if (status === "post") return "bg-slate-700/40 border-slate-600/30";
  return "bg-amber-500/15 border-amber-500/20";
}

function formatGameTime(startTime?: string) {
  if (!startTime) return "";
  try {
    const d = new Date(startTime);
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/New_York" }) + " ET";
  } catch { return ""; }
}

function LiveScoresSection({ sport }: { sport: string }) {
  const { data: games, isLoading } = useQuery<LiveGameScore[]>({
    queryKey: [`/api/scores/${sport}`],
    refetchInterval: 120000,
  });

  if (isLoading) {
    return (
      <div data-testid="live-scores-section" className="mb-6">
        <div className="flex items-center gap-2.5 mb-4">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center">
            <Radio className="w-4 h-4 text-emerald-400" />
          </div>
          <h2 className="text-lg font-black text-white tracking-tight">Live Scores</h2>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="bg-slate-800/30 border-border p-4 min-w-[220px] shrink-0">
              <Skeleton className="h-4 w-20 mb-3" />
              <Skeleton className="h-5 w-full mb-2" />
              <Skeleton className="h-5 w-full" />
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (!games || games.length === 0) {
    return (
      <div data-testid="live-scores-section" className="mb-6">
        <div className="flex items-center gap-2.5 mb-4">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center">
            <Radio className="w-4 h-4 text-emerald-400" />
          </div>
          <h2 className="text-lg font-black text-white tracking-tight">Live Scores</h2>
        </div>
        <Card className="bg-slate-800/30 border-border p-6 text-center" data-testid="no-games-message">
          <Clock className="w-6 h-6 text-slate-600 mx-auto mb-2" />
          <p className="text-sm text-slate-400 font-bold">No games scheduled today</p>
        </Card>
      </div>
    );
  }

  const isGolf = sport === "GOLF";
  const liveGames = games.filter(g => g.status === "in");
  const hasLive = liveGames.length > 0;

  if (isGolf) {
    const tournament = games[0];
    if (!tournament?.leaderboard?.length) return null;
    return (
      <div data-testid="live-scores-section" className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-lime-500/20 flex items-center justify-center">
              <Flag className="w-4 h-4 text-lime-400" />
            </div>
            <h2 className="text-lg font-black text-white tracking-tight">{tournament.tournamentName || "Tournament"}</h2>
          </div>
          {tournament.status === "in" && (
            <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[11px] font-black px-2 py-0.5 gap-1 animate-pulse" data-testid="live-indicator">
              <Circle className="w-2 h-2 fill-current" /> LIVE
            </Badge>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {tournament.leaderboard.slice(0, 10).map((player, idx) => (
            <div
              key={idx}
              className={`flex items-center justify-between px-4 py-2.5 rounded-lg ${idx < 3 ? "bg-lime-950/30 border border-lime-800/20" : "bg-slate-800/30 border border-slate-800/50"}`}
              data-testid={`golf-leaderboard-${idx}`}
            >
              <div className="flex items-center gap-3">
                <span className={`text-sm font-black w-6 text-center ${idx < 3 ? "text-lime-400" : "text-slate-500"}`}>
                  {player.position || `T${idx + 1}`}
                </span>
                <span className="text-sm font-bold text-white">{player.playerName}</span>
              </div>
              <div className="flex items-center gap-3">
                {player.thru && (
                  <span className="text-[11px] text-slate-500 font-bold">Thru {player.thru}</span>
                )}
                <span className={`text-sm font-black ${player.score.startsWith("-") ? "text-emerald-400" : player.score === "E" ? "text-slate-300" : "text-red-400"}`}>
                  {player.score}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div data-testid="live-scores-section" className="mb-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center">
            <Radio className="w-4 h-4 text-emerald-400" />
          </div>
          <h2 className="text-lg font-black text-white tracking-tight">Live Scores</h2>
        </div>
        {hasLive && (
          <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[11px] font-black px-2 py-0.5 gap-1 animate-pulse" data-testid="live-indicator">
            <Circle className="w-2 h-2 fill-current" /> {liveGames.length} LIVE
          </Badge>
        )}
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin">
        {games.map(game => {
          if (!game.homeTeam || !game.awayTeam) return null;
          const isLive = game.status === "in";
          const isFinal = game.status === "post";
          return (
            <Card
              key={game.id}
              className={`min-w-[240px] shrink-0 p-4 transition-all ${
                isLive ? "bg-emerald-950/30 border-emerald-800/30 ring-1 ring-emerald-500/20" :
                isFinal ? "bg-slate-800/30 border-slate-700/40" :
                "bg-slate-800/40 border-border"
              }`}
              data-testid={`game-card-${game.id}`}
            >
              <div className="flex items-center justify-between gap-2 mb-3">
                <Badge className={`text-[10px] font-black px-1.5 py-0 ${getStatusBg(game.status)} ${getStatusColor(game.status)}`} data-testid={`game-status-${game.id}`}>
                  {isLive ? (game.shortDetail || "LIVE") : isFinal ? "FINAL" : formatGameTime(game.startTime)}
                </Badge>
                {isLive && game.clock && (
                  <span className="text-[10px] text-emerald-400/70 font-bold" data-testid={`game-clock-${game.id}`}>{game.clock}</span>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <TeamLogo team={game.awayTeam.abbreviation} sport={sport} size={22} />
                    <span className={`text-sm font-bold ${!isFinal ? "text-white" : parseInt(game.awayTeam.score) > parseInt(game.homeTeam.score) ? "text-white" : "text-slate-400"}`} data-testid={`away-team-${game.id}`}>
                      {game.awayTeam.abbreviation}
                    </span>
                  </div>
                  <span className={`text-lg font-black tabular-nums ${
                    isLive ? "text-emerald-400" :
                    isFinal && parseInt(game.awayTeam.score) > parseInt(game.homeTeam.score) ? "text-white" :
                    isFinal ? "text-slate-500" : "text-slate-300"
                  }`} data-testid={`away-score-${game.id}`}>
                    {game.status === "pre" ? "-" : game.awayTeam.score}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <TeamLogo team={game.homeTeam.abbreviation} sport={sport} size={22} />
                    <span className={`text-sm font-bold ${!isFinal ? "text-white" : parseInt(game.homeTeam.score) > parseInt(game.awayTeam.score) ? "text-white" : "text-slate-400"}`} data-testid={`home-team-${game.id}`}>
                      {game.homeTeam.abbreviation}
                    </span>
                  </div>
                  <span className={`text-lg font-black tabular-nums ${
                    isLive ? "text-emerald-400" :
                    isFinal && parseInt(game.homeTeam.score) > parseInt(game.awayTeam.score) ? "text-white" :
                    isFinal ? "text-slate-500" : "text-slate-300"
                  }`} data-testid={`home-score-${game.id}`}>
                    {game.status === "pre" ? "-" : game.homeTeam.score}
                  </span>
                </div>
              </div>
            </Card>
          );
        })}
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
        <Button variant="outline" className="border-cyan-500/40 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 hover:text-cyan-200 font-bold gap-2" data-testid="quick-action-vault">
          <Archive className="w-4 h-4" /> Vault
        </Button>
      </Link>
      <Link href="/props">
        <Button variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 hover:text-amber-200 font-bold gap-2" data-testid="quick-action-props">
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
    queryKey: [`/api/dashboard/${activeSport.toLowerCase()}`],
    refetchInterval: 300000,
  });

  const tier = subData?.tier || "free";
  const firstName = user?.firstName || user?.email?.split("@")[0] || "Player";

  return (
    <div className="container mx-auto px-4 py-6 max-w-6xl">
      <HeroBanner firstName={firstName} tier={tier} />
      <SportSelector activeSport={activeSport} onSelect={setActiveSport} />

      <LiveScoresSection sport={activeSport} />

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
                <Card key={i} className="bg-slate-800/30 border-border p-4">
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
          <AIInsightsBanner players={dashData?.topScorers || []} matchups={dashData?.matchups || []} sport={activeSport} />
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
      <div className="min-h-[calc(100vh-80px)] relative bg-[#0F172A]">
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
              {SPORT_ORDER.map(sport => {
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
            <div className="flex justify-center mb-12">
              <div className="bg-white/5 border border-amber-500/20 rounded-xl p-5 backdrop-blur-sm text-left max-w-xs" data-testid="unauth-category-props">
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
              onClick={() => (window.location.href = "/login")}
              className="h-16 px-12 text-xl font-black bg-emerald-500 hover:bg-emerald-600 text-white shadow-2xl shadow-emerald-500/30"
              data-testid="login-btn"
            >
              Get Started
            </Button>
            <p className="text-sm text-slate-400 mt-4">1 optimized lineup included. Upgrade for more.</p>
          </div>
        </div>
      </div>
    );
  }

  return <AuthenticatedDashboard />;
}

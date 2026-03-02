import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Link, useSearch } from "wouter";
import { Lock, Crown, Zap, ArrowUpRight, ArrowDownRight, ExternalLink, Trophy, Activity, Target, Dribbble, Clock, Star, Flame, Flag, TrendingUp, Shield, Sparkles } from "lucide-react";
import { useState } from "react";
import { ACTIVE_SPORTS } from "@shared/platform-config";
import { AFFILIATE_LINKS, AFFILIATE_PROMOS } from "@shared/affiliate-config";

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
        data-testid={`team-logo-fallback-${team.toLowerCase()}`}
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
      data-testid={`team-logo-${team.toLowerCase()}`}
    />
  );
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
  lockedCount?: number;
  maxPerSport: number;
}

function SportAffiliateBanner({ sport }: { sport: string }) {
  const promo = AFFILIATE_PROMOS[sport];
  if (!promo) return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6" data-testid={`affiliate-banner-${sport.toLowerCase()}`}>
      <a
        href={AFFILIATE_LINKS.draftkings.sportsbook.url}
        target="_blank"
        rel="noopener noreferrer"
        className="block"
        data-testid={`affiliate-dk-sportsbook-${sport.toLowerCase()}`}
      >
        <div className="bg-gradient-to-r from-emerald-900/40 to-emerald-800/20 border border-emerald-700/30 rounded-xl p-4 transition-all hover-elevate">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                <span className="text-emerald-400 font-black text-xs">DK</span>
              </div>
              <div>
                <p className="text-xs font-black text-emerald-400 uppercase tracking-wider">DraftKings Sportsbook</p>
                <p className="text-[11px] text-slate-400">Place {sport} prop bets</p>
              </div>
            </div>
            <ExternalLink className="w-4 h-4 text-emerald-500/50" />
          </div>
          <p className="text-xs text-slate-300">{promo.dk}</p>
        </div>
      </a>
      <a
        href={AFFILIATE_LINKS.fanduel.sportsbook.url}
        target="_blank"
        rel="noopener noreferrer"
        className="block"
        data-testid={`affiliate-fd-sportsbook-${sport.toLowerCase()}`}
      >
        <div className="bg-gradient-to-r from-blue-900/40 to-blue-800/20 border border-blue-700/30 rounded-xl p-4 transition-all hover-elevate">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center">
                <span className="text-blue-400 font-black text-xs">FD</span>
              </div>
              <div>
                <p className="text-xs font-black text-blue-400 uppercase tracking-wider">FanDuel Sportsbook</p>
                <p className="text-[11px] text-slate-400">Place {sport} prop bets</p>
              </div>
            </div>
            <ExternalLink className="w-4 h-4 text-blue-500/50" />
          </div>
          <p className="text-xs text-slate-300">{promo.fd}</p>
        </div>
      </a>
    </div>
  );
}

function DfsAffiliateBanner() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-10" data-testid="affiliate-dfs-banner">
      <a
        href={AFFILIATE_LINKS.draftkings.dfs.url}
        target="_blank"
        rel="noopener noreferrer"
        className="block"
        data-testid="affiliate-dk-dfs"
      >
        <div className="bg-gradient-to-r from-emerald-900/30 to-slate-900/50 border border-emerald-700/20 rounded-xl p-5 transition-all hover-elevate">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
                <span className="text-emerald-400 font-black text-sm">DK</span>
              </div>
              <div>
                <p className="text-sm font-black text-white">{AFFILIATE_LINKS.draftkings.dfs.label}</p>
                <p className="text-xs text-slate-400">{AFFILIATE_LINKS.draftkings.dfs.description}</p>
              </div>
            </div>
            <ExternalLink className="w-4 h-4 text-emerald-500/50" />
          </div>
        </div>
      </a>
      <a
        href={AFFILIATE_LINKS.fanduel.dfs.url}
        target="_blank"
        rel="noopener noreferrer"
        className="block"
        data-testid="affiliate-fd-dfs"
      >
        <div className="bg-gradient-to-r from-blue-900/30 to-slate-900/50 border border-blue-700/20 rounded-xl p-5 transition-all hover-elevate">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
                <span className="text-blue-400 font-black text-sm">FD</span>
              </div>
              <div>
                <p className="text-sm font-black text-white">{AFFILIATE_LINKS.fanduel.dfs.label}</p>
                <p className="text-xs text-slate-400">{AFFILIATE_LINKS.fanduel.dfs.description}</p>
              </div>
            </div>
            <ExternalLink className="w-4 h-4 text-blue-500/50" />
          </div>
        </div>
      </a>
    </div>
  );
}

function getConfidenceTier(confidence: number): "gold" | "bronze" | "standard" {
  if (confidence >= 78) return "gold";
  if (confidence >= 68) return "bronze";
  return "standard";
}

function getStarCount(confidence: number): number {
  if (confidence >= 85) return 5;
  if (confidence >= 78) return 4;
  if (confidence >= 68) return 3;
  if (confidence >= 58) return 2;
  return 1;
}

function StarRating({ count, tier }: { count: number; tier: "gold" | "bronze" | "standard" }) {
  const filledColor = tier === "gold"
    ? "text-yellow-400 fill-yellow-400"
    : tier === "bronze"
    ? "text-orange-400 fill-orange-400"
    : "text-emerald-400 fill-emerald-400";
  const emptyColor = "text-slate-700";

  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={`w-3.5 h-3.5 ${i < count ? filledColor : emptyColor}`}
        />
      ))}
    </div>
  );
}

function PropCard({ prop, index }: { prop: PropBet; index: number }) {
  const conf = Number(prop.confidence);
  const tier = getConfidenceTier(conf);
  const isGold = tier === "gold";
  const isBronze = tier === "bronze";
  const starCount = getStarCount(conf);

  return (
    <Card
      className="bg-slate-800/30 border-slate-800 p-5 transition-all hover-elevate relative overflow-hidden"
      data-testid={`prop-card-${index}`}
    >
      {isGold && (
        <>
          <div className="absolute -top-3 -right-3 z-10 pointer-events-none" data-testid={`prop-gold-star-${index}`}>
            <div className="relative">
              <Star className="w-20 h-20 text-yellow-400 fill-yellow-400 drop-shadow-[0_0_12px_rgba(250,204,21,0.4)]" />
              <span className="absolute top-[30px] left-1/2 -translate-x-1/2 text-[8px] font-black text-yellow-950 uppercase tracking-widest">
                DAILY
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 mb-3" data-testid={`prop-tier-badge-${index}`}>
            <div className="flex items-center gap-1.5 bg-yellow-400/15 border border-yellow-500/25 rounded-full px-3 py-1">
              <Star className="w-3.5 h-3.5 text-yellow-400 fill-yellow-400" />
              <span className="text-[10px] font-black text-yellow-400 uppercase tracking-widest">
                Today's Top Pick
              </span>
            </div>
          </div>
        </>
      )}

      {isBronze && (
        <div className="flex items-center gap-2 mb-3" data-testid={`prop-tier-badge-${index}`}>
          <div className="flex items-center gap-1.5 bg-orange-400/10 border border-orange-500/20 rounded-full px-3 py-1">
            <Flame className="w-3.5 h-3.5 text-orange-400" />
            <span className="text-[10px] font-black text-orange-400 uppercase tracking-widest">
              Hot Pick
            </span>
          </div>
        </div>
      )}

      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1" data-testid={`prop-teams-${index}`}>
            <TeamLogo team={prop.team} sport={prop.sport} size={24} />
            <span className="text-[10px] font-black text-slate-500 mx-0.5">vs</span>
            <TeamLogo team={prop.opponent} sport={prop.sport} size={24} />
          </div>
          <div>
            <span className="text-[11px] font-bold text-slate-400">{prop.team} vs {prop.opponent}</span>
            {prop.gameInfo && (() => {
              const dotMatch = prop.gameInfo.match(/·\s*(.+)$/);
              const legacyMatch = !dotMatch && prop.gameInfo.match(/(\d{1,2}:\d{2}\s*(?:AM|PM)\s*ET)/i);
              const gameTime = dotMatch ? dotMatch[1].trim() : legacyMatch ? legacyMatch[1].trim() : null;
              return gameTime ? (
                <div className="flex items-center gap-1 mt-0.5" data-testid={`prop-gametime-${index}`}>
                  <Clock className="w-3 h-3 text-emerald-400/70" />
                  <span className="text-[11px] font-bold text-emerald-400/90">{gameTime}</span>
                </div>
              ) : (
                <p className="text-[11px] text-slate-500 mt-0.5">{prop.gameInfo}</p>
              );
            })()}
          </div>
        </div>
        <div className="flex items-center gap-2" data-testid={`prop-confidence-${index}`}>
          <StarRating count={starCount} tier={tier} />
          <span className={`text-[11px] font-black ${
            isGold ? "text-yellow-300" : isBronze ? "text-orange-300" : "text-slate-400"
          }`}>
            {conf.toFixed(0)}%
          </span>
        </div>
      </div>

      <h3 className="text-base font-bold text-white mb-1" data-testid={`prop-player-${index}`}>{prop.playerName}</h3>

      <div className="flex items-center justify-between bg-slate-900/50 rounded-xl px-4 py-3 border border-slate-800/50">
        <div>
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">{prop.propType}</p>
          <p className="text-lg font-black text-white">{prop.line}</p>
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
  );
}

function LockedPropCard({ index, sport, tier }: { index: number; sport: string; tier: string }) {
  const isGuest = tier === "guest";
  const upgradeLabel = isGuest ? "Locked Pick" : tier === "star" ? "Pro Pick" : "Premium Pick";
  const upgradeText = isGuest ? "Sign In to Unlock" : tier === "star" ? "Upgrade to Pro" : "Upgrade Plan";
  return (
    <Card
      className="bg-slate-800/20 border-slate-800/50 p-5 relative overflow-hidden"
      data-testid={`prop-locked-${sport.toLowerCase()}-${index}`}
    >
      <div className="absolute inset-0 backdrop-blur-sm bg-slate-900/60 z-10 flex flex-col items-center justify-center">
        <Lock className="w-7 h-7 text-amber-500/60 mb-2" />
        <p className="text-sm font-bold text-slate-300 mb-1">{upgradeLabel}</p>
        <p className="text-[11px] text-slate-400 mb-2">{isGuest ? "Create an account to view picks" : "Higher confidence pick"}</p>
        {isGuest ? (
          <Button size="sm" className="text-xs" onClick={() => window.location.href = '/api/login'}>
            <Lock className="w-3 h-3 mr-1" /> {upgradeText}
          </Button>
        ) : (
          <Link href="/pricing">
            <Button size="sm" className="text-xs">
              <Crown className="w-3 h-3 mr-1" /> {upgradeText}
            </Button>
          </Link>
        )}
      </div>
      <div className="opacity-20">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-12 h-3 bg-slate-700 rounded" />
          <div className="w-16 h-3 bg-slate-700 rounded" />
        </div>
        <div className="w-32 h-5 bg-slate-700 rounded mb-2" />
        <div className="w-24 h-3 bg-slate-700 rounded mb-3" />
        <div className="bg-slate-900/50 rounded-xl px-4 py-3">
          <div className="w-20 h-3 bg-slate-700 rounded mb-2" />
          <div className="w-12 h-6 bg-slate-700 rounded" />
        </div>
      </div>
    </Card>
  );
}

const SPORT_ICON_COMPONENTS: Record<string, typeof Trophy> = {
  NBA: Dribbble,
  NHL: Activity,
  MLB: Target,
  NFL: Trophy,
  GOLF: Flag,
};

interface PrizePicksProjection {
  id: string;
  playerName: string;
  team: string;
  position: string;
  statType: string;
  line: number;
  startTime: string;
  gameInfo: string;
  imageUrl: string | null;
  league: string;
  oddsType: string;
  isLive: boolean;
  status: string;
}

interface PrizePicksResponse {
  sport: string;
  projections: PrizePicksProjection[];
}

const PP_STAT_COLORS: Record<string, string> = {
  "Points": "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  "Rebounds": "text-blue-400 bg-blue-500/10 border-blue-500/20",
  "Assists": "text-purple-400 bg-purple-500/10 border-purple-500/20",
  "Pts+Rebs+Asts": "text-amber-400 bg-amber-500/10 border-amber-500/20",
  "3-Pointers Made": "text-cyan-400 bg-cyan-500/10 border-cyan-500/20",
  "Fantasy Score": "text-pink-400 bg-pink-500/10 border-pink-500/20",
  "Goals": "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  "Shots on Goal": "text-blue-400 bg-blue-500/10 border-blue-500/20",
  "Saves": "text-orange-400 bg-orange-500/10 border-orange-500/20",
};

function getStatColor(statType: string): string {
  return PP_STAT_COLORS[statType] || "text-slate-300 bg-slate-500/10 border-slate-500/20";
}

export default function PropBets() {
  const searchString = useSearch();
  const sportParam = new URLSearchParams(searchString).get("sport")?.toUpperCase() || null;
  const [ppSport, setPpSport] = useState<string>("NBA");

  const { data, isLoading } = useQuery<PropsResponse>({
    queryKey: ["/api/props"],
  });

  const { data: ppData, isLoading: ppLoading } = useQuery<PrizePicksResponse>({
    queryKey: ["/api/prizepicks", ppSport],
    refetchInterval: 300000,
  });

  useEffect(() => {
    if (sportParam && data && !isLoading) {
      const el = document.querySelector(`[data-testid="sport-section-${sportParam.toLowerCase()}"]`);
      if (el) {
        setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
      }
    }
  }, [sportParam, data, isLoading]);

  const tier = data?.tier || "guest";
  const isGuest = tier === "guest";
  const isPro = tier === "pro";
  const isPaid = tier === "pro" || tier === "star";

  const propsBySport: Record<string, PropBet[]> = {};
  if (data?.props) {
    for (const prop of data.props) {
      if (!propsBySport[prop.sport]) propsBySport[prop.sport] = [];
      propsBySport[prop.sport].push(prop);
    }
  }

  const lockedPerSport = isGuest
    ? 2
    : data && !isPro && data.lockedCount
      ? Math.max(1, Math.floor(data.lockedCount / ACTIVE_SPORTS.length))
      : 0;

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
    <div className="min-h-screen">
      {/* Hero Background */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-emerald-950/40 via-slate-950/80 to-[#0F172A]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-emerald-500/8 via-transparent to-transparent" />
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl" />
        <div className="absolute top-10 right-1/4 w-72 h-72 bg-amber-500/5 rounded-full blur-3xl" />

        <div className="relative container mx-auto px-4 pt-12 pb-10">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-8 gap-4">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-4xl font-black text-white tracking-tight" data-testid="prop-bets-title">Prop Bets</h1>
                <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-xs font-black">
                  <Zap className="w-3 h-3 mr-1 fill-current" /> AI PICKS
                </Badge>
              </div>
              <p className="text-slate-400">
                Daily AI-generated player prop picks organized by sport.
                {isGuest ? (
                  <span className="text-amber-400 font-bold ml-1">
                    Sign in to unlock picks
                  </span>
                ) : !isPro && (
                  <span className="text-amber-400 font-bold ml-1">
                    {data?.maxPerSport || 2} picks per sport
                  </span>
                )}
              </p>
            </div>
            {isGuest ? (
              <Button onClick={() => window.location.href = '/api/login'} data-testid="signin-props-btn">
                <Lock className="w-4 h-4 mr-2" /> Sign In to Unlock
              </Button>
            ) : !isPro && (
              <Link href="/pricing">
                <Button data-testid="upgrade-props-btn">
                  <Crown className="w-4 h-4 mr-2" /> {tier === "star" ? "Upgrade to Pro" : "Unlock More Picks"}
                </Button>
              </Link>
            )}
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 pb-12 -mt-2">

      {isGuest && (
        <div className="mb-10" data-testid="props-membership-explainer">
          <div className="bg-gradient-to-br from-amber-500/5 via-slate-900/80 to-slate-900 border border-amber-500/20 rounded-2xl p-8 mb-8">
            <div className="text-center mb-6">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 mb-3">
                <Sparkles className="w-7 h-7 text-amber-400" />
              </div>
              <h2 className="text-2xl font-black text-white tracking-tight mb-2">AI-Powered Prop Picks</h2>
              <p className="text-slate-400 max-w-xl mx-auto">
                Our algorithm analyzes player stats, matchups, and trends to deliver high-confidence prop bet picks daily across every active sport. Here's a preview — sign in to unlock more.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-2xl mx-auto">
              <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4 text-center space-y-2">
                <Target className="w-5 h-5 text-emerald-400 mx-auto" />
                <div className="text-sm font-bold text-white">Confidence Ratings</div>
                <div className="text-xs text-slate-400">Each pick rated with a 5-star confidence score</div>
              </div>
              <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4 text-center space-y-2">
                <TrendingUp className="w-5 h-5 text-amber-400 mx-auto" />
                <div className="text-sm font-bold text-white">Daily Updates</div>
                <div className="text-xs text-slate-400">Fresh picks generated every day for active sports</div>
              </div>
              <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4 text-center space-y-2">
                <Shield className="w-5 h-5 text-cyan-400 mx-auto" />
                <div className="text-sm font-bold text-white">Multi-Sport</div>
                <div className="text-xs text-slate-400">NBA, NHL, GOLF and more covered daily</div>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-4 mt-6">
              <Badge className="bg-slate-800/80 border-slate-700 text-slate-300 text-xs font-bold px-3 py-1">
                Basic: 1 pick/sport
              </Badge>
              <Badge className="bg-emerald-500/10 border-emerald-500/20 text-emerald-400 text-xs font-bold px-3 py-1">
                Star: 5 picks/sport
              </Badge>
              <Badge className="bg-amber-500/10 border-amber-500/20 text-amber-400 text-xs font-bold px-3 py-1">
                Pro: 15 picks/sport
              </Badge>
            </div>
          </div>

          <div className="flex items-center gap-2 mb-6">
            <Zap className="w-5 h-5 text-amber-400 fill-amber-400" />
            <h3 className="text-lg font-black text-white">Today's Picks</h3>
            <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[10px] font-black">1 PER SPORT</Badge>
          </div>
        </div>
      )}

      <div className="bg-slate-800/30 border border-slate-800 rounded-xl p-4 mb-8" data-testid="star-rating-legend">
        <div className="flex items-center gap-2 mb-3">
          <Star className="w-4 h-4 text-yellow-400 fill-yellow-400" />
          <span className="text-sm font-bold text-white">Confidence Rating</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          {[
            { stars: 5, label: "Elite", range: "85%+", color: "text-yellow-400 fill-yellow-400" },
            { stars: 4, label: "Strong", range: "78–84%", color: "text-yellow-400 fill-yellow-400" },
            { stars: 3, label: "Solid", range: "68–77%", color: "text-orange-400 fill-orange-400" },
            { stars: 2, label: "Moderate", range: "58–67%", color: "text-emerald-400 fill-emerald-400" },
            { stars: 1, label: "Speculative", range: "<58%", color: "text-emerald-400 fill-emerald-400" },
          ].map(({ stars, label, range, color }) => (
            <div key={stars} className="flex items-center gap-2">
              <div className="flex items-center gap-0.5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star key={i} className={`w-3 h-3 ${i < stars ? color : "text-slate-700"}`} />
                ))}
              </div>
              <div className="flex flex-col">
                <span className="text-[11px] font-bold text-white leading-tight">{label}</span>
                <span className="text-[10px] text-slate-500 leading-tight">{range}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <DfsAffiliateBanner />

      {ACTIVE_SPORTS.map(sport => {
        const sportProps = propsBySport[sport] || [];
        const hasContent = sportProps.length > 0 || isGuest || (!isPro && lockedPerSport > 0);
        if (!hasContent && !isPro) return null;

        return (
          <section key={sport} className="mb-12" data-testid={`sport-section-${sport.toLowerCase()}`}>
            <div className="flex items-center gap-3 mb-4">
              {(() => { const Icon = SPORT_ICON_COMPONENTS[sport]; return Icon ? <Icon className="w-6 h-6 text-emerald-400" /> : null; })()}
              <h2 className="text-2xl font-black text-white tracking-tight">{sport}</h2>
              {sportProps.length > 0 && (
                <Badge variant="outline" className="text-[11px] font-bold border-slate-700 text-slate-400">
                  {sportProps.length} pick{sportProps.length !== 1 ? "s" : ""}
                </Badge>
              )}
            </div>

            <SportAffiliateBanner sport={sport} />

            {sportProps.length === 0 && !isGuest && isPro ? (
              <div className="py-10 text-center bg-slate-800/20 rounded-2xl border border-dashed border-slate-800/50 mb-6">
                <p className="text-slate-400 text-sm">No {sport} props available today</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-2">
                {sportProps.map((prop, idx) => (
                  <PropCard key={prop.id} prop={prop} index={prop.id} />
                ))}
                {(isGuest || !isPro) && Array.from({ length: Math.min(lockedPerSport, 3) }).map((_, i) => (
                  <LockedPropCard key={`locked-${sport}-${i}`} index={i} sport={sport} tier={tier} />
                ))}
              </div>
            )}
          </section>
        );
      })}

      <section className="mb-12" data-testid="prizepicks-section">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500/30 to-purple-600/20 flex items-center justify-center border border-violet-500/30">
            <TrendingUp className="w-4 h-4 text-violet-400" />
          </div>
          <h2 className="text-2xl font-black text-white tracking-tight">PrizePicks Board</h2>
          <Badge className="bg-violet-500/10 text-violet-400 border-violet-500/20 text-[10px] font-black">LIVE LINES</Badge>
        </div>
        <p className="text-sm text-slate-400 mb-4 ml-11">Real-time player projections from PrizePicks. Pick More or Less on any stat line.</p>

        <div className="flex gap-2 mb-5 ml-11 flex-wrap">
          {(["NBA", "NHL", "NFL", "MLB", "GOLF", "SOCCER"] as const).map(s => (
            <Button
              key={s}
              size="sm"
              variant={ppSport === s ? "default" : "ghost"}
              className={ppSport === s
                ? "bg-violet-500 text-white font-black text-xs"
                : "text-slate-400 font-bold text-xs border border-slate-700/50"
              }
              onClick={() => setPpSport(s)}
              data-testid={`pp-sport-${s.toLowerCase()}`}
            >
              {s}
            </Button>
          ))}
        </div>

        {ppLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {[1, 2, 3, 4, 5, 6].map(i => <Skeleton key={i} className="h-24 bg-slate-800 rounded-xl" />)}
          </div>
        ) : !ppData?.projections?.length ? (
          <div className="py-10 text-center bg-slate-800/20 rounded-2xl border border-dashed border-slate-800/50">
            <p className="text-slate-400 text-sm">No PrizePicks lines available for {ppSport} right now</p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2 mb-4 ml-11">
              {(() => {
                const statCounts: Record<string, number> = {};
                ppData.projections.forEach(p => { statCounts[p.statType] = (statCounts[p.statType] || 0) + 1; });
                const sorted = Object.entries(statCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);
                return sorted.map(([stat, count]) => (
                  <Badge key={stat} className={`${getStatColor(stat)} text-[10px] font-bold border`}>
                    {stat} ({count})
                  </Badge>
                ));
              })()}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {ppData.projections.slice(0, 30).map((proj) => (
                <div
                  key={proj.id}
                  className="bg-slate-800/40 border border-slate-700/40 rounded-xl p-3 hover:border-violet-500/30 transition-colors"
                  data-testid={`pp-card-${proj.id}`}
                >
                  <div className="flex items-center gap-3">
                    {proj.imageUrl ? (
                      <img
                        src={proj.imageUrl}
                        alt={proj.playerName}
                        className="w-10 h-10 rounded-full bg-slate-700/50 object-cover shrink-0"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-slate-700/50 flex items-center justify-center shrink-0">
                        <span className="text-xs font-black text-slate-400">{proj.team?.slice(0, 3)}</span>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-black text-white truncate">{proj.playerName}</span>
                        {proj.isLive && (
                          <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-[9px] font-black px-1.5 py-0">LIVE</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] text-slate-400 font-bold">{proj.team}</span>
                        {proj.position && (
                          <>
                            <span className="text-slate-600">·</span>
                            <span className="text-[11px] text-slate-500">{proj.position}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-lg font-black text-white">{proj.line}</div>
                      <Badge className={`${getStatColor(proj.statType)} text-[9px] font-bold border px-1.5 py-0`}>
                        {proj.statType}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-700/30">
                    <span className="text-[10px] text-slate-500">{proj.gameInfo}</span>
                    {proj.oddsType === "demon" && (
                      <Badge className="bg-red-500/10 text-red-400 border-red-500/20 text-[9px] font-bold px-1.5 py-0">
                        <Flame className="w-2.5 h-2.5 mr-0.5 inline" /> Demon
                      </Badge>
                    )}
                    {proj.oddsType === "goblin" && (
                      <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[9px] font-bold px-1.5 py-0">
                        <Shield className="w-2.5 h-2.5 mr-0.5 inline" /> Goblin
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {ppData.projections.length > 30 && (
              <p className="text-center text-xs text-slate-500 mt-3">
                Showing 30 of {ppData.projections.length} available lines
              </p>
            )}
          </>
        )}
        <div className="mt-4 text-center">
          <p className="text-[10px] text-slate-500">
            Data provided by PrizePicks. Lines are for informational purposes only.
          </p>
        </div>
      </section>

      {!isPro && (isGuest || (data?.lockedCount && data.lockedCount > 0)) && (
        <div className="mt-4 mb-12 text-center bg-gradient-to-r from-amber-900/20 via-amber-800/10 to-amber-900/20 border border-amber-700/20 rounded-2xl p-8" data-testid="unlock-all-cta">
          <Crown className="w-10 h-10 text-amber-500/60 mx-auto mb-3" />
          <h3 className="text-xl font-black text-white mb-2">
            {isGuest ? "Sign In to Unlock AI Picks" : tier === "star" ? "Get Up to 15 Picks Per Sport" : "Unlock More Daily Picks"}
          </h3>
          <p className="text-slate-400 text-sm mb-5 max-w-md mx-auto">
            {isGuest
              ? "Create an account to start seeing AI-powered prop picks. Upgrade for even more picks across all sports."
              : tier === "star"
                ? "Upgrade to Pro ($19.99/mo) for up to 15 AI-powered prop picks per sport with higher confidence ratings."
                : "Upgrade your plan for more AI-powered prop picks across all sports. Star gets up to 5, Pro gets up to 15."}
          </p>
          {isGuest ? (
            <Button onClick={() => window.location.href = '/api/login'} data-testid="unlock-all-btn">
              <Lock className="w-4 h-4 mr-2" /> Sign In
            </Button>
          ) : (
            <Link href="/pricing">
              <Button data-testid="unlock-all-btn">
                <Crown className="w-4 h-4 mr-2" /> {tier === "star" ? "Upgrade to Pro" : "View Plans"}
              </Button>
            </Link>
          )}
        </div>
      )}

      <div className="border-t border-slate-800 pt-8 mt-4">
        <p className="text-[11px] text-slate-400 text-center max-w-2xl mx-auto leading-relaxed" data-testid="affiliate-disclaimer">
          Affiliate Disclosure: EliteLineup AI may earn a commission from links to DraftKings and FanDuel.
          Must be 21+ and present in states where DFS/sports betting is legal. Please play responsibly.
          If you or someone you know has a gambling problem, call 1-800-GAMBLER.
        </p>
      </div>
      </div>
    </div>
  );
}

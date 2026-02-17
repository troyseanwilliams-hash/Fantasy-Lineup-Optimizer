import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Link, useSearch } from "wouter";
import { Lock, Crown, Zap, ArrowUpRight, ArrowDownRight, ExternalLink, Trophy, Activity, Target, Dribbble, Clock } from "lucide-react";
import { useState } from "react";
import { ACTIVE_SPORTS } from "@shared/platform-config";
import { AFFILIATE_LINKS, AFFILIATE_PROMOS } from "@shared/affiliate-config";

const SPORT_LOGO_PATH: Record<string, string> = {
  NBA: "nba", NHL: "nhl", MLB: "mlb", NFL: "nfl",
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

function TeamLogo({ team, sport, size = 20 }: { team: string; sport: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div
        className="rounded-full bg-slate-700/60 flex items-center justify-center text-[9px] font-black text-slate-400 shrink-0"
        style={{ width: size, height: size }}
        data-testid={`team-logo-fallback-${team.toLowerCase()}`}
      >
        {team.slice(0, 3)}
      </div>
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

function PropCard({ prop, index }: { prop: PropBet; index: number }) {
  return (
    <Card
      className="bg-slate-800/30 border-slate-800 p-5 transition-all hover-elevate"
      data-testid={`prop-card-${index}`}
    >
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
              const timeMatch = prop.gameInfo.match(/(\d{1,2}:\d{2}\s*(?:AM|PM)(?:\s*ET)?)/i);
              const gameTime = timeMatch ? timeMatch[1] : null;
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
        <div className={`px-2 py-0.5 rounded text-[11px] font-black ${
          Number(prop.confidence) >= 75
            ? "bg-emerald-500/20 text-emerald-400"
            : Number(prop.confidence) >= 65
            ? "bg-amber-500/20 text-amber-400"
            : "bg-slate-700/50 text-slate-400"
        }`} data-testid={`prop-confidence-${index}`}>
          {Number(prop.confidence).toFixed(0)}%
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
};

export default function PropBets() {
  const searchString = useSearch();
  const sportParam = new URLSearchParams(searchString).get("sport")?.toUpperCase() || null;

  const { data, isLoading } = useQuery<PropsResponse>({
    queryKey: ["/api/props"],
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
    ? 3
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
    <div className="container mx-auto px-4 py-12">
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

      {!isPro && (isGuest || (data?.lockedCount && data.lockedCount > 0)) && (
        <div className="mt-4 mb-12 text-center bg-gradient-to-r from-amber-900/20 via-amber-800/10 to-amber-900/20 border border-amber-700/20 rounded-2xl p-8" data-testid="unlock-all-cta">
          <Crown className="w-10 h-10 text-amber-500/60 mx-auto mb-3" />
          <h3 className="text-xl font-black text-white mb-2">
            {isGuest ? "Sign In to Unlock AI Picks" : tier === "star" ? "Get Up to 15 Picks Per Sport" : "Unlock More Daily Picks"}
          </h3>
          <p className="text-slate-400 text-sm mb-5 max-w-md mx-auto">
            {isGuest
              ? "Create a free account to start seeing AI-powered prop picks. Upgrade for even more picks across all sports."
              : tier === "star"
                ? "Upgrade to Pro ($19.99/mo) for up to 15 AI-powered prop picks per sport with higher confidence ratings."
                : "Upgrade your plan for more AI-powered prop picks across all sports. Star gets up to 8, Pro gets up to 15."}
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
  );
}

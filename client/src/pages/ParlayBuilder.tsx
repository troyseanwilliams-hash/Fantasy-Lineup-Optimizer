import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import {
  Layers, Lock, Crown, Trophy, Zap, Plus, X, Trash2,
  TrendingUp, ArrowUpRight, ArrowDownRight, Dribbble,
  Activity, Flag, Target, DollarSign, Sparkles, ChevronRight,
  AlertTriangle, CheckCircle2, Info, Copy, Share2, ExternalLink
} from "lucide-react";
import { ACTIVE_SPORTS } from "@shared/platform-config";
import { AFFILIATE_LINKS } from "@shared/affiliate-config";

const SPORT_META: Record<string, { icon: typeof Dribbble; color: string; bgColor: string; accent: string }> = {
  NBA: { icon: Dribbble, color: "text-orange-400", bgColor: "bg-orange-500/20", accent: "orange" },
  NHL: { icon: Activity, color: "text-cyan-400", bgColor: "bg-cyan-500/20", accent: "cyan" },
  MLB: { icon: Target, color: "text-red-400", bgColor: "bg-red-500/20", accent: "red" },
  GOLF: { icon: Flag, color: "text-lime-400", bgColor: "bg-lime-500/20", accent: "lime" },
};

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

function TeamLogo({ team, sport, size = 24 }: { team: string; sport: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div
        className="rounded-full bg-slate-800 flex items-center justify-center text-[9px] font-bold text-slate-400 shrink-0"
        style={{ width: size, height: size }}
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

interface ParlayLeg {
  prop: PropBet;
  americanOdds: number;
  decimalOdds: number;
}

function confidenceToOdds(confidence: number): { american: number; decimal: number } {
  const impliedProb = confidence / 100;
  const trueProb = Math.max(0.3, Math.min(0.85, impliedProb * 0.92));
  if (trueProb >= 0.5) {
    const american = Math.round(-100 * trueProb / (1 - trueProb));
    return { american, decimal: Math.round((1 / trueProb) * 100) / 100 };
  } else {
    const american = Math.round(100 * (1 - trueProb) / trueProb);
    return { american: +american, decimal: Math.round((1 / trueProb) * 100) / 100 };
  }
}

function formatOdds(american: number): string {
  return american > 0 ? `+${american}` : `${american}`;
}

function UnauthenticatedView() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-lg text-center space-y-6">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-purple-500/10 border border-purple-500/20 mb-2">
          <Layers className="w-10 h-10 text-purple-400" />
        </div>
        <h1 className="text-3xl font-black text-white tracking-tight" data-testid="parlay-title">Parlay Builder</h1>
        <p className="text-slate-400 text-lg leading-relaxed">
          Combine multiple player props across sports into one powerful parlay. Our AI-powered engine calculates combined odds, potential payouts, and links you directly to DraftKings to place your bet.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 space-y-2">
            <Layers className="w-5 h-5 text-purple-400 mx-auto" />
            <div className="text-sm font-bold text-white">Build Parlays</div>
            <div className="text-xs text-slate-400">Stack props from any sport into high-value parlays</div>
          </div>
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 space-y-2">
            <TrendingUp className="w-5 h-5 text-emerald-400 mx-auto" />
            <div className="text-sm font-bold text-white">Live Odds</div>
            <div className="text-xs text-slate-400">See combined odds and potential payouts in real time</div>
          </div>
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 space-y-2">
            <ExternalLink className="w-5 h-5 text-amber-400 mx-auto" />
            <div className="text-sm font-bold text-white">Place on DK</div>
            <div className="text-xs text-slate-400">One-click link to place your parlay on DraftKings</div>
          </div>
        </div>
        <div className="bg-gradient-to-r from-purple-500/10 via-slate-800/50 to-purple-500/10 border border-purple-500/20 rounded-xl p-4">
          <div className="flex items-center gap-2 justify-center mb-2">
            <Crown className="w-4 h-4 text-amber-400" />
            <span className="text-sm font-bold text-white">Pro Feature</span>
          </div>
          <p className="text-xs text-slate-400">The Parlay Builder is available exclusively to Pro members. Upgrade to start building winning parlays.</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
          <a href="/api/login" data-testid="parlay-login-btn">
            <Button className="bg-emerald-500 hover:bg-emerald-600 text-black font-bold px-8 h-12">
              <Zap className="w-4 h-4 mr-2" /> Sign In to Get Started
            </Button>
          </a>
          <Link href="/pricing">
            <Button variant="outline" className="border-slate-700 text-slate-300 h-12 px-6" data-testid="parlay-pricing-btn">
              <Crown className="w-4 h-4 mr-2" /> View Plans
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

function NonProView() {
  return (
    <div className="min-h-screen">
      <div className="relative overflow-hidden border-b border-slate-800/50">
        <div className="absolute inset-0 bg-gradient-to-br from-purple-950/50 via-slate-950/90 to-slate-900/95" />
        <div className="relative container mx-auto px-4 py-10">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-14 h-14 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
              <Layers className="w-7 h-7 text-purple-400" />
            </div>
            <div>
              <h1 className="text-4xl font-black text-white tracking-tight" data-testid="parlay-title">Parlay Builder</h1>
              <p className="text-slate-400 text-sm mt-1">Combine picks into parlays</p>
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-12">
        <div className="max-w-2xl mx-auto text-center space-y-8">
          <div className="bg-gradient-to-b from-purple-500/5 to-transparent border border-purple-500/20 rounded-2xl p-8">
            <Lock className="w-12 h-12 text-purple-400/60 mx-auto mb-4" />
            <h2 className="text-2xl font-black text-white mb-3">Upgrade to Pro for Parlay Builder</h2>
            <p className="text-slate-400 mb-6">
              The Parlay Builder is an exclusive Pro feature ($49.99/mo). Combine multiple player props across any sport into a single parlay with combined odds and a direct link to place your bet on DraftKings.
            </p>

            <div className="bg-slate-800/40 border border-amber-500/20 rounded-xl p-5 text-left max-w-sm mx-auto mb-6">
              <div className="flex items-center gap-2 mb-3">
                <Crown className="w-5 h-5 text-amber-400" />
                <span className="text-sm font-bold text-amber-400">Pro Plan Includes</span>
              </div>
              <ul className="space-y-2 text-xs text-slate-400">
                <li className="flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-amber-400/60" /> Up to 8-leg parlays</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-amber-400/60" /> Cross-sport parlay building</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-amber-400/60" /> AI confidence insights</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-amber-400/60" /> Direct DraftKings bet links</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-amber-400/60" /> Payout calculator</li>
              </ul>
            </div>

            <Link href="/pricing">
              <Button className="bg-amber-500 hover:bg-amber-600 text-black font-bold px-8 h-12 shadow-lg shadow-amber-500/20" data-testid="parlay-upgrade-btn">
                <Crown className="w-4 h-4 mr-2" /> Upgrade to Pro
              </Button>
            </Link>
          </div>

          <div className="bg-slate-800/30 border border-slate-800 rounded-2xl p-6">
            <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2 justify-center">
              <Info className="w-5 h-5 text-purple-400" /> How Parlay Builder Works
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
              <div className="space-y-2">
                <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center mx-auto">
                  <span className="text-sm font-black text-purple-400">1</span>
                </div>
                <div className="text-sm font-bold text-white">Pick Props</div>
                <div className="text-xs text-slate-400">Browse props across any sport and add picks to your parlay</div>
              </div>
              <div className="space-y-2">
                <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center mx-auto">
                  <span className="text-sm font-black text-purple-400">2</span>
                </div>
                <div className="text-sm font-bold text-white">See Odds</div>
                <div className="text-xs text-slate-400">Combined odds and potential payouts update as you build</div>
              </div>
              <div className="space-y-2">
                <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center mx-auto">
                  <span className="text-sm font-black text-purple-400">3</span>
                </div>
                <div className="text-sm font-bold text-white">Place Bet</div>
                <div className="text-xs text-slate-400">Click through to DraftKings to place your parlay bet</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ParlayBuilder() {
  const { user, isLoading: authLoading } = useAuth();
  const [selectedSport, setSelectedSport] = useState<string>("ALL");
  const [parlayLegs, setParlayLegs] = useState<ParlayLeg[]>([]);
  const [wagerAmount, setWagerAmount] = useState<number>(10);
  const [copied, setCopied] = useState(false);

  const { data: subData } = useQuery<{ tier: string }>({
    queryKey: ["/api/subscription"],
    enabled: !!user,
  });

  const { data: propsData, isLoading: propsLoading } = useQuery<{ props: PropBet[]; tier: string }>({
    queryKey: ["/api/props"],
    enabled: !!user,
  });

  const tier = subData?.tier || "free";
  const isPro = tier === "pro";
  const maxLegs = 8;

  if (authLoading) {
    return (
      <div className="container mx-auto px-4 py-12">
        <Skeleton className="h-12 w-64 bg-slate-800 mb-6" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Skeleton className="h-96 bg-slate-800 rounded-xl" />
          <Skeleton className="h-96 bg-slate-800 rounded-xl" />
        </div>
      </div>
    );
  }

  if (!user) return <UnauthenticatedView />;
  if (!isPro) return <NonProView />;

  const allProps = propsData?.props?.filter(p => !p.isLocked) || [];
  const filteredProps = selectedSport === "ALL" ? allProps : allProps.filter(p => p.sport === selectedSport);

  const availableSports = useMemo(() => {
    const sports = new Set(allProps.map(p => p.sport));
    return ACTIVE_SPORTS.filter(s => sports.has(s));
  }, [allProps]);

  const addLeg = (prop: PropBet) => {
    if (parlayLegs.length >= maxLegs) return;
    if (parlayLegs.some(l => l.prop.id === prop.id)) return;
    const conf = Number(prop.confidence);
    const odds = confidenceToOdds(conf);
    setParlayLegs(prev => [...prev, { prop, americanOdds: odds.american, decimalOdds: odds.decimal }]);
  };

  const removeLeg = (propId: number) => {
    setParlayLegs(prev => prev.filter(l => l.prop.id !== propId));
  };

  const clearAll = () => {
    setParlayLegs([]);
  };

  const combinedDecimalOdds = parlayLegs.reduce((acc, leg) => acc * leg.decimalOdds, 1);
  const combinedAmericanOdds = combinedDecimalOdds >= 2
    ? Math.round((combinedDecimalOdds - 1) * 100)
    : Math.round(-100 / (combinedDecimalOdds - 1));
  const potentialPayout = Math.round(wagerAmount * combinedDecimalOdds * 100) / 100;
  const profit = Math.round((potentialPayout - wagerAmount) * 100) / 100;

  const avgConfidence = parlayLegs.length > 0
    ? Math.round(parlayLegs.reduce((sum, l) => sum + Number(l.prop.confidence), 0) / parlayLegs.length)
    : 0;

  const parlayRating = avgConfidence >= 75 ? "Strong" : avgConfidence >= 65 ? "Moderate" : avgConfidence >= 55 ? "Risky" : "Long Shot";
  const parlayColor = avgConfidence >= 75 ? "text-emerald-400" : avgConfidence >= 65 ? "text-amber-400" : avgConfidence >= 55 ? "text-orange-400" : "text-red-400";

  const copyParlay = () => {
    const sportLegs: Record<string, string[]> = {};
    parlayLegs.forEach(l => {
      const s = l.prop.sport;
      if (!sportLegs[s]) sportLegs[s] = [];
      sportLegs[s].push(`${l.prop.playerName} ${l.prop.pick} ${l.prop.line} ${l.prop.propType} (${formatOdds(l.americanOdds)})`);
    });
    const sections = Object.entries(sportLegs).map(([sport, lines]) => `${sport}\n${lines.join("\n")}`);
    const text = `Parlay - ${parlayLegs.length} Legs\n${sections.join("\n\n")}\nCombined: ${formatOdds(combinedAmericanOdds)} | $${wagerAmount} → $${potentialPayout.toFixed(2)}`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const legSports = useMemo(() => {
    const sports = new Set(parlayLegs.map(l => l.prop.sport));
    return Array.from(sports);
  }, [parlayLegs]);

  return (
    <div className="min-h-screen">
      <div className="relative overflow-hidden border-b border-slate-800/50">
        <div className="absolute inset-0 bg-gradient-to-br from-purple-950/60 via-slate-950/90 to-slate-900/95" />
        <div className="absolute top-0 right-0 w-96 h-96 bg-purple-500/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3" />

        <div className="relative container mx-auto px-4 py-8">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
                <Layers className="w-7 h-7 text-purple-400" />
              </div>
              <div>
                <h1 className="text-3xl font-black text-white tracking-tight" data-testid="parlay-title">Parlay Builder</h1>
                <p className="text-slate-400 text-sm mt-0.5">Combine picks across sports</p>
              </div>
              <Badge className="ml-2 bg-amber-500/20 text-amber-400 border-amber-500/30 font-bold">
                <Crown className="w-3 h-3 mr-1" /> PRO
              </Badge>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant={selectedSport === "ALL" ? "default" : "outline"}
                size="sm"
                onClick={() => setSelectedSport("ALL")}
                className={selectedSport === "ALL"
                  ? "bg-purple-500 hover:bg-purple-600 text-white font-bold"
                  : "border-slate-700 text-slate-400 hover:text-white font-bold"
                }
                data-testid="parlay-sport-all"
              >
                All Sports
              </Button>
              {availableSports.filter(s => s !== "GOLF").map(sport => {
                const meta = SPORT_META[sport];
                if (!meta) return null;
                const Icon = meta.icon;
                return (
                  <Button
                    key={sport}
                    variant={selectedSport === sport ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSelectedSport(sport)}
                    className={selectedSport === sport
                      ? "bg-purple-500 hover:bg-purple-600 text-white font-bold"
                      : "border-slate-700 text-slate-400 hover:text-white font-bold"
                    }
                    data-testid={`parlay-sport-${sport.toLowerCase()}`}
                  >
                    <Icon className="w-3.5 h-3.5 mr-1.5" />
                    {sport}
                  </Button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <div className="lg:col-span-3 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-purple-400" />
                Available Props
                {selectedSport !== "ALL" && <span className="text-sm text-slate-400 font-normal ml-1">— {selectedSport}</span>}
              </h2>
              <Badge variant="outline" className="border-slate-700 text-slate-400 text-xs">
                {filteredProps.length} props • max {maxLegs} legs
              </Badge>
            </div>

            {propsLoading ? (
              <div className="space-y-3">
                {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-20 bg-slate-800 rounded-xl" />)}
              </div>
            ) : filteredProps.length === 0 ? (
              <Card className="bg-slate-800/30 border-slate-800 p-8 text-center">
                <AlertTriangle className="w-8 h-8 text-amber-400/60 mx-auto mb-3" />
                <p className="text-sm text-slate-400">No props available{selectedSport !== "ALL" ? ` for ${selectedSport}` : ""} today. Props are generated daily — check back soon.</p>
              </Card>
            ) : (
              <div className="space-y-2">
                {filteredProps.map(prop => {
                  const isAdded = parlayLegs.some(l => l.prop.id === prop.id);
                  const conf = Number(prop.confidence);
                  const odds = confidenceToOdds(conf);
                  const isFull = parlayLegs.length >= maxLegs;

                  return (
                    <Card
                      key={prop.id}
                      className={`border p-4 transition-all cursor-pointer group ${
                        isAdded
                          ? "bg-purple-500/10 border-purple-500/30"
                          : "bg-slate-800/30 border-slate-800 hover:border-purple-500/30 hover:bg-slate-800/50"
                      }`}
                      onClick={() => isAdded ? removeLeg(prop.id) : addLeg(prop)}
                      data-testid={`parlay-prop-${prop.id}`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <TeamLogo team={prop.team} sport={prop.sport} size={32} />
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-white text-sm">{prop.playerName}</span>
                              <span className="text-xs text-slate-500">{prop.team}</span>
                              <Badge className="text-[9px] font-bold px-1 py-0 bg-slate-800 text-slate-400 border-slate-700">{prop.sport}</Badge>
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <Badge
                                className={`text-[10px] font-bold px-1.5 py-0 ${
                                  prop.pick === "Over"
                                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                    : "bg-red-500/10 text-red-400 border-red-500/20"
                                }`}
                              >
                                {prop.pick === "Over" ? <ArrowUpRight className="w-2.5 h-2.5 mr-0.5" /> : <ArrowDownRight className="w-2.5 h-2.5 mr-0.5" />}
                                {prop.pick}
                              </Badge>
                              <span className="text-xs text-slate-300 font-bold">{prop.line} {prop.propType}</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <div className={`text-sm font-black ${odds.american > 0 ? "text-emerald-400" : "text-white"}`}>
                              {formatOdds(odds.american)}
                            </div>
                            <div className={`text-[10px] font-bold ${conf >= 75 ? "text-emerald-400" : conf >= 60 ? "text-amber-400" : "text-red-400"}`}>
                              {conf.toFixed(0)}% conf
                            </div>
                          </div>
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
                            isAdded
                              ? "bg-purple-500 text-white"
                              : isFull
                                ? "bg-slate-800 text-slate-600"
                                : "bg-slate-800 text-slate-400 group-hover:bg-purple-500/20 group-hover:text-purple-400"
                          }`}>
                            {isAdded ? <CheckCircle2 className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                          </div>
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>

          <div className="lg:col-span-2 space-y-4">
            <Card className="bg-slate-800/30 border-purple-500/20 p-5 sticky top-24">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-black text-white flex items-center gap-2">
                  <Layers className="w-5 h-5 text-purple-400" />
                  Your Parlay
                </h3>
                {parlayLegs.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearAll}
                    className="text-slate-400 hover:text-red-400 text-xs"
                    data-testid="parlay-clear-all"
                  >
                    <Trash2 className="w-3 h-3 mr-1" /> Clear
                  </Button>
                )}
              </div>

              {parlayLegs.length === 0 ? (
                <div className="py-10 text-center">
                  <Layers className="w-10 h-10 text-slate-700 mx-auto mb-3" />
                  <p className="text-sm text-slate-500 font-bold">No legs added</p>
                  <p className="text-xs text-slate-600 mt-1">Click on props to add them to your parlay</p>
                </div>
              ) : (
                <>
                  <div className="space-y-2 mb-4">
                    {parlayLegs.map((leg, idx) => (
                      <div
                        key={leg.prop.id}
                        className="bg-slate-900/60 border border-slate-800 rounded-lg p-3 flex items-center justify-between group"
                        data-testid={`parlay-leg-${idx}`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                          <div className="w-6 h-6 rounded-full bg-purple-500/20 flex items-center justify-center shrink-0">
                            <span className="text-[10px] font-black text-purple-400">{idx + 1}</span>
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm font-bold text-white truncate">{leg.prop.playerName}</span>
                              <Badge className="text-[8px] font-bold px-1 py-0 bg-slate-800 text-slate-500 border-slate-700">{leg.prop.sport}</Badge>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Badge
                                className={`text-[9px] font-bold px-1 py-0 ${
                                  leg.prop.pick === "Over"
                                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                    : "bg-red-500/10 text-red-400 border-red-500/20"
                                }`}
                              >
                                {leg.prop.pick}
                              </Badge>
                              <span className="text-[10px] text-slate-400">{leg.prop.line} {leg.prop.propType}</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className={`text-xs font-bold ${leg.americanOdds > 0 ? "text-emerald-400" : "text-white"}`}>
                            {formatOdds(leg.americanOdds)}
                          </span>
                          <button
                            onClick={(e) => { e.stopPropagation(); removeLeg(leg.prop.id); }}
                            className="w-5 h-5 rounded flex items-center justify-center text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                            data-testid={`parlay-remove-leg-${idx}`}
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {legSports.length > 1 && (
                    <div className="flex items-center gap-1.5 mb-3 px-1">
                      <Sparkles className="w-3 h-3 text-amber-400" />
                      <span className="text-[10px] font-bold text-amber-400">Cross-sport parlay: {legSports.join(" + ")}</span>
                    </div>
                  )}

                  <div className="border-t border-slate-800 pt-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-400 font-bold">Legs</span>
                      <span className="text-sm font-bold text-white">{parlayLegs.length}/{maxLegs}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-400 font-bold">Combined Odds</span>
                      <span className={`text-lg font-black ${combinedAmericanOdds > 0 ? "text-emerald-400" : "text-white"}`}>
                        {formatOdds(combinedAmericanOdds)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-400 font-bold">AI Rating</span>
                      <span className={`text-sm font-bold ${parlayColor}`}>{parlayRating} ({avgConfidence}%)</span>
                    </div>

                    <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-3">
                      <label className="text-xs text-slate-400 font-bold block mb-1.5">Wager Amount</label>
                      <div className="flex items-center gap-2">
                        <DollarSign className="w-4 h-4 text-emerald-400 shrink-0" />
                        <input
                          type="number"
                          value={wagerAmount}
                          onChange={e => setWagerAmount(Math.max(1, Number(e.target.value)))}
                          className="bg-transparent text-white font-bold text-lg w-full outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          min={1}
                          data-testid="parlay-wager-input"
                        />
                      </div>
                      <div className="flex gap-1.5 mt-2">
                        {[5, 10, 25, 50, 100].map(amt => (
                          <button
                            key={amt}
                            onClick={() => setWagerAmount(amt)}
                            className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                              wagerAmount === amt
                                ? "bg-purple-500/20 text-purple-400"
                                : "bg-slate-800 text-slate-500 hover:text-slate-300"
                            }`}
                            data-testid={`parlay-wager-${amt}`}
                          >
                            ${amt}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="bg-gradient-to-r from-purple-500/10 to-emerald-500/10 border border-purple-500/20 rounded-lg p-4">
                      <div className="text-xs text-slate-400 font-bold mb-1">Potential Payout</div>
                      <div className="text-3xl font-black text-white">${potentialPayout.toFixed(2)}</div>
                      <div className="text-xs text-emerald-400 font-bold mt-0.5">+${profit.toFixed(2)} profit</div>
                    </div>

                    <a
                      href={AFFILIATE_LINKS.draftkings.sportsbook.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block"
                      data-testid="parlay-place-bet-btn"
                    >
                      <Button className="w-full h-12 bg-emerald-500 hover:bg-emerald-600 text-black font-black shadow-lg shadow-emerald-500/20">
                        <ExternalLink className="w-4 h-4 mr-2" /> Place on DraftKings
                      </Button>
                    </a>

                    <div className="flex gap-2">
                      <Button
                        onClick={copyParlay}
                        variant="outline"
                        className="flex-1 border-slate-700 text-slate-300 font-bold"
                        data-testid="parlay-copy-btn"
                      >
                        {copied ? <><CheckCircle2 className="w-4 h-4 mr-1.5 text-emerald-400" /> Copied!</> : <><Copy className="w-4 h-4 mr-1.5" /> Copy</>}
                      </Button>
                      <Button
                        variant="outline"
                        className="border-slate-700 text-slate-300"
                        data-testid="parlay-share-btn"
                        onClick={copyParlay}
                      >
                        <Share2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </Card>

            {parlayLegs.length >= 2 && (
              <Card className="bg-slate-800/20 border-slate-800 p-4">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" /> AI Parlay Insight
                </h4>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {avgConfidence >= 70
                    ? `This ${parlayLegs.length}-leg ${legSports.length > 1 ? "cross-sport " : ""}parlay shows strong correlation between selected props. The average AI confidence of ${avgConfidence}% suggests favorable conditions for this combination.`
                    : avgConfidence >= 55
                    ? `This ${parlayLegs.length}-leg parlay has moderate risk. Consider focusing on legs with higher individual confidence scores to improve your overall edge.`
                    : `This ${parlayLegs.length}-leg parlay is a high-risk, high-reward play. The combined probability is relatively low — consider removing weaker legs to improve your hit rate.`}
                </p>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

import { useQuery } from "@tanstack/react-query";
import { Zap, Newspaper, TrendingUp, ArrowRight, Clock, ExternalLink, ArrowUpRight, ArrowDownRight, Archive, Crown, Trophy, Dribbble, Activity, Target, Lock, Sparkles } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { ACTIVE_SPORTS } from "@shared/platform-config";
import type { Slate } from "@shared/schema";

interface NewsArticle {
  id: string;
  headline: string;
  description: string;
  published: string;
  type: string;
  imageUrl: string | null;
  linkUrl: string | null;
  categories: string[];
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
  isLocked: boolean;
}

interface PropsResponse {
  props: PropBet[];
  tier: string;
  totalCount: number;
  maxPerSport: number;
}

const SPORT_META: Record<string, { icon: typeof Dribbble; color: string; bgColor: string; label: string }> = {
  NBA: { icon: Dribbble, color: "text-orange-400", bgColor: "bg-orange-500/20", label: "NBA" },
  NHL: { icon: Activity, color: "text-cyan-400", bgColor: "bg-cyan-500/20", label: "NHL" },
  MLB: { icon: Target, color: "text-red-400", bgColor: "bg-red-500/20", label: "MLB" },
};

function timeAgo(dateStr: string): string {
  const now = new Date();
  const published = new Date(dateStr);
  const diffMs = now.getTime() - published.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  return `${diffDays}d ago`;
}

function FeaturedNewsSection() {
  const primarySport = ACTIVE_SPORTS[0]?.toLowerCase() || "nba";
  const { data, isLoading, error } = useQuery<{ articles: NewsArticle[] }>({
    queryKey: [`/api/news/${primarySport}`],
  });

  const articles = data?.articles?.slice(0, 4) || [];
  const sportKey = primarySport.toUpperCase();
  const meta = SPORT_META[sportKey] || SPORT_META.NBA;

  return (
    <div data-testid="featured-news-section">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className={`w-9 h-9 rounded-lg ${meta.bgColor} flex items-center justify-center`}>
            <Newspaper className={`w-4.5 h-4.5 ${meta.color}`} />
          </div>
          <div>
            <h2 className="text-lg font-black text-white tracking-tight">Featured News</h2>
            <p className="text-[11px] text-slate-400 font-bold uppercase tracking-wider">Latest fantasy updates</p>
          </div>
        </div>
        <Link href={`/news/${primarySport}`}>
          <Button variant="ghost" size="sm" className="text-emerald-400 hover:text-emerald-300 font-bold gap-1" data-testid="view-all-news">
            All News <ArrowRight className="w-3.5 h-3.5" />
          </Button>
        </Link>
      </div>

      {error ? (
        <Card className="bg-red-900/20 border-red-800/40 p-6 text-center" data-testid="news-error">
          <Newspaper className="w-10 h-10 text-red-400/50 mx-auto mb-2" />
          <p className="text-sm text-red-400 font-bold">Unable to load news</p>
          <p className="text-[11px] text-red-400/60 mt-1">Please try again later</p>
        </Card>
      ) : isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="bg-slate-800/30 border-slate-800 p-4">
              <Skeleton className="h-4 w-3/4 mb-2" />
              <Skeleton className="h-3 w-full mb-1" />
              <Skeleton className="h-3 w-1/2" />
            </Card>
          ))}
        </div>
      ) : articles.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {articles.map((article) => (
            <a
              key={article.id}
              href={article.linkUrl || "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="block group"
              data-testid={`featured-news-${article.id}`}
            >
              <Card className="bg-slate-800/30 border-slate-800 p-4 h-full transition-all hover:border-slate-700 hover:bg-slate-800/50">
                <h3 className="text-sm font-bold text-white group-hover:text-emerald-400 transition-colors leading-snug line-clamp-2 mb-2">
                  {article.headline}
                </h3>
                {article.description && (
                  <p className="text-[13px] text-slate-400 line-clamp-2 leading-relaxed mb-3">
                    {article.description}
                  </p>
                )}
                <div className="flex items-center gap-2 mt-auto">
                  {article.published && (
                    <span className="flex items-center gap-1 text-[11px] text-slate-500 font-bold">
                      <Clock className="w-3 h-3" />
                      {timeAgo(article.published)}
                    </span>
                  )}
                  <ExternalLink className="w-3 h-3 text-slate-600 ml-auto group-hover:text-emerald-500 transition-colors" />
                </div>
              </Card>
            </a>
          ))}
        </div>
      ) : (
        <Card className="bg-slate-800/30 border-slate-800 p-8 text-center">
          <Newspaper className="w-10 h-10 text-slate-600 mx-auto mb-2" />
          <p className="text-sm text-slate-400 font-bold">No news available right now</p>
        </Card>
      )}

      <div className="flex gap-2 mt-4 flex-wrap" data-testid="news-sport-links">
        {ACTIVE_SPORTS.map(sport => {
          const m = SPORT_META[sport] || SPORT_META.NBA;
          const SIcon = m.icon;
          return (
            <Link key={sport} href={`/news/${sport.toLowerCase()}`}>
              <Button variant="outline" size="sm" className="border-slate-700 text-slate-300 hover:text-white hover:border-slate-600 font-bold gap-1.5" data-testid={`news-link-${sport.toLowerCase()}`}>
                <SIcon className={`w-3.5 h-3.5 ${m.color}`} />
                {sport} News
              </Button>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function DailyPicksSection() {
  const { data, isLoading, error } = useQuery<PropsResponse>({
    queryKey: ["/api/props"],
  });

  const visibleProps = data?.props?.filter(p => !p.isLocked).slice(0, 6) || [];
  const lockedCount = data?.props?.filter(p => p.isLocked).length || 0;
  const tier = data?.tier || "free";

  return (
    <div data-testid="daily-picks-section">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-purple-500/20 flex items-center justify-center">
            <TrendingUp className="w-4.5 h-4.5 text-purple-400" />
          </div>
          <div>
            <h2 className="text-lg font-black text-white tracking-tight">Daily Pick Specials</h2>
            <p className="text-[11px] text-slate-400 font-bold uppercase tracking-wider">Today's top prop picks</p>
          </div>
        </div>
        <Link href="/props">
          <Button variant="ghost" size="sm" className="text-purple-400 hover:text-purple-300 font-bold gap-1" data-testid="view-all-props">
            All Picks <ArrowRight className="w-3.5 h-3.5" />
          </Button>
        </Link>
      </div>

      {error ? (
        <Card className="bg-red-900/20 border-red-800/40 p-6 text-center" data-testid="props-error">
          <TrendingUp className="w-10 h-10 text-red-400/50 mx-auto mb-2" />
          <p className="text-sm text-red-400 font-bold">Unable to load picks</p>
          <p className="text-[11px] text-red-400/60 mt-1">Please try again later</p>
        </Card>
      ) : isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="bg-slate-800/30 border-slate-800 p-4">
              <Skeleton className="h-4 w-1/2 mb-2" />
              <Skeleton className="h-3 w-3/4 mb-1" />
              <Skeleton className="h-5 w-1/3" />
            </Card>
          ))}
        </div>
      ) : visibleProps.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {visibleProps.map((prop) => {
            const isOver = prop.pick.toLowerCase().includes("over");
            const sportMeta = SPORT_META[prop.sport] || SPORT_META.NBA;
            return (
              <Card
                key={prop.id}
                className="bg-slate-800/30 border-slate-800 p-4 transition-all hover:border-slate-700 hover:bg-slate-800/50"
                data-testid={`daily-pick-${prop.id}`}
              >
                <div className="flex items-center justify-between mb-2">
                  <Badge className={`text-[11px] font-black ${sportMeta.bgColor} ${sportMeta.color} border-transparent px-1.5 py-0`}>
                    {prop.sport}
                  </Badge>
                  <Badge className={`text-[11px] font-black px-1.5 py-0 ${
                    prop.confidence === "high" ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" :
                    prop.confidence === "medium" ? "bg-amber-500/20 text-amber-400 border-amber-500/30" :
                    "bg-slate-700/50 text-slate-400 border-slate-700"
                  }`}>
                    {prop.confidence}
                  </Badge>
                </div>
                <p className="text-sm font-bold text-white truncate">{prop.playerName}</p>
                <p className="text-[11px] text-slate-500 font-bold mt-0.5">{prop.team} vs {prop.opponent}</p>
                <div className="flex items-center justify-between mt-3">
                  <span className="text-[11px] text-slate-400 font-bold">{prop.propType}</span>
                  <div className="flex items-center gap-1.5">
                    {isOver ? (
                      <ArrowUpRight className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <ArrowDownRight className="w-3.5 h-3.5 text-red-400" />
                    )}
                    <span className={`text-sm font-black ${isOver ? "text-emerald-400" : "text-red-400"}`}>
                      {prop.pick} {prop.line}
                    </span>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card className="bg-slate-800/30 border-slate-800 p-8 text-center">
          <TrendingUp className="w-10 h-10 text-slate-600 mx-auto mb-2" />
          <p className="text-sm text-slate-400 font-bold">No picks available today</p>
          <p className="text-[11px] text-slate-500 mt-1">Check back when games are scheduled</p>
        </Card>
      )}

      {lockedCount > 0 && (
        <div className="mt-4 flex items-center justify-between bg-gradient-to-r from-purple-900/20 to-slate-900/30 border border-purple-800/20 rounded-lg px-4 py-3" data-testid="picks-upgrade-banner">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-purple-400" />
            <span className="text-sm text-slate-300 font-bold">
              {lockedCount} more {lockedCount === 1 ? "pick" : "picks"} available
            </span>
          </div>
          {tier === "free" ? (
            <Link href="/pricing">
              <Button size="sm" className="bg-purple-500 hover:bg-purple-600 text-white font-bold text-xs gap-1" data-testid="upgrade-picks-btn">
                <Sparkles className="w-3 h-3" /> Upgrade
              </Button>
            </Link>
          ) : (
            <Link href="/props">
              <Button size="sm" variant="ghost" className="text-purple-400 hover:text-purple-300 font-bold text-xs gap-1" data-testid="view-all-picks-btn">
                View All <ArrowRight className="w-3 h-3" />
              </Button>
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

function QuickOptimizeSection() {
  const { data: slates } = useQuery<Slate[]>({
    queryKey: ["/api/slates"],
  });

  const { data: subData } = useQuery<{ tier: string }>({
    queryKey: ["/api/subscription"],
  });

  const mainSlates = slates?.filter(s => s.isMain) || [];
  const tier = subData?.tier || "free";
  const isPaid = tier === "star" || tier === "pro";

  return (
    <div data-testid="quick-optimize-section">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-9 h-9 rounded-lg bg-emerald-500/20 flex items-center justify-center">
          <Zap className="w-4.5 h-4.5 text-emerald-400 fill-current" />
        </div>
        <div>
          <h2 className="text-lg font-black text-white tracking-tight">Quick Optimize</h2>
          <p className="text-[11px] text-slate-400 font-bold uppercase tracking-wider">Jump into a slate</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {ACTIVE_SPORTS.map(sport => {
          const meta = SPORT_META[sport] || SPORT_META.NBA;
          const Icon = meta.icon;
          const slate = mainSlates.find(s => s.sport === sport && s.platform === "draftkings");

          return (
            <Card key={sport} className="bg-slate-800/30 border-slate-800 p-4" data-testid={`quick-optimize-${sport.toLowerCase()}`}>
              <div className="flex items-center gap-3 mb-3">
                <div className={`w-8 h-8 rounded-lg ${meta.bgColor} flex items-center justify-center`}>
                  <Icon className={`w-4 h-4 ${meta.color}`} />
                </div>
                <div>
                  <p className="text-sm font-black text-white">{sport}</p>
                  <p className="text-[11px] text-slate-500 font-bold">DraftKings</p>
                </div>
              </div>
              {slate ? (
                <div className="space-y-2">
                  <Link href={`/optimizer/${slate.id}`}>
                    <Button size="sm" className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs" data-testid={`optimize-free-${sport.toLowerCase()}`}>
                      Free Builder
                    </Button>
                  </Link>
                  {isPaid ? (
                    <Link href={`/optimizer-pro/${slate.id}`}>
                      <Button size="sm" variant="outline" className="w-full border-emerald-700/40 text-emerald-400 hover:bg-emerald-900/20 font-bold text-xs gap-1 mt-2" data-testid={`optimize-pro-${sport.toLowerCase()}`}>
                        {tier === "pro" ? <Crown className="w-3 h-3" /> : <Trophy className="w-3 h-3" />}
                        {tier === "pro" ? "Pro" : "Star"} Builder
                      </Button>
                    </Link>
                  ) : (
                    <Link href="/pricing">
                      <Button size="sm" variant="outline" className="w-full border-slate-700 text-slate-500 font-bold text-xs gap-1 mt-2" data-testid={`optimize-locked-${sport.toLowerCase()}`}>
                        <Lock className="w-3 h-3" /> Upgrade
                      </Button>
                    </Link>
                  )}
                </div>
              ) : (
                <p className="text-[11px] text-slate-500 font-bold">No active slate</p>
              )}
            </Card>
          );
        })}

        <Card className="bg-slate-800/30 border-slate-800 p-4 flex flex-col items-center justify-center" data-testid="quick-optimize-vault">
          <Archive className="w-6 h-6 text-slate-500 mb-2" />
          <p className="text-sm font-bold text-slate-300 mb-1">Lineup Vault</p>
          <Link href="/lineups">
            <Button size="sm" variant="ghost" className="text-emerald-400 hover:text-emerald-300 font-bold text-xs gap-1" data-testid="go-vault-btn">
              View Saved <ArrowRight className="w-3 h-3" />
            </Button>
          </Link>
        </Card>
      </div>
    </div>
  );
}

function AuthenticatedDashboard() {
  const { user } = useAuth();
  const { data: subData } = useQuery<{ tier: string }>({
    queryKey: ["/api/subscription"],
  });

  const tier = subData?.tier || "free";
  const firstName = user?.firstName || user?.email?.split("@")[0] || "Player";

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <div className="mb-10" data-testid="dashboard-welcome">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-black text-white tracking-tight">
              Welcome back, <span className="text-emerald-400">{firstName}</span>
            </h1>
            <p className="text-slate-400 text-sm mt-1 font-bold">
              {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {tier === "pro" ? (
              <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-sm font-black px-3 py-1 gap-1">
                <Crown className="w-4 h-4" /> Pro
              </Badge>
            ) : tier === "star" ? (
              <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-sm font-black px-3 py-1 gap-1">
                <Trophy className="w-4 h-4" /> Star
              </Badge>
            ) : (
              <Link href="/pricing">
                <Button size="sm" className="bg-emerald-500 hover:bg-emerald-600 text-white font-bold gap-1" data-testid="dashboard-upgrade-btn">
                  <Sparkles className="w-3.5 h-3.5" /> Upgrade Plan
                </Button>
              </Link>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-12">
        <FeaturedNewsSection />
        <DailyPicksSection />
        <QuickOptimizeSection />
      </div>

      <div className="mt-10 text-center">
        <p className="text-[11px] text-slate-500">News powered by <a href="https://www.rotoballer.com" target="_blank" rel="noopener noreferrer" className="text-emerald-500/60 hover:text-emerald-400">RotoBaller</a></p>
      </div>
    </div>
  );
}

export default function Home() {
  const { user } = useAuth();

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
            Advanced lineup optimizer for DraftKings. Real player projections, LP-based optimization, and instant lineup building.
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

  return <AuthenticatedDashboard />;
}

import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ACTIVE_SPORTS } from "@shared/platform-config";
import { Button } from "@/components/ui/button";
import { Newspaper, ExternalLink, Clock, Dribbble, Activity, Target, ArrowLeft, Shield, Flag, Trophy, Users, Circle } from "lucide-react";
import { usePageMeta } from "@/hooks/use-page-meta";

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

interface NewsResponse {
  sport: string;
  articles: NewsArticle[];
}

interface GolfLeaderboardEntry {
  position: number;
  playerName: string;
  score: string;
  rounds: number[];
  country: string;
}

interface GolfTournament {
  name: string;
  date: string;
  status: "live" | "final" | "upcoming";
  fieldSize: number;
  leaderboard: GolfLeaderboardEntry[];
  purse: string | null;
}

interface GolfEnhancedResponse {
  sport: string;
  articles: NewsArticle[];
  tournaments: GolfTournament[];
}

const SPORT_META: Record<string, { icon: typeof Dribbble; color: string; bgColor: string; label: string; gradient: string; image: string }> = {
  NBA: { icon: Dribbble, color: "text-orange-400", bgColor: "bg-orange-500/20", label: "NBA", gradient: "from-orange-900/80 via-slate-900/90 to-slate-950", image: "/images/sport-nba.png" },
  NHL: { icon: Activity, color: "text-cyan-400", bgColor: "bg-cyan-500/20", label: "NHL", gradient: "from-cyan-900/80 via-slate-900/90 to-slate-950", image: "/images/sport-nhl.png" },
  MLB: { icon: Target, color: "text-red-400", bgColor: "bg-red-500/20", label: "MLB", gradient: "from-red-900/80 via-slate-900/90 to-slate-950", image: "/images/sport-mlb.png" },
  NFL: { icon: Shield, color: "text-green-400", bgColor: "bg-green-500/20", label: "NFL", gradient: "from-green-900/80 via-slate-900/90 to-slate-950", image: "/images/sport-nfl.png" },
  GOLF: { icon: Flag, color: "text-lime-400", bgColor: "bg-lime-500/20", label: "GOLF", gradient: "from-lime-900/80 via-slate-900/90 to-slate-950", image: "/images/sport-golf.png" },
  SOCCER: { icon: Dribbble, color: "text-teal-400", bgColor: "bg-teal-500/20", label: "SOCCER", gradient: "from-teal-900/80 via-slate-900/90 to-slate-950", image: "/images/sport-nba.png" },
};

function timeAgo(dateStr: string): string {
  const now = new Date();
  const published = new Date(dateStr);
  const diffMs = now.getTime() - published.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays === 1) return "Yesterday";
  return `${diffDays}d ago`;
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "";
  }
}

function formatTournamentDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

function TournamentLeaderboard({ tournament }: { tournament: GolfTournament }) {
  const isLive = tournament.status === "live";
  const isFinal = tournament.status === "final";

  return (
    <Card
      className={`overflow-hidden ${isLive ? "bg-emerald-950/30 border-emerald-800/30 ring-1 ring-emerald-500/20" : "bg-slate-800/30 border-border"}`}
      data-testid={`tournament-card-${tournament.name.replace(/\s+/g, "-").toLowerCase()}`}
    >
      <div className="p-4 border-b border-slate-700/40">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2.5">
            <div className={`w-8 h-8 rounded-lg ${isLive ? "bg-emerald-500/20" : "bg-lime-500/20"} flex items-center justify-center`}>
              <Trophy className={`w-4 h-4 ${isLive ? "text-emerald-400" : "text-lime-400"}`} />
            </div>
            <div>
              <h3 className="text-sm font-black text-white leading-tight">{tournament.name}</h3>
              <div className="flex items-center gap-2 mt-0.5">
                {tournament.date && (
                  <span className="text-[11px] text-slate-500 font-bold">{formatTournamentDate(tournament.date)}</span>
                )}
                {tournament.fieldSize > 0 && (
                  <span className="text-[11px] text-slate-600 flex items-center gap-1">
                    <Users className="w-3 h-3" /> {tournament.fieldSize} players
                  </span>
                )}
              </div>
            </div>
          </div>
          {isLive && (
            <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[11px] font-black px-2 py-0.5 gap-1 animate-pulse" data-testid="tournament-live-badge">
              <Circle className="w-2 h-2 fill-current" /> LIVE
            </Badge>
          )}
          {isFinal && (
            <Badge className="bg-slate-700/50 text-slate-400 border-slate-600/30 text-[11px] font-black px-2 py-0.5" data-testid="tournament-final-badge">
              FINAL
            </Badge>
          )}
          {tournament.purse && (
            <span className="text-[11px] text-lime-400/70 font-bold">{tournament.purse}</span>
          )}
        </div>
      </div>

      <div className="divide-y divide-slate-800/60">
        <div className="grid grid-cols-[40px_1fr_auto] items-center px-4 py-2 bg-slate-800/20">
          <span className="text-[10px] text-slate-500 font-bold uppercase">Pos</span>
          <span className="text-[10px] text-slate-500 font-bold uppercase">Player</span>
          <div className="flex items-center gap-6">
            <span className="text-[10px] text-slate-500 font-bold uppercase w-16 text-center hidden sm:block">Rounds</span>
            <span className="text-[10px] text-slate-500 font-bold uppercase w-12 text-right">Score</span>
          </div>
        </div>
        {tournament.leaderboard.map((player, idx) => (
          <div
            key={idx}
            className={`grid grid-cols-[40px_1fr_auto] items-center px-4 py-2.5 ${idx === 0 ? "bg-lime-950/20" : "hover:bg-slate-800/20"} transition-colors`}
            data-testid={`leaderboard-player-${tournament.name.replace(/\s+/g, "-").toLowerCase()}-${idx}`}
          >
            <span className={`text-sm font-black ${idx === 0 ? "text-lime-400" : idx < 3 ? "text-lime-400/70" : "text-slate-500"}`}>
              {player.position}
            </span>
            <div className="flex items-center gap-2 min-w-0">
              <span className={`text-sm font-bold truncate ${idx === 0 ? "text-white" : "text-slate-300"}`}>{player.playerName}</span>
              {player.country && (
                <span className="text-[10px] text-slate-600 hidden md:inline">{player.country}</span>
              )}
            </div>
            <div className="flex items-center gap-6">
              <div className="hidden sm:flex items-center gap-1.5 w-16 justify-center">
                {player.rounds.slice(0, 4).map((r, ri) => (
                  <span key={ri} className="text-[11px] text-slate-500 font-mono">{r}</span>
                ))}
              </div>
              <span className={`text-sm font-black w-12 text-right ${
                player.score.startsWith("-") ? "text-emerald-400" :
                player.score === "E" ? "text-slate-300" : "text-red-400"
              }`}>
                {player.score}
              </span>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function GolfNewsPage() {
  const meta = SPORT_META.GOLF;

  const { data, isLoading, error } = useQuery<GolfEnhancedResponse>({
    queryKey: ["/api/news/golf/enhanced"],
    refetchInterval: 3 * 60 * 1000,
  });

  const articles = data?.articles || [];
  const tournaments = data?.tournaments || [];
  const heroArticle = articles[0];
  const remainingArticles = articles.slice(1);

  return (
    <div className="container mx-auto px-4 max-w-5xl pb-12">
      {isLoading && (
        <div className="space-y-6" data-testid="golf-news-loading">
          <Skeleton className="w-full h-64 rounded-xl" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Skeleton className="h-80 rounded-xl" />
            <Skeleton className="h-80 rounded-xl" />
          </div>
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-lg" />
            ))}
          </div>
        </div>
      )}

      {error && (
        <Card className="bg-red-900/20 border-red-800/40 p-8 text-center">
          <p className="text-red-400 font-bold text-lg" data-testid="golf-news-error">Failed to load golf news</p>
          <p className="text-sm text-red-400/60 mt-2">Please try again later</p>
        </Card>
      )}

      {data && (
        <div className="space-y-8">
          {heroArticle && (
            <a
              href={heroArticle.linkUrl || "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="block group"
              data-testid="golf-hero-article"
            >
              <Card className="bg-[#1E293B] border-border overflow-hidden transition-all hover:border-lime-800/40 hover:shadow-xl hover:shadow-lime-900/10">
                {heroArticle.imageUrl && (
                  <div className="w-full h-64 overflow-hidden bg-slate-800 relative">
                    <img
                      src={heroArticle.imageUrl}
                      alt={heroArticle.headline}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-900/90 via-transparent to-transparent" />
                    <div className="absolute bottom-0 left-0 right-0 p-6">
                      <div className="flex items-center gap-3 mb-3">
                        {heroArticle.categories.slice(0, 2).map((cat, i) => (
                          <Badge key={i} className="text-xs font-bold bg-lime-500/20 text-lime-400 border-transparent">
                            {cat}
                          </Badge>
                        ))}
                        {heroArticle.published && (
                          <span className="flex items-center gap-1.5 text-xs text-slate-400">
                            <Clock className="w-3.5 h-3.5" />
                            {timeAgo(heroArticle.published)}
                          </span>
                        )}
                      </div>
                      <h3 className="text-2xl font-black text-white group-hover:text-lime-400 transition-colors leading-tight">
                        {heroArticle.headline}
                      </h3>
                    </div>
                  </div>
                )}
                {!heroArticle.imageUrl && (
                  <div className="p-6">
                    <h3 className="text-2xl font-black text-white group-hover:text-lime-400 transition-colors leading-tight">
                      {heroArticle.headline}
                    </h3>
                  </div>
                )}
                {heroArticle.description && (
                  <div className="px-6 pb-5">
                    <p className="text-sm text-slate-400 leading-relaxed line-clamp-2">{heroArticle.description}</p>
                    <div className="flex items-center gap-2 mt-3 text-xs text-lime-500 font-semibold group-hover:text-lime-400">
                      Read full article <ExternalLink className="w-3.5 h-3.5" />
                    </div>
                  </div>
                )}
              </Card>
            </a>
          )}

          {tournaments.length > 0 && (
            <div data-testid="golf-tournaments-section">
              <div className="flex items-center gap-2.5 mb-4">
                <div className="w-8 h-8 rounded-lg bg-lime-500/20 flex items-center justify-center">
                  <Flag className="w-4 h-4 text-lime-400" />
                </div>
                <h2 className="text-lg font-black text-white tracking-tight">Tournament Results</h2>
              </div>
              <div className={`grid gap-4 ${tournaments.length > 1 ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1"}`}>
                {tournaments.map((t, idx) => (
                  <TournamentLeaderboard key={idx} tournament={t} />
                ))}
              </div>
            </div>
          )}

          {remainingArticles.length > 0 && (
            <div data-testid="golf-more-news">
              <div className="flex items-center gap-2.5 mb-4">
                <div className="w-8 h-8 rounded-lg bg-slate-700/50 flex items-center justify-center">
                  <Newspaper className="w-4 h-4 text-slate-400" />
                </div>
                <h2 className="text-lg font-black text-white tracking-tight">More Golf News</h2>
              </div>
              <div className="space-y-3">
                {remainingArticles.map((article) => (
                  <a
                    key={article.id}
                    href={article.linkUrl || "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block group"
                    data-testid={`news-article-${article.id}`}
                  >
                    <Card className="bg-[#1E293B] border-border overflow-hidden transition-all hover:border-slate-600 hover:shadow-lg hover:shadow-black/10">
                      <div className="flex gap-4 p-4">
                        {article.imageUrl && (
                          <div className="w-28 h-20 rounded-lg overflow-hidden shrink-0 bg-slate-800">
                            <img
                              src={article.imageUrl}
                              alt={article.headline}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                              loading="lazy"
                            />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <h3 className="text-sm font-bold text-white group-hover:text-lime-400 transition-colors leading-snug line-clamp-2">
                            {article.headline}
                          </h3>
                          {article.description && (
                            <p className="text-xs text-slate-400 mt-1.5 line-clamp-1 leading-relaxed">
                              {article.description}
                            </p>
                          )}
                          <div className="flex items-center gap-3 mt-2">
                            {article.published && (
                              <span className="flex items-center gap-1 text-[11px] text-slate-500">
                                <Clock className="w-3 h-3" />
                                {timeAgo(article.published)}
                              </span>
                            )}
                            {article.categories.slice(0, 1).map((cat, i) => (
                              <Badge key={i} className="text-[10px] font-bold bg-lime-500/10 text-lime-400/70 border-transparent py-0">
                                {cat}
                              </Badge>
                            ))}
                            <ExternalLink className="w-3 h-3 text-slate-600 group-hover:text-lime-400 shrink-0 ml-auto transition-colors" />
                          </div>
                        </div>
                      </div>
                    </Card>
                  </a>
                ))}
              </div>
            </div>
          )}

          {articles.length === 0 && tournaments.length === 0 && (
            <Card className="bg-slate-800/30 border-border p-12 text-center">
              <Flag className="w-14 h-14 text-slate-600 mx-auto mb-4" />
              <p className="text-slate-300 font-bold text-lg" data-testid="golf-no-content">No golf news available right now</p>
              <p className="text-sm text-slate-500 mt-2">Check back later for updates</p>
            </Card>
          )}
        </div>
      )}

      <div className="mt-10 text-center">
        <p className="text-xs text-slate-500">News powered by <a href="https://www.espn.com" target="_blank" rel="noopener noreferrer" className="text-emerald-500 hover:text-emerald-400 transition-colors">ESPN</a></p>
      </div>
    </div>
  );
}

function StandardNewsContent({ sport, meta }: { sport: string; meta: typeof SPORT_META.NBA }) {
  const { data, isLoading, error } = useQuery<NewsResponse>({
    queryKey: [`/api/news/${sport.toLowerCase()}`],
    refetchInterval: 5 * 60 * 1000,
  });

  return (
    <div className="container mx-auto px-4 max-w-4xl pb-12">
      {isLoading && (
        <div className="space-y-5" data-testid="news-loading">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="bg-slate-800/30 border-border p-6">
              <div className="flex gap-5">
                <Skeleton className="w-36 h-24 rounded-lg shrink-0" />
                <div className="flex-1 space-y-3">
                  <Skeleton className="h-6 w-3/4" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {error && (
        <Card className="bg-red-900/20 border-red-800/40 p-8 text-center">
          <p className="text-red-400 font-bold text-lg">Failed to load news</p>
          <p className="text-sm text-red-400/60 mt-2">Please try again later</p>
        </Card>
      )}

      {data && data.articles.length === 0 && (
        <Card className="bg-slate-800/30 border-border p-12 text-center">
          <Newspaper className="w-14 h-14 text-slate-600 mx-auto mb-4" />
          <p className="text-slate-300 font-bold text-lg">No {sport} news available right now</p>
          <p className="text-sm text-slate-500 mt-2">Check back later for updates</p>
        </Card>
      )}

      {data && data.articles.length > 0 && (
        <div className="space-y-5" data-testid="news-articles">
          {data.articles.map((article, index) => (
            <a
              key={article.id}
              href={article.linkUrl || "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="block group"
              data-testid={`news-article-${article.id}`}
            >
              <Card className="bg-[#1E293B] border-border overflow-hidden transition-all hover:border-slate-600 hover:shadow-lg hover:shadow-black/10">
                {index === 0 && article.imageUrl ? (
                  <div>
                    <div className="w-full h-52 overflow-hidden bg-slate-800">
                      <img
                        src={article.imageUrl}
                        alt={article.headline}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    </div>
                    <div className="p-6">
                      <div className="flex items-center gap-3 mb-3">
                        {article.categories.slice(0, 2).map((cat, i) => (
                          <Badge key={i} className={`text-xs font-bold ${meta.bgColor} ${meta.color} border-transparent`}>
                            {cat}
                          </Badge>
                        ))}
                        {article.published && (
                          <span className="flex items-center gap-1.5 text-xs text-slate-500">
                            <Clock className="w-3.5 h-3.5" />
                            {timeAgo(article.published)}
                          </span>
                        )}
                      </div>
                      <h3 className="text-xl font-bold text-white group-hover:text-emerald-400 transition-colors leading-tight">
                        {article.headline}
                      </h3>
                      {article.description && (
                        <p className="text-sm text-slate-400 mt-3 leading-relaxed line-clamp-3">
                          {article.description}
                        </p>
                      )}
                      <div className="flex items-center gap-2 mt-4 text-xs text-emerald-500 font-semibold group-hover:text-emerald-400">
                        Read full article
                        <ExternalLink className="w-3.5 h-3.5" />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-5 p-5">
                    {article.imageUrl && (
                      <div className="w-36 h-24 rounded-lg overflow-hidden shrink-0 bg-slate-800">
                        <img
                          src={article.imageUrl}
                          alt={article.headline}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          loading="lazy"
                        />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <h3 className="text-base font-bold text-white group-hover:text-emerald-400 transition-colors leading-snug line-clamp-2">
                        {article.headline}
                      </h3>
                      {article.description && (
                        <p className="text-sm text-slate-400 mt-2 line-clamp-2 leading-relaxed">
                          {article.description}
                        </p>
                      )}
                      <div className="flex items-center gap-3 mt-3">
                        {article.published && (
                          <span className="flex items-center gap-1.5 text-xs text-slate-500">
                            <Clock className="w-3.5 h-3.5" />
                            {timeAgo(article.published)}
                            <span className="text-slate-600 ml-1">{formatDate(article.published)}</span>
                          </span>
                        )}
                        {article.categories.slice(0, 2).map((cat, i) => (
                          <Badge key={i} className={`text-xs font-bold ${meta.bgColor} ${meta.color} border-transparent`}>
                            {cat}
                          </Badge>
                        ))}
                        <ExternalLink className="w-3.5 h-3.5 text-slate-600 group-hover:text-emerald-400 shrink-0 ml-auto transition-colors" />
                      </div>
                    </div>
                  </div>
                )}
              </Card>
            </a>
          ))}
        </div>
      )}

      <div className="mt-10 text-center">
        <p className="text-xs text-slate-500">News powered by <a href="https://www.espn.com" target="_blank" rel="noopener noreferrer" className="text-emerald-500 hover:text-emerald-400 transition-colors">ESPN</a></p>
      </div>
    </div>
  );
}

export default function News() {
  usePageMeta({ title: "Sports News - Latest Updates", description: "Latest sports news, injury updates, and analysis for DFS players.", path: "/news" });
  const params = useParams<{ sport: string }>();
  const sport = (params.sport || "NBA").toUpperCase();
  const meta = SPORT_META[sport] || SPORT_META.NBA;
  const Icon = meta.icon;
  const isGolf = sport === "GOLF";

  return (
    <div className="min-h-screen">
      <div className="relative overflow-hidden mb-8" data-testid="news-hero">
        <div className="absolute inset-0">
          <img
            src={meta.image}
            alt={`${sport} background`}
            className="w-full h-full object-cover opacity-30"
          />
          <div className={`absolute inset-0 bg-gradient-to-b ${meta.gradient}`} />
        </div>
        <div className="relative container mx-auto px-4 max-w-5xl pt-8 pb-10">
          <Link href="/">
            <span className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors cursor-pointer mb-4" data-testid="news-back-link">
              <ArrowLeft className="w-4 h-4" />
              Dashboard
            </span>
          </Link>
          <div className="flex items-center gap-4 mt-3">
            <div className={`w-12 h-12 rounded-xl ${meta.bgColor} flex items-center justify-center`}>
              <Icon className={`w-6 h-6 ${meta.color}`} />
            </div>
            <div>
              <h1 className="text-3xl font-black text-white tracking-tight" data-testid="news-title">
                {isGolf ? "PGA Tour Hub" : `${sport} News`}
              </h1>
              <p className="text-slate-400 text-sm mt-0.5">
                {isGolf ? "Live tournaments, leaderboards & latest golf news" : "Latest fantasy sports news and analysis"}
              </p>
            </div>
          </div>

          <div className="flex gap-2 mt-6" data-testid="news-sport-tabs">
            {ACTIVE_SPORTS.map(s => {
              const sm = SPORT_META[s] || SPORT_META.NBA;
              const SIcon = sm.icon;
              const isActive = s === sport;
              return (
                <Link key={s} href={`/news/${s.toLowerCase()}`}>
                  <Button
                    variant={isActive ? "secondary" : "ghost"}
                    size="sm"
                    className={isActive ? "font-bold" : "text-slate-500 font-bold"}
                    data-testid={`news-tab-${s.toLowerCase()}`}
                  >
                    <SIcon className={`w-4 h-4 mr-1.5 ${isActive ? sm.color : ""}`} />
                    {s}
                  </Button>
                </Link>
              );
            })}
          </div>
        </div>
      </div>

      {isGolf ? <GolfNewsPage /> : <StandardNewsContent sport={sport} meta={meta} />}
    </div>
  );
}

import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ACTIVE_SPORTS } from "@shared/platform-config";
import { Button } from "@/components/ui/button";
import { Newspaper, ExternalLink, Clock, Dribbble, Activity, Target, ArrowLeft, Shield, Flag } from "lucide-react";

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

const SPORT_META: Record<string, { icon: typeof Dribbble; color: string; bgColor: string; label: string; gradient: string; image: string }> = {
  NBA: { icon: Dribbble, color: "text-orange-400", bgColor: "bg-orange-500/20", label: "NBA", gradient: "from-orange-900/80 via-slate-900/90 to-slate-950", image: "/images/sport-nba.png" },
  NHL: { icon: Activity, color: "text-cyan-400", bgColor: "bg-cyan-500/20", label: "NHL", gradient: "from-cyan-900/80 via-slate-900/90 to-slate-950", image: "/images/sport-nhl.png" },
  MLB: { icon: Target, color: "text-red-400", bgColor: "bg-red-500/20", label: "MLB", gradient: "from-red-900/80 via-slate-900/90 to-slate-950", image: "/images/sport-mlb.png" },
  NFL: { icon: Shield, color: "text-green-400", bgColor: "bg-green-500/20", label: "NFL", gradient: "from-green-900/80 via-slate-900/90 to-slate-950", image: "/images/sport-nfl.png" },
  GOLF: { icon: Flag, color: "text-lime-400", bgColor: "bg-lime-500/20", label: "GOLF", gradient: "from-lime-900/80 via-slate-900/90 to-slate-950", image: "/images/sport-golf.png" },
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

export default function News() {
  const params = useParams<{ sport: string }>();
  const sport = (params.sport || "NBA").toUpperCase();
  const meta = SPORT_META[sport] || SPORT_META.NBA;
  const Icon = meta.icon;

  const { data, isLoading, error } = useQuery<NewsResponse>({
    queryKey: [`/api/news/${sport.toLowerCase()}`],
    refetchInterval: 5 * 60 * 1000,
  });

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
        <div className="relative container mx-auto px-4 max-w-4xl pt-8 pb-10">
          <Link href="/">
            <span className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-[var(--text-main)] transition-colors cursor-pointer mb-4" data-testid="news-back-link">
              <ArrowLeft className="w-4 h-4" />
              Dashboard
            </span>
          </Link>
          <div className="flex items-center gap-4 mt-3">
            <div className={`w-12 h-12 rounded-xl ${meta.bgColor} flex items-center justify-center`}>
              <Icon className={`w-6 h-6 ${meta.color}`} />
            </div>
            <div>
              <h1 className="text-3xl font-black text-[var(--text-main)] tracking-tight" data-testid="news-title">
                {sport} News
              </h1>
              <p className="text-slate-400 text-sm mt-0.5">Latest fantasy sports news and analysis</p>
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

      <div className="container mx-auto px-4 max-w-4xl pb-12">
        {isLoading && (
          <div className="space-y-5" data-testid="news-loading">
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} className="bg-black/[0.03] dark:bg-slate-800/30 border-border p-6">
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
          <Card className="bg-black/[0.03] dark:bg-slate-800/30 border-border p-12 text-center">
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
                <Card className="bg-[var(--bg-card)] border-border overflow-hidden transition-all hover:border-slate-400 dark:hover:border-slate-600 hover:shadow-lg hover:shadow-black/10">
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
                        <h3 className="text-xl font-bold text-[var(--text-main)] group-hover:text-emerald-400 transition-colors leading-tight">
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
                        <h3 className="text-base font-bold text-[var(--text-main)] group-hover:text-emerald-400 transition-colors leading-snug line-clamp-2">
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
          <p className="text-xs text-slate-500">News powered by <a href="https://www.rotoballer.com" target="_blank" rel="noopener noreferrer" className="text-emerald-500 hover:text-emerald-400 transition-colors">RotoBaller</a></p>
        </div>
      </div>
    </div>
  );
}

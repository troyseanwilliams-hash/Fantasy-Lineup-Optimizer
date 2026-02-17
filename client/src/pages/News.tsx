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
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  return `${diffDays}d ago`;
}

export default function News() {
  const params = useParams<{ sport: string }>();
  const sport = (params.sport || "NBA").toUpperCase();
  const meta = SPORT_META[sport] || SPORT_META.NBA;
  const Icon = meta.icon;

  const { data, isLoading, error } = useQuery<NewsResponse>({
    queryKey: [`/api/news/${sport.toLowerCase()}`],
  });

  return (
    <div>
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
                {sport} News
              </h1>
              <p className="text-slate-400 text-sm mt-0.5">Fantasy sports news and analysis from RotoBaller</p>
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

      <div className="container mx-auto px-4 max-w-5xl pb-8">
        {isLoading && (
        <div className="space-y-4" data-testid="news-loading">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="bg-slate-800/30 border-slate-800 p-5">
              <div className="flex gap-4">
                <Skeleton className="w-24 h-24 rounded-lg shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-5 w-3/4" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {error && (
        <Card className="bg-red-900/20 border-red-800/40 p-6 text-center">
          <p className="text-red-400 font-bold">Failed to load news</p>
          <p className="text-sm text-red-400/60 mt-1">Please try again later</p>
        </Card>
      )}

      {data && data.articles.length === 0 && (
        <Card className="bg-slate-800/30 border-slate-800 p-10 text-center">
          <Newspaper className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400 font-bold">No {sport} news available right now</p>
          <p className="text-sm text-slate-400 mt-1">Check back later for updates</p>
        </Card>
      )}

      {data && data.articles.length > 0 && (
        <div className="space-y-4" data-testid="news-articles">
          {data.articles.map((article) => (
            <a
              key={article.id}
              href={article.linkUrl || "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="block group"
              data-testid={`news-article-${article.id}`}
            >
              <Card className="bg-slate-800/30 border-slate-800 p-5 transition-all hover:border-slate-700 hover:bg-slate-800/50">
                <div className="flex gap-4">
                  {article.imageUrl && (
                    <div className="w-28 h-20 rounded-lg overflow-hidden shrink-0 bg-slate-800">
                      <img
                        src={article.imageUrl}
                        alt={article.headline}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-base font-bold text-white group-hover:text-emerald-400 transition-colors leading-snug line-clamp-2">
                        {article.headline}
                      </h3>
                      <ExternalLink className="w-4 h-4 text-slate-400 group-hover:text-emerald-400 shrink-0 mt-0.5 transition-colors" />
                    </div>
                    {article.description && (
                      <p className="text-sm text-slate-400 mt-1.5 line-clamp-2 leading-relaxed">
                        {article.description}
                      </p>
                    )}
                    <div className="flex items-center gap-3 mt-2">
                      {article.published && (
                        <span className="flex items-center gap-1 text-[11px] text-slate-400 font-bold">
                          <Clock className="w-3 h-3" />
                          {timeAgo(article.published)}
                        </span>
                      )}
                      {article.type && article.type !== "Article" && (
                        <Badge className="text-[11px] font-black bg-slate-700/50 text-slate-400 border-slate-700">
                          {article.type}
                        </Badge>
                      )}
                      {article.categories.slice(0, 2).map((cat, i) => (
                        <Badge key={i} className={`text-[11px] font-black ${meta.bgColor} ${meta.color} border-transparent`}>
                          {cat}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
              </Card>
            </a>
          ))}
        </div>
      )}

        <div className="mt-8 text-center">
          <p className="text-[11px] text-slate-400">News powered by <a href="https://www.rotoballer.com" target="_blank" rel="noopener noreferrer" className="text-emerald-500 hover:text-emerald-400">RotoBaller</a></p>
        </div>
      </div>
    </div>
  );
}

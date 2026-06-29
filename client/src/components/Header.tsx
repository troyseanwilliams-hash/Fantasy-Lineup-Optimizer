import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Zap, Archive, LogOut, ShieldAlert, Crown, TrendingUp, ChevronDown, Dribbble, Activity, Target, Newspaper, LayoutGrid, Bell, Lock, Sparkles, AlertTriangle, Info, XCircle, CreditCard, Trophy, Flag, Layers, Menu, X, Users, Settings2, BarChart3, Award, Swords, Circle, Shield } from "lucide-react";
import { ACTIVE_SPORTS, COMING_SOON_SPORTS } from "@shared/platform-config";
import type { Slate } from "@shared/schema";
import { LogoBanner } from "@/components/Logo";

interface AlertItem {
  id: number;
  title: string;
  message: string;
  severity: string;
  sport: string;
  type: string;
  isRead: boolean;
  createdAt: string;
}

const SPORT_META: Record<string, { icon: typeof Dribbble; color: string; bgColor: string }> = {
  NBA: { icon: Dribbble, color: "text-orange-400", bgColor: "bg-orange-500/20" },
  NHL: { icon: Activity, color: "text-cyan-400", bgColor: "bg-cyan-500/20" },
  MLB: { icon: Target, color: "text-red-400", bgColor: "bg-red-500/20" },
  GOLF: { icon: Flag, color: "text-lime-400", bgColor: "bg-lime-500/20" },
  SOCCER: { icon: Circle, color: "text-teal-400", bgColor: "bg-teal-500/20" },
  NFL: { icon: Shield, color: "text-blue-400", bgColor: "bg-blue-500/20" },
};

export function Header() {
  const { user, logout } = useAuth();
  const [location, navigate] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const { data: subData } = useQuery<{ tier: string }>({
    queryKey: ["/api/subscription"],
    enabled: !!user,
  });

  const { data: slates } = useQuery<Slate[]>({
    queryKey: ["/api/slates"],
    enabled: !!user,
  });

  const { data: alertsData } = useQuery<{ alerts: AlertItem[]; unreadCount: number }>({
    queryKey: ["/api/alerts"],
    enabled: !!user,
    refetchInterval: 60000,
  });

  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/alerts/read-all");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
    },
  });

  const mainSlates = slates?.filter(s => s.isMain) || [];
  const isPro = subData?.tier === "pro";
  const isStar = subData?.tier === "star";
  const isPaid = isPro || isStar;
  const unreadCount = alertsData?.unreadCount || 0;
  const recentAlerts = alertsData?.alerts?.slice(0, 8) || [];

  const severityIcon = (severity: string) => {
    if (severity === "critical") return <XCircle className="w-4 h-4 text-red-400 shrink-0" />;
    if (severity === "warning") return <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />;
    return <Info className="w-4 h-4 text-blue-400 shrink-0" />;
  };

  const mobileNav = (href: string) => {
    navigate(href);
    setMobileMenuOpen(false);
  };

  return (
    <header className="sticky top-0 z-50 bg-[#0F172A] border-b border-[#1E293B]">
      {/* World Cup announcement strip */}
      <div className="bg-gradient-to-r from-emerald-950 via-teal-950 to-emerald-950 border-b border-emerald-800/40 py-1.5 px-4">
        <div className="container mx-auto flex items-center justify-center gap-3 text-center">
          <div className="flex items-center gap-1.5 shrink-0">
            <Circle className="w-2.5 h-2.5 text-emerald-400 fill-current animate-pulse" />
            <span className="text-[11px] font-black text-emerald-400 uppercase tracking-widest">LIVE NOW</span>
          </div>
          <span className="text-[11px] text-slate-300 font-bold">
            🏆 FIFA World Cup 2026 — AI prop picks & DFS lineups for every match
          </span>
          <Link href="/">
            <span className="hidden sm:inline text-[11px] font-black text-emerald-400 hover:text-emerald-300 transition-colors underline underline-offset-2 shrink-0 cursor-pointer">
              View Picks →
            </span>
          </Link>
        </div>
      </div>
      <div className="container mx-auto px-4 h-20 lg:h-24 flex items-center justify-between">
        <div className="flex items-center space-x-10 min-w-0">
          <Link href="/">
            <div className="flex items-center cursor-pointer group-hover:opacity-90 transition-opacity shrink-0">
              <LogoBanner height={29} className="lg:hidden" />
              <LogoBanner height={38} className="hidden lg:block" />
            </div>
          </Link>

          <nav className="hidden lg:flex items-center space-x-6">
            {user && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="flex items-center space-x-2 font-bold text-sm tracking-wide transition-colors cursor-pointer outline-none text-slate-400 hover:text-white"
                    data-testid="sport-selector"
                  >
                    <LayoutGrid className="w-4 h-4" />
                    <span>Sports</span>
                    <ChevronDown className="w-3 h-3 opacity-50" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-72 bg-[#1E293B] border-border">
                  {ACTIVE_SPORTS.map((sport, idx) => {
                    const meta = SPORT_META[sport] || { icon: Dribbble, color: "text-slate-400", bgColor: "bg-slate-500/20" };
                    const Icon = meta.icon;
                    const dkSlate = mainSlates.find(s => s.sport === sport && s.platform === "draftkings");
                    const bestSlate = dkSlate
                      || mainSlates.find(s => s.sport === sport && s.platform === "fanduel")
                      || mainSlates.find(s => s.sport === sport && s.platform === "yahoo");
                    const builderLabel = dkSlate ? `${sport} DK Builder` : bestSlate ? `${sport} Builder` : `${sport} DK Builder`;

                    return (
                      <div key={sport}>
                        {idx > 0 && <DropdownMenuSeparator className="bg-slate-800" />}
                        <DropdownMenuLabel className="flex items-center gap-2 py-2">
                          <div className={`w-6 h-6 rounded flex items-center justify-center ${meta.bgColor}`}>
                            <Icon className={`w-3.5 h-3.5 ${meta.color}`} />
                          </div>
                          <span className="text-xs font-black text-white uppercase tracking-wider">{sport}</span>
                        </DropdownMenuLabel>

                        <Link href={`/news/${sport.toLowerCase()}`}>
                          <DropdownMenuItem className="cursor-pointer" data-testid={`sport-menu-${sport.toLowerCase()}-news`}>
                            <Newspaper className="w-4 h-4 mr-2 text-amber-400" />
                            <span className="text-sm font-bold text-slate-300">News</span>
                          </DropdownMenuItem>
                        </Link>

                        {bestSlate ? (
                          <Link href={`/optimizer/${bestSlate.id}`}>
                            <DropdownMenuItem className="cursor-pointer" data-testid={`sport-menu-${sport.toLowerCase()}-dk`}>
                              <div className="w-6 h-6 rounded bg-emerald-500/20 flex items-center justify-center mr-2 shrink-0">
                                <span className="text-emerald-400 font-black text-[11px]">DK</span>
                              </div>
                              <span className="text-sm font-bold text-slate-300">{builderLabel}</span>
                            </DropdownMenuItem>
                          </Link>
                        ) : (
                          <DropdownMenuItem disabled className="opacity-50" data-testid={`sport-menu-${sport.toLowerCase()}-dk`}>
                            <div className="w-6 h-6 rounded bg-emerald-500/20 flex items-center justify-center mr-2 shrink-0">
                              <span className="text-emerald-400 font-black text-[11px]">DK</span>
                            </div>
                            <span className="text-sm font-bold text-slate-300">{sport} DK Builder</span>
                          </DropdownMenuItem>
                        )}
                        {isStar && bestSlate ? (
                          <Link href={`/optimizer-pro/${bestSlate.id}`}>
                            <DropdownMenuItem className="cursor-pointer" data-testid={`sport-menu-${sport.toLowerCase()}-star-dk`}>
                              <div className="w-6 h-6 rounded bg-emerald-500/20 flex items-center justify-center mr-2 shrink-0">
                                <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                              </div>
                              <span className="text-sm font-bold text-emerald-300">{sport} Pro Optimizer</span>
                              <Trophy className="w-3.5 h-3.5 text-emerald-400 ml-auto" />
                            </DropdownMenuItem>
                          </Link>
                        ) : !isPro ? (
                          <Link href="/pricing">
                            <DropdownMenuItem className="cursor-pointer" data-testid={`sport-menu-${sport.toLowerCase()}-star-dk`}>
                              <div className="w-6 h-6 rounded bg-emerald-500/10 flex items-center justify-center mr-2 shrink-0">
                                <Lock className="w-3 h-3 text-emerald-500/50" />
                              </div>
                              <span className="text-sm font-bold text-slate-500">{sport} Pro Optimizer</span>
                              <Trophy className="w-3.5 h-3.5 text-emerald-500/40 ml-auto" />
                            </DropdownMenuItem>
                          </Link>
                        ) : null}

                        {isPro && bestSlate ? (
                          <Link href={`/optimizer-pro/${bestSlate.id}`}>
                            <DropdownMenuItem className="cursor-pointer" data-testid={`sport-menu-${sport.toLowerCase()}-pro-dk`}>
                              <div className="w-6 h-6 rounded bg-amber-500/20 flex items-center justify-center mr-2 shrink-0">
                                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                              </div>
                              <span className="text-sm font-bold text-amber-300">{sport} Pro Optimizer</span>
                              <Crown className="w-3.5 h-3.5 text-amber-400 ml-auto" />
                            </DropdownMenuItem>
                          </Link>
                        ) : (
                          <Link href="/pricing">
                            <DropdownMenuItem className="cursor-pointer" data-testid={`sport-menu-${sport.toLowerCase()}-pro-dk`}>
                              <div className="w-6 h-6 rounded bg-amber-500/10 flex items-center justify-center mr-2 shrink-0">
                                <Lock className="w-3 h-3 text-amber-500/50" />
                              </div>
                              <span className="text-sm font-bold text-slate-500">{sport} Pro Optimizer</span>
                              <Crown className="w-3.5 h-3.5 text-amber-500/40 ml-auto" />
                            </DropdownMenuItem>
                          </Link>
                        )}

                        <Link href={`/props?sport=${sport}`}>
                          <DropdownMenuItem className="cursor-pointer" data-testid={`sport-menu-${sport.toLowerCase()}-props`}>
                            <TrendingUp className="w-4 h-4 mr-2 text-purple-400" />
                            <span className="text-sm font-bold text-slate-300">Prop Bets</span>
                          </DropdownMenuItem>
                        </Link>
                      </div>
                    );
                  })}
                  {/* Coming Soon sports (NFL, NBA) */}
                  {COMING_SOON_SPORTS.map((sport) => {
                    const meta = SPORT_META[sport] || { icon: Shield, color: "text-slate-400", bgColor: "bg-slate-500/20" };
                    const Icon = meta.icon;
                    return (
                      <div key={sport}>
                        <DropdownMenuSeparator className="bg-slate-800" />
                        <DropdownMenuLabel className="flex items-center gap-2 py-2">
                          <div className={`w-6 h-6 rounded flex items-center justify-center ${meta.bgColor} opacity-60`}>
                            <Icon className={`w-3.5 h-3.5 ${meta.color}`} />
                          </div>
                          <span className="text-xs font-black text-slate-500 uppercase tracking-wider">{sport}</span>
                          <span className="ml-auto text-[9px] font-black text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded-full uppercase tracking-wider">Fall 2026</span>
                        </DropdownMenuLabel>
                        <Link href="/nfl-mme">
                          <DropdownMenuItem className="cursor-pointer opacity-70 hover:opacity-100" data-testid={`sport-menu-${sport.toLowerCase()}-mme`}>
                            <div className="w-6 h-6 rounded bg-blue-500/10 flex items-center justify-center mr-2 shrink-0">
                              <Sparkles className="w-3.5 h-3.5 text-blue-400" />
                            </div>
                            <span className="text-sm font-bold text-slate-400">MME Optimizer</span>
                            <span className="text-[9px] font-black text-blue-400 ml-auto">SOON</span>
                          </DropdownMenuItem>
                        </Link>
                        <Link href="/nfl-draft">
                          <DropdownMenuItem className="cursor-pointer opacity-70 hover:opacity-100" data-testid={`sport-menu-${sport.toLowerCase()}-draft`}>
                            <div className="w-6 h-6 rounded bg-amber-500/10 flex items-center justify-center mr-2 shrink-0">
                              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                            </div>
                            <span className="text-sm font-bold text-slate-400">Fantasy Draft Hub</span>
                            <span className="text-[9px] font-black text-amber-400 ml-auto">NEW</span>
                          </DropdownMenuItem>
                        </Link>
                      </div>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className={`flex items-center space-x-2 font-bold text-sm tracking-wide transition-colors cursor-pointer outline-none ${
                    ["/props", "/prizepicks", "/showdown", "/player-config", "/ownership", "/nfl-mme", "/nfl-draft"].includes(location)
                      ? "text-[#10B981]"
                      : "text-slate-400 hover:text-white"
                  }`}
                  data-testid="nav-tools"
                >
                  <Layers className="w-4 h-4" />
                  <span>Tools</span>
                  <ChevronDown className="w-3 h-3 opacity-50" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56 bg-[#1E293B] border-border">
                <Link href="/props">
                  <DropdownMenuItem className="cursor-pointer" data-testid="nav-props">
                    <TrendingUp className="w-4 h-4 mr-2 text-purple-400" />
                    <span className="text-sm font-bold text-slate-300">Prop Bets</span>
                  </DropdownMenuItem>
                </Link>
                <Link href="/prizepicks">
                  <DropdownMenuItem className="cursor-pointer" data-testid="nav-prizepicks">
                    <Zap className="w-4 h-4 mr-2 text-emerald-400" />
                    <span className="text-sm font-bold text-slate-300">PrizePicks</span>
                  </DropdownMenuItem>
                </Link>
                <Link href="/showdown">
                  <DropdownMenuItem className="cursor-pointer" data-testid="nav-showdown">
                    <Swords className="w-4 h-4 mr-2 text-amber-400" />
                    <span className="text-sm font-bold text-slate-300">Showdown</span>
                  </DropdownMenuItem>
                </Link>
                <DropdownMenuSeparator className="bg-slate-800" />
                <Link href="/nfl-draft">
                  <DropdownMenuItem className="cursor-pointer" data-testid="nav-nfl-draft">
                    <Sparkles className="w-4 h-4 mr-2 text-amber-400" />
                    <span className="text-sm font-bold text-slate-300">NFL Draft Hub</span>
                    <span className="ml-auto text-[9px] font-black text-amber-400">NEW</span>
                  </DropdownMenuItem>
                </Link>
                {(isPaid || user?.isAdmin) && (
                  <>
                    <DropdownMenuSeparator className="bg-slate-800" />
                    <Link href="/player-config">
                      <DropdownMenuItem className="cursor-pointer" data-testid="nav-player-config">
                        <Settings2 className="w-4 h-4 mr-2 text-slate-400" />
                        <span className="text-sm font-bold text-slate-300">Player Config</span>
                      </DropdownMenuItem>
                    </Link>
                    <Link href="/scout">
                      <DropdownMenuItem className="cursor-pointer" data-testid="nav-scout">
                        <Sparkles className="w-4 h-4 mr-2 text-emerald-400" />
                        <span className="text-sm font-bold text-slate-300">AI Scout</span>
                      </DropdownMenuItem>
                    </Link>
                  </>
                )}
                {user?.isAdmin && (
                  <Link href="/ownership">
                    <DropdownMenuItem className="cursor-pointer" data-testid="nav-ownership">
                      <Users className="w-4 h-4 mr-2 text-amber-400" />
                      <span className="text-sm font-bold text-slate-300">Proj. Ownership</span>
                    </DropdownMenuItem>
                  </Link>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            {user && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className={`flex items-center space-x-2 font-bold text-sm tracking-wide transition-colors cursor-pointer outline-none ${
                      ["/lineups", "/live-scores", "/performance", "/track-record", "/winning-lineups"].includes(location)
                        ? "text-emerald-400"
                        : "text-slate-400 hover:text-white"
                    }`}
                    data-testid="nav-my-dfs"
                  >
                    <Archive className="w-4 h-4" />
                    <span>My DFS</span>
                    <ChevronDown className="w-3 h-3 opacity-50" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56 bg-[#1E293B] border-border">
                  <Link href="/lineups">
                    <DropdownMenuItem className="cursor-pointer" data-testid="nav-vault">
                      <Archive className="w-4 h-4 mr-2 text-slate-400" />
                      <span className="text-sm font-bold text-slate-300">Saved Lineups</span>
                    </DropdownMenuItem>
                  </Link>
                  <Link href="/track-record">
                    <DropdownMenuItem className="cursor-pointer" data-testid="nav-track-record">
                      <Award className="w-4 h-4 mr-2 text-emerald-400" />
                      <span className="text-sm font-bold text-slate-300">Track Record</span>
                    </DropdownMenuItem>
                  </Link>
                  {(isPaid || user?.isAdmin) && (
                    <>
                      <DropdownMenuSeparator className="bg-slate-800" />
                      <Link href="/live-scores">
                        <DropdownMenuItem className="cursor-pointer" data-testid="nav-live-scores">
                          <Activity className="w-4 h-4 mr-2 text-emerald-400" />
                          <span className="text-sm font-bold text-slate-300">Live Scores</span>
                        </DropdownMenuItem>
                      </Link>
                      <Link href="/performance">
                        <DropdownMenuItem className="cursor-pointer" data-testid="nav-performance">
                          <BarChart3 className="w-4 h-4 mr-2 text-emerald-400" />
                          <span className="text-sm font-bold text-slate-300">Performance</span>
                        </DropdownMenuItem>
                      </Link>
                    </>
                  )}
                  {(isPro || user?.isAdmin) && (
                    <>
                      <DropdownMenuSeparator className="bg-slate-800" />
                      <Link href="/winning-lineups">
                        <DropdownMenuItem className="cursor-pointer" data-testid="nav-winning-lineups">
                          <Trophy className="w-4 h-4 mr-2 text-amber-400" />
                          <span className="text-sm font-bold text-amber-300">Win Agent</span>
                          <Crown className="w-3 h-3 text-amber-400 ml-auto" />
                        </DropdownMenuItem>
                      </Link>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {!user && (
              <Link href="/pricing">
                <div className={`flex items-center space-x-2 font-bold text-sm tracking-wide transition-colors cursor-pointer ${
                  location === "/pricing" ? "text-[#10B981]" : "text-slate-400 hover:text-white"
                }`} data-testid="nav-pricing">
                  <Crown className="w-4 h-4" />
                  <span>Pricing</span>
                </div>
              </Link>
            )}
            {user?.isAdmin && (
              <Link href="/admin">
                <div className={`flex items-center space-x-2 font-bold text-sm tracking-wide transition-colors cursor-pointer ${
                  location === "/admin" ? "text-[#10B981]" : "text-slate-400 hover:text-white"
                }`} data-testid="nav-admin">
                  <ShieldAlert className="w-4 h-4" />
                  <span>Admin</span>
                </div>
              </Link>
            )}
          </nav>
        </div>

        <div className="flex items-center space-x-3 lg:space-x-6 shrink-0">
          {user ? (
            <div className="hidden lg:flex items-center space-x-4">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="relative p-2 rounded-lg hover:bg-slate-800 transition-colors" data-testid="alerts-bell">
                    <Bell className="w-5 h-5 text-slate-400" />
                    {unreadCount > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center text-[11px] font-black text-white" data-testid="alerts-badge">
                        {unreadCount > 9 ? "9+" : unreadCount}
                      </span>
                    )}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-80 bg-[#1E293B] border-border max-h-96 overflow-y-auto">
                  <DropdownMenuLabel className="flex items-center justify-between">
                    <span className="text-xs font-black text-white uppercase tracking-wider">Alerts</span>
                    {unreadCount > 0 && (
                      <button
                        onClick={() => markAllReadMutation.mutate()}
                        className="text-[11px] font-bold text-emerald-400 hover:text-emerald-300 cursor-pointer"
                        data-testid="mark-all-read"
                      >
                        Mark all read
                      </button>
                    )}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator className="bg-slate-800" />
                  {recentAlerts.length === 0 ? (
                    <div className="py-6 text-center">
                      <Bell className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                      <p className="text-sm text-slate-400">No alerts yet</p>
                      <p className="text-[11px] text-slate-400 mt-1">Injury updates for your lineups will appear here</p>
                    </div>
                  ) : (
                    recentAlerts.map(alert => (
                      <div
                        key={alert.id}
                        className={`px-3 py-2.5 border-b border-slate-800/50 ${alert.isRead ? "opacity-60" : ""}`}
                        data-testid={`alert-item-${alert.id}`}
                      >
                        <div className="flex items-start gap-2">
                          {severityIcon(alert.severity)}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-white truncate">{alert.title}</p>
                            <p className="text-[11px] text-slate-400 line-clamp-2 mt-0.5">{alert.message}</p>
                            <div className="flex items-center gap-2 mt-1">
                              <Badge className="text-[11px] font-bold bg-slate-800 text-slate-400 border-slate-700 px-1.5 py-0">{alert.sport}</Badge>
                              {!alert.isRead && (
                                <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center gap-3 hover:bg-slate-800/50 rounded-lg px-3 py-2 transition-colors cursor-pointer outline-none" data-testid="account-menu">
                    <div className="flex flex-col items-end">
                      <span className="text-sm font-bold text-white">{user.firstName || user.email?.split('@')[0]}</span>
                      {isPro ? (
                        <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-[11px] font-black px-1.5 py-0">
                          <Crown className="w-3 h-3 mr-0.5" /> CHAMPION
                        </Badge>
                      ) : subData?.tier === "star" ? (
                        <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[11px] font-black px-1.5 py-0">
                          <Trophy className="w-3 h-3 mr-0.5" /> SHARPSHOOTER
                        </Badge>
                      ) : (
                        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Contender</span>
                      )}
                    </div>
                    <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 bg-[#1E293B] border-border">
                  <DropdownMenuLabel className="text-slate-400 text-xs font-bold uppercase tracking-wider">Account</DropdownMenuLabel>
                  <DropdownMenuSeparator className="bg-slate-800" />
                  {!isPaid && (
                    <Link href="/pricing">
                      <DropdownMenuItem className="cursor-pointer" data-testid="menu-upgrade">
                        <Crown className="w-4 h-4 mr-2 text-amber-400" />
                        <span className="text-sm font-bold text-amber-300">Upgrade Plan</span>
                      </DropdownMenuItem>
                    </Link>
                  )}
                  {subData?.tier === "star" && (
                    <Link href="/pricing">
                      <DropdownMenuItem className="cursor-pointer" data-testid="menu-upgrade">
                        <Crown className="w-4 h-4 mr-2 text-amber-400" />
                        <span className="text-sm font-bold text-amber-300">Upgrade to Champion</span>
                      </DropdownMenuItem>
                    </Link>
                  )}
                  {isPro && (
                    <DropdownMenuItem disabled className="opacity-60">
                      <Crown className="w-4 h-4 mr-2 text-amber-400" />
                      <span className="text-sm font-bold text-amber-300">Champion Member</span>
                    </DropdownMenuItem>
                  )}
                  <Link href="/pricing">
                    <DropdownMenuItem className="cursor-pointer" data-testid="menu-plans">
                      <CreditCard className="w-4 h-4 mr-2 text-slate-400" />
                      <span className="text-sm font-bold text-slate-300">Plans & Billing</span>
                    </DropdownMenuItem>
                  </Link>
                  <DropdownMenuSeparator className="bg-slate-800" />
                  <DropdownMenuItem 
                    className="cursor-pointer text-red-400 focus:text-red-400"
                    onClick={() => logout()}
                    data-testid="logout-btn"
                  >
                    <LogOut className="w-4 h-4 mr-2" />
                    <span className="text-sm font-bold">Sign Out</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : (
            <Link href="/login">
              <Button 
                className="hidden lg:flex bg-[#10B981] text-white px-8 font-bold rounded-lg h-11"
                data-testid="sign-in-btn"
              >
                Sign In
              </Button>
            </Link>
          )}

          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="lg:hidden p-2 rounded-lg transition-colors hover:bg-slate-800"
            data-testid="mobile-menu-btn"
          >
            {mobileMenuOpen ? (
              <X className="w-6 h-6 text-white" />
            ) : (
              <Menu className="w-6 h-6 text-white" />
            )}
          </button>
        </div>
      </div>

      {mobileMenuOpen && (
        <div className="lg:hidden border-t border-border bg-[#0F172A] max-h-[calc(100vh-4rem)] overflow-y-auto" data-testid="mobile-menu">
          <div className="container mx-auto px-4 py-4 space-y-1">
            {user && (
              <div className="flex items-center gap-3 px-3 py-3 mb-3 rounded-lg bg-slate-800/50">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-white truncate">{user.firstName || user.email?.split('@')[0]}</p>
                  <p className="text-[11px] text-slate-400 truncate">{user.email}</p>
                </div>
                {isPro ? (
                  <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-[11px] font-black px-1.5 py-0 shrink-0">
                    <Crown className="w-3 h-3 mr-0.5" /> CHAMPION
                  </Badge>
                ) : isStar ? (
                  <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[11px] font-black px-1.5 py-0 shrink-0">
                    <Trophy className="w-3 h-3 mr-0.5" /> SHARPSHOOTER
                  </Badge>
                ) : (
                  <Badge className="bg-slate-700/50 text-slate-400 border-slate-600 text-[11px] font-black px-1.5 py-0 shrink-0">CONTENDER</Badge>
                )}
              </div>
            )}

            {!user && (
              <Link href="/login">
                <button
                  onClick={() => setMobileMenuOpen(false)}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-lg bg-[#10B981] text-white font-bold text-sm mb-3"
                  data-testid="mobile-sign-in-btn"
                >
                  <Zap className="w-5 h-5 fill-current" />
                  <span>Sign In</span>
                </button>
              </Link>
            )}

            <button
              onClick={() => mobileNav("/")}
              className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg text-left text-sm font-bold transition-colors ${
                location === "/" ? "bg-emerald-500/10 text-emerald-400" : "text-white hover:bg-slate-800"
              }`}
              data-testid="mobile-nav-home"
            >
              <LayoutGrid className="w-5 h-5 shrink-0" />
              <span>Home</span>
            </button>

            <button
              onClick={() => mobileNav("/props")}
              className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg text-left text-sm font-bold transition-colors ${
                location === "/props" ? "bg-emerald-500/10 text-emerald-400" : "text-white hover:bg-slate-800"
              }`}
              data-testid="mobile-nav-props"
            >
              <TrendingUp className="w-5 h-5 shrink-0" />
              <span>Prop Bets</span>
            </button>

            <button
              onClick={() => mobileNav("/prizepicks")}
              className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg text-left text-sm font-bold transition-colors ${
                location === "/prizepicks" ? "bg-emerald-500/10 text-emerald-400" : "text-white hover:bg-slate-800"
              }`}
              data-testid="mobile-nav-prizepicks"
            >
              <Zap className="w-5 h-5 shrink-0" />
              <span>PrizePicks Builder</span>
              <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-[9px] font-bold px-1.5 py-0 ml-auto">CHAMPION</Badge>
            </button>

            <button
              onClick={() => mobileNav("/showdown")}
              className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg text-left text-sm font-bold transition-colors ${
                location === "/showdown" ? "bg-amber-500/10 text-amber-400" : "text-white hover:bg-slate-800"
              }`}
              data-testid="mobile-nav-showdown"
            >
              <Swords className="w-5 h-5 shrink-0" />
              <span>Showdown</span>
            </button>

            <button
              onClick={() => mobileNav("/lineups")}
              className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg text-left text-sm font-bold transition-colors ${
                location === "/lineups" ? "bg-emerald-500/10 text-emerald-400" : "text-white hover:bg-slate-800"
              }`}
              data-testid="mobile-nav-vault"
            >
              <Archive className="w-5 h-5 shrink-0" />
              <span>Saved Lineups</span>
            </button>

            {(isPaid || user?.isAdmin) && (
              <button
                onClick={() => mobileNav("/player-config")}
                className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg text-left text-sm font-bold transition-colors ${
                  location === "/player-config" ? "bg-amber-500/10 text-amber-400" : "text-white hover:bg-slate-800"
                }`}
                data-testid="mobile-nav-player-config"
              >
                <Settings2 className="w-5 h-5 shrink-0" />
                <span>Player Config</span>
              </button>
            )}
            {user?.isAdmin && (
              <button
                onClick={() => mobileNav("/ownership")}
                className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg text-left text-sm font-bold transition-colors ${
                  location === "/ownership" ? "bg-amber-500/10 text-amber-400" : "text-white hover:bg-slate-800"
                }`}
                data-testid="mobile-nav-ownership"
              >
                <Users className="w-5 h-5 shrink-0" />
                <span>Proj. Ownership</span>
                <Crown className="w-3 h-3 text-amber-400 ml-auto" />
              </button>
            )}

            {(isPaid || user?.isAdmin) && (
              <button
                onClick={() => mobileNav("/live-scores")}
                className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg text-left text-sm font-bold transition-colors ${
                  location === "/live-scores" ? "bg-emerald-500/10 text-emerald-400" : "text-white hover:bg-slate-800"
                }`}
                data-testid="mobile-nav-live-scores"
              >
                <Activity className="w-5 h-5 shrink-0" />
                <span>Live Scores</span>
              </button>
            )}
            {(isPaid || user?.isAdmin) && (
              <button
                onClick={() => mobileNav("/performance")}
                className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg text-left text-sm font-bold transition-colors ${
                  location === "/performance" ? "bg-emerald-500/10 text-emerald-400" : "text-white hover:bg-slate-800"
                }`}
                data-testid="mobile-nav-performance"
              >
                <BarChart3 className="w-5 h-5 shrink-0" />
                <span>Performance</span>
              </button>
            )}
            {user && (
              <button
                onClick={() => mobileNav("/track-record")}
                className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg text-left text-sm font-bold transition-colors ${
                  location === "/track-record" ? "bg-emerald-500/10 text-emerald-400" : "text-white hover:bg-slate-800"
                }`}
                data-testid="mobile-nav-track-record"
              >
                <Award className="w-5 h-5 shrink-0" />
                <span>Track Record</span>
              </button>
            )}
            {(isPaid || user?.isAdmin) && (
              <button
                onClick={() => mobileNav("/notifications")}
                className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg text-left text-sm font-bold transition-colors ${
                  location === "/notifications" ? "bg-emerald-500/10 text-emerald-400" : "text-white hover:bg-slate-800"
                }`}
                data-testid="mobile-nav-notifications"
              >
                <Bell className="w-5 h-5 shrink-0" />
                <span>Notifications</span>
              </button>
            )}

            <button
              onClick={() => mobileNav("/pricing")}
              className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg text-left text-sm font-bold transition-colors ${
                location === "/pricing" ? "bg-emerald-500/10 text-emerald-400" : "text-white hover:bg-slate-800"
              }`}
              data-testid="mobile-nav-pricing"
            >
              <Crown className="w-5 h-5 shrink-0" />
              <span>Pricing</span>
            </button>

            {user && (
              <>
                <div className="border-t border-border my-2 pt-2">
                  <p className="px-3 py-1 text-[11px] font-black text-slate-400 uppercase tracking-wider">Sports</p>
                </div>
                {ACTIVE_SPORTS.map(sport => {
                  const meta = SPORT_META[sport] || { icon: Dribbble, color: "text-slate-400", bgColor: "bg-slate-500/20" };
                  const Icon = meta.icon;
                  const dkSlate = mainSlates.find(s => s.sport === sport && s.platform === "draftkings");
                  const bestSlate = dkSlate
                    || mainSlates.find(s => s.sport === sport && s.platform === "fanduel")
                    || mainSlates.find(s => s.sport === sport && s.platform === "yahoo");
                  const builderLabel = dkSlate ? `DK Builder ${sport}` : bestSlate ? `Builder ${sport}` : `DK Builder ${sport}`;

                  return (
                    <div key={sport} className="space-y-0.5">
                      <div className="flex items-center gap-2 px-3 py-2">
                        <div className={`w-6 h-6 rounded flex items-center justify-center ${meta.bgColor}`}>
                          <Icon className={`w-3.5 h-3.5 ${meta.color}`} />
                        </div>
                        <span className="text-xs font-black text-white uppercase tracking-wider">{sport}</span>
                      </div>

                      <div className="pl-6 space-y-0.5">
                        <button
                          onClick={() => mobileNav(`/news/${sport.toLowerCase()}`)}
                          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm font-bold text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
                          data-testid={`mobile-sport-${sport.toLowerCase()}-news`}
                        >
                          <Newspaper className="w-4 h-4 text-amber-400 shrink-0" />
                          <span>News</span>
                        </button>

                        {bestSlate ? (
                          <button
                            onClick={() => mobileNav(`/optimizer/${bestSlate.id}`)}
                            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm font-bold text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
                            data-testid={`mobile-sport-${sport.toLowerCase()}-dk`}
                          >
                            <div className="w-5 h-5 rounded bg-emerald-500/20 flex items-center justify-center shrink-0">
                              <span className="text-emerald-400 font-black text-[10px]">DK</span>
                            </div>
                            <span>{builderLabel}</span>
                          </button>
                        ) : (
                          <div className="flex items-center gap-2 px-3 py-2 text-sm font-bold text-slate-600">
                            <div className="w-5 h-5 rounded bg-emerald-500/10 flex items-center justify-center shrink-0">
                              <span className="text-emerald-500/40 font-black text-[10px]">DK</span>
                            </div>
                            <span>DK Builder {sport}</span>
                          </div>
                        )}

                        {isPro && bestSlate ? (
                          <button
                            onClick={() => mobileNav(`/optimizer-pro/${bestSlate.id}`)}
                            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm font-bold text-amber-300 hover:bg-slate-800 transition-colors"
                            data-testid={`mobile-sport-${sport.toLowerCase()}-pro`}
                          >
                            <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
                            <span>Pro Optimizer {sport}</span>
                            <Crown className="w-3.5 h-3.5 text-amber-400 ml-auto" />
                          </button>
                        ) : isStar && bestSlate ? (
                          <button
                            onClick={() => mobileNav(`/optimizer-pro/${bestSlate.id}`)}
                            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm font-bold text-emerald-300 hover:bg-slate-800 transition-colors"
                            data-testid={`mobile-sport-${sport.toLowerCase()}-star`}
                          >
                            <Sparkles className="w-4 h-4 text-emerald-400 shrink-0" />
                            <span>Pro Optimizer {sport}</span>
                            <Trophy className="w-3.5 h-3.5 text-emerald-400 ml-auto" />
                          </button>
                        ) : (
                          <button
                            onClick={() => mobileNav("/pricing")}
                            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm font-bold text-slate-600 hover:bg-slate-800 transition-colors"
                          >
                            <Lock className="w-4 h-4 shrink-0" />
                            <span>Pro Optimizer {sport}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </>
            )}

            {(isPro || user?.isAdmin) && (
              <>
                <div className="border-t border-border my-2 pt-2" />
                <button
                  onClick={() => mobileNav("/winning-lineups")}
                  className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg text-left text-sm font-bold transition-colors ${
                    location === "/winning-lineups" ? "bg-amber-500/10 text-amber-400" : "text-white hover:bg-slate-800"
                  }`}
                  data-testid="mobile-nav-winning-lineups"
                >
                  <Trophy className="w-5 h-5 shrink-0" />
                  <span>Win Agent</span>
                  <Crown className="w-3 h-3 text-amber-400 ml-auto" />
                </button>
              </>
            )}
            {user?.isAdmin && (
              <>
                <button
                  onClick={() => mobileNav("/admin")}
                  className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg text-left text-sm font-bold transition-colors ${
                    location === "/admin" ? "bg-emerald-500/10 text-emerald-400" : "text-white hover:bg-slate-800"
                  }`}
                  data-testid="mobile-nav-admin"
                >
                  <ShieldAlert className="w-5 h-5 shrink-0" />
                  <span>Admin</span>
                </button>
              </>
            )}

            {user && (
              <>
                <div className="border-t border-border my-2 pt-2" />
                <button
                  onClick={() => { logout(); setMobileMenuOpen(false); }}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-lg text-left text-sm font-bold text-red-400 hover:bg-red-500/10 transition-colors"
                  data-testid="mobile-logout-btn"
                >
                  <LogOut className="w-5 h-5 shrink-0" />
                  <span>Sign Out</span>
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}

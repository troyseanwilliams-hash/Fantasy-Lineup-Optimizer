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
import { Zap, Archive, LogOut, ShieldAlert, Crown, TrendingUp, ChevronDown, Dribbble, Activity, Target, Newspaper, LayoutGrid, Bell, Lock, Sparkles, AlertTriangle, Info, XCircle, CreditCard, Trophy } from "lucide-react";
import { ACTIVE_SPORTS } from "@shared/platform-config";
import type { Slate } from "@shared/schema";

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
};

export function Header() {
  const { user, logout } = useAuth();
  const [location] = useLocation();

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
  const isPaid = subData?.tier === "pro" || subData?.tier === "competitive";
  const unreadCount = alertsData?.unreadCount || 0;
  const recentAlerts = alertsData?.alerts?.slice(0, 8) || [];

  const severityIcon = (severity: string) => {
    if (severity === "critical") return <XCircle className="w-4 h-4 text-red-400 shrink-0" />;
    if (severity === "warning") return <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />;
    return <Info className="w-4 h-4 text-blue-400 shrink-0" />;
  };

  return (
    <header className="bg-[#0F172A] border-b border-slate-800 sticky top-0 z-50">
      <div className="container mx-auto px-4 h-20 flex items-center justify-between">
        <div className="flex items-center space-x-10">
          <Link href="/">
            <div className="flex items-center space-x-3 cursor-pointer group">
              <div className="w-10 h-10 bg-[#10B981] rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/20 group-hover:scale-110 transition-transform">
                <Zap className="text-white w-6 h-6 fill-current" />
              </div>
              <span className="text-2xl font-black tracking-tighter text-white uppercase">
                ELITE<span className="text-[#10B981]">LINEUP</span>
              </span>
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
                <DropdownMenuContent align="start" className="w-72 bg-slate-900 border-slate-800">
                  {ACTIVE_SPORTS.map((sport, idx) => {
                    const meta = SPORT_META[sport] || { icon: Dribbble, color: "text-slate-400", bgColor: "bg-slate-500/20" };
                    const Icon = meta.icon;
                    const dkSlate = mainSlates.find(s => s.sport === sport && s.platform === "draftkings");
                    const fdSlate = mainSlates.find(s => s.sport === sport && s.platform === "fanduel");

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

                        {dkSlate ? (
                          <Link href={`/optimizer/${dkSlate.id}`}>
                            <DropdownMenuItem className="cursor-pointer" data-testid={`sport-menu-${sport.toLowerCase()}-dk`}>
                              <div className="w-6 h-6 rounded bg-emerald-500/20 flex items-center justify-center mr-2 shrink-0">
                                <span className="text-emerald-400 font-black text-[11px]">DK</span>
                              </div>
                              <span className="text-sm font-bold text-slate-300">{sport} DK Builder</span>
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
                        {fdSlate ? (
                          <Link href={`/optimizer/${fdSlate.id}`}>
                            <DropdownMenuItem className="cursor-pointer" data-testid={`sport-menu-${sport.toLowerCase()}-fd`}>
                              <div className="w-6 h-6 rounded bg-blue-500/20 flex items-center justify-center mr-2 shrink-0">
                                <span className="text-blue-400 font-black text-[11px]">FD</span>
                              </div>
                              <span className="text-sm font-bold text-slate-300">{sport} FD Builder</span>
                            </DropdownMenuItem>
                          </Link>
                        ) : (
                          <DropdownMenuItem disabled className="opacity-50" data-testid={`sport-menu-${sport.toLowerCase()}-fd`}>
                            <div className="w-6 h-6 rounded bg-blue-500/20 flex items-center justify-center mr-2 shrink-0">
                              <span className="text-blue-400 font-black text-[11px]">FD</span>
                            </div>
                            <span className="text-sm font-bold text-slate-300">{sport} FD Builder</span>
                          </DropdownMenuItem>
                        )}

                        {isPro && dkSlate ? (
                          <Link href={`/optimizer-pro/${dkSlate.id}`}>
                            <DropdownMenuItem className="cursor-pointer" data-testid={`sport-menu-${sport.toLowerCase()}-pro-dk`}>
                              <div className="w-6 h-6 rounded bg-amber-500/20 flex items-center justify-center mr-2 shrink-0">
                                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                              </div>
                              <span className="text-sm font-bold text-amber-300">{sport} Pro DK</span>
                              <Crown className="w-3.5 h-3.5 text-amber-400 ml-auto" />
                            </DropdownMenuItem>
                          </Link>
                        ) : (
                          <Link href="/pricing">
                            <DropdownMenuItem className={`cursor-pointer ${isPro ? "opacity-50" : ""}`} data-testid={`sport-menu-${sport.toLowerCase()}-pro-dk`}>
                              <div className="w-6 h-6 rounded bg-amber-500/10 flex items-center justify-center mr-2 shrink-0">
                                <Lock className="w-3 h-3 text-amber-500/50" />
                              </div>
                              <span className="text-sm font-bold text-slate-500">{sport} Pro DK</span>
                              <Crown className="w-3.5 h-3.5 text-amber-500/40 ml-auto" />
                            </DropdownMenuItem>
                          </Link>
                        )}

                        {isPro && fdSlate ? (
                          <Link href={`/optimizer-pro/${fdSlate.id}`}>
                            <DropdownMenuItem className="cursor-pointer" data-testid={`sport-menu-${sport.toLowerCase()}-pro-fd`}>
                              <div className="w-6 h-6 rounded bg-amber-500/20 flex items-center justify-center mr-2 shrink-0">
                                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                              </div>
                              <span className="text-sm font-bold text-amber-300">{sport} Pro FD</span>
                              <Crown className="w-3.5 h-3.5 text-amber-400 ml-auto" />
                            </DropdownMenuItem>
                          </Link>
                        ) : (
                          <Link href="/pricing">
                            <DropdownMenuItem className={`cursor-pointer ${isPro ? "opacity-50" : ""}`} data-testid={`sport-menu-${sport.toLowerCase()}-pro-fd`}>
                              <div className="w-6 h-6 rounded bg-amber-500/10 flex items-center justify-center mr-2 shrink-0">
                                <Lock className="w-3 h-3 text-amber-500/50" />
                              </div>
                              <span className="text-sm font-bold text-slate-500">{sport} Pro FD</span>
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
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            <Link href="/props">
              <div className={`flex items-center space-x-2 font-bold text-sm tracking-wide transition-colors cursor-pointer ${
                location === "/props" ? "text-[#10B981]" : "text-slate-400 hover:text-white"
              }`} data-testid="nav-props">
                <TrendingUp className="w-4 h-4" />
                <span>Props</span>
              </div>
            </Link>
            <Link href="/lineups">
              <div className={`flex items-center space-x-2 font-bold text-sm tracking-wide transition-colors cursor-pointer ${
                location === "/lineups" ? "text-[#10B981]" : "text-slate-400 hover:text-white"
              }`} data-testid="nav-vault">
                <Archive className="w-4 h-4" />
                <span>Vault</span>
              </div>
            </Link>
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

        <div className="flex items-center space-x-6">
          {user ? (
            <div className="flex items-center space-x-4">
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
                <DropdownMenuContent align="end" className="w-80 bg-slate-900 border-slate-800 max-h-96 overflow-y-auto">
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
                    <div className="hidden md:flex flex-col items-end">
                      <span className="text-sm font-bold text-white">{user.firstName || user.email?.split('@')[0]}</span>
                      {isPro ? (
                        <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-[11px] font-black px-1.5 py-0">
                          <Crown className="w-3 h-3 mr-0.5" /> PRO
                        </Badge>
                      ) : subData?.tier === "competitive" ? (
                        <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[11px] font-black px-1.5 py-0">
                          <Trophy className="w-3 h-3 mr-0.5" /> COMPETITIVE
                        </Badge>
                      ) : (
                        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Free Plan</span>
                      )}
                    </div>
                    <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 bg-slate-900 border-slate-800">
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
                  {subData?.tier === "competitive" && (
                    <Link href="/pricing">
                      <DropdownMenuItem className="cursor-pointer" data-testid="menu-upgrade">
                        <Crown className="w-4 h-4 mr-2 text-amber-400" />
                        <span className="text-sm font-bold text-amber-300">Upgrade to Pro</span>
                      </DropdownMenuItem>
                    </Link>
                  )}
                  {isPro && (
                    <DropdownMenuItem disabled className="opacity-60">
                      <Crown className="w-4 h-4 mr-2 text-amber-400" />
                      <span className="text-sm font-bold text-amber-300">Pro Member</span>
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
            <Button 
              onClick={() => window.location.href = '/api/login'} 
              className="bg-[#10B981] text-white px-8 font-bold rounded-lg h-11"
              data-testid="sign-in-btn"
            >
              Sign In
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}

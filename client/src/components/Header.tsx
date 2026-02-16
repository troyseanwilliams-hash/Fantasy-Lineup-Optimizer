import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
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
import { Zap, Archive, LogOut, ShieldAlert, Crown, TrendingUp, ChevronDown, Dribbble, Activity, Target, Newspaper, LayoutGrid } from "lucide-react";
import { ACTIVE_SPORTS } from "@shared/platform-config";
import type { Slate } from "@shared/schema";

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

  const mainSlates = slates?.filter(s => s.isMain) || [];

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
                <DropdownMenuContent align="start" className="w-64 bg-slate-900 border-slate-800">
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

                        <Link href={dkSlate ? `/optimizer/${dkSlate.id}` : `/news/${sport.toLowerCase()}`}>
                          <DropdownMenuItem className="cursor-pointer" data-testid={`sport-menu-${sport.toLowerCase()}-dk`}>
                            <div className="w-6 h-6 rounded bg-emerald-500/20 flex items-center justify-center mr-2 shrink-0">
                              <span className="text-emerald-400 font-black text-[9px]">DK</span>
                            </div>
                            <span className="text-sm font-bold text-slate-300">DraftKings Builder</span>
                          </DropdownMenuItem>
                        </Link>
                        <Link href={fdSlate ? `/optimizer/${fdSlate.id}` : `/news/${sport.toLowerCase()}`}>
                          <DropdownMenuItem className="cursor-pointer" data-testid={`sport-menu-${sport.toLowerCase()}-fd`}>
                            <div className="w-6 h-6 rounded bg-blue-500/20 flex items-center justify-center mr-2 shrink-0">
                              <span className="text-blue-400 font-black text-[9px]">FD</span>
                            </div>
                            <span className="text-sm font-bold text-slate-300">FanDuel Builder</span>
                          </DropdownMenuItem>
                        </Link>

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
            <Link href="/pricing">
              <div className={`flex items-center space-x-2 font-bold text-sm tracking-wide transition-colors cursor-pointer ${
                location === "/pricing" ? "text-[#10B981]" : "text-slate-400 hover:text-white"
              }`} data-testid="nav-pricing">
                <Crown className="w-4 h-4" />
                <span>Pricing</span>
              </div>
            </Link>
            <Link href="/admin">
              <div className={`flex items-center space-x-2 font-bold text-sm tracking-wide transition-colors cursor-pointer ${
                location === "/admin" ? "text-[#10B981]" : "text-slate-400 hover:text-white"
              }`} data-testid="nav-admin">
                <ShieldAlert className="w-4 h-4" />
                <span>Admin</span>
              </div>
            </Link>
          </nav>
        </div>

        <div className="flex items-center space-x-6">
          {user ? (
            <div className="flex items-center space-x-4">
              <div className="hidden md:flex flex-col items-end">
                <span className="text-sm font-bold text-white">{user.firstName || user.email?.split('@')[0]}</span>
                {subData?.tier === "pro" ? (
                  <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-[9px] font-black px-1.5 py-0">
                    <Crown className="w-3 h-3 mr-0.5" /> PRO
                  </Badge>
                ) : (
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Free Plan</span>
                )}
              </div>
              <div className="h-10 w-px bg-slate-800"></div>
              <div className="flex items-center space-x-2">
                <Button 
                  variant="ghost" 
                  size="icon" 
                  onClick={() => logout()} 
                  className="text-slate-400"
                  data-testid="logout-btn"
                >
                  <LogOut className="w-5 h-5" />
                </Button>
              </div>
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

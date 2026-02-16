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
import { Zap, Archive, LogOut, ShieldAlert, Crown, TrendingUp, ChevronDown, Dribbble, Activity, Target, Newspaper, Users } from "lucide-react";
import { ACTIVE_SPORTS } from "@shared/platform-config";
import type { Slate } from "@shared/schema";

const SPORT_META: Record<string, { icon: typeof Dribbble; color: string }> = {
  NBA: { icon: Dribbble, color: "text-orange-400" },
  NHL: { icon: Activity, color: "text-cyan-400" },
  MLB: { icon: Target, color: "text-red-400" },
};

function SportMenu({ sport, slates, location }: { sport: string; slates: Slate[]; location: string }) {
  const meta = SPORT_META[sport] || { icon: Dribbble, color: "text-slate-400" };
  const Icon = meta.icon;
  const sportSlates = slates.filter(s => s.sport === sport && s.isMain);
  const dkSlate = sportSlates.find(s => s.platform === "draftkings");
  const fdSlate = sportSlates.find(s => s.platform === "fanduel");
  const isActive = sportSlates.some(s => location === `/optimizer/${s.id}`);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={`flex items-center space-x-1.5 font-bold text-sm tracking-wide transition-colors cursor-pointer outline-none ${
            isActive ? "text-[#10B981]" : "text-slate-400 hover:text-white"
          }`}
          data-testid={`sport-menu-${sport.toLowerCase()}`}
        >
          <Icon className="w-4 h-4" />
          <span>{sport}</span>
          <ChevronDown className="w-3 h-3 opacity-50" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56 bg-slate-900 border-slate-800">
        <DropdownMenuLabel className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Lineup Builder</DropdownMenuLabel>
        {dkSlate && (
          <Link href={`/optimizer/${dkSlate.id}`}>
            <DropdownMenuItem className="cursor-pointer" data-testid={`sport-menu-${sport.toLowerCase()}-dk`}>
              <div className="w-6 h-6 rounded bg-emerald-500/20 flex items-center justify-center mr-2 shrink-0">
                <span className="text-emerald-400 font-black text-[9px]">DK</span>
              </div>
              <div>
                <p className="text-sm font-bold text-white">DraftKings</p>
                <p className="text-[10px] text-slate-500">{dkSlate.name}</p>
              </div>
            </DropdownMenuItem>
          </Link>
        )}
        {fdSlate && (
          <Link href={`/optimizer/${fdSlate.id}`}>
            <DropdownMenuItem className="cursor-pointer" data-testid={`sport-menu-${sport.toLowerCase()}-fd`}>
              <div className="w-6 h-6 rounded bg-blue-500/20 flex items-center justify-center mr-2 shrink-0">
                <span className="text-blue-400 font-black text-[9px]">FD</span>
              </div>
              <div>
                <p className="text-sm font-bold text-white">FanDuel</p>
                <p className="text-[10px] text-slate-500">{fdSlate.name}</p>
              </div>
            </DropdownMenuItem>
          </Link>
        )}
        <DropdownMenuSeparator className="bg-slate-800" />
        <DropdownMenuLabel className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Coming Soon</DropdownMenuLabel>
        <DropdownMenuItem className="cursor-default opacity-50" disabled>
          <Newspaper className="w-4 h-4 mr-2 text-slate-500" />
          <span className="text-sm text-slate-500">{sport} News</span>
        </DropdownMenuItem>
        <DropdownMenuItem className="cursor-default opacity-50" disabled>
          <Users className="w-4 h-4 mr-2 text-slate-500" />
          <span className="text-sm text-slate-500">Player Updates</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

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
            {user && ACTIVE_SPORTS.map(sport => (
              <SportMenu key={sport} sport={sport} slates={mainSlates} location={location} />
            ))}

            <div className="w-px h-5 bg-slate-800" />

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

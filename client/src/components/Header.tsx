import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LayoutDashboard, Zap, Archive, Settings, LogOut, ShieldAlert, Crown } from "lucide-react";

export function Header() {
  const { user, logout } = useAuth();
  const [location] = useLocation();

  const { data: subData } = useQuery<{ tier: string }>({
    queryKey: ["/api/subscription"],
    enabled: !!user,
  });

  const links = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/lineups", label: "Vault", icon: Archive },
    { href: "/pricing", label: "Pricing", icon: Crown },
    { href: "/admin", label: "Admin", icon: ShieldAlert },
  ];

  return (
    <header className="bg-[#0F172A] border-b border-slate-800 sticky top-0 z-50">
      <div className="container mx-auto px-4 h-20 flex items-center justify-between">
        <div className="flex items-center space-x-12">
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

          <nav className="hidden lg:flex items-center space-x-8">
            {links.map((link) => (
              <Link key={link.href} href={link.href}>
                <div className={`flex items-center space-x-2 font-bold text-sm tracking-wide transition-colors cursor-pointer ${
                  location === link.href ? "text-[#10B981]" : "text-slate-400 hover:text-white"
                }`}>
                  <link.icon className="w-4 h-4" />
                  <span>{link.label}</span>
                </div>
              </Link>
            ))}
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
                  className="text-slate-400 hover:text-red-400 hover:bg-red-400/10"
                  data-testid="logout-btn"
                >
                  <LogOut className="w-5 h-5" />
                </Button>
              </div>
            </div>
          ) : (
            <Button 
              onClick={() => window.location.href = '/api/login'} 
              className="bg-[#10B981] text-white hover:bg-[#059669] px-8 font-bold rounded-lg h-11"
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

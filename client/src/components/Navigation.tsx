import { Link, useLocation } from "wouter";
import { LayoutDashboard, Users, History, Trophy, LogOut } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";

export function Navigation() {
  const [location] = useLocation();
  const { logout, user } = useAuth();

  const isActive = (path: string) => location === path;

  return (
    <nav className="border-b border-border/50 bg-card/50 backdrop-blur-xl sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-2 group cursor-pointer">
              <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center group-hover:bg-primary/30 transition-colors">
                <Trophy className="w-5 h-5 text-primary" />
              </div>
              <span className="font-display font-bold text-xl tracking-tight text-white group-hover:text-primary transition-colors">
                PRO<span className="text-primary">LINEUP</span>
              </span>
            </Link>

            <div className="hidden md:flex items-center space-x-1">
              <Link href="/" className={isActive("/") ? "text-primary" : "text-muted-foreground hover:text-white"}>
                <Button variant="ghost" className="gap-2">
                  <LayoutDashboard className="w-4 h-4" />
                  Slates
                </Button>
              </Link>
              <Link href="/lineups" className={isActive("/lineups") ? "text-primary" : "text-muted-foreground hover:text-white"}>
                <Button variant="ghost" className="gap-2">
                  <History className="w-4 h-4" />
                  Saved Lineups
                </Button>
              </Link>
              <Link href="/admin" className={isActive("/admin") ? "text-primary" : "text-muted-foreground hover:text-white"}>
                <Button variant="ghost" className="gap-2">
                  <Users className="w-4 h-4" />
                  Admin
                </Button>
              </Link>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {user && (
              <div className="flex items-center gap-4">
                <div className="text-right hidden sm:block">
                  <p className="text-sm font-medium text-white">{user.firstName} {user.lastName}</p>
                  <p className="text-xs text-muted-foreground">{user.email}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => logout()} className="border-red-900/50 text-red-400 hover:bg-red-950/50 hover:text-red-300">
                  <LogOut className="w-4 h-4 mr-2" />
                  Logout
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}

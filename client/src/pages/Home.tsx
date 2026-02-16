import { useSlates } from "@/hooks/use-slates";
import { Navigation } from "@/components/Navigation";
import { Link } from "wouter";
import { Calendar, Clock, ArrowRight, Loader2, Trophy } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";

export default function Home() {
  const { data: slates, isLoading, error } = useSlates();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center text-center p-4">
        <h2 className="text-2xl font-bold text-destructive mb-2">Error Loading Slates</h2>
        <p className="text-muted-foreground">{error.message}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navigation />
      
      {/* Hero Section */}
      <div className="relative overflow-hidden bg-card border-b border-border">
        <div className="absolute inset-0 bg-grid-white/[0.02]" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24 relative z-10">
          <h1 className="text-4xl sm:text-6xl font-display font-bold text-white mb-6 tracking-tight">
            Build Winning <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-emerald-400">Lineups</span>
          </h1>
          <p className="text-lg sm:text-xl text-muted-foreground max-w-2xl mb-8">
            Advanced optimizer for NFL, NBA, MLB, and NHL. Leverage data-driven projections to dominate your fantasy contests.
          </p>
          <div className="flex gap-4">
            <Link href="/lineups">
              <Button size="lg" className="font-display tracking-wide bg-primary text-primary-foreground hover:bg-primary/90">
                View My Lineups
              </Button>
            </Link>
            <Link href="/admin">
              <Button size="lg" variant="outline" className="font-display tracking-wide">
                Admin Dashboard
              </Button>
            </Link>
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl font-display font-bold text-white flex items-center gap-2">
            <Trophy className="w-6 h-6 text-primary" />
            Active Slates
          </h2>
          <span className="text-sm text-muted-foreground">Select a slate to start optimizing</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {slates && slates.length > 0 ? (
            slates.map((slate) => (
              <Link key={slate.id} href={`/optimizer/${slate.id}`} className="group">
                <div className="bg-card rounded-2xl p-6 border border-border shadow-lg transition-all duration-300 hover:border-primary/50 hover:shadow-primary/10 hover:-translate-y-1 h-full flex flex-col">
                  <div className="flex justify-between items-start mb-4">
                    <span className="bg-primary/10 text-primary text-xs font-bold px-3 py-1 rounded-full border border-primary/20">
                      {slate.sport}
                    </span>
                    <Clock className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                  </div>
                  
                  <h3 className="text-xl font-bold text-white mb-2 group-hover:text-primary transition-colors">
                    {slate.name}
                  </h3>
                  
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mb-6">
                    <Calendar className="w-4 h-4" />
                    <span>{format(new Date(slate.startTime), "MMM d, yyyy • h:mm a")}</span>
                  </div>
                  
                  <div className="mt-auto pt-4 border-t border-border/50 flex items-center justify-between text-sm font-medium text-white group-hover:text-primary transition-colors">
                    <span>Open Optimizer</span>
                    <ArrowRight className="w-4 h-4 transform group-hover:translate-x-1 transition-transform" />
                  </div>
                </div>
              </Link>
            ))
          ) : (
            <div className="col-span-full py-12 text-center bg-card/50 rounded-2xl border border-dashed border-border">
              <p className="text-muted-foreground">No active slates found. Check back later or create one in Admin.</p>
              <Link href="/admin">
                <Button variant="link" className="mt-2 text-primary">Go to Admin</Button>
              </Link>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

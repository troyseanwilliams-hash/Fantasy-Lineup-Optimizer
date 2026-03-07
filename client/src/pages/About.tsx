import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Zap, Target, TrendingUp, Shield, BarChart3, Users,
  Dribbble, Activity, Flag, ArrowRight, Sparkles
} from "lucide-react";

const FEATURES = [
  {
    icon: BarChart3,
    title: "AI Lineup Optimizer",
    description: "Generate mathematically optimal DraftKings lineups using advanced algorithms that analyze projections, correlations, and projected ownership data.",
    color: "text-emerald-400",
    bg: "from-emerald-500/20 to-emerald-500/5",
  },
  {
    icon: Target,
    title: "Prop Pick Engine",
    description: "AI-driven prop bet analysis across all major sports. Get confidence-rated picks on player props with real-time injury and matchup data.",
    color: "text-amber-400",
    bg: "from-amber-500/20 to-amber-500/5",
  },
  {
    icon: TrendingUp,
    title: "PrizePicks Builder",
    description: "Build optimized PrizePicks entries with our correlation engine. Find the best combos backed by statistical edge and trend analysis.",
    color: "text-cyan-400",
    bg: "from-cyan-500/20 to-cyan-500/5",
  },
];

const SPORTS = [
  { name: "NBA", icon: Dribbble, color: "text-orange-400", bg: "bg-orange-500/15" },
  { name: "NHL", icon: Activity, color: "text-cyan-400", bg: "bg-cyan-500/15" },
  { name: "MLB", icon: Target, color: "text-red-400", bg: "bg-red-500/15" },
  { name: "NFL", icon: Shield, color: "text-green-400", bg: "bg-green-500/15" },
  { name: "GOLF", icon: Flag, color: "text-lime-400", bg: "bg-lime-500/15" },
];

const REASONS = [
  {
    title: "Data-Driven Edge",
    description: "Our models process thousands of data points per slate including player projections, Vegas lines, weather, and historical matchup trends.",
  },
  {
    title: "Real-Time Updates",
    description: "Projections and picks update in real time as injury news breaks, lineups are confirmed, and odds shift across sportsbooks.",
  },
  {
    title: "Built for Winners",
    description: "Whether you're a casual player or a high-volume grinder, our tiered plans give you the tools to compete at every level.",
  },
  {
    title: "Multi-Platform Support",
    description: "Optimized for DraftKings classic contests and PrizePicks flex plays. One platform, multiple ways to win.",
  },
];

export default function About() {
  return (
    <div className="bg-[#0F172A] min-h-screen" data-testid="about-page">
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-emerald-950/40 via-[#0F172A] to-[#0F172A]" />
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-gradient-to-bl from-emerald-500/8 via-transparent to-transparent rounded-full" />
        <div className="relative z-10 container mx-auto px-4 py-20 md:py-28">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 mb-6">
              <div className="w-8 h-8 bg-emerald-500/20 rounded-lg flex items-center justify-center">
                <Zap className="w-4 h-4 text-emerald-400 fill-current" />
              </div>
              <span className="text-emerald-400 text-sm font-black uppercase tracking-widest" data-testid="text-about-label">About EliteLineup AI</span>
            </div>
            <h1 className="text-4xl md:text-5xl font-black text-white tracking-tight leading-tight mb-6" data-testid="text-about-heading">
              Smarter Lineups.{" "}
              <span className="text-emerald-400">Sharper Picks.</span>
            </h1>
            <p className="text-lg text-slate-300 leading-relaxed max-w-2xl" data-testid="text-about-mission">
              EliteLineup AI is an AI-powered daily fantasy sports optimizer built for DraftKings and PrizePicks players. We combine advanced statistical models with real-time data to help you make smarter lineup decisions and find edges the market misses.
            </p>
          </div>
        </div>
      </div>

      <section className="container mx-auto px-4 pb-20" data-testid="section-features">
        <div className="flex items-center gap-2.5 mb-8">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500/30 to-cyan-500/20 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-white tracking-tight">What We Offer</h2>
            <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">Tools designed to give you an edge</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {FEATURES.map((feature) => {
            const Icon = feature.icon;
            return (
              <Card
                key={feature.title}
                className="bg-slate-800/40 border-border p-6 relative overflow-hidden"
                data-testid={`card-feature-${feature.title.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <div className={`absolute inset-0 bg-gradient-to-b ${feature.bg} opacity-50`} />
                <div className="relative z-10">
                  <Icon className={`w-8 h-8 ${feature.color} mb-4`} />
                  <h3 className="text-lg font-black text-white mb-2">{feature.title}</h3>
                  <p className="text-sm text-slate-400 leading-relaxed">{feature.description}</p>
                </div>
              </Card>
            );
          })}
        </div>
      </section>

      <section className="container mx-auto px-4 pb-20" data-testid="section-sports">
        <div className="flex items-center gap-2.5 mb-8">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500/30 to-violet-500/20 flex items-center justify-center">
            <Shield className="w-4 h-4 text-purple-400" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-white tracking-tight">Supported Sports</h2>
            <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">Comprehensive coverage across major leagues</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-4">
          {SPORTS.map((sport) => {
            const Icon = sport.icon;
            return (
              <div
                key={sport.name}
                className={`${sport.bg} rounded-xl px-6 py-4 flex items-center gap-3 border border-slate-700/40`}
                data-testid={`badge-sport-${sport.name.toLowerCase()}`}
              >
                <Icon className={`w-6 h-6 ${sport.color}`} />
                <span className="text-white font-black text-sm tracking-wide">{sport.name}</span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="container mx-auto px-4 pb-20" data-testid="section-why">
        <div className="flex items-center gap-2.5 mb-8">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500/30 to-orange-500/20 flex items-center justify-center">
            <Users className="w-4 h-4 text-amber-400" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-white tracking-tight">Why EliteLineup AI</h2>
            <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">The competitive advantage you need</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {REASONS.map((reason, idx) => (
            <Card
              key={reason.title}
              className="bg-slate-800/40 border-border p-6"
              data-testid={`card-reason-${idx}`}
            >
              <h3 className="text-base font-black text-white mb-2">{reason.title}</h3>
              <p className="text-sm text-slate-400 leading-relaxed">{reason.description}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="container mx-auto px-4 pb-20" data-testid="section-cta">
        <div className="relative rounded-xl overflow-hidden p-8 md:p-12">
          <div className="absolute inset-0 bg-gradient-to-r from-emerald-950/60 via-slate-900/80 to-purple-950/50" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,_var(--tw-gradient-stops))] from-emerald-500/10 via-transparent to-purple-500/10" />
          <div className="relative z-10 text-center max-w-xl mx-auto">
            <h2 className="text-2xl md:text-3xl font-black text-white mb-4" data-testid="text-cta-heading">Ready to Level Up Your Game?</h2>
            <p className="text-slate-300 mb-6">
              Join thousands of DFS players using EliteLineup AI to build winning lineups and find profitable props every day.
            </p>
            <div className="flex items-center justify-center gap-4 flex-wrap">
              <Link href="/">
                <Button className="bg-emerald-500 text-white font-bold gap-2 shadow-lg shadow-emerald-500/20" data-testid="button-get-started">
                  Get Started <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
              <Link href="/pricing">
                <Button variant="outline" className="font-bold gap-2" data-testid="button-view-pricing">
                  View Pricing
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

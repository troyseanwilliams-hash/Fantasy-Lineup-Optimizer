import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Zap, ArrowRight, BarChart3, Layers, Download, Sparkles,
  Crown, Trophy, Check, X, Shield, Target, Activity,
  Dribbble, Flag, Circle
} from "lucide-react";

const SPORTS = [
  { name: "NBA", icon: Dribbble, color: "text-orange-400", bg: "bg-orange-500/15" },
  { name: "NHL", icon: Activity, color: "text-cyan-400", bg: "bg-cyan-500/15" },
  { name: "MLB", icon: Target, color: "text-red-400", bg: "bg-red-500/15" },
  { name: "NFL", icon: Shield, color: "text-green-400", bg: "bg-green-500/15" },
  { name: "GOLF", icon: Flag, color: "text-lime-400", bg: "bg-lime-500/15" },
  { name: "SOCCER", icon: Circle, color: "text-teal-400", bg: "bg-teal-500/15" },
];

const TIERS = [
  {
    name: "Contender",
    price: "Free",
    badge: null,
    badgeIcon: null,
    ring: "ring-slate-600",
    features: [
      { text: "Single lineup generation", included: true },
      { text: "DraftKings Classic contests", included: true },
      { text: "All 6 sports supported", included: true },
      { text: "Real-time player projections", included: true },
      { text: "1 saved team per sport", included: true },
      { text: "Multi-lineup generation", included: false },
      { text: "CSV export to DraftKings", included: false },
      { text: "AI boost analysis", included: false },
    ],
  },
  {
    name: "Sharpshooter",
    price: "$19.99/mo",
    badge: "Popular",
    badgeIcon: Trophy,
    ring: "ring-emerald-500/50",
    features: [
      { text: "Everything in Contender", included: true },
      { text: "Generate up to 5 lineups at once", included: true },
      { text: "20 saved teams per sport", included: true },
      { text: "CSV export for DraftKings upload", included: true },
      { text: "Lock & exclude player controls", included: true },
      { text: "5 AI prop picks per sport", included: true },
      { text: "Advanced exposure settings", included: false },
      { text: "Ownership projections", included: false },
    ],
  },
  {
    name: "Champion",
    price: "$49.99/mo",
    badge: "Best Value",
    badgeIcon: Crown,
    ring: "ring-amber-500/50",
    features: [
      { text: "Everything in Sharpshooter", included: true },
      { text: "Generate up to 20 lineups at once", included: true },
      { text: "150 saved teams per sport", included: true },
      { text: "Advanced exposure controls", included: true },
      { text: "AI boost analysis & injury tracking", included: true },
      { text: "Ownership projections & player fading", included: true },
      { text: "15 AI prop picks per sport", included: true },
      { text: "PrizePicks Builder with live lines", included: true },
    ],
  },
];

const HOW_IT_WORKS = [
  {
    step: "1",
    title: "Choose Your Slate",
    description: "Select from active DraftKings contests across NBA, NHL, MLB, NFL, GOLF, and SOCCER.",
  },
  {
    step: "2",
    title: "Customize Your Pool",
    description: "Lock in must-play players, exclude bad matchups, and set salary and position constraints.",
  },
  {
    step: "3",
    title: "Optimize & Export",
    description: "Our LP engine generates mathematically optimal lineups based on projections, value scores, and correlations.",
  },
];

export default function LineupBuilderInfo() {
  return (
    <div className="bg-[#0F172A] min-h-screen" data-testid="lineup-builder-info-page">
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-emerald-950/40 via-[#0F172A] to-[#0F172A]" />
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-gradient-to-bl from-emerald-500/8 via-transparent to-transparent rounded-full" />
        <div className="relative z-10 container mx-auto px-4 py-20 md:py-28">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 mb-6">
              <div className="w-8 h-8 bg-emerald-500/20 rounded-lg flex items-center justify-center">
                <BarChart3 className="w-4 h-4 text-emerald-400" />
              </div>
              <span className="text-emerald-400 text-sm font-black uppercase tracking-widest" data-testid="text-page-label">Lineup Builder</span>
            </div>
            <h1 className="text-4xl md:text-5xl font-black text-white tracking-tight leading-tight mb-6" data-testid="text-page-heading">
              AI-Optimized Lineups.{" "}
              <span className="text-emerald-400">Maximum Edge.</span>
            </h1>
            <p className="text-lg text-slate-300 leading-relaxed max-w-2xl" data-testid="text-page-description">
              Our Linear Programming engine analyzes thousands of player projections, salary values, and correlations to build mathematically optimal DraftKings lineups — so you can spend less time crunching numbers and more time winning.
            </p>
          </div>
        </div>
      </div>

      <section className="container mx-auto px-4 pb-20" data-testid="section-how-it-works">
        <div className="flex items-center gap-2.5 mb-8">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500/30 to-blue-500/20 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-cyan-400" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-white tracking-tight">How It Works</h2>
            <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">Three steps to winning lineups</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {HOW_IT_WORKS.map((item) => (
            <Card key={item.step} className="bg-slate-800/40 border-border p-6 relative overflow-hidden" data-testid={`card-step-${item.step}`}>
              <div className="absolute top-4 right-4 text-5xl font-black text-slate-800/60">{item.step}</div>
              <div className="relative z-10">
                <h3 className="text-lg font-black text-white mb-2">{item.title}</h3>
                <p className="text-sm text-slate-400 leading-relaxed">{item.description}</p>
              </div>
            </Card>
          ))}
        </div>
      </section>

      <section className="container mx-auto px-4 pb-20" data-testid="section-sports">
        <div className="flex items-center gap-2.5 mb-8">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500/30 to-violet-500/20 flex items-center justify-center">
            <Shield className="w-4 h-4 text-purple-400" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-white tracking-tight">Supported Sports</h2>
            <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">Optimize lineups across every major league</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-4">
          {SPORTS.map((sport) => {
            const Icon = sport.icon;
            return (
              <div key={sport.name} className={`${sport.bg} rounded-xl px-6 py-4 flex items-center gap-3 border border-slate-700/40`} data-testid={`badge-sport-${sport.name.toLowerCase()}`}>
                <Icon className={`w-6 h-6 ${sport.color}`} />
                <span className="text-white font-black text-sm tracking-wide">{sport.name}</span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="container mx-auto px-4 pb-20" data-testid="section-tiers">
        <div className="flex items-center gap-2.5 mb-8">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500/30 to-orange-500/20 flex items-center justify-center">
            <Layers className="w-4 h-4 text-amber-400" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-white tracking-tight">Choose Your Plan</h2>
            <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">More power at every tier</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {TIERS.map((tier) => {
            const BadgeIcon = tier.badgeIcon;
            return (
              <Card key={tier.name} className={`bg-slate-800/40 border-border p-6 relative overflow-hidden ${tier.badge ? `ring-1 ${tier.ring}` : ""}`} data-testid={`tier-card-${tier.name.toLowerCase()}`}>
                {tier.badge && BadgeIcon && (
                  <Badge className="absolute top-4 right-4 bg-emerald-500/15 text-emerald-400 border-emerald-500/25 text-[10px] font-black gap-1">
                    <BadgeIcon className="w-3 h-3" /> {tier.badge}
                  </Badge>
                )}
                <h3 className="text-xl font-black text-white mb-1">{tier.name}</h3>
                <p className="text-2xl font-black text-emerald-400 mb-5">{tier.price}</p>
                <ul className="space-y-3">
                  {tier.features.map((feature, idx) => (
                    <li key={idx} className="flex items-start gap-2.5">
                      {feature.included ? (
                        <Check className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                      ) : (
                        <X className="w-4 h-4 text-slate-600 mt-0.5 shrink-0" />
                      )}
                      <span className={`text-sm ${feature.included ? "text-slate-300" : "text-slate-600"}`}>{feature.text}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>
      </section>

      <section className="container mx-auto px-4 pb-20" data-testid="section-cta">
        <div className="relative rounded-xl overflow-hidden p-8 md:p-12">
          <div className="absolute inset-0 bg-gradient-to-r from-emerald-950/60 via-slate-900/80 to-cyan-950/50" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,_var(--tw-gradient-stops))] from-emerald-500/10 via-transparent to-cyan-500/10" />
          <div className="relative z-10 text-center max-w-xl mx-auto">
            <h2 className="text-2xl md:text-3xl font-black text-white mb-4" data-testid="text-cta-heading">Ready to Build Winning Lineups?</h2>
            <p className="text-slate-300 mb-6">
              Sign up for free and start optimizing your DraftKings lineups today. Upgrade anytime to unlock multi-lineup generation, CSV export, and advanced tools.
            </p>
            <div className="flex items-center justify-center gap-4 flex-wrap">
              <Link href="/login">
                <Button className="bg-emerald-500 text-white font-bold gap-2 shadow-lg shadow-emerald-500/20" data-testid="button-get-started">
                  Get Started Free <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
              <Link href="/pricing">
                <Button variant="outline" className="font-bold gap-2" data-testid="button-view-pricing">
                  View Full Pricing
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Target, ArrowRight, ArrowUpRight, ArrowDownRight, Star, Flame,
  Crown, Trophy, Check, X, Zap, Sparkles, TrendingUp, Shield,
  Clock, BarChart3, Layers
} from "lucide-react";

const TIERS = [
  {
    name: "Contender",
    price: "Free",
    badge: null,
    badgeIcon: null,
    ring: "",
    features: [
      { text: "AI-generated prop picks daily", included: true },
      { text: "Up to 2 picks per sport", included: true },
      { text: "Confidence star ratings", included: true },
      { text: "All active sports covered", included: true },
      { text: "5+ picks per sport", included: false },
      { text: "Gold & Hot Pick tiers", included: false },
      { text: "Parlay Builder access", included: false },
      { text: "PrizePicks Builder access", included: false },
    ],
  },
  {
    name: "Sharpshooter",
    price: "$19.99/mo",
    badge: "Popular",
    badgeIcon: Trophy,
    ring: "ring-1 ring-emerald-500/50",
    features: [
      { text: "Everything in Contender", included: true },
      { text: "Up to 5 picks per sport", included: true },
      { text: "Gold & Hot Pick access", included: true },
      { text: "Higher confidence picks unlocked", included: true },
      { text: "Parlay Builder access", included: false },
      { text: "PrizePicks Builder access", included: false },
      { text: "15 picks per sport", included: false },
      { text: "AI-powered prop analysis", included: false },
    ],
  },
  {
    name: "Champion",
    price: "$39.99/mo",
    badge: "Best Value",
    badgeIcon: Crown,
    ring: "ring-1 ring-amber-500/50",
    features: [
      { text: "Everything in Sharpshooter", included: true },
      { text: "Up to 15 picks per sport", included: true },
      { text: "Full access to all confidence tiers", included: true },
      { text: "Parlay Builder tool", included: true },
      { text: "PrizePicks Builder with live lines", included: true },
      { text: "AI-powered prop analysis & insights", included: true },
      { text: "PrizePicks entry optimization", included: true },
      { text: "Vault tracking for PrizePicks entries", included: true },
    ],
  },
];

const FEATURES = [
  {
    icon: Star,
    title: "Confidence Ratings",
    description: "Every pick is rated on a 5-star confidence scale powered by our AI model. Gold-star picks represent our highest-conviction plays of the day.",
    color: "text-amber-400",
    bg: "from-amber-500/20 to-amber-500/5",
  },
  {
    icon: TrendingUp,
    title: "Daily AI Analysis",
    description: "Our algorithm processes player stats, matchup data, injury reports, and line movement to generate fresh picks every day across all active sports.",
    color: "text-emerald-400",
    bg: "from-emerald-500/20 to-emerald-500/5",
  },
  {
    icon: BarChart3,
    title: "Parlay Builder",
    description: "Combine multiple prop picks into correlated parlays. Our system identifies which picks pair well together for higher expected value.",
    color: "text-cyan-400",
    bg: "from-cyan-500/20 to-cyan-500/5",
  },
  {
    icon: Layers,
    title: "PrizePicks Integration",
    description: "Build optimized PrizePicks entries using live projection data. Find the best player combos backed by statistical analysis and trend data.",
    color: "text-purple-400",
    bg: "from-purple-500/20 to-purple-500/5",
  },
];

const PICK_TIERS = [
  {
    icon: Star,
    label: "Gold Pick",
    sublabel: "Today's Top Pick",
    description: "78%+ confidence — our highest conviction play of the day for each sport.",
    iconColor: "text-yellow-400 fill-yellow-400",
    bgColor: "bg-yellow-400/10 border-yellow-500/20",
  },
  {
    icon: Flame,
    label: "Hot Pick",
    sublabel: "High Confidence",
    description: "68-77% confidence — strong plays backed by favorable matchups and recent trends.",
    iconColor: "text-orange-400",
    bgColor: "bg-orange-400/10 border-orange-500/20",
  },
  {
    icon: Target,
    label: "Standard Pick",
    sublabel: "Solid Value",
    description: "Below 68% confidence — viable plays with positive expected value based on the data.",
    iconColor: "text-emerald-400",
    bgColor: "bg-emerald-400/10 border-emerald-500/20",
  },
];

export default function PropInsightsInfo() {
  return (
    <div className="bg-[#0F172A] min-h-screen" data-testid="prop-insights-info-page">
      <div className="relative overflow-hidden">
        <img src="/images/props-hero.png" alt="" className="absolute inset-0 w-full h-full object-cover opacity-20" />
        <div className="absolute inset-0 bg-gradient-to-b from-amber-950/60 via-[#0F172A]/90 to-[#0F172A]" />
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-gradient-to-bl from-amber-500/6 via-transparent to-transparent rounded-full" />
        <div className="relative z-10 container mx-auto px-4 py-20 md:py-28">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 mb-6">
              <div className="w-8 h-8 bg-amber-500/20 rounded-lg flex items-center justify-center">
                <Target className="w-4 h-4 text-amber-400" />
              </div>
              <span className="text-amber-400 text-sm font-black uppercase tracking-widest" data-testid="text-page-label">Prop Insights</span>
            </div>
            <h1 className="text-4xl md:text-5xl font-black text-white tracking-tight leading-tight mb-6" data-testid="text-page-heading">
              AI-Powered Prop Picks.{" "}
              <span className="text-amber-400">Every Sport. Every Day.</span>
            </h1>
            <p className="text-lg text-slate-300 leading-relaxed max-w-2xl" data-testid="text-page-description">
              Our prop betting system analyzes player projections, matchup data, injury reports, and historical trends to deliver confidence-rated picks across NBA, NHL, MLB, NFL, GOLF, and SOCCER — updated daily.
            </p>
          </div>
        </div>
      </div>

      <section className="container mx-auto px-4 pb-20" data-testid="section-pick-tiers">
        <div className="flex items-center gap-2.5 mb-8">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-yellow-500/30 to-orange-500/20 flex items-center justify-center">
            <Star className="w-4 h-4 text-yellow-400 fill-yellow-400" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-white tracking-tight">Pick Confidence Tiers</h2>
            <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">How we rate our picks</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {PICK_TIERS.map((tier) => {
            const Icon = tier.icon;
            return (
              <Card key={tier.label} className={`${tier.bgColor} border p-6`} data-testid={`card-pick-tier-${tier.label.toLowerCase().replace(/\s+/g, "-")}`}>
                <div className="flex items-center gap-3 mb-3">
                  <Icon className={`w-7 h-7 ${tier.iconColor}`} />
                  <div>
                    <h3 className="text-base font-black text-white">{tier.label}</h3>
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{tier.sublabel}</p>
                  </div>
                </div>
                <p className="text-sm text-slate-300 leading-relaxed">{tier.description}</p>
              </Card>
            );
          })}
        </div>
      </section>

      <section className="container mx-auto px-4 pb-20" data-testid="section-features">
        <div className="flex items-center gap-2.5 mb-8">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500/30 to-cyan-500/20 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-white tracking-tight">What's Included</h2>
            <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">Tools for smarter prop betting</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {FEATURES.map((feature) => {
            const Icon = feature.icon;
            return (
              <Card key={feature.title} className="bg-slate-800/40 border-border p-6 relative overflow-hidden" data-testid={`card-feature-${feature.title.toLowerCase().replace(/\s+/g, "-")}`}>
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

      <section className="container mx-auto px-4 pb-20" data-testid="section-tiers">
        <div className="flex items-center gap-2.5 mb-8">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500/30 to-orange-500/20 flex items-center justify-center">
            <Crown className="w-4 h-4 text-amber-400" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-white tracking-tight">Picks by Plan</h2>
            <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">Unlock more picks as you level up</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {TIERS.map((tier) => {
            const BadgeIcon = tier.badgeIcon;
            return (
              <Card key={tier.name} className={`bg-slate-800/40 border-border p-6 relative overflow-hidden ${tier.ring}`} data-testid={`tier-card-${tier.name.toLowerCase()}`}>
                {tier.badge && BadgeIcon && (
                  <Badge className="absolute top-4 right-4 bg-emerald-500/15 text-emerald-400 border-emerald-500/25 text-[10px] font-black gap-1">
                    <BadgeIcon className="w-3 h-3" /> {tier.badge}
                  </Badge>
                )}
                <h3 className="text-xl font-black text-white mb-1">{tier.name}</h3>
                <p className="text-2xl font-black text-amber-400 mb-5">{tier.price}</p>
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
          <div className="absolute inset-0 bg-gradient-to-r from-amber-950/50 via-slate-900/80 to-emerald-950/40" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,_var(--tw-gradient-stops))] from-amber-500/10 via-transparent to-emerald-500/10" />
          <div className="relative z-10 text-center max-w-xl mx-auto">
            <h2 className="text-2xl md:text-3xl font-black text-white mb-4" data-testid="text-cta-heading">Start Getting Smarter Picks Today</h2>
            <p className="text-slate-300 mb-6">
              Sign up for free and get daily AI-generated prop picks. Upgrade to unlock more picks per sport, the Parlay Builder, and PrizePicks integration.
            </p>
            <div className="flex items-center justify-center gap-4 flex-wrap">
              <Link href="/login">
                <Button className="bg-amber-500 text-black font-bold gap-2 shadow-lg shadow-amber-500/20" data-testid="button-get-started">
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

import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, Crown, Zap, Lock, Trophy, Sparkles, Layers, Calendar, Tag } from "lucide-react";

type BillingCycle = "monthly" | "annual";

export default function Pricing() {
  const { user } = useAuth();
  const [billing, setBilling] = useState<BillingCycle>("monthly");

  const { data: subData } = useQuery<{ tier: string; lineupCount: number; maxLineups: number }>({
    queryKey: ["/api/subscription"],
    enabled: !!user,
  });

  const currentTier = subData?.tier || "free";

  const starPrice = billing === "monthly" ? "$19.99" : "$200";
  const starPeriod = billing === "monthly" ? "/month" : "/year";
  const starFirstMonth = billing === "monthly" ? "$9.99" : null;
  const starSavings = billing === "annual" ? "Save $39.88/yr" : null;

  const proPrice = billing === "monthly" ? "$49.99" : "$499";
  const proPeriod = billing === "monthly" ? "/month" : "/year";
  const proFirstMonth = billing === "monthly" ? "$29.99" : null;
  const proSavings = billing === "annual" ? "Save $100.88/yr" : null;

  return (
    <div className="container mx-auto px-4 py-16 max-w-6xl">
      <div className="text-center mb-12">
        <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/20 font-bold text-sm px-3 py-1 mb-6">
          <Crown className="w-4 h-4 mr-1" /> Pricing
        </Badge>
        <h1 className="text-5xl font-black text-white mb-4 tracking-tight" data-testid="pricing-title">
          Choose Your Edge
        </h1>
        <p className="text-lg text-slate-400 max-w-xl mx-auto mb-8">
          Start with the Basic plan, then level up your DFS strategy with more lineups and powerful tools.
        </p>

        <div className="inline-flex items-center bg-slate-800/60 rounded-xl p-1 border border-slate-700/50" data-testid="billing-toggle">
          <button
            onClick={() => setBilling("monthly")}
            className={`px-5 py-2.5 rounded-lg text-sm font-bold transition-all ${
              billing === "monthly"
                ? "bg-emerald-500 text-black shadow-lg"
                : "text-slate-400 hover:text-white"
            }`}
            data-testid="billing-monthly"
          >
            Monthly
          </button>
          <button
            onClick={() => setBilling("annual")}
            className={`px-5 py-2.5 rounded-lg text-sm font-bold transition-all flex items-center gap-1.5 ${
              billing === "annual"
                ? "bg-emerald-500 text-black shadow-lg"
                : "text-slate-400 hover:text-white"
            }`}
            data-testid="billing-annual"
          >
            Annual
            <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-[10px] font-black px-1.5 py-0">SAVE</Badge>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
        <Card className={`bg-slate-800/30 border-slate-800 p-8 relative ${currentTier === "free" ? "ring-2 ring-slate-600" : ""}`} data-testid="plan-basic">
          {currentTier === "free" && (
            <Badge className="absolute -top-3 left-6 bg-slate-700 text-slate-300 text-[11px] font-black">CURRENT PLAN</Badge>
          )}
          <div className="mb-6">
            <h3 className="text-2xl font-black text-white mb-2">Basic</h3>
            <div className="flex items-baseline gap-1">
              <span className="text-4xl font-black text-white">$0</span>
              <span className="text-slate-400 font-bold">/month</span>
            </div>
            <p className="text-xs text-slate-500 mt-2">Get started with the basics</p>
          </div>
          <ul className="space-y-3 mb-8">
            <li className="flex items-center gap-3 text-sm text-slate-300">
              <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <span>1 saved team per sport</span>
            </li>
            <li className="flex items-center gap-3 text-sm text-slate-300">
              <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <span>DraftKings & FanDuel support</span>
            </li>
            <li className="flex items-center gap-3 text-sm text-slate-300">
              <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <span>LP-based optimization</span>
            </li>
            <li className="flex items-center gap-3 text-sm text-slate-300">
              <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <span>Lock & exclude players</span>
            </li>
            <li className="flex items-center gap-3 text-sm text-slate-300">
              <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <span>2 AI prop picks per sport</span>
            </li>
            <li className="flex items-center gap-3 text-sm text-slate-400">
              <Lock className="w-4 h-4 text-slate-500 flex-shrink-0" />
              <span>No CSV export</span>
            </li>
            <li className="flex items-center gap-3 text-sm text-slate-400">
              <Lock className="w-4 h-4 text-slate-500 flex-shrink-0" />
              <span>No multi-lineup generation</span>
            </li>
            <li className="flex items-center gap-3 text-sm text-slate-400">
              <Lock className="w-4 h-4 text-slate-500 flex-shrink-0" />
              <span>No AI boost analysis</span>
            </li>
            <li className="flex items-center gap-3 text-sm text-slate-400">
              <Lock className="w-4 h-4 text-slate-500 flex-shrink-0" />
              <span>No ownership projections</span>
            </li>
          </ul>
          <Button variant="outline" className="w-full h-12 border-slate-700 text-slate-400 font-bold" disabled>
            {currentTier === "free" ? "Current Plan" : "Basic Plan"}
          </Button>
        </Card>

        <Card className={`bg-slate-800/30 border-emerald-500/30 p-8 relative ${currentTier === "star" ? "ring-2 ring-emerald-500" : ""}`} data-testid="plan-star">
          {currentTier === "star" ? (
            <Badge className="absolute -top-3 left-6 bg-emerald-500 text-black text-[11px] font-black">CURRENT PLAN</Badge>
          ) : currentTier === "free" ? (
            <Badge className="absolute -top-3 left-6 bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[11px] font-black">POPULAR</Badge>
          ) : null}
          <div className="mb-6">
            <h3 className="text-2xl font-black text-white mb-2 flex items-center gap-2">
              Star <Trophy className="w-5 h-5 text-emerald-400" />
            </h3>
            <div className="flex items-baseline gap-1">
              <span className="text-4xl font-black text-white" data-testid="star-price">{starPrice}</span>
              <span className="text-slate-400 font-bold">{starPeriod}</span>
            </div>
            {starFirstMonth && (
              <div className="flex items-center gap-2 mt-2">
                <Tag className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-xs font-bold text-emerald-400" data-testid="star-first-month">First month only {starFirstMonth}</span>
              </div>
            )}
            {starSavings && (
              <div className="flex items-center gap-2 mt-2">
                <Calendar className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-xs font-bold text-emerald-400" data-testid="star-savings">{starSavings}</span>
              </div>
            )}
            <p className="text-xs text-emerald-400/70 mt-2">For serious DFS players</p>
          </div>
          <ul className="space-y-3 mb-8">
            <li className="flex items-center gap-3 text-sm text-slate-300">
              <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <span className="font-bold">20 saved teams per sport</span>
            </li>
            <li className="flex items-center gap-3 text-sm text-slate-300">
              <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <span>DraftKings & FanDuel support</span>
            </li>
            <li className="flex items-center gap-3 text-sm text-slate-300">
              <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <span>LP-based optimization</span>
            </li>
            <li className="flex items-center gap-3 text-sm text-slate-300">
              <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <span>Lock & exclude players</span>
            </li>
            <li className="flex items-center gap-3 text-sm text-slate-300">
              <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <span className="font-bold">Up to 5 AI prop picks per sport</span>
            </li>
            <li className="flex items-center gap-3 text-sm text-slate-300">
              <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <span className="font-bold">CSV export to DK & FD</span>
            </li>
            <li className="flex items-center gap-3 text-sm text-slate-300">
              <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <span className="font-bold">Multi-lineup generation (up to 5)</span>
            </li>
            <li className="flex items-center gap-3 text-sm text-slate-400">
              <Lock className="w-4 h-4 text-slate-500 flex-shrink-0" />
              <span>No AI boost analysis</span>
            </li>
            <li className="flex items-center gap-3 text-sm text-slate-400">
              <Lock className="w-4 h-4 text-slate-500 flex-shrink-0" />
              <span>No ownership projections</span>
            </li>
          </ul>
          {currentTier === "star" ? (
            <Button className="w-full h-12 bg-emerald-500 hover:bg-emerald-600 text-black font-black" disabled>
              <Trophy className="w-4 h-4 mr-2" /> Active
            </Button>
          ) : currentTier === "pro" ? (
            <Button variant="outline" className="w-full h-12 border-slate-700 text-slate-400 font-bold" disabled>
              Included in Pro
            </Button>
          ) : (
            <>
              <Button
                className="w-full h-12 bg-emerald-500 hover:bg-emerald-600 text-black font-black shadow-lg shadow-emerald-500/20"
                data-testid="upgrade-star-btn"
                disabled
              >
                <Trophy className="w-4 h-4 mr-2" /> Coming Soon
              </Button>
              <p className="text-[11px] text-slate-400 text-center mt-2">Payment integration coming soon</p>
            </>
          )}
        </Card>

        <Card className={`bg-slate-800/30 border-amber-500/30 p-8 relative ${currentTier === "pro" ? "ring-2 ring-amber-500" : ""}`} data-testid="plan-pro">
          {currentTier === "pro" ? (
            <Badge className="absolute -top-3 left-6 bg-amber-500 text-black text-[11px] font-black">CURRENT PLAN</Badge>
          ) : (
            <Badge className="absolute -top-3 left-6 bg-amber-500/20 text-amber-400 border-amber-500/30 text-[11px] font-black">MAX EDGE</Badge>
          )}
          <div className="mb-6">
            <h3 className="text-2xl font-black text-white mb-2 flex items-center gap-2">
              Pro <Sparkles className="w-5 h-5 text-amber-400" />
            </h3>
            <div className="flex items-baseline gap-1">
              <span className="text-4xl font-black text-white" data-testid="pro-price">{proPrice}</span>
              <span className="text-slate-400 font-bold">{proPeriod}</span>
            </div>
            {proFirstMonth && (
              <div className="flex items-center gap-2 mt-2">
                <Tag className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-xs font-bold text-amber-400" data-testid="pro-first-month">First month only {proFirstMonth}</span>
              </div>
            )}
            {proSavings && (
              <div className="flex items-center gap-2 mt-2">
                <Calendar className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-xs font-bold text-amber-400" data-testid="pro-savings">{proSavings}</span>
              </div>
            )}
            <p className="text-xs text-amber-400/70 mt-2">Dominate every slate</p>
          </div>
          <ul className="space-y-3 mb-8">
            <li className="flex items-center gap-3 text-sm text-slate-300">
              <Check className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <span className="font-bold">150 saved teams per sport</span>
            </li>
            <li className="flex items-center gap-3 text-sm text-slate-300">
              <Check className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <span>DraftKings & FanDuel support</span>
            </li>
            <li className="flex items-center gap-3 text-sm text-slate-300">
              <Check className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <span>LP-based optimization</span>
            </li>
            <li className="flex items-center gap-3 text-sm text-slate-300">
              <Check className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <span>Lock & exclude players</span>
            </li>
            <li className="flex items-center gap-3 text-sm text-slate-300">
              <Check className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <span className="font-bold text-amber-300">Up to 15 AI prop picks per sport</span>
            </li>
            <li className="flex items-center gap-3 text-sm text-slate-300">
              <Check className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <span className="font-bold">CSV export to DK & FD</span>
            </li>
            <li className="flex items-center gap-3 text-sm text-slate-300">
              <Check className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <span className="font-bold">Multi-lineup generation (up to 20)</span>
            </li>
            <li className="flex items-center gap-3 text-sm text-slate-300">
              <Check className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <span className="font-bold text-amber-300">AI boost analysis & injury tracking</span>
            </li>
            <li className="flex items-center gap-3 text-sm text-slate-300">
              <Check className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <span className="font-bold text-amber-300">Ownership projections & player fading</span>
            </li>
          </ul>
          {currentTier === "pro" ? (
            <Button className="w-full h-12 bg-amber-500 hover:bg-amber-600 text-black font-black" disabled>
              <Crown className="w-4 h-4 mr-2" /> Active
            </Button>
          ) : (
            <>
              <Button
                className="w-full h-12 bg-amber-500 hover:bg-amber-600 text-black font-black shadow-lg shadow-amber-500/20"
                data-testid="upgrade-pro-btn"
                disabled
              >
                <Crown className="w-4 h-4 mr-2" /> Coming Soon
              </Button>
              <p className="text-[11px] text-slate-400 text-center mt-2">Payment integration coming soon</p>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

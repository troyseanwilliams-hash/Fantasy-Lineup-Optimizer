import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, Crown, Zap, Lock } from "lucide-react";

export default function Pricing() {
  const { user } = useAuth();

  const { data: subData } = useQuery<{ tier: string; lineupCount: number; maxLineups: number }>({
    queryKey: ["/api/subscription"],
    enabled: !!user,
  });

  const currentTier = subData?.tier || "free";

  return (
    <div className="container mx-auto px-4 py-16 max-w-4xl">
      <div className="text-center mb-16">
        <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/20 font-bold text-sm px-3 py-1 mb-6">
          <Crown className="w-4 h-4 mr-1" /> Pricing
        </Badge>
        <h1 className="text-5xl font-black text-white mb-4 tracking-tight">
          Choose Your Plan
        </h1>
        <p className="text-lg text-slate-400 max-w-xl mx-auto">
          Start free with 1 optimized lineup. Upgrade to Pro for unlimited power.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-3xl mx-auto">
        {/* Free Plan */}
        <Card className={`bg-slate-800/30 border-slate-800 p-8 relative ${currentTier === "free" ? "ring-2 ring-slate-600" : ""}`} data-testid="plan-free">
          {currentTier === "free" && (
            <Badge className="absolute -top-3 left-6 bg-slate-700 text-slate-300 text-[10px] font-black">CURRENT PLAN</Badge>
          )}
          <div className="mb-6">
            <h3 className="text-2xl font-black text-white mb-2">Free</h3>
            <div className="flex items-baseline gap-1">
              <span className="text-4xl font-black text-white">$0</span>
              <span className="text-slate-500 font-bold">/month</span>
            </div>
          </div>
          <ul className="space-y-3 mb-8">
            <li className="flex items-center gap-3 text-sm text-slate-300">
              <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <span>1 saved lineup at a time</span>
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
            <li className="flex items-center gap-3 text-sm text-slate-500">
              <Lock className="w-4 h-4 text-slate-600 flex-shrink-0" />
              <span>No CSV export</span>
            </li>
            <li className="flex items-center gap-3 text-sm text-slate-500">
              <Lock className="w-4 h-4 text-slate-600 flex-shrink-0" />
              <span>No multi-lineup generation</span>
            </li>
          </ul>
          {currentTier === "free" ? (
            <Button variant="outline" className="w-full h-12 border-slate-700 text-slate-400 font-bold" disabled>
              Current Plan
            </Button>
          ) : (
            <Button variant="outline" className="w-full h-12 border-slate-700 text-slate-400 font-bold" disabled>
              Included
            </Button>
          )}
        </Card>

        {/* Pro Plan */}
        <Card className={`bg-slate-800/30 border-amber-500/30 p-8 relative ${currentTier === "pro" ? "ring-2 ring-amber-500" : ""}`} data-testid="plan-pro">
          {currentTier === "pro" ? (
            <Badge className="absolute -top-3 left-6 bg-amber-500 text-black text-[10px] font-black">CURRENT PLAN</Badge>
          ) : (
            <Badge className="absolute -top-3 left-6 bg-amber-500/20 text-amber-400 border-amber-500/30 text-[10px] font-black">RECOMMENDED</Badge>
          )}
          <div className="mb-6">
            <h3 className="text-2xl font-black text-white mb-2 flex items-center gap-2">
              Pro <Crown className="w-5 h-5 text-amber-400" />
            </h3>
            <div className="flex items-baseline gap-1">
              <span className="text-4xl font-black text-white">$9.99</span>
              <span className="text-slate-500 font-bold">/month</span>
            </div>
          </div>
          <ul className="space-y-3 mb-8">
            <li className="flex items-center gap-3 text-sm text-slate-300">
              <Check className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <span className="font-bold">Up to 20 saved lineups</span>
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
              <span className="font-bold">CSV lineup export</span>
            </li>
            <li className="flex items-center gap-3 text-sm text-slate-300">
              <Check className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <span className="font-bold">Multi-lineup generation</span>
            </li>
          </ul>
          {currentTier === "pro" ? (
            <Button className="w-full h-12 bg-amber-500 hover:bg-amber-600 text-black font-black" disabled>
              <Crown className="w-4 h-4 mr-2" /> Active
            </Button>
          ) : (
            <Button
              className="w-full h-12 bg-amber-500 hover:bg-amber-600 text-black font-black shadow-lg shadow-amber-500/20"
              data-testid="upgrade-pro-btn"
              onClick={() => {
                window.location.href = "/api/create-checkout";
              }}
            >
              <Crown className="w-4 h-4 mr-2" /> Upgrade to Pro
            </Button>
          )}
        </Card>
      </div>
    </div>
  );
}

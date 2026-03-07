import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Check, Crown, Lock, Trophy, Sparkles, Calendar, Tag, Loader2, AlertTriangle, CreditCard, Gift } from "lucide-react";
import { PaymentModal } from "@/components/PaymentForm";

type BillingCycle = "monthly" | "annual";

export default function Pricing() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [billing, setBilling] = useState<BillingCycle>("monthly");
  const [paymentTier, setPaymentTier] = useState<"star" | "pro" | null>(null);

  const { data: subData } = useQuery<{
    tier: string;
    status: string;
    lineupCount: number;
    maxLineups: number;
    graceEndsAt: string | null;
    stripeSubscriptionId: string | null;
    currentPeriodEnd: string | null;
  }>({
    queryKey: ["/api/subscription"],
    enabled: !!user,
  });

  const currentTier = subData?.tier || "free";
  const subStatus = subData?.status || "active";
  const hasActiveStripeSubscription = !!subData?.stripeSubscriptionId && subStatus !== "incomplete" && subStatus !== "canceled";
  const isTrialing = subStatus === "trialing";
  const trialEligible = !hasActiveStripeSubscription;
  const graceEndsAt = subData?.graceEndsAt ? new Date(subData.graceEndsAt) : null;
  const daysLeft = graceEndsAt ? Math.max(0, Math.ceil((graceEndsAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24))) : null;
  const trialEndsAt = isTrialing && subData?.currentPeriodEnd ? new Date(subData.currentPeriodEnd) : null;
  const trialDaysLeft = trialEndsAt ? Math.max(0, Math.ceil((trialEndsAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24))) : null;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("success") === "true") {
      toast({
        title: "Subscription Activated",
        description: "Your plan has been upgraded successfully. Enjoy your new features!",
      });
      window.history.replaceState({}, "", "/pricing");
    } else if (params.get("canceled") === "true") {
      toast({
        title: "Checkout Canceled",
        description: "No charges were made. You can upgrade anytime.",
        variant: "destructive",
      });
      window.history.replaceState({}, "", "/pricing");
    }
  }, []);

  const openPaymentForm = (tier: "star" | "pro") => {
    if (!user) {
      window.location.href = "/login";
      return;
    }
    setPaymentTier(tier);
  };

  const portalMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/subscription/portal");
      return res.json();
    },
    onSuccess: (data: { url: string }) => {
      window.location.href = data.url;
    },
    onError: (error: Error) => {
      toast({
        title: "Portal Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const starPrice = billing === "monthly" ? "$19.99" : "$200";
  const starPeriod = billing === "monthly" ? "/month" : "/year";
  const starSavings = billing === "annual" ? "Save $39.88/yr" : null;

  const proPrice = billing === "monthly" ? "$49.99" : "$500";
  const proPeriod = billing === "monthly" ? "/month" : "/year";
  const proSavings = billing === "annual" ? "Save $99.88/yr" : null;

  return (
    <div className="container mx-auto px-4 py-16 max-w-6xl">
      {isTrialing && trialEndsAt && (
        <div className="mb-8 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-start gap-3 max-w-3xl mx-auto" data-testid="trial-banner">
          <Gift className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-emerald-300">
              Free trial — {trialDaysLeft} day{trialDaysLeft !== 1 ? "s" : ""} remaining
            </p>
            <p className="text-xs text-emerald-400/70 mt-1">
              Your {currentTier === "pro" ? "Champion" : "Sharpshooter"} trial ends on {trialEndsAt.toLocaleDateString()}. You'll be charged automatically after the trial unless you cancel.
            </p>
          </div>
        </div>
      )}

      {graceEndsAt && !hasActiveStripeSubscription && currentTier !== "free" && !isTrialing && (
        <div className="mb-8 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-3 max-w-3xl mx-auto" data-testid="grace-period-banner">
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-amber-300">
              Your access expires in {daysLeft} day{daysLeft !== 1 ? "s" : ""}
            </p>
            <p className="text-xs text-amber-400/70 mt-1">
              Subscribe before {graceEndsAt.toLocaleDateString()} to keep your {currentTier === "pro" ? "Champion" : "Sharpshooter"} features. After that, your account will revert to the Contender plan.
            </p>
          </div>
        </div>
      )}

      <div className="text-center mb-12">
        <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/20 font-bold text-sm px-3 py-1 mb-6">
          <Crown className="w-4 h-4 mr-1" /> Pricing
        </Badge>
        <h1 className="text-5xl font-black text-white mb-4 tracking-tight" data-testid="pricing-title">
          Choose Your Edge
        </h1>
        <p className="text-lg text-slate-400 max-w-xl mx-auto mb-8">
          Start with the Contender plan, then level up your DFS strategy with more lineups and powerful tools.
        </p>

        <div className="inline-flex items-center bg-slate-800/60 rounded-xl p-1 border border-border/50" data-testid="billing-toggle">
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
        <Card className={`bg-slate-800/30 border-border p-8 relative ${currentTier === "free" ? "ring-2 ring-slate-600" : ""}`} data-testid="plan-basic">
          {currentTier === "free" && (
            <Badge className="absolute -top-3 left-6 bg-slate-700 text-slate-300 text-[11px] font-black">CURRENT PLAN</Badge>
          )}
          <div className="mb-6">
            <h3 className="text-2xl font-black text-white mb-2">Contender</h3>
            <div className="flex items-baseline gap-1">
              <span className="text-4xl font-black text-white">$0</span>
              <span className="text-slate-400 font-bold">/month</span>
            </div>
            <p className="text-xs text-slate-500 mt-2">Get started as a contender</p>
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
            
          </ul>
          <Button variant="outline" className="w-full h-12 border-slate-700 text-slate-400 font-bold" disabled data-testid="basic-plan-btn">
            {currentTier === "free" ? "Current Plan" : "Contender Plan"}
          </Button>
        </Card>

        <Card className={`bg-[#1E293B] border-emerald-500/30 p-8 relative ${currentTier === "star" ? "ring-2 ring-emerald-500" : ""}`} data-testid="plan-star">

          {currentTier === "star" ? (
            <Badge className="absolute -top-3 left-6 bg-emerald-500 text-black text-[11px] font-black">CURRENT PLAN</Badge>
          ) : currentTier === "free" ? (
            <Badge className="absolute -top-3 left-6 bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[11px] font-black">POPULAR</Badge>
          ) : null}
          <div className="mb-6">
            <h3 className="text-2xl font-black text-white mb-2 flex items-center gap-2">
              Sharpshooter <Trophy className="w-5 h-5 text-emerald-400" />
            </h3>
            <div className="flex items-baseline gap-1">
              <span className="text-4xl font-black text-white" data-testid="star-price">{starPrice}</span>
              <span className="text-slate-400 font-bold">{starPeriod}</span>
            </div>
            {starSavings && (
              <div className="flex items-center gap-2 mt-2">
                <Calendar className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-xs font-bold text-emerald-400" data-testid="star-savings">{starSavings}</span>
              </div>
            )}
            <p className="text-xs text-emerald-400/70 mt-2">For serious DFS sharpshooters</p>
            {currentTier === "free" && trialEligible && (
              <div className="flex items-center gap-1.5 mt-2">
                <Gift className="w-3 h-3 text-emerald-400" />
                <span className="text-xs font-bold text-emerald-300">7-day free trial</span>
              </div>
            )}
            {isTrialing && currentTier === "star" && trialDaysLeft !== null && (
              <div className="flex items-center gap-1.5 mt-2">
                <Gift className="w-3 h-3 text-emerald-400" />
                <span className="text-xs font-bold text-emerald-300">Trial — {trialDaysLeft} day{trialDaysLeft !== 1 ? "s" : ""} left</span>
              </div>
            )}
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
              <span className="font-bold">CSV export to DraftKings</span>
            </li>
            <li className="flex items-center gap-3 text-sm text-slate-300">
              <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <span className="font-bold">Multi-lineup generation (up to 5)</span>
            </li>
            
            <li className="flex items-center gap-3 text-sm text-slate-400">
              <Lock className="w-4 h-4 text-slate-500 flex-shrink-0" />
              <span>No AI boost analysis</span>
            </li>
          </ul>
          {currentTier === "star" && hasActiveStripeSubscription ? (
            <Button
              className="w-full h-12 bg-emerald-500 hover:bg-emerald-600 text-black font-black"
              onClick={() => portalMutation.mutate()}
              disabled={portalMutation.isPending}
              data-testid="manage-star-btn"
            >
              {portalMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CreditCard className="w-4 h-4 mr-2" />}
              Manage Subscription
            </Button>
          ) : currentTier === "star" && !hasActiveStripeSubscription ? (
            <Button
              className="w-full h-12 bg-emerald-500 hover:bg-emerald-600 text-black font-black"
              onClick={() => openPaymentForm("star")}
              data-testid="subscribe-star-btn"
            >
              <Trophy className="w-4 h-4 mr-2" />
              Subscribe Now
            </Button>
          ) : currentTier === "pro" ? (
            <Button variant="outline" className="w-full h-12 border-slate-700 text-slate-400 font-bold" disabled>
              Included in Champion
            </Button>
          ) : (
            <Button
              className="w-full h-12 bg-emerald-500 hover:bg-emerald-600 text-black font-black shadow-lg shadow-emerald-500/20"
              data-testid="upgrade-star-btn"
              onClick={() => openPaymentForm("star")}
            >
              {trialEligible ? (
                <><Gift className="w-4 h-4 mr-2" />Start Free Trial</>
              ) : (
                <><Trophy className="w-4 h-4 mr-2" />Upgrade to Sharpshooter</>
              )}
            </Button>
          )}
        </Card>

        <Card className={`bg-[#1E293B] border-amber-500/30 p-8 relative ${currentTier === "pro" ? "ring-2 ring-amber-500" : ""}`} data-testid="plan-pro">
          {currentTier === "pro" ? (
            <Badge className="absolute -top-3 left-6 bg-amber-500 text-black text-[11px] font-black">CURRENT PLAN</Badge>
          ) : (
            <Badge className="absolute -top-3 left-6 bg-amber-500/20 text-amber-400 border-amber-500/30 text-[11px] font-black">MAX EDGE</Badge>
          )}
          <div className="mb-6">
            <h3 className="text-2xl font-black text-white mb-2 flex items-center gap-2">
              Champion <Sparkles className="w-5 h-5 text-amber-400" />
            </h3>
            <div className="flex items-baseline gap-1">
              <span className="text-4xl font-black text-white" data-testid="pro-price">{proPrice}</span>
              <span className="text-slate-400 font-bold">{proPeriod}</span>
            </div>
            {proSavings && (
              <div className="flex items-center gap-2 mt-2">
                <Calendar className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-xs font-bold text-amber-400" data-testid="pro-savings">{proSavings}</span>
              </div>
            )}
            <p className="text-xs text-amber-400/70 mt-2">Dominate every slate like a champion</p>
            {currentTier !== "pro" && trialEligible && (
              <div className="flex items-center gap-1.5 mt-2">
                <Gift className="w-3 h-3 text-amber-400" />
                <span className="text-xs font-bold text-amber-300">7-day free trial</span>
              </div>
            )}
            {isTrialing && currentTier === "pro" && trialDaysLeft !== null && (
              <div className="flex items-center gap-1.5 mt-2">
                <Gift className="w-3 h-3 text-amber-400" />
                <span className="text-xs font-bold text-amber-300">Trial — {trialDaysLeft} day{trialDaysLeft !== 1 ? "s" : ""} left</span>
              </div>
            )}
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
              <span className="font-bold">CSV export to DraftKings</span>
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
              <span className="font-bold text-amber-300">PrizePicks Builder with live lines</span>
            </li>
          </ul>
          {currentTier === "pro" && hasActiveStripeSubscription ? (
            <Button
              className="w-full h-12 bg-amber-500 hover:bg-amber-600 text-black font-black"
              onClick={() => portalMutation.mutate()}
              disabled={portalMutation.isPending}
              data-testid="manage-pro-btn"
            >
              {portalMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CreditCard className="w-4 h-4 mr-2" />}
              Manage Subscription
            </Button>
          ) : currentTier === "pro" && !hasActiveStripeSubscription ? (
            <Button
              className="w-full h-12 bg-amber-500 hover:bg-amber-600 text-black font-black"
              onClick={() => openPaymentForm("pro")}
              data-testid="subscribe-pro-btn"
            >
              <Crown className="w-4 h-4 mr-2" />
              Subscribe Now
            </Button>
          ) : (
            <Button
              className="w-full h-12 bg-amber-500 hover:bg-amber-600 text-black font-black shadow-lg shadow-amber-500/20"
              data-testid="upgrade-pro-btn"
              onClick={() => openPaymentForm("pro")}
            >
              {trialEligible ? (
                <><Gift className="w-4 h-4 mr-2" />Start Free Trial</>
              ) : (
                <><Crown className="w-4 h-4 mr-2" />Upgrade to Champion</>
              )}
            </Button>
          )}
        </Card>
      </div>

      {paymentTier && (
        <PaymentModal
          tier={paymentTier}
          billing={billing}
          onSuccess={() => {
            setPaymentTier(null);
            toast({
              title: "Subscription Activated",
              description: "Your plan has been upgraded successfully. Enjoy your new features!",
            });
          }}
          onCancel={() => setPaymentTier(null)}
        />
      )}
    </div>
  );
}

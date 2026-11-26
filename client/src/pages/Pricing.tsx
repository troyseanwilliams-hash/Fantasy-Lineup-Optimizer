import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { usePageMeta } from "@/hooks/use-page-meta";
import { Check, Crown, Lock, Trophy, Sparkles, Calendar, Tag, Loader2, AlertTriangle, CreditCard, Gift, Dice5 } from "lucide-react";
import { PaymentModal } from "@/components/PaymentForm";
import { FEATURE_VISIBILITY } from "@shared/platform-config";
import { PASSES, SPORT_PLAN_SPORTS, SPORT_PLAN_MONTHLY_CENTS, formatUsd } from "@shared/plans";
import { Ticket, Copy, Users } from "lucide-react";

type BillingCycle = "monthly" | "annual";

export default function Pricing() {
  const { user } = useAuth();
  const { toast } = useToast();
  usePageMeta({
    title: "Pricing - DFS Optimizer Plans",
    description: "Choose your EliteLineup AI plan. Free Contender tier, single-sport plans from $9.99/mo, Sharpshooter at $19.99/mo, or Champion at $39.99/mo. Slate and Week passes with no subscription.",
    path: "/pricing",
  });
  const [billing, setBilling] = useState<BillingCycle>("monthly");
  const [paymentTier, setPaymentTier] = useState<"star" | "pro" | null>(null);
  const [paymentSport, setPaymentSport] = useState<string | null>(null);
  const [passBusy, setPassBusy] = useState<string | null>(null);

  const { data: subData } = useQuery<{
    tier: string;
    status: string;
    lineupCount: number;
    maxLineups: number;
    graceEndsAt: string | null;
    stripeSubscriptionId: string | null;
    currentPeriodEnd: string | null;
    isAdmin?: boolean;
    sportScope?: string | null;
    passExpiresAt?: string | null;
  }>({
    queryKey: ["/api/subscription"],
    enabled: !!user,
  });

  const isAdmin = subData?.isAdmin === true;
  const currentTier = subData?.tier || "free";
  const subStatus = subData?.status || "active";
  const hasActiveStripeSubscription = !isAdmin && !!subData?.stripeSubscriptionId && subStatus !== "incomplete" && subStatus !== "canceled";
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
    } else if (params.get("pass_success")) {
      toast({
        title: "Pass activated",
        description: "Your pass is live. It can take a few seconds to show up, so refresh if you do not see it yet.",
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

  const openPaymentForm = (tier: "star" | "pro", sportScope: string | null = null) => {
    if (!user) {
      window.location.href = "/login";
      return;
    }
    setPaymentSport(sportScope);
    setPaymentTier(tier);
  };

  const buyPass = async (passId: string) => {
    if (!user) {
      window.location.href = "/login";
      return;
    }
    setPassBusy(passId);
    try {
      const res = await fetch("/api/subscription/pass-checkout", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message || "Could not start checkout");
      if (body.url) window.location.href = body.url;
    } catch (err: any) {
      toast({ title: "Could not start checkout", description: err?.message || "Please try again.", variant: "destructive" });
    } finally {
      setPassBusy(null);
    }
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

  const starPrice = isAdmin ? "$0" : billing === "monthly" ? "$19.99" : "$199.90";
  const starPeriod = isAdmin ? "/month" : billing === "monthly" ? "/month" : "/year";
  const starSavings = !isAdmin && billing === "annual" ? "Save $39.98/yr" : null;

  const proPrice = isAdmin ? "$0" : billing === "monthly" ? "$39.99" : "$399.90";
  const proPeriod = isAdmin ? "/month" : billing === "monthly" ? "/month" : "/year";
  const proSavings = !isAdmin && billing === "annual" ? "Save $79.98/yr" : null;

  return (
    <div className="container mx-auto px-4 py-16 max-w-6xl relative">
      <img src="/images/pricing-hero.png" alt="" className="absolute top-0 left-0 right-0 h-[400px] w-full object-cover opacity-10 pointer-events-none" />
      <div className="absolute top-0 left-0 right-0 h-[400px] bg-gradient-to-b from-transparent to-[#0F172A] pointer-events-none" />
      {isAdmin && (
        <div className="mb-8 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center gap-3 max-w-3xl mx-auto" data-testid="admin-banner">
          <Crown className="w-5 h-5 text-amber-400 shrink-0" />
          <p className="text-sm font-bold text-amber-300">Admin account — full Champion access at $0</p>
        </div>
      )}
      {!isAdmin && subData?.passExpiresAt && !hasActiveStripeSubscription && (
        <div className="mb-8 p-4 rounded-xl bg-volt-500/10 border border-volt-500/30 flex items-start gap-3 max-w-3xl mx-auto" data-testid="pass-banner">
          <Ticket className="w-5 h-5 text-volt-400 shrink-0 mt-0.5" />
          <p className="text-sm font-bold text-volt-300">
            Pass active until {new Date(subData.passExpiresAt).toLocaleString()}. Buy another pass to extend it, or subscribe to keep going.
          </p>
        </div>
      )}
      {!isAdmin && subData?.sportScope && (
        <div className="mb-8 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-start gap-3 max-w-3xl mx-auto" data-testid="sport-plan-banner">
          <Trophy className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
          <p className="text-sm font-bold text-emerald-300">
            You are on the {subData.sportScope} plan. Upgrade to Sharpshooter or Champion to unlock every sport.
          </p>
        </div>
      )}
      {!isAdmin && isTrialing && trialEndsAt && (
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

      {!isAdmin && graceEndsAt && !hasActiveStripeSubscription && currentTier !== "free" && !isTrialing && (
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
              <span>DraftKings support</span>
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
            <li className="flex items-center gap-3 text-sm text-slate-300">
              <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <span>Showdown Builder (1 lineup)</span>
            </li>
            <li className="flex items-center gap-3 text-sm text-slate-300">
              <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <span>Track Record</span>
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
              <span>No Monte Carlo Simulation</span>
            </li>
            <li className="flex items-center gap-3 text-sm text-slate-400">
              <Lock className="w-4 h-4 text-slate-500 flex-shrink-0" />
              <span>No AI boost analysis</span>
            </li>
            <li className="flex items-center gap-3 text-sm text-slate-400">
              <Lock className="w-4 h-4 text-slate-500 flex-shrink-0" />
              <span>No Live Scores or Performance</span>
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
              <span>DraftKings support</span>
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
            <li className="flex items-center gap-3 text-sm text-slate-300">
              <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <span className="font-bold">Showdown Builder (up to 5)</span>
            </li>
            <li className="flex items-center gap-3 text-sm text-slate-300">
              <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <span className="font-bold">Player Config overrides</span>
            </li>
            <li className="flex items-center gap-3 text-sm text-slate-300">
              <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <span className="font-bold">Live Score Tracker</span>
            </li>
            <li className="flex items-center gap-3 text-sm text-slate-300">
              <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <span className="font-bold">Performance Dashboard</span>
            </li>
            <li className="flex items-center gap-3 text-sm text-slate-300">
              <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <span className="font-bold">Monte Carlo Sim Mode (up to 200 sims)</span>
            </li>
            <li className="flex items-center gap-3 text-sm text-slate-300">
              <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <span>Track Record</span>
            </li>
            <li className="flex items-center gap-3 text-sm text-slate-400">
              <Lock className="w-4 h-4 text-slate-500 flex-shrink-0" />
              <span>No AI boost analysis</span>
            </li>
            <li className="flex items-center gap-3 text-sm text-slate-400">
              <Lock className="w-4 h-4 text-slate-500 flex-shrink-0" />
              <span>No Win Agent or ownership heatmap</span>
            </li>
            {FEATURE_VISIBILITY.draftHub && <li className="flex items-center gap-3 text-sm text-slate-400">
              <Lock className="w-4 h-4 text-slate-500 flex-shrink-0" />
              <span>No NFL Draft Hub</span>
            </li>}
          </ul>
          {isAdmin ? (
            <Button variant="outline" className="w-full h-12 border-amber-500/30 text-amber-400 font-bold cursor-default" disabled data-testid="admin-star-btn">
              <Crown className="w-4 h-4 mr-2" />Admin Access — $0
            </Button>
          ) : currentTier === "star" && hasActiveStripeSubscription ? (
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
              <span>DraftKings support</span>
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
              <span className="font-bold text-amber-300">Monte Carlo Sim Mode (up to 500 sims)</span>
            </li>
            <li className="flex items-center gap-3 text-sm text-slate-300">
              <Check className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <span className="font-bold text-amber-300">Pro Optimizer with ceiling & leverage modes</span>
            </li>
            <li className="flex items-center gap-3 text-sm text-slate-300">
              <Check className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <span className="font-bold text-amber-300">PrizePicks Builder with live lines</span>
            </li>
            <li className="flex items-center gap-3 text-sm text-slate-300">
              <Check className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <span className="font-bold text-amber-300">Showdown Builder (up to 20)</span>
            </li>
            <li className="flex items-center gap-3 text-sm text-slate-300">
              <Check className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <span className="font-bold text-amber-300">Player Config overrides</span>
            </li>
            <li className="flex items-center gap-3 text-sm text-slate-300">
              <Check className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <span className="font-bold text-amber-300">Live Score Tracker</span>
            </li>
            <li className="flex items-center gap-3 text-sm text-slate-300">
              <Check className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <span className="font-bold text-amber-300">Performance Dashboard</span>
            </li>
            <li className="flex items-center gap-3 text-sm text-slate-300">
              <Check className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <span className="font-bold">Track Record</span>
            </li>
            <li className="flex items-center gap-3 text-sm text-slate-300">
              <Check className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <span className="font-bold text-amber-300">Ownership Heatmap projections</span>
            </li>
            <li className="flex items-center gap-3 text-sm text-slate-300">
              <Check className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <span className="font-bold text-amber-300">Win Agent — AI lineup analysis</span>
            </li>
            <li className="flex items-center gap-3 text-sm text-slate-300">
              <Check className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <span className="font-bold text-amber-300">Auto-learning historical adjustments</span>
            </li>
            <li className="flex items-center gap-3 text-sm text-slate-300">
              <Check className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <span className="font-bold text-amber-300">DraftKings entries import</span>
            </li>
            <li className="flex items-center gap-3 text-sm text-slate-300">
              <Check className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <span className="font-bold text-amber-300">Bankroll Tracker: profit and ROI by sport</span>
            </li>
            <li className="flex items-center gap-3 text-sm text-slate-300">
              <Check className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <span className="font-bold text-amber-300">Late Swap: re-optimize after games start</span>
            </li>
            <li className="flex items-center gap-3 text-sm text-slate-300">
              <Check className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <span className="font-bold text-amber-300">Bulk lineup regeneration</span>
            </li>
            {FEATURE_VISIBILITY.draftHub && <li className="flex items-center gap-3 text-sm text-slate-300">
              <Check className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <span className="font-bold text-amber-300">🏈 Full NFL Draft Hub (Mock Draft Simulator + Live Draft Assistant + cheat sheets)</span>
            </li>}
          </ul>
          {isAdmin ? (
            <Button className="w-full h-12 bg-amber-500/20 border border-amber-500/30 text-amber-300 font-black cursor-default hover:bg-amber-500/20" disabled data-testid="admin-pro-btn">
              <Crown className="w-4 h-4 mr-2" />Admin Access — $0
            </Button>
          ) : currentTier === "pro" && hasActiveStripeSubscription ? (
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

      <p className="text-center text-xs text-slate-500 mt-6">No refunds. Cancel at any time.</p>

      {/* Passes and single-sport plans */}
      <div className="max-w-5xl mx-auto mt-16" data-testid="flex-options">
        <div className="text-center mb-8">
          <h2 className="text-3xl font-black text-white tracking-tight">Not ready to subscribe?</h2>
          <p className="text-slate-400 mt-2">Pay for one slate, one week, or just the sport you play.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="bg-[#0F1A2E] border-volt-500/20 p-6 relative overflow-hidden" data-testid="passes-card">
            <img src="/images/art/pass.svg" alt="" className="absolute -right-6 -top-6 w-40 opacity-60 pointer-events-none" />
            <div className="relative">
              <div className="flex items-center gap-2 mb-1"><Ticket className="w-5 h-5 text-volt-400" /><h3 className="text-xl font-black text-white">One-time passes</h3></div>
              <p className="text-xs text-slate-400 mb-5">Full Sharpshooter access, every sport, no recurring charge.</p>
              <div className="space-y-3">
                {Object.values(PASSES).map(pass => (
                  <div key={pass.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-700/60 bg-slate-900/50 p-4">
                    <div>
                      <p className="font-black text-white">{pass.label} <span className="text-volt-400">{formatUsd(pass.amountCents)}</span></p>
                      <p className="text-xs text-slate-400">{pass.blurb}</p>
                    </div>
                    <Button
                      className="bg-volt-500 hover:bg-volt-400 text-black font-black shrink-0"
                      disabled={passBusy !== null || currentTier === "pro" || hasActiveStripeSubscription}
                      onClick={() => buyPass(pass.id)}
                      data-testid={`buy-pass-${pass.id}`}
                    >
                      {passBusy === pass.id ? <Loader2 className="w-4 h-4 animate-spin" /> : "Buy"}
                    </Button>
                  </div>
                ))}
              </div>
              {(currentTier === "pro" || hasActiveStripeSubscription) && !isAdmin && (
                <p className="text-xs text-slate-500 mt-3">Passes are for accounts without an active plan.</p>
              )}
            </div>
          </Card>

          <Card className="bg-[#0F1A2E] border-emerald-500/20 p-6" data-testid="sport-plans-card">
            <div className="flex items-center gap-2 mb-1"><Trophy className="w-5 h-5 text-emerald-400" /><h3 className="text-xl font-black text-white">Single-sport plans</h3></div>
            <p className="text-xs text-slate-400 mb-5">Sharpshooter tools for one sport at {formatUsd(SPORT_PLAN_MONTHLY_CENTS)}/month. Cancel any time.</p>
            <div className="space-y-3">
              {SPORT_PLAN_SPORTS.map(sport => (
                <div key={sport} className="flex items-center justify-between gap-3 rounded-xl border border-slate-700/60 bg-slate-900/50 p-4">
                  <div>
                    <p className="font-black text-white">{sport} <span className="text-emerald-400">{formatUsd(SPORT_PLAN_MONTHLY_CENTS)}/mo</span></p>
                    <p className="text-xs text-slate-400">Everything in Sharpshooter, {sport} only.</p>
                  </div>
                  <Button
                    className="bg-emerald-500 hover:bg-emerald-600 text-black font-black shrink-0"
                    disabled={hasActiveStripeSubscription || isAdmin}
                    onClick={() => openPaymentForm("star", sport)}
                    data-testid={`buy-sport-${sport.toLowerCase()}`}
                  >
                    {trialEligible ? "Try free" : "Subscribe"}
                  </Button>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {user && <ReferralCard />}
      </div>

      {/* Standalone Draft Hub */}
      {FEATURE_VISIBILITY.draftHub && <div className="max-w-2xl mx-auto mt-12">
        <div className="text-center mb-4">
          <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Standalone — 2026 Season</span>
        </div>
        <Card className="bg-[#0F1A2E] border-blue-500/30 p-8 relative" data-testid="plan-draft-hub">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <span className="text-3xl">🏈</span>
                <h3 className="text-2xl font-black text-white">NFL Draft Hub 2026</h3>
                <Badge className="bg-blue-500/20 text-blue-300 border-blue-500/30 text-[10px] font-black px-1.5">ONE-TIME</Badge>
              </div>
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-4xl font-black text-white">$49</span>
                <span className="text-slate-400 font-bold">one-time</span>
              </div>
              <p className="text-xs text-blue-400/70 mb-3">Full access through the 2026 NFL Draft season</p>
              <p className="text-sm text-slate-400 mb-4 max-w-md">
                Just want the Draft Hub? One payment gets you the complete 2026 NFL Draft experience — no subscription required.
              </p>
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm text-slate-300">
                <li className="flex items-center gap-2"><Check className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" /><span>285 deep player profiles</span></li>
                <li className="flex items-center gap-2"><Check className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" /><span className="font-bold text-amber-300">Mock Draft Simulator (new)</span></li>
                <li className="flex items-center gap-2"><Check className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" /><span>Live Draft Assistant</span></li>
                <li className="flex items-center gap-2"><Check className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" /><span>AI pick per round with reasoning</span></li>
                <li className="flex items-center gap-2"><Check className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" /><span>Daily news-adjusted ranks + risers/fallers</span></li>
                <li className="flex items-center gap-2"><Check className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" /><span>Printable cheat sheets + CSV</span></li>
                <li className="flex items-center gap-2"><Check className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" /><span>Superflex &amp; TE-Premium re-ranks</span></li>
                <li className="flex items-center gap-2"><Check className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" /><span>Bye week tracker + handcuffs</span></li>
              </ul>
              <p className="text-xs text-slate-500 mt-4">
                💡 Want DFS lineup tools too? Champion ($39.99/mo) includes the Draft Hub plus everything else.
              </p>
            </div>
            <div className="flex flex-col items-center gap-3 sm:min-w-[180px]">
              {isAdmin ? (
                <Button className="w-full h-12 bg-blue-500/20 border border-blue-500/30 text-blue-300 font-black cursor-default hover:bg-blue-500/20" disabled data-testid="admin-draft-hub-btn">
                  <Crown className="w-4 h-4 mr-2" />Admin Access
                </Button>
              ) : currentTier === "pro" ? (
                <Button className="w-full h-12 bg-blue-500/20 border border-blue-500/30 text-blue-300 font-bold cursor-default hover:bg-blue-500/20" disabled data-testid="draft-hub-owned-btn">
                  <Check className="w-4 h-4 mr-2" />Already Included
                </Button>
              ) : (
                <Button
                  className="w-full h-12 bg-blue-600 hover:bg-blue-700 text-white font-black shadow-lg shadow-blue-500/20"
                  data-testid="buy-draft-hub-btn"
                  onClick={async () => {
                    try {
                      const res = await fetch("/api/subscription/draft-hub-checkout", { method: "POST", credentials: "include" });
                      if (res.status === 401) { window.location.href = "/login"; return; }
                      const data = await res.json();
                      if (data.url) window.location.href = data.url;
                    } catch { toast({ title: "Error", description: "Could not start checkout. Please try again.", variant: "destructive" }); }
                  }}
                >
                  <span className="mr-2">🏈</span>Buy Draft Hub — $49
                </Button>
              )}
              <p className="text-xs text-slate-500 text-center">No refunds. No subscription.</p>
            </div>
          </div>
        </Card>
      </div>}

      {paymentTier && (
        <PaymentModal
          tier={paymentTier}
          billing={billing}
          sportScope={paymentSport}
          onSuccess={() => {
            setPaymentTier(null);
            toast({
              title: "Subscription Activated",
              description: "Your plan has been upgraded successfully. Enjoy your new features!",
            });
          }}
          onCancel={() => { setPaymentTier(null); setPaymentSport(null); }}
        />
      )}
    </div>
  );
}


function ReferralCard() {
  const { toast } = useToast();
  const { data } = useQuery<{ code: string; pending: number; rewarded: number }>({ queryKey: ["/api/referral"] });
  if (!data) return null;
  const link = `${window.location.origin}/?ref=${data.code}`;
  return (
    <Card className="bg-[#0F1A2E] border-amber-500/20 p-6 mt-6" data-testid="referral-card">
      <div className="flex flex-col md:flex-row md:items-center gap-5">
        <img src="/images/art/referral.svg" alt="" className="w-28 h-28 shrink-0 hidden md:block" />
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1"><Users className="w-5 h-5 text-amber-400" /><h3 className="text-xl font-black text-white">Give a friend a month, get a month</h3></div>
          <p className="text-sm text-slate-400 mb-4">
            When someone signs up with your link and makes their first paid subscription payment, you get one month free. Subscribers receive a credit on their next bill. Everyone else gets a 30-day pass.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <input readOnly value={link} className="flex-1 h-10 rounded-md bg-slate-950 border border-border px-3 text-sm text-slate-200" aria-label="Your referral link" />
            <Button
              className="bg-amber-500 hover:bg-amber-600 text-black font-black"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(link);
                  toast({ title: "Link copied" });
                } catch {
                  toast({ title: "Copy failed", description: "Select the link and copy it manually.", variant: "destructive" });
                }
              }}
            >
              <Copy className="w-4 h-4 mr-2" />Copy link
            </Button>
          </div>
          <p className="text-xs text-slate-500 mt-3">{data.rewarded} rewarded, {data.pending} waiting on a first payment. Up to 12 rewards a year.</p>
        </div>
      </div>
    </Card>
  );
}

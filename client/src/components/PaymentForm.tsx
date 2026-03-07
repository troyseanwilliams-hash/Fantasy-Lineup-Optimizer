import { useState, useEffect, useRef } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Shield, Lock, Crown, Trophy, X, Check, CheckCircle2, Gift } from "lucide-react";

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || "");

interface PaymentFormProps {
  tier: "star" | "pro";
  billing: "monthly" | "annual";
  onSuccess: () => void;
  onCancel: () => void;
}

function CheckoutForm({ tier, isTrial, onSuccess, onCancel }: { tier: "star" | "pro"; isTrial: boolean; onSuccess: () => void; onCancel: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const { toast } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);
  const [paymentComplete, setPaymentComplete] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements || isProcessing) return;

    setIsProcessing(true);

    if (isTrial) {
      const { error, setupIntent } = await stripe.confirmSetup({
        elements,
        redirect: "if_required",
      });

      if (error) {
        toast({
          title: "Setup Failed",
          description: error.message || "Something went wrong saving your payment method.",
          variant: "destructive",
        });
        setIsProcessing(false);
      } else if (setupIntent && (setupIntent.status === "succeeded" || setupIntent.status === "processing")) {
        setPaymentComplete(true);
        queryClient.invalidateQueries({ queryKey: ["/api/subscription"] });
        setTimeout(() => {
          onSuccess();
        }, 2000);
      } else {
        toast({
          title: "Setup Incomplete",
          description: "Your payment setup requires additional action.",
          variant: "destructive",
        });
        setIsProcessing(false);
      }
    } else {
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        redirect: "if_required",
      });

      if (error) {
        toast({
          title: "Payment Failed",
          description: error.message || "Something went wrong with your payment.",
          variant: "destructive",
        });
        setIsProcessing(false);
      } else if (paymentIntent && (paymentIntent.status === "succeeded" || paymentIntent.status === "processing")) {
        setPaymentComplete(true);
        queryClient.invalidateQueries({ queryKey: ["/api/subscription"] });
        setTimeout(() => {
          onSuccess();
        }, 2000);
      } else {
        toast({
          title: "Payment Incomplete",
          description: "Your payment requires additional action. Please follow the instructions.",
          variant: "destructive",
        });
        setIsProcessing(false);
      }
    }
  };

  if (paymentComplete) {
    return (
      <div className="flex flex-col items-center justify-center py-8 space-y-4">
        <div className={`w-16 h-16 rounded-full flex items-center justify-center ${
          tier === "pro" ? "bg-amber-500/20" : "bg-emerald-500/20"
        }`}>
          <CheckCircle2 className={`w-8 h-8 ${tier === "pro" ? "text-amber-400" : "text-emerald-400"}`} />
        </div>
        <h3 className="text-xl font-black text-white">
          {isTrial ? "Trial Activated!" : "Payment Successful!"}
        </h3>
        <p className="text-sm text-slate-400 text-center">
          {isTrial
            ? `Your 7-day free trial of ${tier === "pro" ? "Pro" : "Star"} has started. Enjoy!`
            : `Your ${tier === "pro" ? "Pro" : "Star"} subscription is now active.`}
        </p>
      </div>
    );
  }

  const tierName = tier === "pro" ? "Pro" : "Star";

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="flex items-center gap-3 pb-4 border-b border-slate-700">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
          tier === "pro" ? "bg-amber-500/20" : "bg-emerald-500/20"
        }`}>
          {tier === "pro" ? (
            <Crown className="w-5 h-5 text-amber-400" />
          ) : (
            <Trophy className="w-5 h-5 text-emerald-400" />
          )}
        </div>
        <div>
          <h3 className="text-lg font-black text-white">
            {isTrial ? `Start Free Trial` : `Subscribe to ${tierName}`}
          </h3>
          <p className="text-xs text-slate-400">
            {isTrial ? "Add a payment method to start your 7-day free trial" : "Enter your payment details below"}
          </p>
        </div>
      </div>

      {isTrial && (
        <div className={`flex items-center gap-3 p-3 rounded-xl border ${
          tier === "pro"
            ? "bg-amber-500/10 border-amber-500/20"
            : "bg-emerald-500/10 border-emerald-500/20"
        }`}>
          <Gift className={`w-5 h-5 flex-shrink-0 ${tier === "pro" ? "text-amber-400" : "text-emerald-400"}`} />
          <div>
            <p className={`text-xs font-bold ${tier === "pro" ? "text-amber-300" : "text-emerald-300"}`}>
              7-Day Free Trial
            </p>
            <p className="text-[11px] text-slate-400">
              You won't be charged until your trial ends. Cancel anytime.
            </p>
          </div>
        </div>
      )}

      <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700">
        <PaymentElement
          options={{
            layout: "tabs",
          }}
        />
      </div>

      <div className="flex items-center gap-2 text-xs text-slate-400">
        <Shield className="w-3.5 h-3.5 text-emerald-400" />
        <span>Your payment is secured by Stripe. We never store your card details.</span>
      </div>

      <div className="flex gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          className="flex-1 h-12 border-slate-700 text-slate-400 font-bold"
          disabled={isProcessing}
          data-testid="payment-cancel-btn"
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={!stripe || !elements || isProcessing}
          className={`flex-1 h-12 font-black shadow-lg ${
            tier === "pro"
              ? "bg-amber-500 hover:bg-amber-600 text-black shadow-amber-500/20"
              : "bg-emerald-500 hover:bg-emerald-600 text-black shadow-emerald-500/20"
          }`}
          data-testid="payment-submit-btn"
        >
          {isProcessing ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Processing...
            </>
          ) : isTrial ? (
            <>
              <Gift className="w-4 h-4 mr-2" />
              Start Free Trial
            </>
          ) : (
            <>
              <Lock className="w-4 h-4 mr-2" />
              Subscribe Now
            </>
          )}
        </Button>
      </div>
    </form>
  );
}

export function PaymentModal({ tier, billing, onSuccess, onCancel }: PaymentFormProps) {
  const { toast } = useToast();
  const hasMutated = useRef(false);

  const createIntentMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/subscription/create-intent", { tier, billing });
      return res.json();
    },
    onError: (error: Error) => {
      toast({
        title: "Setup Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    if (!hasMutated.current) {
      hasMutated.current = true;
      createIntentMutation.mutate();
    }
  }, [tier, billing]);

  const tierName = tier === "pro" ? "Pro" : "Star";
  const price = tier === "pro"
    ? (billing === "annual" ? "$500/year" : "$49.99/month")
    : (billing === "annual" ? "$200/year" : "$19.99/month");
  const isTrial = createIntentMutation.data?.isTrial ?? false;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4" data-testid="payment-modal">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full max-w-md bg-[#1E293B] border border-slate-700 rounded-2xl shadow-2xl overflow-hidden">
        <button
          onClick={onCancel}
          className="absolute top-4 right-4 p-1 rounded-lg hover:bg-slate-700 transition-colors z-10"
          data-testid="payment-close-btn"
        >
          <X className="w-5 h-5 text-slate-400" />
        </button>

        <div className={`px-6 pt-6 pb-4 bg-gradient-to-r ${
          tier === "pro"
            ? "from-amber-500/10 to-amber-600/5 border-b border-amber-500/20"
            : "from-emerald-500/10 to-emerald-600/5 border-b border-emerald-500/20"
        }`}>
          <div className="flex items-center gap-3 mb-3">
            <div className={`w-12 h-12 rounded-xl ${
              tier === "pro" ? "bg-amber-500/20" : "bg-emerald-500/20"
            } flex items-center justify-center`}>
              {tier === "pro" ? (
                <Crown className="w-6 h-6 text-amber-400" />
              ) : (
                <Trophy className="w-6 h-6 text-emerald-400" />
              )}
            </div>
            <div>
              <h2 className="text-xl font-black text-white">EliteLineup {tierName}</h2>
              <p className={`text-sm font-bold ${tier === "pro" ? "text-amber-400" : "text-emerald-400"}`}>
                {isTrial ? `7 days free, then ${price}` : price}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 mt-4">
            {tier === "star" ? (
              <>
                <div className="flex items-center gap-1.5 text-xs text-slate-300">
                  <Check className="w-3 h-3 text-emerald-400" /> 20 teams/sport
                </div>
                <div className="flex items-center gap-1.5 text-xs text-slate-300">
                  <Check className="w-3 h-3 text-emerald-400" /> 5 AI picks/sport
                </div>
                <div className="flex items-center gap-1.5 text-xs text-slate-300">
                  <Check className="w-3 h-3 text-emerald-400" /> CSV export
                </div>
                <div className="flex items-center gap-1.5 text-xs text-slate-300">
                  <Check className="w-3 h-3 text-emerald-400" /> Multi-lineup (5)
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-1.5 text-xs text-slate-300">
                  <Check className="w-3 h-3 text-amber-400" /> 150 teams/sport
                </div>
                <div className="flex items-center gap-1.5 text-xs text-slate-300">
                  <Check className="w-3 h-3 text-amber-400" /> 15 AI picks/sport
                </div>
                <div className="flex items-center gap-1.5 text-xs text-slate-300">
                  <Check className="w-3 h-3 text-amber-400" /> AI boosts & injuries
                </div>
                <div className="flex items-center gap-1.5 text-xs text-slate-300">
                  <Check className="w-3 h-3 text-amber-400" /> PrizePicks builder
                </div>
              </>
            )}
          </div>
        </div>

        <div className="p-6">
          {createIntentMutation.isPending ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className={`w-8 h-8 animate-spin mb-4 ${tier === "pro" ? "text-amber-400" : "text-emerald-400"}`} />
              <p className="text-sm text-slate-400 font-medium">Setting up your subscription...</p>
            </div>
          ) : createIntentMutation.isError ? (
            <div className="flex flex-col items-center justify-center py-12">
              <p className="text-sm text-red-400 font-medium mb-4">Failed to initialize payment</p>
              <Button
                onClick={() => createIntentMutation.mutate()}
                variant="outline"
                className="border-slate-700 text-slate-300"
                data-testid="payment-retry-btn"
              >
                Try Again
              </Button>
            </div>
          ) : createIntentMutation.data?.clientSecret ? (
            <Elements
              stripe={stripePromise}
              options={{
                clientSecret: createIntentMutation.data.clientSecret,
                appearance: {
                  theme: "night",
                  variables: {
                    colorPrimary: tier === "pro" ? "#f59e0b" : "#10b981",
                    colorBackground: "#1e293b",
                    colorText: "#e2e8f0",
                    colorDanger: "#ef4444",
                    fontFamily: "system-ui, -apple-system, sans-serif",
                    borderRadius: "8px",
                    spacingUnit: "4px",
                  },
                  rules: {
                    ".Input": {
                      backgroundColor: "#0f172a",
                      border: "1px solid #334155",
                      color: "#e2e8f0",
                    },
                    ".Input:focus": {
                      border: `1px solid ${tier === "pro" ? "#f59e0b" : "#10b981"}`,
                      boxShadow: `0 0 0 1px ${tier === "pro" ? "#f59e0b" : "#10b981"}`,
                    },
                    ".Label": {
                      color: "#94a3b8",
                      fontSize: "13px",
                      fontWeight: "600",
                    },
                    ".Tab": {
                      backgroundColor: "#0f172a",
                      border: "1px solid #334155",
                      color: "#94a3b8",
                    },
                    ".Tab--selected": {
                      backgroundColor: "#1e293b",
                      border: `1px solid ${tier === "pro" ? "#f59e0b" : "#10b981"}`,
                      color: "#e2e8f0",
                    },
                  },
                },
              }}
            >
              <CheckoutForm tier={tier} isTrial={isTrial} onSuccess={onSuccess} onCancel={onCancel} />
            </Elements>
          ) : null}
        </div>
      </div>
    </div>
  );
}

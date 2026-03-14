import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Lock, Crown } from "lucide-react";
import { Loader2 } from "lucide-react";

interface ContentAccess {
  tier: string;
  features: Record<string, { unlocked: boolean; requiredTier: string }>;
}

const TIER_LABELS: Record<string, string> = {
  free: "Contender",
  star: "Sharpshooter",
  pro: "Champion",
};

interface GatedContentProps {
  feature: string;
  children: React.ReactNode;
  fallbackTitle?: string;
  fallbackDescription?: string;
}

export function GatedContent({ feature, children, fallbackTitle, fallbackDescription }: GatedContentProps) {
  const { user } = useAuth();

  const { data, isLoading } = useQuery<ContentAccess>({
    queryKey: ["/api/content-access"],
    enabled: !!user,
  });

  if (!user) {
    return (
      <div className="min-h-[400px] flex items-center justify-center" data-testid={`gated-login-${feature}`}>
        <Card className="bg-slate-900 border-slate-700 max-w-md">
          <CardContent className="p-8 text-center">
            <Lock className="w-12 h-12 text-slate-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-white mb-2">Sign In Required</h2>
            <p className="text-slate-400">Log in to access this feature.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-[400px] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
      </div>
    );
  }

  const featureAccess = data?.features[feature];
  const isAdmin = user.isAdmin;

  if (isAdmin || !featureAccess || featureAccess.unlocked) {
    return <>{children}</>;
  }

  const requiredTierLabel = TIER_LABELS[featureAccess.requiredTier] || featureAccess.requiredTier;

  return (
    <div className="min-h-[400px] flex items-center justify-center" data-testid={`gated-locked-${feature}`}>
      <Card className="bg-slate-900 border-slate-700 max-w-md">
        <CardContent className="p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-amber-500/10 flex items-center justify-center mx-auto mb-4">
            <Crown className="w-8 h-8 text-amber-500" />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">
            {fallbackTitle || `${requiredTierLabel} Feature`}
          </h2>
          <p className="text-slate-400 mb-6">
            {fallbackDescription || `Upgrade to ${requiredTierLabel} or higher to unlock this feature.`}
          </p>
          <Button
            onClick={() => window.location.href = "/pricing"}
            className="bg-emerald-600 hover:bg-emerald-700 font-bold"
            data-testid={`btn-upgrade-${feature}`}
          >
            <Crown className="w-4 h-4 mr-2" />
            Upgrade to {requiredTierLabel}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

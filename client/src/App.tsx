import { useEffect } from "react";
import { Switch, Route, Link, useLocation, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";

import Home from "@/pages/Home";
import Login from "@/pages/Login";
import Optimizer from "@/pages/Optimizer";
import ProOptimizer from "@/pages/ProOptimizer";
import SavedLineups from "@/pages/SavedLineups";
import PropBets from "@/pages/PropBets";
import Admin from "@/pages/Admin";
import Pricing from "@/pages/Pricing";
import News from "@/pages/News";
import ParlayBuilder from "@/pages/ParlayBuilder";
import PrizePicksBuilder from "@/pages/PrizePicksBuilder";
import Onboarding from "@/pages/Onboarding";
import Terms from "@/pages/Terms";
import Privacy from "@/pages/Privacy";
import About from "@/pages/About";
import LineupBuilderInfo from "@/pages/LineupBuilderInfo";
import PropInsightsInfo from "@/pages/PropInsightsInfo";
import OwnershipHeatmap from "@/pages/OwnershipHeatmap";
import WinningLineups from "@/pages/WinningLineups";
import PlayerConfiguration from "@/pages/PlayerConfiguration";
import LiveScoreTracker from "@/pages/LiveScoreTracker";
import NotificationPreferences from "@/pages/NotificationPreferences";
import PerformanceDashboard from "@/pages/PerformanceDashboard";
import TrackRecord from "@/pages/TrackRecord";
import ShowdownBuilder from "@/pages/ShowdownBuilder";
import NFLGppWorkbench from "@/pages/NFLGppWorkbench";
import ScoutDashboard from "@/pages/ScoutDashboard";
import SimGuide from "@/pages/SimGuide";
import NFLMMEOptimizer from "@/pages/NFLMMEOptimizer";
import NFLDraft from "@/pages/NFLDraft";
import Support from "@/pages/Support";
import TopStacks from "@/pages/TopStacks";
import MmaOptimizer from "@/pages/MmaOptimizer";
import Tracker from "@/pages/Tracker";
import LateSwap from "@/pages/LateSwap";
import { ReferralCapture } from "@/components/ReferralCapture";

import NotFound from "@/pages/not-found";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

function Router() {
  const { user, isLoading } = useAuth();
  const [location] = useLocation();
  const isOptimizer = location.startsWith("/optimizer") || location.startsWith("/optimizer-pro");
  const isOnboarding = location === "/onboarding";
  const isLoginPage = location === "/login";

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location]);

  if (isLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#0A0A0C]">
        <Loader2 className="w-10 h-10 text-volt-500 animate-spin" />
      </div>
    );
  }

  if (!user && isOnboarding) {
    return <Redirect to="/" />;
  }

  if (user && isLoginPage) {
    return <Redirect to="/" />;
  }

  return (
    <div className={`flex flex-col ${isOptimizer ? "h-[100dvh] overflow-hidden" : isOnboarding || isLoginPage ? "" : "min-h-screen"} bg-[#0A0A0C]`}>
      <ReferralCapture />
      {!isOnboarding && !isLoginPage && <Header />}
      <main className={isOptimizer ? "min-h-0 flex-1 overflow-y-auto" : "flex-grow"} data-testid={isOptimizer ? "optimizer-page-scroll" : undefined}>
        <Switch>
          <Route path="/" component={Home} />
          <Route path="/login" component={Login} />
          <Route path="/onboarding" component={Onboarding} />
          <Route path="/optimizer/:id" component={Optimizer} />
          <Route path="/optimizer-pro/:id" component={ProOptimizer} />
           <Route path="/top-stacks" component={TopStacks} />
          <Route path="/mma-optimizer" component={MmaOptimizer} />
          <Route path="/lineups" component={SavedLineups} />
          <Route path="/props" component={PropBets} />
          <Route path="/parlays" component={ParlayBuilder} />
          <Route path="/prizepicks" component={PrizePicksBuilder} />
          <Route path="/news/:sport" component={News} />
          <Route path="/pricing" component={Pricing} />
          <Route path="/terms" component={Terms} />
          <Route path="/privacy" component={Privacy} />
          <Route path="/about" component={About} />
          <Route path="/lineup-builder" component={LineupBuilderInfo} />
          <Route path="/prop-insights" component={PropInsightsInfo} />
          <Route path="/ownership" component={OwnershipHeatmap} />
           <Route path="/player-config" component={PlayerConfiguration} />
           <Route path="/player-configuration" component={PlayerConfiguration} />
          <Route path="/winning-lineups" component={WinningLineups} />
          <Route path="/live-scores" component={LiveScoreTracker} />
          <Route path="/notifications" component={NotificationPreferences} />
          <Route path="/performance" component={PerformanceDashboard} />
          <Route path="/track-record" component={TrackRecord} />
          <Route path="/showdown" component={ShowdownBuilder} />
          <Route path="/nfl-gpp" component={NFLGppWorkbench} />
          <Route path="/scout" component={ScoutDashboard} />
          <Route path="/admin" component={Admin} />
          <Route path="/sim-guide" component={SimGuide} />
          <Route path="/nfl-mme" component={NFLMMEOptimizer} />
          <Route path="/nfl-draft" component={NFLDraft} />
          <Route path="/support" component={Support} />
          <Route path="/tracker" component={Tracker} />
          <Route path="/late-swap" component={LateSwap} />
          <Route component={NotFound} />
        </Switch>
      </main>
      {!isOptimizer && !isOnboarding && !isLoginPage && <Footer />}
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Router />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

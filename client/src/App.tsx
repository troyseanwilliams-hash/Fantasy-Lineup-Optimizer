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
      <div className="h-screen w-screen flex items-center justify-center bg-[#0F172A]">
        <Loader2 className="w-10 h-10 text-emerald-500 animate-spin" />
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
    <div className={`flex flex-col ${isOptimizer ? "h-screen overflow-hidden" : isOnboarding || isLoginPage ? "" : "min-h-screen"} bg-[#0F172A]`}>
      {!isOnboarding && !isLoginPage && <Header />}
      <main className={isOptimizer ? "flex-1 overflow-hidden" : "flex-grow"}>
        <Switch>
          <Route path="/" component={Home} />
          <Route path="/login" component={Login} />
          <Route path="/onboarding" component={Onboarding} />
          <Route path="/optimizer/:id" component={Optimizer} />
          <Route path="/optimizer-pro/:id" component={ProOptimizer} />
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
          <Route path="/admin" component={Admin} />
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

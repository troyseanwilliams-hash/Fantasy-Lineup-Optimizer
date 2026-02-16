import { Switch, Route, Link, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";

import Home from "@/pages/Home";
import Optimizer from "@/pages/Optimizer";
import SavedLineups from "@/pages/SavedLineups";
import PropBets from "@/pages/PropBets";
import Admin from "@/pages/Admin";
import Pricing from "@/pages/Pricing";
import News from "@/pages/News";
import NotFound from "@/pages/not-found";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

function Router() {
  const { user, isLoading } = useAuth();
  const [location] = useLocation();
  const isOptimizer = location.startsWith("/optimizer");

  if (isLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[var(--bg-dark)]">
        <Loader2 className="w-10 h-10 text-[var(--primary)] animate-spin" />
      </div>
    );
  }

  return (
    <div className={`flex flex-col ${isOptimizer ? "h-screen overflow-hidden" : "min-h-screen"} bg-[var(--bg-dark)]`}>
      <Header />
      <main className={isOptimizer ? "flex-1 overflow-hidden" : "flex-grow"}>
        <Switch>
          <Route path="/" component={Home} />
          <Route path="/optimizer/:id" component={Optimizer} />
          <Route path="/lineups" component={SavedLineups} />
          <Route path="/props" component={PropBets} />
          <Route path="/news/:sport" component={News} />
          <Route path="/pricing" component={Pricing} />
          <Route path="/admin" component={Admin} />
          <Route component={NotFound} />
        </Switch>
      </main>
      {!isOptimizer && <Footer />}
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

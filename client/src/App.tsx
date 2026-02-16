import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";

import Home from "@/pages/Home";
import Optimizer from "@/pages/Optimizer";
import SavedLineups from "@/pages/SavedLineups";
import Admin from "@/pages/Admin";
import NotFound from "@/pages/not-found";

function Router() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-background">
        <Loader2 className="w-10 h-10 text-primary animate-spin" />
      </div>
    );
  }

  // Simple auth protection for demo
  if (!user) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-background space-y-6">
        <h1 className="text-4xl font-display font-bold text-white">PRO<span className="text-primary">LINEUP</span></h1>
        <p className="text-muted-foreground">Please log in to access the optimizer.</p>
        <a href="/api/login">
           <button className="bg-primary text-primary-foreground px-8 py-3 rounded-lg font-bold hover:bg-primary/90 transition-colors">
             Login with Replit
           </button>
        </a>
      </div>
    );
  }

  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/optimizer/:id" component={Optimizer} />
      <Route path="/lineups" component={SavedLineups} />
      <Route path="/admin" component={Admin} />
      <Route component={NotFound} />
    </Switch>
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

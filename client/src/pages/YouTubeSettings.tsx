import { useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { CheckCircle2, Loader2, Unplug, Youtube } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type YouTubeStatus = {
  configured: boolean;
  connected: boolean;
  channel: { id: string | null; title: string | null; connectedAt: string | null } | null;
};

export default function YouTubeSettings() {
  const [location] = useLocation();
  const { toast } = useToast();
  const { data, isLoading } = useQuery<YouTubeStatus>({ queryKey: ["/api/youtube/status"] });
  const disconnect = useMutation({
    mutationFn: () => apiRequest("POST", "/api/youtube/disconnect"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/youtube/status"] }),
  });

  useEffect(() => {
    const params = new URLSearchParams(location.split("?")[1] || "");
    if (params.get("connected") === "1") {
      toast({ title: "YouTube connected", description: "Your channel is ready for publishing." });
    } else if (params.has("error")) {
      toast({
        title: "YouTube connection failed",
        description: "Check the Google OAuth redirect URL and try again.",
        variant: "destructive",
      });
    }
  }, [location, toast]);

  return (
    <div className="container mx-auto max-w-2xl px-4 py-12">
      <Card className="border-slate-700 bg-slate-900 text-white">
        <CardHeader>
          <div className="mb-2 flex items-center gap-3">
            <Youtube className="h-8 w-8 text-red-500" />
            <CardTitle>YouTube connection</CardTitle>
          </div>
          <CardDescription>
            Connect a channel to authorize secure video publishing. Your Google password is never shared with this app.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {isLoading ? (
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          ) : data?.connected ? (
            <>
              <div className="flex items-center gap-3 rounded-lg border border-emerald-700/50 bg-emerald-950/40 p-4">
                <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                <div>
                  <p className="font-semibold">Connected</p>
                  <p className="text-sm text-slate-300">{data.channel?.title || "YouTube channel"}</p>
                </div>
              </div>
              <Button variant="outline" onClick={() => disconnect.mutate()} disabled={disconnect.isPending}>
                <Unplug className="mr-2 h-4 w-4" />
                Disconnect YouTube
              </Button>
            </>
          ) : (
            <>
              {!data?.configured && (
                <p className="text-sm text-amber-300">YouTube OAuth credentials are not configured.</p>
              )}
              <Button asChild disabled={!data?.configured} className="bg-red-600 hover:bg-red-700">
                <a href="/api/youtube/connect">
                  <Youtube className="mr-2 h-4 w-4" />
                  Connect YouTube
                </a>
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { usePageMeta } from "@/hooks/use-page-meta";
import { apiRequest } from "@/lib/queryClient";
import { Music, Video, Copy, Sparkles, Loader2, ArrowRight } from "lucide-react";

// Partner creation sites (lead funnel). Override at build if the domains change.
const DIGITAL_DRIFT_STUDIO = "https://digitaldriftproductions.replit.app/studio";
const AIBEATSYNC = "https://aibeatsync.com";

const NFL_TEAMS = [
  "Cardinals","Falcons","Ravens","Bills","Panthers","Bears","Bengals","Browns","Cowboys","Broncos",
  "Lions","Packers","Texans","Colts","Jaguars","Chiefs","Raiders","Chargers","Rams","Dolphins",
  "Vikings","Patriots","Saints","Giants","Jets","Eagles","Steelers","49ers","Seahawks","Buccaneers","Titans","Commanders",
];
const NBA_TEAMS = [
  "Hawks","Celtics","Nets","Hornets","Bulls","Cavaliers","Mavericks","Nuggets","Pistons","Warriors",
  "Rockets","Pacers","Clippers","Lakers","Grizzlies","Heat","Bucks","Timberwolves","Pelicans","Knicks",
  "Thunder","Magic","76ers","Suns","Trail Blazers","Kings","Spurs","Raptors","Jazz","Wizards",
];

interface HypeResult {
  team: string;
  style: string;
  lyrics: string;
  title: string;
}

export default function TeamHype() {
  usePageMeta({
    title: "Team Hype — Make Your Team's AI Anthem | EliteLineup",
    description: "Turn your favorite team into a custom AI hype anthem, then make the song on Digital Drift and a video on AIBeatSync.",
  });

  const [sport, setSport] = useState<"NFL" | "NBA">("NFL");
  const [team, setTeam] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<HypeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const teams = sport === "NFL" ? NFL_TEAMS : NBA_TEAMS;

  async function generate() {
    if (!team) { setError("Pick your team first."); return; }
    setLoading(true); setError(null); setResult(null); setCopied(false);
    try {
      const res = await apiRequest("POST", "/api/team-hype", { team, sport });
      setResult(await res.json());
    } catch {
      setError("Couldn't generate right now. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function copyLyrics() {
    if (!result) return;
    try { await navigator.clipboard.writeText(result.lyrics); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { /* ignore */ }
  }

  function makeSong() {
    copyLyrics();
    window.open(DIGITAL_DRIFT_STUDIO, "_blank", "noopener");
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-5 py-12 md:py-16">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/30 text-primary text-xs uppercase tracking-widest mb-4">
            <Sparkles className="w-3.5 h-3.5" /> New · Free
          </div>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-3">Make Your Team's Hype Anthem</h1>
          <p className="text-muted-foreground max-w-xl mx-auto">
            Pick your team and we'll write a custom AI hype anthem. Then turn it into a real song on Digital Drift and a
            game-day video on AIBeatSync — share it before kickoff.
          </p>
        </div>

        <Card className="p-6 md:p-8">
          <div className="flex gap-2 mb-5">
            {(["NFL", "NBA"] as const).map((s) => (
              <button
                key={s}
                onClick={() => { setSport(s); setTeam(""); }}
                className={`px-4 py-2 rounded-md text-sm font-semibold transition ${sport === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
              >
                {s}
              </button>
            ))}
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <select
              value={team}
              onChange={(e) => setTeam(e.target.value)}
              className="flex-1 bg-muted border border-border rounded-md px-4 py-3 text-sm outline-none focus:border-primary"
            >
              <option value="">Choose your {sport} team…</option>
              {teams.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <Button onClick={generate} disabled={loading} className="sm:w-52">
              {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Writing…</> : <><Sparkles className="w-4 h-4 mr-2" /> Generate Anthem</>}
            </Button>
          </div>
          {error && <p className="text-red-400 text-sm mt-3">{error}</p>}

          {result && (
            <div className="mt-7 border-t border-border pt-6">
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <div>
                  <h2 className="text-xl font-bold">{result.title}</h2>
                  <p className="text-muted-foreground text-xs mt-0.5">Suggested style: {result.style}</p>
                </div>
                <Button variant="outline" size="sm" onClick={copyLyrics}>
                  <Copy className="w-3.5 h-3.5 mr-1.5" /> {copied ? "Copied!" : "Copy lyrics"}
                </Button>
              </div>
              <pre className="whitespace-pre-wrap font-mono text-sm bg-muted/50 border border-border rounded-md p-4 max-h-96 overflow-auto">{result.lyrics}</pre>

              <div className="grid sm:grid-cols-2 gap-3 mt-5">
                <button onClick={makeSong} className="group flex items-center justify-between gap-3 rounded-lg border border-primary/40 bg-primary/10 hover:bg-primary/20 transition p-4 text-left">
                  <span className="flex items-center gap-3">
                    <Music className="w-5 h-5 text-primary" />
                    <span>
                      <span className="block font-semibold text-sm">Make the song</span>
                      <span className="block text-muted-foreground text-xs">on Digital Drift · lyrics copied for you</span>
                    </span>
                  </span>
                  <ArrowRight className="w-4 h-4 text-primary group-hover:translate-x-0.5 transition" />
                </button>
                <a href={AIBEATSYNC} target="_blank" rel="noopener noreferrer" className="group flex items-center justify-between gap-3 rounded-lg border border-border hover:border-primary/40 transition p-4 text-left">
                  <span className="flex items-center gap-3">
                    <Video className="w-5 h-5 text-cyan-400" />
                    <span>
                      <span className="block font-semibold text-sm">Make the video</span>
                      <span className="block text-muted-foreground text-xs">on AIBeatSync · post to socials</span>
                    </span>
                  </span>
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition" />
                </a>
              </div>
              <p className="text-muted-foreground text-xs mt-4 text-center">
                Free anthem from EliteLineup. Song &amp; video creation happen on our partner sites, Digital Drift &amp; AIBeatSync.
              </p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

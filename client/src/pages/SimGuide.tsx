import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { usePageMeta } from "@/hooks/use-page-meta";
import {
  Zap, Target, Settings2, TrendingUp, BarChart3, Shield,
  ChevronRight, Download, Layers, Gauge, Users, Lock,
  Unlock, Ban, Crosshair, Timer, Shuffle, Star,
  Activity, LineChart
} from "lucide-react";

const CONTEST_CONFIGS = [
  {
    title: "Large-Field GPP",
    subtitle: "Thousands of entries",
    color: "border-violet-500/40 bg-violet-500/5",
    badge: "bg-violet-500/20 text-violet-300",
    settings: [
      { label: "Sim Count", value: "500" },
      { label: "Max Exposure", value: "30–40%" },
      { label: "Star Rating", value: "2★ or higher" },
      { label: "Game Stack", value: "Off" },
      { label: "Target Game", value: "Only if strong read" },
    ],
    tip: "Maximum diversity. Every simulation produces a unique lineup, giving you the widest net of high-ceiling combinations.",
  },
  {
    title: "Small-Field GPP",
    subtitle: "Under 1,000 entries",
    color: "border-cyan-500/40 bg-cyan-500/5",
    badge: "bg-cyan-500/20 text-cyan-300",
    settings: [
      { label: "Sim Count", value: "200" },
      { label: "Max Exposure", value: "50–60%" },
      { label: "Star Rating", value: "3★ or higher" },
      { label: "Game Stack", value: "Off" },
      { label: "Target Game", value: "Optional" },
    ],
    tip: "Fewer sims mean more overlap, concentrating exposure on the players the engine likes most.",
  },
  {
    title: "Single Entry / Head-to-Head",
    subtitle: "One lineup",
    color: "border-emerald-500/40 bg-emerald-500/5",
    badge: "bg-emerald-500/20 text-emerald-300",
    settings: [
      { label: "Sim Count", value: "100" },
      { label: "Max Exposure", value: "100% (or blank)" },
      { label: "Star Rating", value: "3★ or higher" },
      { label: "Game Stack", value: "Off" },
      { label: "Target Game", value: "Optional" },
    ],
    tip: "Take the #1 ranked lineup by composite score. Balances consistency with ceiling.",
  },
];

const STEPS = [
  { icon: Layers, text: "Open the Pro Optimizer page" },
  { icon: Target, text: "Select your sport and tonight's main slate" },
  { icon: Zap, text: "Toggle Sim Mode ON (the purple toggle)" },
  { icon: Gauge, text: "Set your sim count (500 large GPP, 200 small, 100 single)" },
  { icon: Users, text: "Set Max Exposure based on contest size" },
  { icon: Star, text: "Optionally set a Star Rating minimum to trim the pool" },
  { icon: Lock, text: "Lock any must-have players (they appear in every lineup)" },
  { icon: Ban, text: "Exclude any players you want to fade" },
  { icon: Crosshair, text: "Optionally select a Target Game for a 15% projection boost" },
  { icon: Timer, text: "Click Generate and wait up to 30 seconds" },
];

const METRICS = [
  {
    label: "Composite Score",
    description: "The overall ranking metric. Higher is better. Weights average performance, upside percentiles, and frequency.",
    color: "text-violet-400",
  },
  {
    label: "Avg",
    description: "Mean projected score across all simulations. Indicates expected floor.",
    color: "text-blue-400",
  },
  {
    label: "P75 / P90",
    description: "The score this lineup hits in the top 25% and top 10% of simulations. These indicate ceiling potential — critical for GPP.",
    color: "text-emerald-400",
  },
  {
    label: "Freq%",
    description: "How often this exact lineup was the optimal solution across all sims. Higher frequency means more robust across game scripts.",
    color: "text-amber-400",
  },
  {
    label: "Stack",
    description: "Which game has the most players from your lineup. Natural 3–4 player stacks indicate correlated upside.",
    color: "text-cyan-400",
  },
];

const TIPS = [
  {
    icon: Unlock,
    title: "Don't over-lock",
    text: "Locking more than 2–3 players removes the diversity advantage that makes sim mode powerful.",
  },
  {
    icon: Activity,
    title: "Check the Vegas context",
    text: "After generation, the response shows whether Vegas and DvP data were applied. Both should show as active for the best results.",
  },
  {
    icon: BarChart3,
    title: "Use exposure data",
    text: "Top exposure players are the ones the engine found across many different game scripts — these are your core plays. Under 10% exposure indicates leverage/contrarian picks.",
  },
  {
    icon: Shuffle,
    title: "Regenerate if needed",
    text: "Each run uses random sampling, so running again produces different lineups. Generate once with the right exposure cap rather than running multiple times.",
  },
  {
    icon: LineChart,
    title: "Review the stack",
    text: "For NBA, a natural 3+ player stack from a high-total game is a strong GPP signal. The sim engine creates these organically through correlated game and team factors.",
  },
];

const BEHIND_THE_SCENES = [
  "Pulls your player pool and applies injury adjustments, scout signals, and any custom projections",
  "Fetches today's Vegas lines (game totals + implied team totals) and defensive matchup data — both cached daily",
  "Adjusts base projections using Defense vs Position multipliers (shifts each player's median)",
  "Runs N simulations, each randomizing game pace, team environment, and individual player variance — with Vegas data widening variance for shootout games",
  "Solves an optimal lineup for each simulation's projections",
  "Scores every unique lineup across ALL simulations for consistency and ceiling",
  "Applies your exposure caps and returns the top lineups ranked by composite score",
];

export default function SimGuide() {
  usePageMeta({ title: "Monte Carlo Simulation Guide - DFS Strategy", description: "Learn how to use Monte Carlo simulations for DFS lineup optimization. Master GPP strategy with our comprehensive simulation guide.", path: "/sim-guide" });
  const handleDownload = () => {
    const content = generatePlainTextGuide();
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "EliteLineup_SimMode_Guide.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-[#0F172A] text-white">
      <div className="max-w-4xl mx-auto px-4 py-12 space-y-12">

        <div className="text-center space-y-4">
          <Badge className="bg-violet-500/20 text-violet-300 border-violet-500/30 text-sm px-3 py-1">
            Simulation Optimizer
          </Badge>
          <h1 className="text-4xl font-bold tracking-tight" data-testid="text-guide-title">
            Monte Carlo Sim Mode Guide
          </h1>
          <p className="text-slate-400 text-lg max-w-2xl mx-auto">
            How to configure the simulation optimizer for maximum edge in GPP tournaments
          </p>
          <Button
            onClick={handleDownload}
            variant="outline"
            className="border-slate-600 text-slate-300 hover:bg-slate-800"
            data-testid="button-download-guide"
          >
            <Download className="w-4 h-4 mr-2" />
            Download Guide
          </Button>
        </div>

        <Card className="bg-slate-800/50 border-slate-700 p-6 space-y-4">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Zap className="w-5 h-5 text-violet-400" />
            What is Sim Mode?
          </h2>
          <p className="text-slate-300 leading-relaxed">
            Sim Mode runs hundreds of game-script simulations instead of using a single set of projections.
            Each simulation randomizes game pace, team scoring environment, and individual player performance —
            then solves an optimal lineup for that scenario. The result is a diverse pool of high-ceiling lineups
            built for GPP (tournament) contests.
          </p>
          <p className="text-slate-300 leading-relaxed">
            Two additional data layers are applied automatically:
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-700/50">
              <div className="text-emerald-400 font-medium mb-1">Vegas Lines</div>
              <p className="text-slate-400 text-sm">
                Game totals and team implied totals from sportsbooks. Widens variance for projected shootouts,
                narrows it for low-scoring games.
              </p>
            </div>
            <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-700/50">
              <div className="text-cyan-400 font-medium mb-1">Defense vs Position (DvP)</div>
              <p className="text-slate-400 text-sm">
                Matchup-based adjustments that boost players facing weak defenses and temper those facing elite ones.
              </p>
            </div>
          </div>
        </Card>

        <div className="space-y-4">
          <h2 className="text-2xl font-semibold">Recommended Settings by Contest Type</h2>
          <div className="grid grid-cols-1 gap-4">
            {CONTEST_CONFIGS.map((cfg) => (
              <Card key={cfg.title} className={`border ${cfg.color} p-6 space-y-4`}>
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold">{cfg.title}</h3>
                    <p className="text-slate-400 text-sm">{cfg.subtitle}</p>
                  </div>
                  <Badge className={cfg.badge}>{cfg.settings[0].value} sims</Badge>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  {cfg.settings.map((s) => (
                    <div key={s.label} className="bg-slate-900/60 rounded-lg p-3 text-center">
                      <div className="text-slate-500 text-xs uppercase tracking-wider mb-1">{s.label}</div>
                      <div className="text-white font-medium text-sm">{s.value}</div>
                    </div>
                  ))}
                </div>
                <p className="text-slate-400 text-sm italic">{cfg.tip}</p>
              </Card>
            ))}
          </div>
        </div>

        <Card className="bg-slate-800/50 border-slate-700 p-6 space-y-4">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <LineChart className="w-5 h-5 text-emerald-400" />
            Understanding the Results
          </h2>
          <div className="space-y-3">
            {METRICS.map((m) => (
              <div key={m.label} className="flex gap-3">
                <span className={`font-semibold min-w-[140px] ${m.color}`}>{m.label}</span>
                <span className="text-slate-400">{m.description}</span>
              </div>
            ))}
          </div>
        </Card>

        <div className="space-y-4">
          <h2 className="text-2xl font-semibold flex items-center gap-2">
            <Settings2 className="w-6 h-6 text-violet-400" />
            Step-by-Step Setup
          </h2>
          <div className="space-y-2">
            {STEPS.map((step, i) => (
              <div key={i} className="flex items-center gap-4 bg-slate-800/40 border border-slate-700/40 rounded-lg px-4 py-3">
                <div className="flex items-center justify-center w-8 h-8 rounded-full bg-violet-500/20 text-violet-400 font-bold text-sm shrink-0">
                  {i + 1}
                </div>
                <step.icon className="w-4 h-4 text-slate-500 shrink-0" />
                <span className="text-slate-300">{step.text}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <h2 className="text-2xl font-semibold">Tips for Best Results</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {TIPS.map((tip) => (
              <Card key={tip.title} className="bg-slate-800/50 border-slate-700 p-5 space-y-2">
                <div className="flex items-center gap-2">
                  <tip.icon className="w-4 h-4 text-amber-400" />
                  <h3 className="font-semibold">{tip.title}</h3>
                </div>
                <p className="text-slate-400 text-sm leading-relaxed">{tip.text}</p>
              </Card>
            ))}
          </div>
        </div>

        <Card className="bg-slate-800/50 border-slate-700 p-6 space-y-4">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Shield className="w-5 h-5 text-cyan-400" />
            What Happens Behind the Scenes
          </h2>
          <p className="text-slate-400 mb-2">When you click Generate in Sim Mode, the system:</p>
          <ol className="space-y-2">
            {BEHIND_THE_SCENES.map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-400 text-xs font-bold shrink-0 mt-0.5">
                  {i + 1}
                </span>
                <span className="text-slate-300 text-sm">{step}</span>
              </li>
            ))}
          </ol>
        </Card>

        <Card className="bg-slate-800/50 border-slate-700 p-6 space-y-3">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-amber-400" />
            Tier Access
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-700/50 text-center">
              <div className="text-blue-400 font-semibold mb-1">Sharpshooter</div>
              <div className="text-slate-500 text-sm mb-2">$19.99/mo</div>
              <div className="text-slate-300 text-sm">Up to 200 sims</div>
              <div className="text-slate-300 text-sm">400 lineups max</div>
            </div>
            <div className="bg-slate-900/50 rounded-lg p-4 border border-violet-500/30 text-center ring-1 ring-violet-500/20">
              <div className="text-violet-400 font-semibold mb-1">Champion</div>
              <div className="text-slate-500 text-sm mb-2">$39.99/mo</div>
              <div className="text-slate-300 text-sm">Up to 500 sims</div>
              <div className="text-slate-300 text-sm">1,000 lineups max</div>
            </div>
            <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-700/50 text-center">
              <div className="text-emerald-400 font-semibold mb-1">Admin</div>
              <div className="text-slate-500 text-sm mb-2">Internal</div>
              <div className="text-slate-300 text-sm">Up to 1,000 sims</div>
              <div className="text-slate-300 text-sm">2,000 lineups max</div>
            </div>
          </div>
        </Card>

        <div className="text-center pt-4">
          <Button
            onClick={handleDownload}
            className="bg-violet-600 hover:bg-violet-700 text-white px-6"
            data-testid="button-download-guide-bottom"
          >
            <Download className="w-4 h-4 mr-2" />
            Download This Guide
          </Button>
        </div>
      </div>
    </div>
  );
}

function generatePlainTextGuide(): string {
  return `ELITELINEUP AI — MONTE CARLO SIMULATION OPTIMIZER GUIDE
========================================================

WHAT IS SIM MODE?

Sim Mode runs hundreds of game-script simulations instead of using a single set of projections. Each simulation randomizes game pace, team scoring environment, and individual player performance — then solves an optimal lineup for that scenario. The result is a diverse pool of high-ceiling lineups built for GPP (tournament) contests.

Two additional data layers are applied automatically:

  - Vegas Lines — Game totals and team implied totals from sportsbooks, which widen variance for projected shootouts and narrow it for low-scoring games.

  - Defense vs Position (DvP) — Matchup-based adjustments that boost players facing weak defenses and temper those facing elite ones.

Both are applied automatically — no configuration needed.


RECOMMENDED SETTINGS BY CONTEST TYPE
-------------------------------------

LARGE-FIELD GPP (thousands of entries)
  Sim Count:       500
  Max Exposure:    30-40%
  Star Rating:     2-star or higher
  Game Stack:      Off
  Target Game:     Only if you have a strong read

  Maximum diversity. Every simulation produces a unique lineup, giving you the widest net of high-ceiling combinations.

SMALL-FIELD GPP (under 1,000 entries)
  Sim Count:       200
  Max Exposure:    50-60%
  Star Rating:     3-star or higher
  Game Stack:      Off
  Target Game:     Optional

  Fewer sims mean more overlap between lineups, which concentrates your exposure on the players the engine likes most.

SINGLE ENTRY / HEAD-TO-HEAD
  Sim Count:       100
  Max Exposure:    100% (or leave blank)
  Star Rating:     3-star or higher
  Game Stack:      Off
  Target Game:     Optional

  Take the #1 ranked lineup by composite score. The composite formula (35% average + 35% P75 + 20% P90 + 10% frequency) balances consistency with ceiling.


UNDERSTANDING THE RESULTS
--------------------------

Composite Score — The overall ranking metric. Higher is better. Weights average performance, upside percentiles, and frequency.

Avg — Mean projected score across all simulations. Indicates expected floor.

P75 / P90 — The score this lineup hits in the top 25% and top 10% of simulations. These indicate ceiling potential — critical for GPP.

Freq% — How often this exact lineup was the optimal solution across all sims. Higher frequency means more robust across game scripts.

Stack — Which game has the most players from your lineup. Natural 3-4 player stacks from the same game indicate correlated upside.


STEP-BY-STEP SETUP
-------------------

 1. Open the Pro Optimizer page
 2. Select your sport and tonight's main slate from the dropdown
 3. Toggle Sim Mode ON (the purple toggle)
 4. Set your sim count (500 for large GPP, 200 for small, 100 for single entry)
 5. Set Max Exposure based on contest size (30-40% for large fields)
 6. Optionally set a Star Rating minimum to trim the player pool
 7. Lock any players you're confident in — they'll appear in every lineup
 8. Exclude any players you want to fade — they'll be removed entirely
 9. If you have a strong conviction on a specific game (e.g., highest over/under), select it in the Target Game dropdown for a 15% projection boost
10. Click Generate and wait up to 30 seconds


TIPS FOR BEST RESULTS
----------------------

Don't over-lock.
  Locking more than 2-3 players removes the diversity advantage that makes sim mode powerful.

Check the Vegas context.
  After generation, the response shows whether Vegas and DvP data were applied. Both should show as active for the best results.

Use exposure data.
  Top exposure players are the ones the engine found across many different game scripts — these are your core plays. Players appearing in under 10% of lineups are leverage/contrarian picks.

Regenerate if needed.
  Each run uses random sampling, so running again will produce different lineups. If you're building a 20-lineup portfolio, generate once with the right exposure cap rather than running multiple times.

Review the stack.
  For NBA, a natural 3+ player stack from a high-total game is a strong GPP signal. The sim engine creates these organically through correlated game and team factors rather than forcing them.


WHAT HAPPENS BEHIND THE SCENES
--------------------------------

When you click Generate in Sim Mode, the system:

 1. Pulls your player pool and applies injury adjustments, scout signals, and any custom projections
 2. Fetches today's Vegas lines (game totals + implied team totals) and defensive matchup data — both cached daily
 3. Adjusts base projections using DvP multipliers (shifts where each player's median sits)
 4. Runs N simulations, each randomizing game pace, team environment, and individual player variance — with Vegas data widening variance for shootout games
 5. Solves an optimal lineup for each simulation's projections
 6. Scores every unique lineup across ALL simulations for consistency and ceiling
 7. Applies your exposure caps and returns the top lineups ranked by composite score


TIER ACCESS
------------

Sharpshooter ($19.99/mo)
  Up to 200 sims, 400 lineups

Champion ($39.99/mo)
  Up to 500 sims, 1,000 lineups

Admin (Internal)
  Up to 1,000 sims, 2,000 lineups


========================================================
EliteLineup AI — elitelineup.com
`;
}

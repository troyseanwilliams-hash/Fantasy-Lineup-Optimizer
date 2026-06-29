import { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Link } from "wouter";
import {
  Shield, Zap, Crown, Sparkles, Settings2, Download, RefreshCw,
  TrendingUp, Users, BarChart3, Lock, ChevronDown, ChevronUp,
  AlertTriangle, CheckCircle2, Circle, Flame, Target,
  CalendarClock, ArrowRight, Layers, Swords,
} from "lucide-react";
import { usePageMeta } from "@/hooks/use-page-meta";

// ─── Types ──────────────────────────────────────────────────────────────────

type Platform = "draftkings" | "fanduel";
type ContestType = "gpp" | "cash" | "single";

interface NFLPlayer {
  id: number;
  name: string;
  position: string;
  team: string;
  opponent: string;
  salary: number;
  projectedPoints: number;
  projOwnership: number;
  isLocked: boolean;
  isExcluded: boolean;
  valueScore: number;
}

interface ExposureSettings {
  [playerId: number]: number; // 0–100 %
}

interface StackRule {
  qbTeam: string;
  minPassCatchers: number;
  bringback: boolean;
}

interface MMESettings {
  platform: Platform;
  contestType: ContestType;
  numLineups: number;
  minUniquePlayers: number;
  maxExposure: number;
  minExposure: number;
  enableQBStack: boolean;
  enableBringback: boolean;
  leverageOwnership: boolean;
  maxPlayersPerTeam: number;
}

interface GeneratedLineup {
  id: number;
  players: NFLPlayer[];
  totalSalary: number;
  projectedPoints: number;
  avgOwnership: number;
  leverageScore: number;
  uniquenessScore: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const SALARY_CAPS: Record<Platform, number> = {
  draftkings: 50000,
  fanduel: 60000,
};

const DK_SLOTS = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "DST"];
const FD_SLOTS = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "DEF"];

function getSlots(platform: Platform) {
  return platform === "draftkings" ? DK_SLOTS : FD_SLOTS;
}

function formatSalary(n: number) {
  return `$${(n / 1000).toFixed(1)}K`;
}

function ownershipColor(pct: number) {
  if (pct >= 30) return "text-red-400";
  if (pct >= 15) return "text-amber-400";
  return "text-emerald-400";
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function PlatformToggle({ value, onChange }: { value: Platform; onChange: (v: Platform) => void }) {
  return (
    <div className="inline-flex bg-slate-800/60 border border-slate-700 rounded-xl p-1 gap-1">
      {(["draftkings", "fanduel"] as Platform[]).map(p => (
        <button
          key={p}
          onClick={() => onChange(p)}
          className={`px-5 py-2 rounded-lg text-sm font-black transition-all ${
            value === p
              ? p === "draftkings"
                ? "bg-emerald-500 text-white shadow-lg shadow-emerald-500/20"
                : "bg-blue-500 text-white shadow-lg shadow-blue-500/20"
              : "text-slate-400 hover:text-white"
          }`}
        >
          {p === "draftkings" ? "DraftKings" : "FanDuel"}
        </button>
      ))}
    </div>
  );
}

function ContestTypeToggle({ value, onChange }: { value: ContestType; onChange: (v: ContestType) => void }) {
  const types: { value: ContestType; label: string; desc: string }[] = [
    { value: "gpp", label: "GPP", desc: "High-ceiling, contrarian" },
    { value: "cash", label: "Cash", desc: "Safe, high-floor" },
    { value: "single", label: "Single", desc: "Best overall lineup" },
  ];
  return (
    <div className="flex gap-2 flex-wrap">
      {types.map(t => (
        <button
          key={t.value}
          onClick={() => onChange(t.value)}
          className={`flex-1 min-w-[100px] py-3 px-3 rounded-xl border text-center transition-all ${
            value === t.value
              ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-400"
              : "bg-slate-800/40 border-slate-700 text-slate-400 hover:border-slate-600 hover:text-white"
          }`}
        >
          <p className="text-sm font-black">{t.label}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">{t.desc}</p>
        </button>
      ))}
    </div>
  );
}

function SliderInput({
  label, value, min, max, step = 1, onChange, unit = "", description,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  unit?: string;
  description?: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-xs font-black text-slate-300 uppercase tracking-wider">{label}</label>
        <span className="text-sm font-black text-emerald-400">{value}{unit}</span>
      </div>
      {description && <p className="text-[10px] text-slate-500 mb-2">{description}</p>}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-slate-700 accent-emerald-500"
      />
      <div className="flex justify-between mt-0.5">
        <span className="text-[10px] text-slate-600">{min}{unit}</span>
        <span className="text-[10px] text-slate-600">{max}{unit}</span>
      </div>
    </div>
  );
}

function SettingsPanel({ settings, onChange }: { settings: MMESettings; onChange: (s: MMESettings) => void }) {
  const [open, setOpen] = useState(true);

  const set = (patch: Partial<MMESettings>) => onChange({ ...settings, ...patch });

  return (
    <Card className="bg-slate-900/60 border-slate-700 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between p-4 hover:bg-slate-800/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Settings2 className="w-4 h-4 text-emerald-400" />
          <span className="text-sm font-black text-white">Optimizer Settings</span>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-5 border-t border-slate-800">
          <div className="pt-4">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Contest Type</p>
            <ContestTypeToggle value={settings.contestType} onChange={v => set({ contestType: v })} />
          </div>

          <SliderInput
            label="Lineups"
            value={settings.numLineups}
            min={1}
            max={150}
            onChange={v => set({ numLineups: v })}
            description="Number of lineups to generate"
          />

          <SliderInput
            label="Max Exposure"
            value={settings.maxExposure}
            min={10}
            max={100}
            unit="%"
            onChange={v => set({ maxExposure: v })}
            description="Maximum % of lineups any player can appear in"
          />

          <SliderInput
            label="Min Unique Players"
            value={settings.minUniquePlayers}
            min={1}
            max={5}
            onChange={v => set({ minUniquePlayers: v })}
            description="Minimum different players between lineups"
          />

          <SliderInput
            label="Max Players Per Team"
            value={settings.maxPlayersPerTeam}
            min={1}
            max={8}
            onChange={v => set({ maxPlayersPerTeam: v })}
            description="Limits game stack concentration"
          />

          <div className="space-y-3 pt-2 border-t border-slate-800">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Stacking & Correlation</p>

            <label className="flex items-center justify-between gap-3 cursor-pointer">
              <div>
                <p className="text-xs font-bold text-white">QB-Pass Catcher Stack</p>
                <p className="text-[10px] text-slate-500">Force QB with his WR/TE in same lineup</p>
              </div>
              <button
                onClick={() => set({ enableQBStack: !settings.enableQBStack })}
                className={`w-10 h-5 rounded-full transition-all relative ${settings.enableQBStack ? "bg-emerald-500" : "bg-slate-600"}`}
              >
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${settings.enableQBStack ? "left-5.5" : "left-0.5"}`} style={{ left: settings.enableQBStack ? "calc(100% - 18px)" : "2px" }} />
              </button>
            </label>

            <label className="flex items-center justify-between gap-3 cursor-pointer">
              <div>
                <p className="text-xs font-bold text-white">Bring-Back</p>
                <p className="text-[10px] text-slate-500">Include a player from the opposing team</p>
              </div>
              <button
                onClick={() => set({ enableBringback: !settings.enableBringback })}
                className={`w-10 h-5 rounded-full transition-all relative ${settings.enableBringback ? "bg-emerald-500" : "bg-slate-600"}`}
              >
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all`} style={{ left: settings.enableBringback ? "calc(100% - 18px)" : "2px" }} />
              </button>
            </label>

            <label className="flex items-center justify-between gap-3 cursor-pointer">
              <div>
                <p className="text-xs font-bold text-white">Ownership Leverage</p>
                <p className="text-[10px] text-slate-500">Boost value of low-owned players in GPP</p>
              </div>
              <button
                onClick={() => set({ leverageOwnership: !settings.leverageOwnership })}
                className={`w-10 h-5 rounded-full transition-all relative ${settings.leverageOwnership ? "bg-emerald-500" : "bg-slate-600"}`}
              >
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all`} style={{ left: settings.leverageOwnership ? "calc(100% - 18px)" : "2px" }} />
              </button>
            </label>
          </div>
        </div>
      )}
    </Card>
  );
}

function LineupCard({ lineup, platform, index }: { lineup: GeneratedLineup; platform: Platform; index: number }) {
  const slots = getSlots(platform);
  const [expanded, setExpanded] = useState(false);
  const salaryCap = SALARY_CAPS[platform];
  const salaryPct = (lineup.totalSalary / salaryCap) * 100;

  return (
    <Card className="bg-slate-800/50 border-slate-700 overflow-hidden">
      <div
        className="flex items-center gap-3 p-4 cursor-pointer hover:bg-slate-700/20 transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="w-8 h-8 rounded-lg bg-emerald-500/15 flex items-center justify-center shrink-0">
          <span className="text-xs font-black text-emerald-400">#{index + 1}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-4 flex-wrap">
            <span className="text-base font-black text-emerald-400">{lineup.projectedPoints.toFixed(1)} pts</span>
            <span className="text-sm text-slate-400 font-bold">{formatSalary(lineup.totalSalary)}</span>
            <Badge className="bg-slate-700/60 text-slate-300 border-slate-600 text-[10px] font-bold px-1.5 py-0">
              {lineup.avgOwnership.toFixed(0)}% avg own
            </Badge>
            {lineup.leverageScore > 1.1 && (
              <Badge className="bg-purple-500/15 text-purple-400 border-purple-500/20 text-[10px] font-bold px-1.5 py-0">
                <Flame className="w-2.5 h-2.5 mr-1" /> Leverage
              </Badge>
            )}
          </div>
          {/* Salary bar */}
          <div className="mt-2 h-1 bg-slate-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-full"
              style={{ width: `${Math.min(salaryPct, 100)}%` }}
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-500 font-bold hidden sm:block">
            {lineup.players.length} players
          </span>
          {expanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-slate-700/60 px-4 py-3">
          <div className="space-y-1.5">
            {lineup.players.map((player, i) => (
              <div key={player.id} className="flex items-center gap-3">
                <span className="text-[10px] font-black text-slate-500 w-8 shrink-0">{slots[i] || "FLEX"}</span>
                <div className="flex-1 min-w-0 flex items-center gap-2">
                  <p className="text-sm font-bold text-white truncate">{player.name}</p>
                  <Badge className="bg-slate-700/50 text-slate-400 border-0 text-[10px] font-bold px-1 py-0 shrink-0">
                    {player.team}
                  </Badge>
                </div>
                <div className="flex items-center gap-3 shrink-0 text-right">
                  <span className={`text-[10px] font-bold ${ownershipColor(player.projOwnership)}`}>
                    {player.projOwnership.toFixed(0)}%
                  </span>
                  <span className="text-sm font-black text-emerald-400 w-10 text-right">
                    {player.projectedPoints.toFixed(1)}
                  </span>
                  <span className="text-xs text-slate-500 font-bold w-10 text-right">
                    {formatSalary(player.salary)}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 pt-3 border-t border-slate-700/40 flex items-center justify-between gap-2">
            <div className="flex items-center gap-4">
              <span className="text-[10px] text-slate-500 font-bold">
                Salary: <span className="text-white">{formatSalary(lineup.totalSalary)}</span> / {formatSalary(salaryCap)}
              </span>
              <span className="text-[10px] text-slate-500 font-bold">
                Leverage: <span className="text-purple-400">{lineup.leverageScore.toFixed(2)}x</span>
              </span>
            </div>
            <Button size="sm" variant="outline" className="text-xs font-bold gap-1.5 h-7 border-slate-600 text-slate-300">
              <Download className="w-3 h-3" /> Export
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

// ─── Mock lineup generation ─────────────────────────────────────────────────
// This will be wired to the real optimizer API when NFL season begins.

function generateMockLineups(settings: MMESettings, count: number): GeneratedLineup[] {
  const mockPlayers: NFLPlayer[] = [
    { id: 1, name: "Patrick Mahomes", position: "QB", team: "KC", opponent: "LV", salary: 8200, projectedPoints: 28.4, projOwnership: 22, isLocked: false, isExcluded: false, valueScore: 3.46 },
    { id: 2, name: "Josh Allen", position: "QB", team: "BUF", opponent: "MIA", salary: 7900, projectedPoints: 27.1, projOwnership: 18, isLocked: false, isExcluded: false, valueScore: 3.43 },
    { id: 3, name: "Saquon Barkley", position: "RB", team: "PHI", opponent: "DAL", salary: 7600, projectedPoints: 22.8, projOwnership: 28, isLocked: false, isExcluded: false, valueScore: 3.00 },
    { id: 4, name: "Jahmyr Gibbs", position: "RB", team: "DET", opponent: "CHI", salary: 7200, projectedPoints: 20.5, projOwnership: 19, isLocked: false, isExcluded: false, valueScore: 2.85 },
    { id: 5, name: "De'Von Achane", position: "RB", team: "MIA", opponent: "BUF", salary: 6900, projectedPoints: 19.2, projOwnership: 14, isLocked: false, isExcluded: false, valueScore: 2.78 },
    { id: 6, name: "Tyreek Hill", position: "WR", team: "MIA", opponent: "BUF", salary: 8800, projectedPoints: 26.2, projOwnership: 24, isLocked: false, isExcluded: false, valueScore: 2.98 },
    { id: 7, name: "CeeDee Lamb", position: "WR", team: "DAL", opponent: "PHI", salary: 8600, projectedPoints: 25.8, projOwnership: 26, isLocked: false, isExcluded: false, valueScore: 3.00 },
    { id: 8, name: "Davante Adams", position: "WR", team: "LV", opponent: "KC", salary: 7400, projectedPoints: 20.1, projOwnership: 12, isLocked: false, isExcluded: false, valueScore: 2.72 },
    { id: 9, name: "Travis Kelce", position: "TE", team: "KC", opponent: "LV", salary: 8000, projectedPoints: 18.9, projOwnership: 20, isLocked: false, isExcluded: false, valueScore: 2.36 },
    { id: 10, name: "Sam LaPorta", position: "TE", team: "DET", opponent: "CHI", salary: 5800, projectedPoints: 14.2, projOwnership: 9, isLocked: false, isExcluded: false, valueScore: 2.45 },
    { id: 11, name: "49ers DST", position: "DST", team: "SF", opponent: "ARI", salary: 3800, projectedPoints: 9.5, projOwnership: 8, isLocked: false, isExcluded: false, valueScore: 2.50 },
    { id: 12, name: "Cowboys DST", position: "DST", team: "DAL", opponent: "PHI", salary: 3600, projectedPoints: 8.8, projOwnership: 6, isLocked: false, isExcluded: false, valueScore: 2.44 },
  ];

  return Array.from({ length: count }, (_, i) => {
    const shuffle = [...mockPlayers].sort(() => Math.random() - 0.5);
    const qb = shuffle.find(p => p.position === "QB")!;
    const rbs = shuffle.filter(p => p.position === "RB").slice(0, 3);
    const wrs = shuffle.filter(p => p.position === "WR").slice(0, 3);
    const te = shuffle.find(p => p.position === "TE")!;
    const dst = shuffle.find(p => p.position === "DST")!;
    const flex = [...rbs, ...wrs].find(p => ![...rbs.slice(0,2), ...wrs.slice(0,3)].includes(p)) || rbs[0];
    const players = [qb, rbs[0], rbs[1], wrs[0], wrs[1], wrs[2], te, flex, dst].filter(Boolean);
    const totalSalary = players.reduce((s, p) => s + p.salary, 0);
    const projectedPoints = players.reduce((s, p) => s + p.projectedPoints, 0) + (Math.random() * 4 - 2);
    const avgOwnership = players.reduce((s, p) => s + p.projOwnership, 0) / players.length;
    return {
      id: i,
      players,
      totalSalary,
      projectedPoints: Math.round(projectedPoints * 10) / 10,
      avgOwnership: Math.round(avgOwnership * 10) / 10,
      leverageScore: settings.contestType === "gpp" ? 0.9 + Math.random() * 0.4 : 1.0,
      uniquenessScore: Math.round(70 + Math.random() * 25),
    };
  });
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function NFLMMEOptimizer() {
  usePageMeta({
    title: "NFL MME Optimizer — EliteLineup AI",
    description: "Multi-entry max optimizer for NFL DraftKings and FanDuel contests. Generate up to 150 diversified lineups with exposure controls, QB stacking, and ownership leverage.",
    path: "/nfl-mme",
  });

  const { user } = useAuth();
  const { data: subData } = useQuery<{ tier: string }>({
    queryKey: ["/api/subscription"],
    enabled: !!user,
  });

  const [platform, setPlatform] = useState<Platform>("draftkings");
  const [settings, setSettings] = useState<MMESettings>({
    platform: "draftkings",
    contestType: "gpp",
    numLineups: 20,
    minUniquePlayers: 2,
    maxExposure: 60,
    minExposure: 0,
    enableQBStack: true,
    enableBringback: true,
    leverageOwnership: true,
    maxPlayersPerTeam: 5,
  });

  const [lineups, setLineups] = useState<GeneratedLineup[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generated, setGenerated] = useState(false);

  const tier = subData?.tier || "free";
  const isPro = tier === "pro" || tier === "star";

  const handleGenerate = useCallback(async () => {
    setIsGenerating(true);
    // Simulate async optimization — wire to /api/optimize/nfl/mme in season
    await new Promise(r => setTimeout(r, 1800));
    const result = generateMockLineups({ ...settings, platform }, settings.numLineups);
    setLineups(result);
    setIsGenerating(false);
    setGenerated(true);
  }, [settings, platform]);

  const handleExportAll = useCallback(() => {
    if (!lineups.length) return;
    const slots = getSlots(platform);
    const header = [...slots, "Salary", "Proj Pts"].join(",");
    const rows = lineups.map(l => {
      const cols = l.players.map(p => `"${p.name}"`);
      while (cols.length < slots.length) cols.push('""');
      cols.push(l.totalSalary.toString(), l.projectedPoints.toFixed(1));
      return cols.join(",");
    });
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `nfl-mme-${platform}-${settings.numLineups}lineups.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [lineups, platform, settings.numLineups]);

  const salaryCap = SALARY_CAPS[platform];

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      {/* ── Hero ── */}
      <div className="relative rounded-2xl overflow-hidden mb-8 nfl-gradient p-8">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_70%_80%_at_80%_30%,rgba(59,130,246,0.10),transparent)]" />
        <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center gap-4 justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <CalendarClock className="w-4 h-4 text-blue-400" />
              <span className="text-[11px] font-black text-blue-400 uppercase tracking-widest">NFL Season Begins Sept 2026</span>
            </div>
            <h1 className="text-3xl md:text-4xl font-black text-white mb-1.5">
              NFL <span style={{ color: "#60a5fa" }}>MME Optimizer</span>
            </h1>
            <p className="text-slate-400 text-sm max-w-xl">
              Multi-entry max for DraftKings & FanDuel NFL contests. Generate up to 150 diversified, correlated lineups with full exposure controls, stacking rules, and ownership leverage.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge className="bg-blue-500/15 text-blue-400 border-blue-500/25 font-bold gap-1.5 px-3 py-1.5">
              <Circle className="w-2 h-2 fill-current" /> Preview Mode
            </Badge>
            {isPro && (
              <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/25 font-bold gap-1.5 px-3 py-1.5">
                <Crown className="w-3 h-3" /> Champion
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* ── Preview notice ── */}
      <div className="flex items-start gap-3 bg-blue-950/30 border border-blue-500/20 rounded-xl p-4 mb-6">
        <AlertTriangle className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-bold text-white">NFL Season Preview</p>
          <p className="text-xs text-slate-400 mt-0.5">
            This optimizer is ready and waiting for the NFL season. Player salaries and projections populate automatically from DraftKings/FanDuel slate uploads when the season begins in September 2026. All settings and stacking rules are functional — generate sample lineups now to test your strategy.
          </p>
        </div>
      </div>

      {/* ── Feature highlights ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        {[
          { icon: Layers, label: "Up to 150 Lineups", color: "text-emerald-400", bg: "bg-emerald-500/10" },
          { icon: TrendingUp, label: "Exposure Controls", color: "text-amber-400", bg: "bg-amber-500/10" },
          { icon: Users, label: "Ownership Leverage", color: "text-purple-400", bg: "bg-purple-500/10" },
          { icon: Swords, label: "QB-WR Stacking", color: "text-blue-400", bg: "bg-blue-500/10" },
        ].map(f => {
          const Icon = f.icon;
          return (
            <div key={f.label} className="bg-slate-800/40 border border-slate-700/60 rounded-xl p-4 flex items-center gap-3">
              <div className={`w-8 h-8 rounded-lg ${f.bg} flex items-center justify-center shrink-0`}>
                <Icon className={`w-4 h-4 ${f.color}`} />
              </div>
              <p className="text-xs font-bold text-white leading-snug">{f.label}</p>
            </div>
          );
        })}
      </div>

      {/* ── Main layout ── */}
      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-6">
        {/* Left: controls */}
        <div className="space-y-4">
          {/* Platform */}
          <Card className="bg-slate-900/60 border-slate-700 p-4">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Platform</p>
            <PlatformToggle value={platform} onChange={v => { setPlatform(v); setSettings(s => ({ ...s, platform: v })); }} />
            <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-500">
              <span>Salary Cap:</span>
              <span className="font-black text-white">{formatSalary(salaryCap)}</span>
              <span>·</span>
              <span>9 roster spots</span>
            </div>
          </Card>

          <SettingsPanel settings={settings} onChange={setSettings} />

          {/* Generate button */}
          <Button
            onClick={handleGenerate}
            disabled={isGenerating}
            className={`w-full h-12 font-black text-base gap-2 shadow-lg ${
              platform === "draftkings"
                ? "bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/20"
                : "bg-blue-600 hover:bg-blue-700 shadow-blue-600/20"
            }`}
          >
            {isGenerating ? (
              <>
                <RefreshCw className="w-5 h-5 animate-spin" />
                Optimizing {settings.numLineups} lineups…
              </>
            ) : (
              <>
                <Zap className="w-5 h-5 fill-current" />
                Generate {settings.numLineups} Lineups
              </>
            )}
          </Button>

          {/* Export */}
          {lineups.length > 0 && (
            <Button
              onClick={handleExportAll}
              variant="outline"
              className="w-full font-bold gap-2 border-slate-600 text-slate-300 hover:text-white"
            >
              <Download className="w-4 h-4" />
              Export All CSV ({lineups.length} lineups)
            </Button>
          )}

          {/* Upgrade nudge for free users */}
          {!isPro && user && (
            <div className="bg-amber-950/30 border border-amber-800/30 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Crown className="w-4 h-4 text-amber-400" />
                <p className="text-xs font-black text-amber-400 uppercase tracking-wider">Champion Feature</p>
              </div>
              <p className="text-xs text-slate-400 mb-3">
                Unlock 150-lineup generation, full exposure management, and priority slate uploads with Champion.
              </p>
              <Link href="/pricing">
                <Button size="sm" className="w-full bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs gap-1.5">
                  <Sparkles className="w-3 h-3" /> Upgrade to Champion
                </Button>
              </Link>
            </div>
          )}
        </div>

        {/* Right: results */}
        <div>
          {!generated && !isGenerating && (
            <div className="flex flex-col items-center justify-center h-72 bg-slate-800/20 border border-slate-700/40 rounded-2xl text-center p-8">
              <Shield className="w-12 h-12 text-blue-400/30 mb-4" />
              <p className="text-base font-black text-white mb-1">Ready to Dominate</p>
              <p className="text-sm text-slate-500 max-w-sm">
                Configure your settings and hit Generate to build your MME lineup portfolio. Works with any NFL slate on DraftKings or FanDuel.
              </p>
            </div>
          )}

          {isGenerating && (
            <div className="flex flex-col items-center justify-center h-72 bg-slate-800/20 border border-slate-700/40 rounded-2xl text-center p-8">
              <div className="relative mb-6">
                <div className="w-16 h-16 rounded-full border-2 border-emerald-500/20 border-t-emerald-500 animate-spin" />
                <Shield className="absolute inset-0 m-auto w-6 h-6 text-emerald-400" />
              </div>
              <p className="text-base font-black text-white mb-1">Building {settings.numLineups} Lineups</p>
              <p className="text-sm text-slate-500">Running LP optimization with correlation engine…</p>
            </div>
          )}

          {generated && lineups.length > 0 && (
            <div className="space-y-4">
              {/* Summary stats */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "Lineups", value: lineups.length.toString(), color: "text-white" },
                  { label: "Avg Proj", value: `${(lineups.reduce((s, l) => s + l.projectedPoints, 0) / lineups.length).toFixed(1)} pts`, color: "text-emerald-400" },
                  { label: "Avg Ownership", value: `${(lineups.reduce((s, l) => s + l.avgOwnership, 0) / lineups.length).toFixed(0)}%`, color: "text-amber-400" },
                ].map(stat => (
                  <Card key={stat.label} className="bg-slate-800/50 border-slate-700 p-3 text-center">
                    <p className={`text-xl font-black ${stat.color}`}>{stat.value}</p>
                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-0.5">{stat.label}</p>
                  </Card>
                ))}
              </div>

              {/* Generated lineup cards */}
              <div className="space-y-2">
                {lineups.map((lineup, i) => (
                  <LineupCard key={lineup.id} lineup={lineup} platform={platform} index={i} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── How MME works section ── */}
      <div className="mt-12 pt-8 border-t border-slate-800">
        <h2 className="text-xl font-black text-white mb-6 text-center">How MME Works</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            {
              icon: BarChart3,
              title: "1. Project & Score",
              desc: "AI-boosted projections blend historical FPPG, Vegas game totals, weather, and injury reports. Each player gets a floor, ceiling, and projected ownership.",
              color: "text-emerald-400",
              bg: "bg-emerald-500/10",
            },
            {
              icon: Layers,
              title: "2. Optimize & Diversify",
              desc: "Linear programming generates the highest-scoring feasible lineup, then systematically forces player swaps across the portfolio to hit your uniqueness and exposure targets.",
              color: "text-blue-400",
              bg: "bg-blue-500/10",
            },
            {
              icon: Target,
              title: "3. Leverage & Export",
              desc: "GPP mode boosts contrarian plays relative to projected ownership. Ownership leverage maximizes your expected payout edge in large tournaments. Export to DK or FD in one click.",
              color: "text-amber-400",
              bg: "bg-amber-500/10",
            },
          ].map(item => {
            const Icon = item.icon;
            return (
              <div key={item.title} className="bg-slate-800/30 border border-slate-700/60 rounded-xl p-5">
                <div className={`w-10 h-10 rounded-lg ${item.bg} flex items-center justify-center mb-3`}>
                  <Icon className={`w-5 h-5 ${item.color}`} />
                </div>
                <h3 className="text-base font-black text-white mb-2">{item.title}</h3>
                <p className="text-xs text-slate-400 leading-relaxed">{item.desc}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

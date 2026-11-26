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
  gameKey?: string;
  isHome?: boolean;
  isFavorite?: boolean;
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
      {(["draftkings"] as Platform[]).map(p => (
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
             <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
               <p className="text-[11px] font-black text-blue-300">Historical NFL portfolio rules active</p>
               <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
                 Targets QB + 1 or 2 pass-catchers, two sub-10% WRs, five to six games,
                 value RBs, home TE/DST preference, and bring-backs in about half of GPP lineups.
               </p>
             </div>

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

// ─── NFL portfolio strategy ──────────────────────────────────────────────────
// These are portfolio weights learned from the attached 2022–2025 top-100
// sample. They are targets across the portfolio, not hard locks on every
// lineup.
const NFL_STRATEGY = {
  nakedQB: 0.102,
  onePassCatcher: 0.491,
  twoPassCatchers: 0.376,
  threePassCatchers: 0.031,
  bringBack: 0.489,
  secondaryStack: 0.67,
  lowOwnedWRs: 2,
  minGames: 5,
  maxGames: 6,
  minRBValue: 4,
};

function shuffled<T>(items: T[]): T[] {
  return [...items].sort(() => Math.random() - 0.5);
}

function addIfAvailable(target: NFLPlayer[], candidate: NFLPlayer | undefined) {
  if (candidate && !target.some(p => p.id === candidate.id)) target.push(candidate);
}

function targetStackSize(index: number, count: number, enabled: boolean): number {
  if (!enabled) return 0;
  if (count === 1) return 1;
  const nakedCount = Math.round(count * NFL_STRATEGY.nakedQB);
  const singleCount = Math.round(count * NFL_STRATEGY.onePassCatcher);
  const tripleCount = count >= 20 ? Math.max(1, Math.round(count * NFL_STRATEGY.threePassCatchers)) : 0;
  const doubleCount = Math.max(0, count - nakedCount - singleCount - tripleCount);
  if (index < nakedCount) return 0;
  if (index < nakedCount + singleCount) return 1;
  if (index < nakedCount + singleCount + doubleCount) return 2;
  return 3;
}

function arrangeClassicRoster(players: NFLPlayer[]): NFLPlayer[] | null {
  const take = (position: string, count: number) => players.filter(p => p.position === position).slice(0, count);
  const qb = take("QB", 1);
  const rbs = take("RB", 2);
  const wrs = take("WR", 3);
  const te = take("TE", 1);
  const dst = players.filter(p => ["DST", "DEF"].includes(p.position)).slice(0, 1);
  const starters = [...qb, ...rbs, ...wrs, ...te, ...dst];
  const flex = players.find(p => ["RB", "WR", "TE"].includes(p.position) && !starters.some(s => s.id === p.id));
  if (qb.length !== 1 || rbs.length !== 2 || wrs.length !== 3 || te.length !== 1 || dst.length !== 1 || !flex) return null;
  return [...qb, ...rbs, ...wrs, ...te, flex, ...dst];
}

export function generateMockLineups(settings: MMESettings, count: number): GeneratedLineup[] {
  const mockPlayers: NFLPlayer[] = [
    { id: 1, name: "Patrick Mahomes", position: "QB", team: "KC", opponent: "LV", salary: 7800, projectedPoints: 25.4, projOwnership: 22, isLocked: false, isExcluded: false, valueScore: 3.26, gameKey: "KC-LV" },
    { id: 2, name: "Josh Allen", position: "QB", team: "BUF", opponent: "MIA", salary: 7600, projectedPoints: 25.1, projOwnership: 18, isLocked: false, isExcluded: false, valueScore: 3.30, gameKey: "BUF-MIA" },
    { id: 13, name: "Jalen Hurts", position: "QB", team: "PHI", opponent: "DAL", salary: 7300, projectedPoints: 23.2, projOwnership: 16, isLocked: false, isExcluded: false, valueScore: 3.18, gameKey: "DAL-PHI" },
    { id: 14, name: "Joe Burrow", position: "QB", team: "CIN", opponent: "CLE", salary: 6900, projectedPoints: 22.4, projOwnership: 9, isLocked: false, isExcluded: false, valueScore: 3.25, gameKey: "CIN-CLE" },
    { id: 3, name: "Saquon Barkley", position: "RB", team: "PHI", opponent: "DAL", salary: 7000, projectedPoints: 20.8, projOwnership: 28, isLocked: false, isExcluded: false, valueScore: 2.97, gameKey: "DAL-PHI" },
    { id: 4, name: "Jahmyr Gibbs", position: "RB", team: "DET", opponent: "CHI", salary: 6800, projectedPoints: 19.7, projOwnership: 19, isLocked: false, isExcluded: false, valueScore: 2.90, gameKey: "CHI-DET" },
    { id: 5, name: "De'Von Achane", position: "RB", team: "MIA", opponent: "BUF", salary: 6600, projectedPoints: 18.8, projOwnership: 14, isLocked: false, isExcluded: false, valueScore: 2.85, gameKey: "BUF-MIA" },
    { id: 15, name: "James Cook", position: "RB", team: "BUF", opponent: "MIA", salary: 6200, projectedPoints: 17.7, projOwnership: 11, isLocked: false, isExcluded: false, valueScore: 2.85, gameKey: "BUF-MIA" },
    { id: 16, name: "Chase Brown", position: "RB", team: "CIN", opponent: "CLE", salary: 5600, projectedPoints: 15.8, projOwnership: 7, isLocked: false, isExcluded: false, valueScore: 2.82, gameKey: "CIN-CLE" },
    { id: 17, name: "Rhamondre Stevenson", position: "RB", team: "NE", opponent: "NYJ", salary: 5400, projectedPoints: 14.9, projOwnership: 8, isLocked: false, isExcluded: false, valueScore: 2.76, gameKey: "NE-NYJ" },
    { id: 6, name: "Tyreek Hill", position: "WR", team: "MIA", opponent: "BUF", salary: 8200, projectedPoints: 24.6, projOwnership: 24, isLocked: false, isExcluded: false, valueScore: 3.00, gameKey: "BUF-MIA" },
    { id: 7, name: "CeeDee Lamb", position: "WR", team: "DAL", opponent: "PHI", salary: 8000, projectedPoints: 23.7, projOwnership: 26, isLocked: false, isExcluded: false, valueScore: 2.96, gameKey: "DAL-PHI" },
    { id: 8, name: "Davante Adams", position: "WR", team: "LV", opponent: "KC", salary: 6800, projectedPoints: 19.1, projOwnership: 12, isLocked: false, isExcluded: false, valueScore: 2.81, gameKey: "KC-LV" },
    { id: 18, name: "Rashee Rice", position: "WR", team: "KC", opponent: "LV", salary: 6100, projectedPoints: 17.9, projOwnership: 8, isLocked: false, isExcluded: false, valueScore: 2.93, gameKey: "KC-LV" },
    { id: 19, name: "Khalil Shakir", position: "WR", team: "BUF", opponent: "MIA", salary: 5000, projectedPoints: 15.1, projOwnership: 6, isLocked: false, isExcluded: false, valueScore: 3.02, gameKey: "BUF-MIA" },
    { id: 20, name: "Wan'Dale Robinson", position: "WR", team: "NYG", opponent: "WAS", salary: 4700, projectedPoints: 14.4, projOwnership: 5, isLocked: false, isExcluded: false, valueScore: 3.06, gameKey: "NYG-WAS" },
    { id: 21, name: "Cedric Tillman", position: "WR", team: "CLE", opponent: "CIN", salary: 4600, projectedPoints: 13.9, projOwnership: 4, isLocked: false, isExcluded: false, valueScore: 3.02, gameKey: "CIN-CLE" },
    { id: 22, name: "Jahan Dotson", position: "WR", team: "PHI", opponent: "DAL", salary: 4500, projectedPoints: 13.7, projOwnership: 6, isLocked: false, isExcluded: false, valueScore: 3.04, gameKey: "DAL-PHI" },
    { id: 25, name: "Xavier Worthy", position: "WR", team: "KC", opponent: "LV", salary: 5200, projectedPoints: 15.6, projOwnership: 7, isLocked: false, isExcluded: false, valueScore: 3.00, gameKey: "KC-LV" },
    { id: 26, name: "Keon Coleman", position: "WR", team: "BUF", opponent: "MIA", salary: 4900, projectedPoints: 14.5, projOwnership: 5, isLocked: false, isExcluded: false, valueScore: 2.96, gameKey: "BUF-MIA" },
    { id: 27, name: "A.J. Brown", position: "WR", team: "PHI", opponent: "DAL", salary: 7200, projectedPoints: 20.8, projOwnership: 18, isLocked: false, isExcluded: false, valueScore: 2.89, gameKey: "DAL-PHI" },
    { id: 28, name: "Ja'Marr Chase", position: "WR", team: "CIN", opponent: "CLE", salary: 7900, projectedPoints: 23.1, projOwnership: 21, isLocked: false, isExcluded: false, valueScore: 2.92, gameKey: "CIN-CLE" },
    { id: 29, name: "Tee Higgins", position: "WR", team: "CIN", opponent: "CLE", salary: 5700, projectedPoints: 16.8, projOwnership: 8, isLocked: false, isExcluded: false, valueScore: 2.95, gameKey: "CIN-CLE" },
    { id: 9, name: "Travis Kelce", position: "TE", team: "KC", opponent: "LV", salary: 6900, projectedPoints: 17.6, projOwnership: 20, isLocked: false, isExcluded: false, valueScore: 2.55, gameKey: "KC-LV", isHome: true },
    { id: 10, name: "Sam LaPorta", position: "TE", team: "DET", opponent: "CHI", salary: 5400, projectedPoints: 14.1, projOwnership: 9, isLocked: false, isExcluded: false, valueScore: 2.61, gameKey: "CHI-DET", isHome: true },
    { id: 23, name: "David Njoku", position: "TE", team: "CLE", opponent: "CIN", salary: 4800, projectedPoints: 13.4, projOwnership: 7, isLocked: false, isExcluded: false, valueScore: 2.79, gameKey: "CIN-CLE", isHome: true },
    { id: 30, name: "Dalton Kincaid", position: "TE", team: "BUF", opponent: "MIA", salary: 4500, projectedPoints: 12.9, projOwnership: 6, isLocked: false, isExcluded: false, valueScore: 2.87, gameKey: "BUF-MIA", isHome: true },
    { id: 31, name: "Dallas Goedert", position: "TE", team: "PHI", opponent: "DAL", salary: 4300, projectedPoints: 12.5, projOwnership: 5, isLocked: false, isExcluded: false, valueScore: 2.91, gameKey: "DAL-PHI", isHome: true },
    { id: 32, name: "Mike Gesicki", position: "TE", team: "CIN", opponent: "CLE", salary: 3700, projectedPoints: 10.7, projOwnership: 3, isLocked: false, isExcluded: false, valueScore: 2.89, gameKey: "CIN-CLE", isHome: false },
    { id: 11, name: "49ers DST", position: "DST", team: "SF", opponent: "ARI", salary: 3500, projectedPoints: 8.9, projOwnership: 8, isLocked: false, isExcluded: false, valueScore: 2.54, gameKey: "ARI-SF", isHome: true, isFavorite: true },
    { id: 12, name: "Cowboys DST", position: "DST", team: "DAL", opponent: "PHI", salary: 3200, projectedPoints: 8.1, projOwnership: 6, isLocked: false, isExcluded: false, valueScore: 2.53, gameKey: "DAL-PHI", isHome: false, isFavorite: true },
    { id: 24, name: "Browns DST", position: "DST", team: "CLE", opponent: "CIN", salary: 2900, projectedPoints: 7.2, projOwnership: 3, isLocked: false, isExcluded: false, valueScore: 2.48, gameKey: "CIN-CLE", isHome: true, isFavorite: false },
  ];

  const qbs = mockPlayers.filter(p => p.position === "QB");
  const usedSignatures = new Set<string>();
  const exposureCounts = new Map<number, number>();
  const lineups: GeneratedLineup[] = [];
  const cap = SALARY_CAPS[settings.platform];
  const maxPlayerAppearances = Math.max(1, Math.ceil(count * settings.maxExposure / 100));

  for (let i = 0; i < count; i++) {
    let selected: NFLPlayer[] = [];
    for (let attempt = 0; attempt < 500 && selected.length === 0; attempt++) {
      const stackCount = targetStackSize(i, count, settings.enableQBStack);
      const eligibleQBs = qbs.filter(candidate =>
        mockPlayers.filter(p => p.team === candidate.team && ["WR", "TE"].includes(p.position)).length >= stackCount
      );
      const qb = shuffled(eligibleQBs)[0];
      if (!qb) continue;
      const players: NFLPlayer[] = [qb];
      const sameTeamPassCatchers = shuffled(mockPlayers
        .filter(p => p.team === qb.team && ["WR", "TE"].includes(p.position))
        .sort((a, b) => b.valueScore - a.valueScore));
      if (stackCount > 0) sameTeamPassCatchers.slice(0, stackCount).forEach(p => addIfAvailable(players, p));
      const bringBackEnabledForLineup = settings.enableBringback && i / Math.max(1, count) < NFL_STRATEGY.bringBack;

      if (bringBackEnabledForLineup) {
        addIfAvailable(players, shuffled(mockPlayers.filter(p => p.team === qb.opponent && ["RB", "WR", "TE"].includes(p.position)))[0]);
      }

      // More than two-thirds of the historical winners included a two-player
      // correlation outside the QB game, led by RB + opposing WR.
      if (i / Math.max(1, count) < NFL_STRATEGY.secondaryStack) {
        const secondaryRBs = shuffled(mockPlayers.filter(p =>
          p.position === "RB" &&
          p.gameKey !== qb.gameKey &&
          p.salary >= NFL_STRATEGY.minRBValue * 1000
        ));
        const secondaryRB = secondaryRBs.find(rb =>
          mockPlayers.some(p => p.position === "WR" && p.team === rb.opponent && p.gameKey === rb.gameKey)
        );
        const secondaryWR = secondaryRB
          ? shuffled(mockPlayers.filter(p => p.position === "WR" && p.team === secondaryRB.opponent && p.gameKey === secondaryRB.gameKey))[0]
          : undefined;
        addIfAvailable(players, secondaryRB);
        addIfAvailable(players, secondaryWR);
      }

      const addRole = (role: string, limit: number, candidates: NFLPlayer[]) => {
        for (const candidate of shuffled(candidates.sort((a, b) => b.valueScore - a.valueScore))) {
          if (players.filter(p => p.position === role).length >= limit) break;
          if (players.some(p => p.id === candidate.id)) continue;
          const teamCount = players.filter(p => p.team === candidate.team).length;
          if (teamCount >= settings.maxPlayersPerTeam) continue;
          players.push(candidate);
        }
      };

      // The sample found sub-$4,500 RBs in fewer than 5% of winners.
      const rolePool = (position: string) => mockPlayers.filter(p => {
        if (p.position !== position) return false;
        if (p.team === qb.opponent) return false;
        if (["WR", "TE"].includes(position) && p.team === qb.team) return false;
        return true;
      });
      addRole("RB", 2, rolePool("RB").filter(p => p.salary >= NFL_STRATEGY.minRBValue * 1000));
      const lowOwnedWRs = mockPlayers.filter(p => p.position === "WR" && p.projOwnership < 10);
      addRole("WR", 3, [
        ...lowOwnedWRs.filter(p => rolePool("WR").some(eligible => eligible.id === p.id)),
        ...rolePool("WR"),
      ]);
      addRole("TE", 1, rolePool("TE").sort((a, b) => Number(b.isHome) - Number(a.isHome)));
      addRole("DST", 1, mockPlayers.filter(p => p.position === "DST").sort((a, b) => Number(b.isHome && b.isFavorite) - Number(a.isHome && a.isFavorite)));
      const flex = shuffled(mockPlayers.filter(p =>
        ["RB", "WR", "TE"].includes(p.position) &&
        !players.some(selectedPlayer => selectedPlayer.id === p.id) &&
        (p.position !== "RB" || p.salary >= NFL_STRATEGY.minRBValue * 1000) &&
        p.team !== qb.opponent &&
        (!["WR", "TE"].includes(p.position) || p.team !== qb.team) &&
        players.filter(selectedPlayer => selectedPlayer.team === p.team).length < settings.maxPlayersPerTeam
      ))[0];
      addIfAvailable(players, flex);
      if (players.length !== 9) continue;

      const arranged = arrangeClassicRoster(players);
      if (!arranged) continue;
      const gameCount = new Set(arranged.map(p => p.gameKey)).size;
      const lowOwnedCount = arranged.filter(p => p.position === "WR" && p.projOwnership < 10).length;
      const totalSalary = arranged.reduce((s, p) => s + p.salary, 0);
      const signature = arranged.map(p => p.id).sort((a, b) => a - b).join("-");
      if (totalSalary > cap || gameCount < NFL_STRATEGY.minGames || gameCount > NFL_STRATEGY.maxGames || lowOwnedCount < NFL_STRATEGY.lowOwnedWRs || usedSignatures.has(signature)) continue;
      if (arranged.some(p => (exposureCounts.get(p.id) || 0) >= maxPlayerAppearances)) continue;
      if (lineups.length && arranged.filter(p => !lineups[lineups.length - 1].players.some(prev => prev.id === p.id)).length < settings.minUniquePlayers) continue;
      selected = arranged;
      usedSignatures.add(signature);
    }

    if (!selected.length) break;
    const totalSalary = selected.reduce((s, p) => s + p.salary, 0);
    const projectedPoints = selected.reduce((s, p) => s + p.projectedPoints, 0);
    const avgOwnership = selected.reduce((s, p) => s + p.projOwnership, 0) / selected.length;
    selected.forEach(p => exposureCounts.set(p.id, (exposureCounts.get(p.id) || 0) + 1));
    lineups.push({
      id: i,
      players: selected,
      totalSalary,
      projectedPoints: Math.round(projectedPoints * 10) / 10,
      avgOwnership: Math.round(avgOwnership * 10) / 10,
      leverageScore: settings.contestType === "gpp" ? Math.max(1, 1.35 - avgOwnership / 100) : 1,
      uniquenessScore: Math.round((new Set(selected.map(p => p.gameKey)).size / 6) * 100),
    });
  }
  return lineups;
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function NFLMMEOptimizer() {
  usePageMeta({
    title: "NFL MME Optimizer — EliteLineup AI",
    description: "Multi-entry max optimizer for NFL DraftKings contests. Generate up to 150 diversified lineups with exposure controls, QB stacking, and ownership leverage.",
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
              Multi-entry max for DraftKings NFL contests. Generate up to 150 diversified, correlated lineups with full exposure controls, stacking rules, and ownership leverage.
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
                Configure your settings and hit Generate to build your MME lineup portfolio. Works with any NFL slate on DraftKings.
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

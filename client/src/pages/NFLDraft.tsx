import { useState, useMemo, useCallback, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  POSITION_COLORS,
  TIER_COLORS,
  UPSIDE_COLORS,
  RISK_COLORS,
  ROUND_STRATEGY,
  type DraftPlayer,
  type Position,
} from "../data/nfl-draft-rankings-2026";
import type { LiveDraftPlayer } from "../../server/nfl-draft";
import { useAuth } from "../hooks/use-auth";

// ── Helpers ───────────────────────────────────────────────────────────────────

const ALL_POSITIONS: Position[] = ["QB", "RB", "WR", "TE", "K", "DST"];

function posClass(pos: string): string {
  return POSITION_COLORS[pos] ?? "bg-slate-600/30 text-slate-400";
}

function tierClass(tier: number): { bg: string; border: string; text: string } {
  return TIER_COLORS[tier] ?? TIER_COLORS[7];
}

// Scoring format projection selector
function getProj(player: LiveDraftPlayer, fmt: "ppr" | "half" | "standard"): number {
  if (fmt === "half") return player.projHalf;
  if (fmt === "standard") return player.projStd;
  return player.projPPR;
}

function RankBadge({ rank }: { rank: number }) {
  const color =
    rank <= 5
      ? "bg-amber-500 text-black"
      : rank <= 15
      ? "bg-emerald-600 text-white"
      : rank <= 30
      ? "bg-blue-600 text-white"
      : rank <= 60
      ? "bg-purple-700 text-white"
      : "bg-slate-700 text-slate-300";
  return (
    <span className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold ${color}`}>
      {rank}
    </span>
  );
}

function NewsImpactBadge({ impact }: { impact: LiveDraftPlayer["newsImpact"] }) {
  if (!impact) return null;
  const dir = impact.direction;
  const icon = dir === "up" ? "↑" : dir === "down" ? "↓" : "→";
  const cls =
    dir === "up"
      ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
      : dir === "down"
      ? "bg-red-500/20 text-red-400 border border-red-500/30"
      : "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {icon} NEWS
    </span>
  );
}

// ── Draft Player Card (Rankings Tab) ─────────────────────────────────────────

function PlayerCard({
  player,
  format,
  isPaywalled,
  expanded,
  onToggle,
}: {
  player: LiveDraftPlayer;
  format: "ppr" | "half" | "standard";
  isPaywalled: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const tc = tierClass(player.tier);
  const adj = player.adjustedRank;
  const base = player.rank;
  const rankDelta = base - adj; // positive = improved

  return (
    <div
      className={`relative rounded-xl border transition-all duration-200 ${tc.bg} ${tc.border} ${isPaywalled ? "opacity-60 cursor-not-allowed" : "cursor-pointer hover:brightness-110"}`}
      onClick={isPaywalled ? undefined : onToggle}
    >
      {/* Paywall overlay */}
      {isPaywalled && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-xl bg-black/60 backdrop-blur-sm">
          <svg className="w-6 h-6 text-amber-400 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          <p className="text-xs text-amber-300 font-semibold">Upgrade to unlock</p>
        </div>
      )}

      <div className="p-4">
        <div className="flex items-start gap-3">
          <RankBadge rank={adj} />

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-white text-sm">{player.name}</span>
              <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ${posClass(player.position)}`}>
                {player.position}
              </span>
              <span className="text-xs text-slate-400">{player.team}</span>
              <span className="text-xs text-slate-500">#{player.posRank}</span>
              {rankDelta !== 0 && (
                <span className={`text-xs font-bold ${rankDelta > 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {rankDelta > 0 ? `▲${rankDelta}` : `▼${Math.abs(rankDelta)}`}
                </span>
              )}
              <NewsImpactBadge impact={player.newsImpact} />
            </div>

            <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
              <span>Tier {player.tier} · {player.tierLabel}</span>
              <span>ADP {player.adp}</span>
              <span>Bye {player.bye}</span>
              <span className={`font-medium ${UPSIDE_COLORS[player.upside]?.split(" ")[1] ?? "text-slate-400"}`}>
                {player.upside.charAt(0).toUpperCase() + player.upside.slice(1)} upside
              </span>
              <span className={`font-medium ${RISK_COLORS[player.risk]}`}>
                {player.risk.charAt(0).toUpperCase() + player.risk.slice(1)} risk
              </span>
            </div>

            {/* ADP vs Our Rank */}
            {(() => {
              const diff = Math.round(player.adp) - adj;
              if (Math.abs(diff) >= 5) {
                return (
                  <div className={`mt-1 text-xs font-semibold ${diff > 0 ? "text-emerald-400" : "text-orange-400"}`}>
                    {diff > 0 ? `↑ Value pick — we rank ${diff} spots higher than ADP` : `↓ Premium — we rank ${Math.abs(diff)} spots lower than ADP`}
                  </div>
                );
              }
              return null;
            })()}
          </div>

          <div className="text-right shrink-0">
            <div className="text-lg font-bold text-white">{getProj(player, format)}</div>
            <div className="text-xs text-slate-500">proj pts</div>
            <div className="text-xs text-slate-500 mt-1">{format.toUpperCase()}</div>
          </div>
        </div>

        {/* Expanded detail */}
        {expanded && (
          <div className="mt-4 space-y-3 border-t border-white/10 pt-3">
            {/* News impact */}
            {player.newsImpact && (
              <div className={`rounded-lg p-3 text-xs ${player.newsImpact.direction === "down" ? "bg-red-500/10 border border-red-500/20" : "bg-emerald-500/10 border border-emerald-500/20"}`}>
                <div className="font-semibold text-white mb-1">📰 Latest News Impact</div>
                <div className="text-slate-300 mb-1">"{player.newsImpact.headline}"</div>
                <div className={`font-semibold ${player.newsImpact.direction === "down" ? "text-red-400" : "text-emerald-400"}`}>
                  Rank adjusted {player.newsImpact.rankChange > 0 ? "down" : "up"} {Math.abs(player.newsImpact.rankChange)} spots
                </div>
                <div className="text-slate-500 mt-1">{new Date(player.newsImpact.publishedAt).toLocaleDateString()}</div>
              </div>
            )}

            {/* Reasoning */}
            <div>
              <div className="text-xs font-semibold text-slate-300 mb-1">📊 Analysis</div>
              <p className="text-xs text-slate-400 leading-relaxed">{player.reasoning}</p>
            </div>

            {/* Strengths + Concerns */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs font-semibold text-emerald-400 mb-1.5">✓ Strengths</div>
                <ul className="space-y-1">
                  {player.strengths.map((s, i) => (
                    <li key={i} className="text-xs text-slate-400 flex gap-1.5 items-start">
                      <span className="text-emerald-500 mt-0.5 shrink-0">•</span>{s}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="text-xs font-semibold text-red-400 mb-1.5">✗ Concerns</div>
                <ul className="space-y-1">
                  {player.concerns.map((c, i) => (
                    <li key={i} className="text-xs text-slate-400 flex gap-1.5 items-start">
                      <span className="text-red-500 mt-0.5 shrink-0">•</span>{c}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Tags */}
            <div className="flex flex-wrap gap-1.5">
              {player.tags.map((tag) => (
                <span key={tag} className="px-2 py-0.5 rounded-full text-xs bg-slate-700/50 text-slate-400 border border-slate-600/30">
                  #{tag}
                </span>
              ))}
            </div>

            {/* Projections by format */}
            <div className="grid grid-cols-3 gap-2 text-center">
              {(["ppr","half","standard"] as const).map((fmt) => (
                <div key={fmt} className={`rounded-lg p-2 ${fmt === format ? "bg-blue-600/20 border border-blue-500/30" : "bg-slate-800/50"}`}>
                  <div className="text-base font-bold text-white">{getProj(player, fmt)}</div>
                  <div className="text-xs text-slate-400">{fmt.toUpperCase()}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Draft Board (Live Draft Assistant) ───────────────────────────────────────

type PickEntry = {
  overall: number;
  round: number;
  pick: number;
  team: "user" | "other";
  teamNum: number;
  player: LiveDraftPlayer | null;
};

interface LeagueSettings {
  numTeams: number;
  draftPosition: number;
  scoringFormat: "ppr" | "half" | "standard";
  rosterSlots: {
    QB: number; RB: number; WR: number; TE: number; K: number; DST: number; FLEX: number;
  };
  numRounds: number;
}

const DEFAULT_SETTINGS: LeagueSettings = {
  numTeams: 12,
  draftPosition: 5,
  scoringFormat: "ppr",
  rosterSlots: { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DST: 1, FLEX: 2 },
  numRounds: 15,
};

function buildDraftBoard(settings: LeagueSettings): PickEntry[] {
  const total = settings.numTeams * settings.numRounds;
  const picks: PickEntry[] = [];
  for (let i = 0; i < total; i++) {
    const round = Math.floor(i / settings.numTeams) + 1;
    const isSnakeEven = round % 2 === 0;
    const posInRound = isSnakeEven
      ? settings.numTeams - (i % settings.numTeams)
      : (i % settings.numTeams) + 1;
    picks.push({
      overall: i + 1,
      round,
      pick: posInRound,
      teamNum: posInRound,
      team: posInRound === settings.draftPosition ? "user" : "other",
      player: null,
    });
  }
  return picks;
}

function pickForOtherTeam(
  available: LiveDraftPlayer[],
  board: PickEntry[],
  teamNum: number,
  round: number,
  settings: LeagueSettings
): LiveDraftPlayer | null {
  if (available.length === 0) return null;

  // Build this team's current roster counts
  const teamDrafted = board.filter(p => p.teamNum === teamNum && p.player !== null);
  const counts: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DST: 0 };
  for (const p of teamDrafted) {
    if (p.player) counts[p.player.position] = (counts[p.player.position] ?? 0) + 1;
  }

  // Calculate what they still need
  const needs: Record<string, number> = {};
  for (const [pos, needed] of Object.entries(settings.rosterSlots)) {
    if (pos === "FLEX") continue;
    needs[pos] = Math.max(0, (needed as number) - (counts[pos] ?? 0));
  }

  // Score each available player for this team's needs
  const scored = available.map(p => {
    let score = 150 - p.adjustedRank;
    const need = needs[p.position] ?? 0;
    if (need > 0) score += 25;
    if (need > 1) score += 10;
    if (need === 0 && p.position !== "K" && p.position !== "DST") score -= 20;
    if (round <= 3 && p.tier <= 2) score += 20;
    if (round >= 13 && (p.position === "K" || p.position === "DST")) score += 20;
    if (round <= 6 && p.risk === "high") score -= 10;
    return { player: p, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.player ?? null;
}

function getRosterNeeds(
  myPicks: PickEntry[],
  settings: LeagueSettings
): Record<string, number> {
  const drafted = myPicks.filter((p) => p.team === "user" && p.player);
  const counts: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DST: 0 };
  for (const p of drafted) {
    if (p.player) counts[p.player.position] = (counts[p.player.position] ?? 0) + 1;
  }
  const needs: Record<string, number> = {};
  for (const [pos, needed] of Object.entries(settings.rosterSlots)) {
    if (pos === "FLEX") continue;
    needs[pos] = Math.max(0, needed - (counts[pos] ?? 0));
  }
  return needs;
}

function aiRecommendation(
  available: LiveDraftPlayer[],
  myPicks: PickEntry[],
  currentPick: PickEntry,
  settings: LeagueSettings,
  allPicks: PickEntry[]
): { player: LiveDraftPlayer; reason: string } | null {
  if (available.length === 0) return null;

  const round = currentPick.round;
  const needs = getRosterNeeds(myPicks, settings);

  // Picks remaining after this one
  const myFuturePicks = allPicks.filter(
    (p) => p.team === "user" && p.player === null && p.overall > currentPick.overall
  );

  // Score each available player
  const scored = available.map((p) => {
    let score = 150 - p.adjustedRank;   // base: best rank first

    // Boost for positional need
    const need = needs[p.position] ?? 0;
    if (need > 0) score += 20;
    if (need > 1) score += 10;

    // Penalize when we already have enough
    if (need === 0 && p.position !== "K" && p.position !== "DST") score -= 15;

    // Early rounds: prioritize elite tier
    if (round <= 3 && p.tier <= 2) score += 30;

    // Mid rounds: value + handcuffs
    if (round >= 7 && p.tier >= 6) score += 10;

    // Late rounds: streaming DST and K are valid
    if (round >= 13 && (p.position === "K" || p.position === "DST")) score += 20;

    // ADP value bonus — if we rank them much higher than consensus
    const adpDiff = Math.round(p.adp) - p.adjustedRank;
    if (adpDiff >= 10) score += 15;
    if (adpDiff >= 20) score += 10;

    // Injury risk penalty in early rounds
    if (round <= 6 && p.risk === "high") score -= 10;

    return { player: p, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0].player;

  // Generate reasoning
  const need = needs[best.position] ?? 0;
  const adpDiff = Math.round(best.adp) - best.adjustedRank;
  let reason = `Round ${round}: ${ROUND_STRATEGY[Math.min(round, 12)] ?? "Best available."}`;
  if (need > 0) reason += ` You still need a ${best.position}.`;
  if (adpDiff >= 10) reason += ` We rank ${best.name} ${adpDiff} spots ahead of consensus ADP — strong value here.`;
  if (best.newsImpact?.direction === "up") reason += ` Recent positive news pushed them up our rankings.`;
  if (best.newsImpact?.direction === "down") reason += ` Note: ${best.newsImpact.headline}`;

  return { player: best, reason };
}

// ── Live Draft Assistant Tab ──────────────────────────────────────────────────

function DraftAssistant({ allPlayers }: { allPlayers: LiveDraftPlayer[] }) {
  const [settings, setSettings] = useState<LeagueSettings>(DEFAULT_SETTINGS);
  const [configured, setConfigured] = useState(false);
  const [board, setBoard] = useState<PickEntry[]>([]);
  const [currentPickIdx, setCurrentPickIdx] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [posFilter, setPosFilter] = useState<Position | "ALL">("ALL");
  const [lastCpuPick, setLastCpuPick] = useState<{ teamNum: number; player: LiveDraftPlayer } | null>(null);
  const boardDomRef = useRef<HTMLDivElement>(null);

  // Refs for latest values inside async callbacks
  const latestBoardRef = useRef(board);
  latestBoardRef.current = board;

  const startDraft = useCallback(() => {
    setBoard(buildDraftBoard(settings));
    setCurrentPickIdx(0);
    setConfigured(true);
    setLastCpuPick(null);
  }, [settings]);

  const resetDraft = useCallback(() => {
    setBoard([]);
    setCurrentPickIdx(0);
    setConfigured(false);
    setSearchQuery("");
    setLastCpuPick(null);
  }, []);

  const draftedIds = useMemo(() => {
    const ids = new Set<number>();
    for (const p of board) {
      if (p.player) ids.add(p.player.id);
    }
    return ids;
  }, [board]);

  const available = useMemo(() =>
    allPlayers.filter((p) => !draftedIds.has(p.id)),
    [allPlayers, draftedIds]);

  const latestAvailableRef = useRef(available);
  latestAvailableRef.current = available;

  const filteredAvailable = useMemo(() =>
    available.filter((p) => {
      if (posFilter !== "ALL" && p.position !== posFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return p.name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q);
      }
      return true;
    }),
    [available, posFilter, searchQuery]);

  const myPicks = useMemo(() => board.filter((p) => p.team === "user"), [board]);
  const currentPick = board[currentPickIdx] ?? null;
  const myPickedPlayers = myPicks.filter((p) => p.player !== null);

  const aiRec = useMemo(() => {
    if (!currentPick || currentPick.team !== "user" || currentPick.player) return null;
    return aiRecommendation(available, myPicks, currentPick, settings, board);
  }, [available, myPicks, currentPick, settings, board]);

  // Auto-run CPU picks until it's the user's turn
  useEffect(() => {
    if (!configured || board.length === 0) return;
    const pick = board[currentPickIdx];
    if (!pick || pick.team !== "other" || pick.player) return;

    const timer = setTimeout(() => {
      const currentBoard = latestBoardRef.current;
      const currentAvailable = latestAvailableRef.current;
      const player = pickForOtherTeam(currentAvailable, currentBoard, pick.teamNum, pick.round, settings);
      if (!player) return;
      // Guard: make sure the slot is still empty (user may have manually filled it)
      if (currentBoard[currentPickIdx]?.player) return;
      setLastCpuPick({ teamNum: pick.teamNum, player });
      setBoard(prev => {
        const next = [...prev];
        next[currentPickIdx] = { ...next[currentPickIdx], player };
        return next;
      });
      setCurrentPickIdx(i => Math.min(i + 1, currentBoard.length - 1));
    }, 380);

    return () => clearTimeout(timer);
  }, [currentPickIdx, configured]); // eslint-disable-line react-hooks/exhaustive-deps

  const makePick = useCallback(
    (player: LiveDraftPlayer) => {
      if (!currentPick) return;
      setLastCpuPick(null);
      setBoard((prev) => {
        const next = [...prev];
        next[currentPickIdx] = { ...next[currentPickIdx], player };
        return next;
      });
      setCurrentPickIdx((i) => Math.min(i + 1, board.length - 1));
    },
    [currentPick, currentPickIdx, board.length]
  );

  const undoPick = useCallback(() => {
    const prevIdx = currentPickIdx - 1;
    if (prevIdx < 0) return;
    setLastCpuPick(null);
    setBoard((prev) => {
      const next = [...prev];
      next[prevIdx] = { ...next[prevIdx], player: null };
      return next;
    });
    setCurrentPickIdx(prevIdx);
  }, [currentPickIdx]);

  // Configuration screen
  if (!configured) {
    return (
      <div className="max-w-xl mx-auto mt-8 space-y-6">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-white mb-2">Configure Your Draft</h2>
          <p className="text-slate-400 text-sm">Set your league settings to get personalized AI pick recommendations.</p>
        </div>

        <div className="bg-slate-800/60 rounded-2xl border border-slate-700/40 p-6 space-y-5">
          {/* Teams */}
          <div>
            <label className="block text-sm font-semibold text-slate-300 mb-2">Number of Teams</label>
            <div className="flex gap-2 flex-wrap">
              {[8, 10, 12, 14].map((n) => (
                <button
                  key={n}
                  onClick={() => setSettings((s) => ({ ...s, numTeams: n }))}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold border transition-colors ${settings.numTeams === n ? "bg-blue-600 border-blue-500 text-white" : "bg-slate-700/50 border-slate-600/30 text-slate-400 hover:text-white"}`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {/* Draft Position */}
          <div>
            <label className="block text-sm font-semibold text-slate-300 mb-2">
              Your Draft Position (1–{settings.numTeams})
            </label>
            <input
              type="range"
              min={1}
              max={settings.numTeams}
              value={settings.draftPosition}
              onChange={(e) => setSettings((s) => ({ ...s, draftPosition: Number(e.target.value) }))}
              className="w-full accent-blue-500"
            />
            <div className="text-sm text-blue-400 font-semibold mt-1">Position {settings.draftPosition}</div>
          </div>

          {/* Scoring */}
          <div>
            <label className="block text-sm font-semibold text-slate-300 mb-2">Scoring Format</label>
            <div className="flex gap-2">
              {(["ppr","half","standard"] as const).map((fmt) => (
                <button
                  key={fmt}
                  onClick={() => setSettings((s) => ({ ...s, scoringFormat: fmt }))}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold border transition-colors ${settings.scoringFormat === fmt ? "bg-blue-600 border-blue-500 text-white" : "bg-slate-700/50 border-slate-600/30 text-slate-400 hover:text-white"}`}
                >
                  {fmt === "half" ? "Half-PPR" : fmt.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {/* Rounds */}
          <div>
            <label className="block text-sm font-semibold text-slate-300 mb-2">Rounds</label>
            <div className="flex gap-2">
              {[13, 14, 15, 16].map((n) => (
                <button
                  key={n}
                  onClick={() => setSettings((s) => ({ ...s, numRounds: n }))}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold border transition-colors ${settings.numRounds === n ? "bg-blue-600 border-blue-500 text-white" : "bg-slate-700/50 border-slate-600/30 text-slate-400 hover:text-white"}`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={startDraft}
            className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-bold py-3 rounded-xl transition-all"
          >
            Start Live Draft →
          </button>
        </div>
      </div>
    );
  }

  // Draft in progress
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

      {/* Left: Available Players */}
      <div className="lg:col-span-2 space-y-3">
        <div className="bg-slate-800/60 rounded-2xl border border-slate-700/40 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-white">
              Available Players
              <span className="ml-2 text-slate-400 text-sm font-normal">({available.length} remaining)</span>
            </h3>
            <div className="flex gap-2">
              <button onClick={undoPick} className="text-xs px-3 py-1.5 rounded-lg bg-slate-700/50 text-slate-300 hover:text-white border border-slate-600/30 transition-colors">
                ← Undo
              </button>
              <button onClick={resetDraft} className="text-xs px-3 py-1.5 rounded-lg bg-red-500/20 text-red-400 hover:text-red-300 border border-red-500/30 transition-colors">
                Reset
              </button>
            </div>
          </div>

          {/* AI Recommendation Banner */}
          {currentPick && currentPick.team === "user" && aiRec && (
            <div className="mb-3 rounded-xl bg-amber-500/10 border border-amber-500/30 p-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold text-amber-400 mb-1">🤖 AI Pick — Round {currentPick.round}, Pick {currentPick.pick}</div>
                  <div className="text-sm font-bold text-white">{aiRec.player.name}</div>
                  <div className="text-xs text-slate-400 mt-0.5">{aiRec.reason}</div>
                </div>
                <button
                  onClick={() => makePick(aiRec.player)}
                  className="ml-4 shrink-0 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-black text-sm font-bold transition-colors"
                >
                  Draft
                </button>
              </div>
            </div>
          )}

          {/* CPU auto-drafting indicator */}
          {currentPick && currentPick.team === "other" && (
            <div className="mb-3 rounded-xl bg-slate-700/40 border border-slate-600/30 p-3">
              <div className="flex items-center gap-2 mb-1">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                </span>
                <div className="text-xs font-semibold text-blue-400">
                  Team {currentPick.teamNum} is on the clock — Round {currentPick.round}, Pick {currentPick.pick}
                </div>
              </div>
              {lastCpuPick && (
                <div className="text-xs text-slate-400">
                  Last pick: <span className="text-white font-semibold">{lastCpuPick.player.name}</span>
                  <span className={`ml-1.5 px-1 rounded text-xs font-bold ${posClass(lastCpuPick.player.position)}`}>{lastCpuPick.player.position}</span>
                  → Team {lastCpuPick.teamNum}
                </div>
              )}
            </div>
          )}

          {/* Search + Filter */}
          <div className="flex gap-2 mb-3">
            <input
              type="text"
              placeholder="Search player or team..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 bg-slate-900/60 border border-slate-700/40 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/50"
            />
            <div className="flex gap-1">
              {(["ALL", ...ALL_POSITIONS] as const).map((pos) => (
                <button
                  key={pos}
                  onClick={() => setPosFilter(pos as Position | "ALL")}
                  className={`px-2 py-1 rounded text-xs font-semibold transition-colors ${posFilter === pos ? "bg-blue-600 text-white" : "bg-slate-700/50 text-slate-400 hover:text-white"}`}
                >
                  {pos}
                </button>
              ))}
            </div>
          </div>

          {/* Player list */}
          <div className="space-y-1 max-h-[520px] overflow-y-auto">
            {filteredAvailable.slice(0, 60).map((player) => (
              <div
                key={player.id}
                onClick={() => makePick(player)}
                className="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer hover:bg-slate-700/50 transition-colors group"
              >
                <RankBadge rank={player.adjustedRank} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-white group-hover:text-blue-300 transition-colors">{player.name}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ${posClass(player.position)}`}>{player.position}</span>
                    <span className="text-xs text-slate-500">{player.team}</span>
                    <NewsImpactBadge impact={player.newsImpact} />
                  </div>
                  <div className="text-xs text-slate-500">ADP {player.adp} · Bye {player.bye} · {player.tierLabel}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-bold text-white">{getProj(player, settings.scoringFormat)}</div>
                  <div className="text-xs text-slate-500">pts</div>
                </div>
                <div className="opacity-0 group-hover:opacity-100 transition-opacity text-xs text-blue-400 font-semibold">
                  Draft →
                </div>
              </div>
            ))}
            {filteredAvailable.length === 0 && (
              <div className="text-center text-slate-500 text-sm py-8">No players match your filter.</div>
            )}
          </div>
        </div>
      </div>

      {/* Right: My Team + Draft Board */}
      <div className="space-y-3">
        {/* My Team */}
        <div className="bg-slate-800/60 rounded-2xl border border-slate-700/40 p-4">
          <h3 className="font-bold text-white mb-3">
            My Team
            <span className="ml-2 text-slate-400 text-sm font-normal">({myPickedPlayers.length} drafted)</span>
          </h3>

          {myPickedPlayers.length === 0 ? (
            <p className="text-slate-500 text-sm">No picks yet. Wait for your turn.</p>
          ) : (
            <div className="space-y-1.5">
              {myPickedPlayers.map((pick, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg bg-slate-900/50 px-2 py-1.5">
                  <span className={`text-xs px-1.5 py-0.5 rounded font-bold ${posClass(pick.player!.position)}`}>
                    {pick.player!.position}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-white truncate">{pick.player!.name}</div>
                    <div className="text-xs text-slate-500">{pick.player!.team} · R{pick.round}</div>
                  </div>
                  <div className="text-xs font-bold text-slate-300">#{pick.player!.adjustedRank}</div>
                </div>
              ))}
            </div>
          )}

          {/* Needs summary */}
          {myPickedPlayers.length > 0 && (
            <div className="mt-3 pt-3 border-t border-slate-700/30">
              <div className="text-xs font-semibold text-slate-400 mb-2">Roster Needs</div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(getRosterNeeds(myPicks, settings)).map(([pos, need]) =>
                  need > 0 ? (
                    <span key={pos} className={`text-xs px-2 py-0.5 rounded-full border font-semibold ${posClass(pos)}`}>
                      {pos} ×{need}
                    </span>
                  ) : null
                )}
              </div>
            </div>
          )}
        </div>

        {/* Draft Order Summary */}
        <div className="bg-slate-800/60 rounded-2xl border border-slate-700/40 p-4">
          <h3 className="font-bold text-white mb-3">Draft Board</h3>
          <div className="space-y-0.5 max-h-80 overflow-y-auto" ref={boardDomRef}>
            {board.map((pick, idx) => (
              <div
                key={pick.overall}
                className={`flex items-center gap-2 px-2 py-1 rounded text-xs transition-colors ${idx === currentPickIdx ? "bg-blue-600/30 border border-blue-500/30" : pick.team === "user" && !pick.player ? "bg-amber-500/10" : ""}`}
              >
                <span className="text-slate-500 w-5 text-right shrink-0">{pick.overall}</span>
                <span className="text-slate-600 w-12 shrink-0">R{pick.round}P{pick.pick}</span>
                {pick.player ? (
                  <>
                    <span className={`px-1 rounded text-xs font-bold ${posClass(pick.player.position)}`}>
                      {pick.player.position}
                    </span>
                    <span className={`flex-1 truncate font-semibold ${pick.team === "user" ? "text-blue-300" : "text-slate-400"}`}>
                      {pick.player.name}
                    </span>
                  </>
                ) : (
                  <span className={`flex-1 ${pick.team === "user" ? "text-amber-400 font-semibold" : "text-slate-600"}`}>
                    {pick.team === "user" ? "← YOUR PICK" : "..."}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Rankings Tab ──────────────────────────────────────────────────────────────

function RankingsTab({ players, isStarOrAbove }: { players: LiveDraftPlayer[]; isStarOrAbove: boolean }) {
  const [posFilter, setPosFilter] = useState<Position | "ALL">("ALL");
  const [format, setFormat] = useState<"ppr" | "half" | "standard">("ppr");
  const [showOnlyValue, setShowOnlyValue] = useState(false);
  const [showOnlySleepers, setShowOnlySleepers] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    return players.filter((p) => {
      if (posFilter !== "ALL" && p.position !== posFilter) return false;
      if (showOnlyValue && Math.round(p.adp) - p.adjustedRank < 5) return false;
      if (showOnlySleepers && !p.tags.includes("sleeper")) return false;
      if (search) {
        const q = search.toLowerCase();
        return p.name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q);
      }
      return true;
    });
  }, [players, posFilter, format, showOnlyValue, showOnlySleepers, search]);

  // Group by tier
  const byTier = useMemo(() => {
    const map = new Map<number, LiveDraftPlayer[]>();
    for (const p of filtered) {
      const arr = map.get(p.tier) ?? [];
      arr.push(p);
      map.set(p.tier, arr);
    }
    return map;
  }, [filtered]);

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="bg-slate-800/60 rounded-2xl border border-slate-700/40 p-4">
        <div className="flex flex-wrap gap-3 items-center">
          {/* Search */}
          <input
            type="text"
            placeholder="Search player..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-slate-900/60 border border-slate-700/40 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/50 w-48"
          />

          {/* Position filter */}
          <div className="flex gap-1">
            {(["ALL", ...ALL_POSITIONS] as const).map((pos) => (
              <button
                key={pos}
                onClick={() => setPosFilter(pos as Position | "ALL")}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors border ${posFilter === pos ? "bg-blue-600 border-blue-500 text-white" : "bg-slate-700/40 border-slate-600/30 text-slate-400 hover:text-white"}`}
              >
                {pos}
              </button>
            ))}
          </div>

          {/* Scoring format */}
          <div className="flex gap-1">
            {(["ppr","half","standard"] as const).map((fmt) => (
              <button
                key={fmt}
                onClick={() => setFormat(fmt)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors border ${format === fmt ? "bg-purple-600 border-purple-500 text-white" : "bg-slate-700/40 border-slate-600/30 text-slate-400 hover:text-white"}`}
              >
                {fmt === "half" ? "Half" : fmt.toUpperCase()}
              </button>
            ))}
          </div>

          {/* Toggles */}
          <button
            onClick={() => setShowOnlyValue((v) => !v)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${showOnlyValue ? "bg-emerald-600 border-emerald-500 text-white" : "bg-slate-700/40 border-slate-600/30 text-slate-400 hover:text-white"}`}
          >
            💰 Value Picks
          </button>
          <button
            onClick={() => setShowOnlySleepers((v) => !v)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${showOnlySleepers ? "bg-amber-600 border-amber-500 text-white" : "bg-slate-700/40 border-slate-600/30 text-slate-400 hover:text-white"}`}
          >
            😴 Sleepers
          </button>
        </div>

        <div className="mt-2 text-xs text-slate-500">
          Showing {filtered.length} of {players.length} players · Rankings updated daily from ESPN NFL news
        </div>
      </div>

      {/* Tiers */}
      {Array.from(byTier.entries()).sort(([a], [b]) => a - b).map(([tier, tierPlayers]) => {
        const tc = tierClass(tier);
        return (
          <div key={tier}>
            <div className={`flex items-center gap-3 px-4 py-2 rounded-xl mb-2 ${tc.bg} border ${tc.border}`}>
              <span className={`font-bold text-sm ${tc.text}`}>{TIER_COLORS[tier]?.label ?? `Tier ${tier}`}</span>
              <span className="text-xs text-slate-500">{tierPlayers.length} players</span>
            </div>
            <div className="space-y-2">
              {tierPlayers.map((player) => {
                const isPaywalled = !player.isFree && !isStarOrAbove;
                return (
                  <PlayerCard
                    key={player.id}
                    player={player}
                    format={format}
                    isPaywalled={isPaywalled}
                    expanded={expandedId === player.id}
                    onToggle={() => setExpandedId(expandedId === player.id ? null : player.id)}
                  />
                );
              })}
            </div>
          </div>
        );
      })}

      {byTier.size === 0 && (
        <div className="text-center text-slate-500 py-12">No players match your filters.</div>
      )}
    </div>
  );
}

// ── Bye Week Tracker ──────────────────────────────────────────────────────────

function ByeWeekTracker({ players }: { players: LiveDraftPlayer[] }) {
  const byeMap = useMemo(() => {
    const map = new Map<number, LiveDraftPlayer[]>();
    for (const p of players) {
      const arr = map.get(p.bye) ?? [];
      arr.push(p);
      map.set(p.bye, arr);
    }
    return map;
  }, [players]);

  return (
    <div className="bg-slate-800/60 rounded-2xl border border-slate-700/40 p-4">
      <h3 className="font-bold text-white mb-3">Bye Week Reference (Top 50 Players)</h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {Array.from(byeMap.entries())
          .sort(([a], [b]) => a - b)
          .map(([week, wPlayers]) => {
            const top = wPlayers.filter((p) => p.adjustedRank <= 50);
            if (top.length === 0) return null;
            return (
              <div key={week} className="rounded-xl bg-slate-900/50 border border-slate-700/30 p-3">
                <div className="text-sm font-bold text-blue-400 mb-2">Week {week}</div>
                <div className="space-y-1">
                  {top.map((p) => (
                    <div key={p.id} className="flex items-center gap-1.5">
                      <span className={`text-xs px-1 rounded ${posClass(p.position)}`}>{p.position}</span>
                      <span className="text-xs text-slate-300 truncate">{p.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}

// ── Handcuff Guide ────────────────────────────────────────────────────────────

function HandcuffGuide({ players }: { players: LiveDraftPlayer[] }) {
  const handcuffs = useMemo(() =>
    players.filter((p) => p.tags.includes("handcuff")),
    [players]);

  const workhorses = useMemo(() =>
    players.filter((p) => p.tags.includes("bellcow") || p.tags.includes("workhorse")),
    [players]);

  return (
    <div className="bg-slate-800/60 rounded-2xl border border-slate-700/40 p-4">
      <h3 className="font-bold text-white mb-3">Handcuff Strategy Guide</h3>
      <p className="text-sm text-slate-400 mb-4">
        Handcuffs are the backup RBs for your workhorse starters. If your RB1 goes down and you own the handcuff, you maintain your points instead of scrambling the waiver wire.
      </p>
      <div className="space-y-2">
        {handcuffs.map((hc) => {
          // Find the player the handcuff is for
          const workhorse = workhorses.find((w) => w.team === hc.team && w.position === "RB");
          return (
            <div key={hc.id} className="flex items-center gap-3 rounded-lg bg-slate-900/50 px-3 py-2">
              <span className="text-xs text-slate-500 w-5 text-right">{hc.adjustedRank}</span>
              <div className="flex-1">
                <div className="text-sm font-semibold text-white">{hc.name}</div>
                <div className="text-xs text-slate-500">{hc.team} · Round ~{Math.round(hc.adp / 12) + 1}</div>
              </div>
              {workhorse && (
                <div className="text-right">
                  <div className="text-xs text-amber-400 font-semibold">Backs up</div>
                  <div className="text-xs text-slate-300">{workhorse.name}</div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Pricing CTA ───────────────────────────────────────────────────────────────

function PricingCTA() {
  return (
    <div className="rounded-2xl bg-gradient-to-r from-blue-900/40 to-purple-900/40 border border-blue-500/20 p-6 text-center">
      <div className="text-2xl mb-2">🏈</div>
      <h3 className="text-lg font-bold text-white mb-2">Unlock Full NFL Draft Suite</h3>
      <p className="text-sm text-slate-400 mb-4 max-w-md mx-auto">
        The first 5 picks are on us — everyone knows Bijan, Lamb, Chase, Jefferson, and Breece Hall.
        The edge is in picks 6–100. Upgrade to get full rankings, daily news adjustments, reasoning,
        sleeper alerts, and the Live Draft Assistant.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-2xl mx-auto mb-4">
        <div className="rounded-xl bg-slate-800/60 border border-slate-700/40 p-4 text-left">
          <div className="text-slate-300 font-bold text-sm mb-1">🎯 Contender — $9.99/mo</div>
          <ul className="text-xs text-slate-400 space-y-1">
            <li>✓ Top 5 draft picks</li>
            <li>✓ 1 saved lineup per sport</li>
            <li>✓ Basic DraftKings access</li>
            <li className="text-slate-600">✗ Full rankings</li>
            <li className="text-slate-600">✗ Live Draft Assistant</li>
          </ul>
        </div>
        <div className="rounded-xl bg-slate-800/60 border border-amber-500/30 p-4 text-left">
          <div className="text-amber-400 font-bold text-sm mb-1">⭐ Sharpshooter — $19.99/mo</div>
          <ul className="text-xs text-slate-400 space-y-1">
            <li>✓ Full 100-player rankings</li>
            <li>✓ Daily news-adjusted ranks</li>
            <li>✓ Reasoning + analysis per player</li>
            <li>✓ Bye week tracker</li>
            <li>✓ Handcuff guide</li>
            <li>✓ ADP value indicator</li>
          </ul>
        </div>
        <div className="rounded-xl bg-gradient-to-b from-purple-900/40 to-blue-900/40 border border-purple-500/30 p-4 text-left">
          <div className="text-purple-400 font-bold text-sm mb-1">👑 Champion — $39.99/mo</div>
          <ul className="text-xs text-slate-400 space-y-1">
            <li>✓ Everything in Sharpshooter</li>
            <li>✓ Live Draft Assistant</li>
            <li>✓ AI pick per round with reasoning</li>
            <li>✓ Sleeper alerts (push notifications)</li>
            <li>✓ 150 DFS lineups</li>
            <li>✓ Priority support</li>
          </ul>
        </div>
      </div>
      <Link href="/pricing">
        <button className="px-8 py-3 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-bold rounded-xl transition-all">
          Upgrade Now — 7-Day Free Trial
        </button>
      </Link>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

type Tab = "rankings" | "draft" | "bye-weeks" | "handcuffs";

export default function NFLDraft() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>("rankings");

  const { data: subData } = useQuery<{ tier?: string }>({
    queryKey: ["/api/subscription"],
  });

  const isAdmin = (user as any)?.isAdmin === true;
  const tier = isAdmin ? "pro" : (subData?.tier ?? "free");
  const isStarOrAbove = isAdmin || tier === "pro" || tier === "star";
  const isChampion = isAdmin || tier === "pro"; // "pro" maps to Champion

  const { data, isLoading, error, refetch } = useQuery<{
    players: LiveDraftPlayer[];
    updatedAt: string;
  }>({
    queryKey: ["/api/nfl/draft-rankings"],
    refetchInterval: 24 * 60 * 60 * 1000,
    staleTime: 60 * 60 * 1000,
  });

  const players = data?.players ?? [];
  const updatedAt = data?.updatedAt;

  const tabs: { id: Tab; label: string; icon: string; requiresPaid?: boolean }[] = [
    { id: "rankings", label: "Rankings", icon: "📊" },
    { id: "draft", label: "Live Draft Assistant", icon: "🏈", requiresPaid: false },
    { id: "bye-weeks", label: "Bye Weeks", icon: "📅", requiresPaid: false },
    { id: "handcuffs", label: "Handcuffs", icon: "🤝", requiresPaid: false },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      <div className="max-w-6xl mx-auto px-4 py-8">

        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-xl">
              🏈
            </div>
            <div>
              <h1 className="text-3xl font-black text-white">NFL Fantasy Draft Hub</h1>
              <p className="text-slate-400 text-sm">
                EliteLineup AI Rankings · Powered by ESPN news + top analyst consensus
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 mt-3 flex-wrap">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></div>
              Rankings update daily
            </div>
            {updatedAt && (
              <div className="text-xs text-slate-500">
                Last updated: {new Date(updatedAt).toLocaleString()}
              </div>
            )}
            {isAdmin && (
              <button
                onClick={() => refetch()}
                className="text-xs px-3 py-1 rounded-lg bg-slate-700/50 text-slate-300 hover:text-white border border-slate-600/30 transition-colors"
              >
                Force refresh
              </button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-slate-800/40 rounded-xl p-1 border border-slate-700/30 overflow-x-auto">
          {tabs.map((tab) => {
            const locked = tab.requiresPaid && !isChampion;
            return (
              <button
                key={tab.id}
                onClick={() => !locked && setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all whitespace-nowrap ${
                  activeTab === tab.id
                    ? "bg-blue-600 text-white shadow"
                    : locked
                    ? "text-slate-600 cursor-not-allowed"
                    : "text-slate-400 hover:text-white hover:bg-slate-700/50"
                }`}
              >
                <span>{tab.icon}</span>
                <span>{tab.label}</span>
                {locked && <span className="text-amber-400">🔒</span>}
              </button>
            );
          })}
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <div className="w-12 h-12 rounded-full border-2 border-blue-500/20 border-t-blue-500 animate-spin"></div>
            <p className="text-slate-400 text-sm">Loading rankings + news adjustments...</p>
          </div>
        )}

        {error && (
          <div className="rounded-xl bg-red-500/10 border border-red-500/30 p-4 text-red-400 text-sm">
            Failed to load rankings. Please try again.
          </div>
        )}

        {!isLoading && !error && (
          <>
            {/* Free top-5 banner */}
            {!isStarOrAbove && (
              <div className="mb-6 rounded-xl bg-amber-500/10 border border-amber-500/30 p-4 flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-bold text-amber-400 mb-1">🔓 Top 5 Picks Free · Picks 6–100 Require Sharpshooter</div>
                  <div className="text-xs text-slate-400">
                    The top 5 are widely agreed upon. The real edge — and where EliteLineup AI earns your trust — starts at pick 6.
                  </div>
                </div>
                <Link href="/pricing">
                  <button className="shrink-0 px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black text-sm font-bold rounded-lg transition-colors">
                    Upgrade
                  </button>
                </Link>
              </div>
            )}

            {/* Tab content */}
            {activeTab === "rankings" && (
              <div className="space-y-6">
                <RankingsTab players={players} isStarOrAbove={isStarOrAbove} />
                {!isStarOrAbove && <PricingCTA />}
              </div>
            )}

            {activeTab === "draft" && isChampion && (
              <DraftAssistant allPlayers={players} />
            )}

            {activeTab === "draft" && !isChampion && (
              <div className="space-y-6">
                <div className="rounded-2xl bg-gradient-to-r from-purple-900/40 to-blue-900/40 border border-purple-500/20 p-8 text-center">
                  <div className="text-4xl mb-3">🏈</div>
                  <h3 className="text-xl font-bold text-white mb-2">Live Draft Assistant</h3>
                  <p className="text-slate-400 text-sm mb-6 max-w-md mx-auto">
                    Configure your league, monitor every pick live, and get an AI-powered recommendation for every one of your picks — with full reasoning. Included exclusively with the Champion plan.
                  </p>
                  <Link href="/pricing">
                    <button className="px-8 py-3 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white font-bold rounded-xl transition-all">
                      Upgrade to Champion — 7-Day Free Trial
                    </button>
                  </Link>
                  <p className="text-xs text-slate-500 mt-3">No refunds. Cancel at any time.</p>
                </div>
              </div>
            )}

            {activeTab === "bye-weeks" && <ByeWeekTracker players={players} />}
            {activeTab === "handcuffs" && <HandcuffGuide players={players} />}
          </>
        )}
      </div>
    </div>
  );
}

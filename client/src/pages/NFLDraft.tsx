import { useState, useMemo, useCallback, useRef, useEffect } from "react";
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
  pick: number;         // 1-based slot within the round
  slotIdx: number;      // 0-based index in customOrder
  team: "user" | "other";
  player: LiveDraftPlayer | null;
};

// Each slot in the draft order. "user" = the human's team; others get auto-labels.
export interface DraftSlot {
  id: string;           // stable unique id
  label: string;        // display name, user-editable
  isUser: boolean;
}

interface LeagueSettings {
  numTeams: number;
  draftPosition: number;  // kept for backwards compat — derived from customOrder
  scoringFormat: "ppr" | "half" | "standard";
  rosterSlots: {
    QB: number; RB: number; WR: number; TE: number; K: number; DST: number; FLEX: number;
  };
  numRounds: number;
  customOrder: DraftSlot[]; // ordered list, index 0 = first pick in round 1
}

const STORAGE_KEY = "elitelineup_draft_order_v1";

function buildDefaultOrder(numTeams: number, userPosition: number): DraftSlot[] {
  return Array.from({ length: numTeams }, (_, i) => ({
    id: `slot-${i}`,
    label: i + 1 === userPosition ? "Your Team" : `Team ${i + 1}`,
    isUser: i + 1 === userPosition,
  }));
}

function saveOrderToStorage(order: DraftSlot[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(order));
  } catch {}
}

function loadOrderFromStorage(): DraftSlot[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed as DraftSlot[];
  } catch {}
  return null;
}

const DEFAULT_SETTINGS: LeagueSettings = {
  numTeams: 12,
  draftPosition: 5,
  scoringFormat: "ppr",
  rosterSlots: { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DST: 1, FLEX: 2 },
  numRounds: 15,
  customOrder: buildDefaultOrder(12, 5),
};

/** Build snake draft board from a custom slot order. */
function buildDraftBoard(settings: LeagueSettings): PickEntry[] {
  const { customOrder, numRounds } = settings;
  const n = customOrder.length;
  const total = n * numRounds;
  const picks: PickEntry[] = [];

  for (let i = 0; i < total; i++) {
    const round = Math.floor(i / n) + 1;
    const posInRound = i % n; // 0-based offset within round
    const slotIdx = round % 2 === 0
      ? n - 1 - posInRound   // even rounds go right-to-left (snake)
      : posInRound;           // odd rounds go left-to-right
    const slot = customOrder[slotIdx];
    picks.push({
      overall: i + 1,
      round,
      pick: slotIdx + 1,
      slotIdx,
      team: slot.isUser ? "user" : "other",
      player: null,
    });
  }
  return picks;
}

// ── Draft Order Editor ────────────────────────────────────────────────────────

function DraftOrderEditor({
  order,
  onChange,
  onSave,
}: {
  order: DraftSlot[];
  onChange: (next: DraftSlot[]) => void;
  onSave: () => void;
}) {
  const dragIdx = useRef<number | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const swap = (a: number, b: number) => {
    if (a < 0 || b < 0 || a >= order.length || b >= order.length) return;
    const next = [...order];
    [next[a], next[b]] = [next[b], next[a]];
    onChange(next);
  };

  const markAsUser = (idx: number) => {
    const next = order.map((s, i) => ({ ...s, isUser: i === idx }));
    onChange(next);
  };

  const startEdit = (slot: DraftSlot) => {
    setEditingId(slot.id);
    setEditValue(slot.label);
  };

  const commitEdit = (id: string) => {
    onChange(order.map((s) => s.id === id ? { ...s, label: editValue.trim() || s.label } : s));
    setEditingId(null);
  };

  // HTML5 drag-and-drop handlers
  const handleDragStart = (idx: number) => { dragIdx.current = idx; };
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdx.current === null || dragIdx.current === idx) return;
    swap(dragIdx.current, idx);
    dragIdx.current = idx;
  };
  const handleDrop = () => { dragIdx.current = null; };

  const userIdx = order.findIndex((s) => s.isUser);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-slate-300">Draft Order</div>
          <div className="text-xs text-slate-500 mt-0.5">
            Drag to reorder · Click a name to rename · "Me" marks your slot
          </div>
        </div>
        <button
          onClick={onSave}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-400 text-xs font-semibold transition-colors"
        >
          💾 Save Order
        </button>
      </div>

      <div className="rounded-xl border border-slate-700/40 overflow-hidden divide-y divide-slate-700/30">
        {order.map((slot, idx) => (
          <div
            key={slot.id}
            draggable
            onDragStart={() => handleDragStart(idx)}
            onDragOver={(e) => handleDragOver(e, idx)}
            onDrop={handleDrop}
            className={`flex items-center gap-3 px-3 py-2.5 transition-colors select-none ${
              slot.isUser
                ? "bg-blue-600/20 border-l-2 border-l-blue-500"
                : "bg-slate-800/40 hover:bg-slate-700/40"
            }`}
          >
            {/* Drag handle */}
            <div className="cursor-grab text-slate-600 shrink-0">
              <svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor">
                <circle cx="4" cy="3" r="1.5"/><circle cx="8" cy="3" r="1.5"/>
                <circle cx="4" cy="8" r="1.5"/><circle cx="8" cy="8" r="1.5"/>
                <circle cx="4" cy="13" r="1.5"/><circle cx="8" cy="13" r="1.5"/>
              </svg>
            </div>

            {/* Pick number badge */}
            <span className={`text-xs font-bold w-6 text-center shrink-0 ${slot.isUser ? "text-blue-400" : "text-slate-500"}`}>
              {idx + 1}
            </span>

            {/* Name — click to edit */}
            {editingId === slot.id ? (
              <input
                autoFocus
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={() => commitEdit(slot.id)}
                onKeyDown={(e) => { if (e.key === "Enter") commitEdit(slot.id); if (e.key === "Escape") setEditingId(null); }}
                className="flex-1 bg-slate-900/80 border border-blue-500/50 rounded px-2 py-0.5 text-sm text-white focus:outline-none"
              />
            ) : (
              <span
                onClick={() => startEdit(slot)}
                className={`flex-1 text-sm font-semibold cursor-text hover:text-white transition-colors ${slot.isUser ? "text-blue-300" : "text-slate-300"}`}
              >
                {slot.label}
                {slot.isUser && <span className="ml-2 text-xs text-blue-400 font-normal">(You)</span>}
              </span>
            )}

            {/* Up / Down */}
            <div className="flex gap-1 shrink-0">
              <button
                onClick={() => swap(idx, idx - 1)}
                disabled={idx === 0}
                className="w-6 h-6 rounded flex items-center justify-center text-slate-500 hover:text-white hover:bg-slate-700/50 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
              >
                ▲
              </button>
              <button
                onClick={() => swap(idx, idx + 1)}
                disabled={idx === order.length - 1}
                className="w-6 h-6 rounded flex items-center justify-center text-slate-500 hover:text-white hover:bg-slate-700/50 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
              >
                ▼
              </button>
            </div>

            {/* Me button */}
            {!slot.isUser ? (
              <button
                onClick={() => markAsUser(idx)}
                className="shrink-0 text-xs px-2 py-1 rounded border border-blue-500/30 text-blue-400 hover:bg-blue-600/20 transition-colors font-semibold"
              >
                Me
              </button>
            ) : (
              <span className="shrink-0 w-10 text-center text-xs text-blue-400">✓</span>
            )}
          </div>
        ))}
      </div>

      {userIdx === -1 && (
        <div className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
          ⚠ No team is marked as "You". Click "Me" on your slot.
        </div>
      )}

      {userIdx !== -1 && (
        <div className="text-xs text-slate-500 text-center">
          You draft {userIdx + 1}{["st","nd","rd"][userIdx] ?? "th"} overall in Round 1 (snake reverses each round)
        </div>
      )}
    </div>
  );
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

// ── Timer hook ────────────────────────────────────────────────────────────────

const PICK_CLOCK_SECONDS = 180; // 3 minutes

function usePickClock(active: boolean, onExpire: () => void) {
  const [secondsLeft, setSecondsLeft] = useState(PICK_CLOCK_SECONDS);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Reset whenever `active` flips true (new pick starts)
  useEffect(() => {
    setSecondsLeft(PICK_CLOCK_SECONDS);
  }, [active]);

  useEffect(() => {
    if (!active) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }
    timerRef.current = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(timerRef.current!);
          onExpire();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [active, onExpire]);

  return secondsLeft;
}

function PickClock({ seconds, isMyPick }: { seconds: number; isMyPick: boolean }) {
  const pct = seconds / PICK_CLOCK_SECONDS;
  const urgent = seconds <= 30;
  const warning = seconds <= 60;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const color = urgent ? "#ef4444" : warning ? "#f59e0b" : "#10b981";
  const radius = 20;
  const circ = 2 * Math.PI * radius;

  return (
    <div className="flex items-center gap-2">
      <svg width="52" height="52" viewBox="0 0 52 52" className="shrink-0">
        {/* Track */}
        <circle cx="26" cy="26" r={radius} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="4" />
        {/* Progress */}
        <circle
          cx="26" cy="26" r={radius}
          fill="none"
          stroke={color}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - pct)}
          transform="rotate(-90 26 26)"
          style={{ transition: "stroke-dashoffset 1s linear, stroke 0.5s" }}
        />
        <text x="26" y="31" textAnchor="middle" fontSize="11" fontWeight="bold" fill={color}>
          {mins}:{secs.toString().padStart(2, "0")}
        </text>
      </svg>
      <div>
        <div className={`text-xs font-bold ${urgent ? "text-red-400" : warning ? "text-amber-400" : "text-emerald-400"}`}>
          {isMyPick ? "YOUR PICK" : "ON THE CLOCK"}
        </div>
        <div className="text-xs text-slate-500">
          {urgent ? "Pick now!" : warning ? "Hurry up" : "Time remaining"}
        </div>
      </div>
    </div>
  );
}

// ── Live Draft Assistant Tab ──────────────────────────────────────────────────

function DraftAssistant({
  allPlayers,
  onTeamUpdate,
}: {
  allPlayers: LiveDraftPlayer[];
  onTeamUpdate?: (players: LiveDraftPlayer[], format: "ppr"|"half"|"standard", slots: LeagueSettings["rosterSlots"]) => void;
}) {
  const [settings, setSettings] = useState<LeagueSettings>(() => {
    const saved = loadOrderFromStorage();
    if (saved && saved.length > 0) {
      const userSlot = saved.findIndex((s) => s.isUser);
      return {
        ...DEFAULT_SETTINGS,
        numTeams: saved.length,
        draftPosition: userSlot + 1,
        customOrder: saved,
      };
    }
    return DEFAULT_SETTINGS;
  });
  const [configured, setConfigured] = useState(false);
  const [showOrderEditor, setShowOrderEditor] = useState(false);
  const [board, setBoard] = useState<PickEntry[]>([]);
  const [currentPickIdx, setCurrentPickIdx] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [posFilter, setPosFilter] = useState<Position | "ALL">("ALL");
  const [paused, setPaused] = useState(false);
  const [draftComplete, setDraftComplete] = useState(false);
  const [lastAutoPick, setLastAutoPick] = useState<{ name: string; team: string } | null>(null);
  const [savedToast, setSavedToast] = useState(false);
  const boardRef = useRef<HTMLDivElement>(null);
  const currentPickRef = useRef<HTMLDivElement>(null);

  // Keep customOrder in sync when numTeams or draftPosition changes
  const syncOrder = useCallback((numTeams: number, draftPosition: number) => {
    setSettings((s) => {
      const existingLen = s.customOrder.length;
      if (existingLen === numTeams) {
        // Just move user flag to new position
        const next = s.customOrder.map((slot, i) => ({ ...slot, isUser: i + 1 === draftPosition }));
        return { ...s, numTeams, draftPosition, customOrder: next };
      }
      // Rebuild from scratch
      return { ...s, numTeams, draftPosition, customOrder: buildDefaultOrder(numTeams, draftPosition) };
    });
  }, []);

  const handleSaveOrder = useCallback(() => {
    saveOrderToStorage(settings.customOrder);
    setSavedToast(true);
    setTimeout(() => setSavedToast(false), 2500);
  }, [settings.customOrder]);

  const startDraft = useCallback(() => {
    if (!settings.customOrder.some((s) => s.isUser)) return; // guard
    setBoard(buildDraftBoard(settings));
    setCurrentPickIdx(0);
    setDraftComplete(false);
    setLastAutoPick(null);
    setConfigured(true);
    setPaused(false);
  }, [settings]);

  const resetDraft = useCallback(() => {
    setBoard([]);
    setCurrentPickIdx(0);
    setConfigured(false);
    setSearchQuery("");
    setDraftComplete(false);
    setLastAutoPick(null);
    setPaused(false);
  }, []);

  const draftedIds = useMemo(() => {
    const ids = new Set<number>();
    for (const p of board) {
      if (p.player) ids.add(p.player.id);
    }
    return ids;
  }, [board]);

  // Get available players at a specific state of the board
  const getAvailableFromBoard = useCallback(
    (b: PickEntry[]) => allPlayers.filter((p) => !b.some((pick) => pick.player?.id === p.id)),
    [allPlayers]
  );

  const available = useMemo(() => getAvailableFromBoard(board), [board, getAvailableFromBoard]);

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
  const isMyTurn = !!currentPick && currentPick.team === "user" && !currentPick.player;

  // Notify parent whenever the user's roster changes
  useEffect(() => {
    if (!configured || !onTeamUpdate) return;
    const drafted = myPickedPlayers.map((p) => p.player!);
    onTeamUpdate(drafted, settings.scoringFormat, settings.rosterSlots);
  }, [myPickedPlayers, settings.scoringFormat, settings.rosterSlots, configured, onTeamUpdate]);

  const aiRec = useMemo(() => {
    if (!isMyTurn) return null;
    return aiRecommendation(available, myPicks, currentPick!, settings, board);
  }, [isMyTurn, available, myPicks, currentPick, settings, board]);

  // Advance to next pick index, detect draft complete
  const advance = useCallback((b: PickEntry[], fromIdx: number) => {
    const nextIdx = fromIdx + 1;
    if (nextIdx >= b.length) {
      setDraftComplete(true);
      return;
    }
    setCurrentPickIdx(nextIdx);
    // Scroll draft board row into view
    setTimeout(() => {
      currentPickRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 100);
  }, []);

  // Execute a pick (used for both user and auto-other picks)
  const executePick = useCallback(
    (player: LiveDraftPlayer, b: PickEntry[], idx: number): PickEntry[] => {
      const next = [...b];
      next[idx] = { ...next[idx], player };
      return next;
    },
    []
  );

  const makePick = useCallback(
    (player: LiveDraftPlayer) => {
      if (!isMyTurn) return;
      setBoard((prev) => {
        const next = executePick(player, prev, currentPickIdx);
        return next;
      });
      advance(board, currentPickIdx);
    },
    [isMyTurn, currentPickIdx, board, executePick, advance]
  );

  const undoPick = useCallback(() => {
    const prevIdx = currentPickIdx - 1;
    if (prevIdx < 0) return;
    setBoard((prev) => {
      const next = [...prev];
      next[prevIdx] = { ...next[prevIdx], player: null };
      return next;
    });
    setCurrentPickIdx(prevIdx);
    setDraftComplete(false);
    setLastAutoPick(null);
  }, [currentPickIdx]);

  // Auto-pick for "other" teams — picks the best available by rank
  const autoPickOtherNow = useCallback(
    (b: PickEntry[], idx: number): PickEntry[] => {
      const avail = getAvailableFromBoard(b);
      if (avail.length === 0) return b;
      const player = avail[0];
      setLastAutoPick({ name: player.name, team: player.team });
      return executePick(player, b, idx);
    },
    [getAvailableFromBoard, executePick]
  );

  // When the clock expires on the user's pick, auto-pick AI rec
  const handleClockExpire = useCallback(() => {
    if (!isMyTurn || paused) return;
    setBoard((prev) => {
      const avail = getAvailableFromBoard(prev);
      if (avail.length === 0) return prev;
      // Use AI rec if available, else top available
      const rec = aiRecommendation(avail, myPicks, currentPick!, settings, prev);
      const player = rec?.player ?? avail[0];
      setLastAutoPick({ name: player.name, team: player.team });
      const next = executePick(player, prev, currentPickIdx);
      setTimeout(() => advance(next, currentPickIdx), 0);
      return next;
    });
  }, [isMyTurn, paused, getAvailableFromBoard, myPicks, currentPick, settings, currentPickIdx, executePick, advance]);

  const clockActive = configured && !draftComplete && !paused && isMyTurn;
  const secondsLeft = usePickClock(clockActive, handleClockExpire);

  // Auto-advance through consecutive "other" picks with a short delay
  useEffect(() => {
    if (!configured || draftComplete || paused) return;
    if (!currentPick || currentPick.team !== "other" || currentPick.player) return;

    const delay = setTimeout(() => {
      setBoard((prev) => {
        const next = autoPickOtherNow(prev, currentPickIdx);
        setTimeout(() => advance(next, currentPickIdx), 0);
        return next;
      });
    }, 600); // 600ms between other-team picks so you can see them flash by

    return () => clearTimeout(delay);
  }, [configured, draftComplete, paused, currentPick, currentPickIdx, autoPickOtherNow, advance]);

  // Configuration screen
  if (!configured) {
    const userSlot = settings.customOrder.findIndex((s) => s.isUser);
    const hasUser = userSlot !== -1;

    return (
      <div className="max-w-2xl mx-auto mt-8 space-y-6">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-white mb-2">Configure Your Draft</h2>
          <p className="text-slate-400 text-sm">Set your league settings and draft order, then start when ready.</p>
        </div>

        {/* Save toast */}
        {savedToast && (
          <div className="fixed top-6 right-6 z-50 bg-emerald-600 text-white text-sm font-semibold px-4 py-2.5 rounded-xl shadow-lg animate-in slide-in-from-top-2">
            ✓ Draft order saved
          </div>
        )}

        <div className="bg-slate-800/60 rounded-2xl border border-slate-700/40 p-6 space-y-6">
          {/* Row 1: Teams + Rounds + Scoring */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            {/* Teams */}
            <div>
              <label className="block text-sm font-semibold text-slate-300 mb-2">Teams</label>
              <div className="flex gap-2 flex-wrap">
                {[8, 10, 12, 14].map((n) => (
                  <button
                    key={n}
                    onClick={() => syncOrder(n, settings.draftPosition <= n ? settings.draftPosition : 1)}
                    className={`px-3 py-2 rounded-lg text-sm font-semibold border transition-colors ${settings.numTeams === n ? "bg-blue-600 border-blue-500 text-white" : "bg-slate-700/50 border-slate-600/30 text-slate-400 hover:text-white"}`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {/* Rounds */}
            <div>
              <label className="block text-sm font-semibold text-slate-300 mb-2">Rounds</label>
              <div className="flex gap-2 flex-wrap">
                {[13, 14, 15, 16].map((n) => (
                  <button
                    key={n}
                    onClick={() => setSettings((s) => ({ ...s, numRounds: n }))}
                    className={`px-3 py-2 rounded-lg text-sm font-semibold border transition-colors ${settings.numRounds === n ? "bg-blue-600 border-blue-500 text-white" : "bg-slate-700/50 border-slate-600/30 text-slate-400 hover:text-white"}`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {/* Scoring */}
            <div>
              <label className="block text-sm font-semibold text-slate-300 mb-2">Scoring</label>
              <div className="flex gap-2 flex-wrap">
                {(["ppr","half","standard"] as const).map((fmt) => (
                  <button
                    key={fmt}
                    onClick={() => setSettings((s) => ({ ...s, scoringFormat: fmt }))}
                    className={`px-3 py-2 rounded-lg text-sm font-semibold border transition-colors ${settings.scoringFormat === fmt ? "bg-purple-600 border-purple-500 text-white" : "bg-slate-700/50 border-slate-600/30 text-slate-400 hover:text-white"}`}
                  >
                    {fmt === "half" ? "Half" : fmt.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Divider */}
          <div className="border-t border-slate-700/40" />

          {/* Draft Order section */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-sm font-semibold text-slate-300">Draft Order</div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {hasUser
                    ? `You pick ${userSlot + 1}${["st","nd","rd"][userSlot] ?? "th"} in Round 1`
                    : "Select your slot below"}
                </div>
              </div>
              <button
                onClick={() => setShowOrderEditor((v) => !v)}
                className={`text-xs px-3 py-1.5 rounded-lg border font-semibold transition-colors ${showOrderEditor ? "bg-blue-600 border-blue-500 text-white" : "bg-slate-700/40 border-slate-600/30 text-slate-300 hover:text-white"}`}
              >
                {showOrderEditor ? "▲ Hide Editor" : "✏ Edit Order"}
              </button>
            </div>

            {/* Quick-pick row when editor is hidden */}
            {!showOrderEditor && (
              <div className="flex gap-1.5 flex-wrap">
                {settings.customOrder.map((slot, idx) => (
                  <button
                    key={slot.id}
                    onClick={() => {
                      const next = settings.customOrder.map((s, i) => ({ ...s, isUser: i === idx }));
                      setSettings((s) => ({ ...s, draftPosition: idx + 1, customOrder: next }));
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                      slot.isUser
                        ? "bg-blue-600 border-blue-500 text-white"
                        : "bg-slate-700/40 border-slate-600/30 text-slate-400 hover:text-white"
                    }`}
                  >
                    {slot.isUser ? `✓ Pick ${idx + 1}` : `${idx + 1}`}
                  </button>
                ))}
              </div>
            )}

            {/* Full editor */}
            {showOrderEditor && (
              <DraftOrderEditor
                order={settings.customOrder}
                onChange={(next) => {
                  const userIdx = next.findIndex((s) => s.isUser);
                  setSettings((s) => ({
                    ...s,
                    numTeams: next.length,
                    draftPosition: userIdx + 1,
                    customOrder: next,
                  }));
                }}
                onSave={handleSaveOrder}
              />
            )}
          </div>

          <button
            onClick={startDraft}
            disabled={!hasUser}
            className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold py-3 rounded-xl transition-all"
          >
            {hasUser ? `Start Draft — You Pick ${userSlot + 1}${["st","nd","rd"][userSlot] ?? "th"} →` : "Select Your Slot to Start"}
          </button>
        </div>
      </div>
    );
  }

  // Draft complete screen
  if (draftComplete) {
    const draftedPlayers = myPickedPlayers.map((p) => p.player!);
    return (
      <div className="space-y-4">
        <div className="rounded-2xl bg-gradient-to-r from-emerald-900/40 to-blue-900/40 border border-emerald-500/30 p-6 text-center">
          <div className="text-4xl mb-2">🏆</div>
          <h3 className="text-2xl font-bold text-white mb-1">Draft Complete!</h3>
          <p className="text-slate-400 text-sm mb-4">Your team has been graded below.</p>
          <div className="flex justify-center gap-3 flex-wrap">
            <button onClick={startDraft} className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm transition-colors">
              Re-Draft Same Settings
            </button>
            <button onClick={resetDraft} className="px-5 py-2.5 rounded-xl bg-slate-700/50 hover:bg-slate-700 text-slate-300 font-bold text-sm border border-slate-600/30 transition-colors">
              Change Settings
            </button>
          </div>
        </div>

        {/* Inline analyzer on complete */}
        <DraftAnalyzer
          input={{ players: draftedPlayers, format: settings.scoringFormat, slots: settings.rosterSlots }}
        />
      </div>
    );
  }

  // Draft in progress
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

      {/* Left: Available Players */}
      <div className="lg:col-span-2 space-y-3">
        <div className="bg-slate-800/60 rounded-2xl border border-slate-700/40 p-4">
          {/* Header row with clock */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <h3 className="font-bold text-white">
                Available
                <span className="ml-1 text-slate-400 text-sm font-normal">({available.length})</span>
              </h3>
              {currentPick && (
                <PickClock seconds={secondsLeft} isMyPick={isMyTurn} />
              )}
            </div>
            <div className="flex gap-2 flex-wrap justify-end">
              <button
                onClick={() => { setPaused((p) => !p); setShowOrderEditor(false); }}
                className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${paused && !showOrderEditor ? "bg-amber-500/20 border-amber-500/30 text-amber-400" : "bg-slate-700/50 border-slate-600/30 text-slate-300 hover:text-white"}`}
              >
                {paused && !showOrderEditor ? "▶ Resume" : "⏸ Pause"}
              </button>
              <button
                onClick={() => { setShowOrderEditor((v) => !v); if (!paused) setPaused(true); }}
                className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${showOrderEditor ? "bg-blue-600 border-blue-500 text-white" : "bg-slate-700/50 border-slate-600/30 text-slate-300 hover:text-white"}`}
              >
                ✏ Order
              </button>
              <button onClick={undoPick} className="text-xs px-3 py-1.5 rounded-lg bg-slate-700/50 text-slate-300 hover:text-white border border-slate-600/30 transition-colors">
                ← Undo
              </button>
              <button onClick={resetDraft} className="text-xs px-3 py-1.5 rounded-lg bg-red-500/20 text-red-400 hover:text-red-300 border border-red-500/30 transition-colors">
                Reset
              </button>
            </div>
          </div>

          {/* Saved toast */}
          {savedToast && (
            <div className="mb-2 rounded-lg bg-emerald-600/20 border border-emerald-500/30 px-3 py-2 text-xs text-emerald-400 font-semibold">
              ✓ Draft order saved
            </div>
          )}

          {/* Inline order editor (mid-draft) */}
          {showOrderEditor && (
            <div className="mb-3 rounded-xl bg-slate-900/70 border border-blue-500/20 p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-bold text-white">Edit Draft Order</div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      // Rebuild the board from current order, keep already-made picks at absolute positions
                      const newBoard = buildDraftBoard(settings);
                      // Restore picks that have been made (by overall pick number)
                      for (const existing of board) {
                        if (existing.player) {
                          const match = newBoard.find((p) => p.overall === existing.overall);
                          if (match) match.player = existing.player;
                        }
                      }
                      setBoard(newBoard);
                      setShowOrderEditor(false);
                      setPaused(false);
                    }}
                    className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-colors"
                  >
                    Apply & Resume
                  </button>
                  <button
                    onClick={() => { setShowOrderEditor(false); setPaused(false); }}
                    className="text-xs px-3 py-1.5 rounded-lg bg-slate-700/50 text-slate-300 hover:text-white border border-slate-600/30 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
              <DraftOrderEditor
                order={settings.customOrder}
                onChange={(next) => {
                  const userIdx = next.findIndex((s) => s.isUser);
                  setSettings((s) => ({
                    ...s,
                    numTeams: next.length,
                    draftPosition: userIdx + 1,
                    customOrder: next,
                  }));
                }}
                onSave={handleSaveOrder}
              />
            </div>
          )}

          {/* Last auto pick toast */}
          {lastAutoPick && !showOrderEditor && (
            <div className="mb-2 rounded-lg bg-slate-700/50 border border-slate-600/30 px-3 py-2 text-xs text-slate-400 flex items-center gap-2">
              <span className="text-slate-500">↳ Auto-picked:</span>
              <span className="font-semibold text-white">{lastAutoPick.name}</span>
              <span className="text-slate-500">({lastAutoPick.team})</span>
            </div>
          )}

          {/* Other teams picking — animated */}
          {currentPick && currentPick.team === "other" && !currentPick.player && (
            <div className="mb-3 rounded-xl bg-slate-700/30 border border-slate-600/20 p-3 flex items-center gap-3">
              <div className="flex gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-bounce" style={{ animationDelay: "0ms" }} />
                <div className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-bounce" style={{ animationDelay: "150ms" }} />
                <div className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
              <div>
                <span className="text-xs font-semibold text-slate-400">
                  {settings.customOrder[currentPick.slotIdx]?.label ?? `Team ${currentPick.pick}`} is picking
                </span>
                <span className="text-xs text-slate-500 ml-2">Round {currentPick.round} · Overall #{currentPick.overall}</span>
              </div>
              {paused && (
                <button
                  onClick={() => {
                    setBoard((prev) => {
                      const next = autoPickOtherNow(prev, currentPickIdx);
                      setTimeout(() => advance(next, currentPickIdx), 0);
                      return next;
                    });
                  }}
                  className="ml-auto text-xs px-3 py-1.5 rounded-lg bg-slate-600 hover:bg-slate-500 text-white border border-slate-500/30 transition-colors"
                >
                  Skip →
                </button>
              )}
            </div>
          )}

          {/* AI Recommendation Banner — shown when it's your turn */}
          {isMyTurn && aiRec && (
            <div className={`mb-3 rounded-xl border p-3 transition-colors ${secondsLeft <= 30 ? "bg-red-500/10 border-red-500/30" : "bg-amber-500/10 border-amber-500/30"}`}>
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className={`text-xs font-semibold mb-1 ${secondsLeft <= 30 ? "text-red-400" : "text-amber-400"}`}>
                    🤖 AI Recommendation — Round {currentPick!.round}, Pick {currentPick!.pick}
                  </div>
                  <div className="text-sm font-bold text-white">{aiRec.player.name}</div>
                  <div className="text-xs text-slate-400 mt-0.5 leading-relaxed">{aiRec.reason}</div>
                  {secondsLeft <= 30 && (
                    <div className="text-xs text-red-400 font-semibold mt-1">⚠ Clock expiring — will auto-draft if you don't pick</div>
                  )}
                </div>
                <button
                  onClick={() => makePick(aiRec.player)}
                  className={`ml-4 shrink-0 px-4 py-2 rounded-lg text-sm font-bold transition-colors ${secondsLeft <= 30 ? "bg-red-500 hover:bg-red-400 text-white" : "bg-amber-500 hover:bg-amber-400 text-black"}`}
                >
                  Draft
                </button>
              </div>
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
                onClick={() => isMyTurn && makePick(player)}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors group ${isMyTurn ? "cursor-pointer hover:bg-slate-700/50" : "opacity-50 cursor-default"}`}
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
          <div className="space-y-0.5 max-h-80 overflow-y-auto" ref={boardRef}>
            {board.map((pick, idx) => (
              <div
                key={pick.overall}
                ref={idx === currentPickIdx ? currentPickRef : undefined}
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
                  <span className={`flex-1 truncate ${pick.team === "user" ? "text-amber-400 font-semibold" : "text-slate-600"}`}>
                    {pick.team === "user"
                      ? "← YOUR PICK"
                      : settings.customOrder[pick.slotIdx]?.label ?? `Team ${pick.pick}`}
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
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-lg mx-auto mb-4">
        <div className="rounded-xl bg-slate-800/60 border border-slate-700/40 p-4 text-left">
          <div className="text-amber-400 font-bold text-sm mb-1">⭐ Sharpshooter — $9.99/mo</div>
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
          <div className="text-purple-400 font-bold text-sm mb-1">👑 Champion — $19.99/mo</div>
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

// ── Draft Analyzer ────────────────────────────────────────────────────────────

type Grade = "A+" | "A" | "A-" | "B+" | "B" | "B-" | "C+" | "C" | "C-" | "D+" | "D" | "D-" | "F";

interface CategoryScore {
  key: string;
  name: string;
  icon: string;
  grade: Grade;
  score: number;   // 0–100
  headline: string;
  details: string[];
}

function scoreToGrade(s: number): Grade {
  if (s >= 97) return "A+";
  if (s >= 93) return "A";
  if (s >= 90) return "A-";
  if (s >= 87) return "B+";
  if (s >= 83) return "B";
  if (s >= 80) return "B-";
  if (s >= 77) return "C+";
  if (s >= 73) return "C";
  if (s >= 70) return "C-";
  if (s >= 67) return "D+";
  if (s >= 63) return "D";
  if (s >= 60) return "D-";
  return "F";
}

const GRADE_COLORS: Record<string, { text: string; bg: string; border: string; bar: string }> = {
  "A+": { text:"text-emerald-300", bg:"bg-emerald-500/10", border:"border-emerald-500/30", bar:"bg-emerald-400" },
  "A":  { text:"text-emerald-400", bg:"bg-emerald-500/10", border:"border-emerald-500/30", bar:"bg-emerald-400" },
  "A-": { text:"text-emerald-400", bg:"bg-emerald-500/10", border:"border-emerald-500/30", bar:"bg-emerald-400" },
  "B+": { text:"text-blue-300",    bg:"bg-blue-500/10",    border:"border-blue-500/30",    bar:"bg-blue-400"    },
  "B":  { text:"text-blue-400",    bg:"bg-blue-500/10",    border:"border-blue-500/30",    bar:"bg-blue-400"    },
  "B-": { text:"text-blue-400",    bg:"bg-blue-500/10",    border:"border-blue-500/30",    bar:"bg-blue-400"    },
  "C+": { text:"text-amber-300",   bg:"bg-amber-500/10",   border:"border-amber-500/30",   bar:"bg-amber-400"   },
  "C":  { text:"text-amber-400",   bg:"bg-amber-500/10",   border:"border-amber-500/30",   bar:"bg-amber-400"   },
  "C-": { text:"text-amber-400",   bg:"bg-amber-500/10",   border:"border-amber-500/30",   bar:"bg-amber-400"   },
  "D+": { text:"text-orange-400",  bg:"bg-orange-500/10",  border:"border-orange-500/30",  bar:"bg-orange-400"  },
  "D":  { text:"text-orange-400",  bg:"bg-orange-500/10",  border:"border-orange-500/30",  bar:"bg-orange-400"  },
  "D-": { text:"text-orange-400",  bg:"bg-orange-500/10",  border:"border-orange-500/30",  bar:"bg-orange-400"  },
  "F":  { text:"text-red-400",     bg:"bg-red-500/10",     border:"border-red-500/30",     bar:"bg-red-500"     },
};

function gradeColors(g: Grade) { return GRADE_COLORS[g] ?? GRADE_COLORS["C"]; }

// Identify positional starters from a pool
function getStarters(
  players: LiveDraftPlayer[],
  slots: LeagueSettings["rosterSlots"]
): LiveDraftPlayer[] {
  const byPos: Record<string, LiveDraftPlayer[]> = {};
  for (const p of players) {
    byPos[p.position] = [...(byPos[p.position] ?? []), p];
  }
  const starters: LiveDraftPlayer[] = [];
  for (const [pos, count] of Object.entries(slots)) {
    if (pos === "FLEX") continue;
    const pool = (byPos[pos] ?? []).slice(0, count);
    starters.push(...pool);
  }
  // FLEX: best remaining RB/WR/TE not already selected
  const selectedIds = new Set(starters.map((p) => p.id));
  const flexPool = players
    .filter((p) => ["RB","WR","TE"].includes(p.position) && !selectedIds.has(p.id))
    .slice(0, slots.FLEX ?? 1);
  starters.push(...flexPool);
  return starters;
}

function analyzeDraft(
  players: LiveDraftPlayer[],
  format: "ppr" | "half" | "standard",
  slots: LeagueSettings["rosterSlots"]
): { categories: CategoryScore[]; overallGrade: Grade; overallScore: number; insights: string[] } {
  if (players.length === 0) {
    return { categories: [], overallGrade: "F", overallScore: 0, insights: [] };
  }

  const starters = getStarters(players, slots);
  const bench = players.filter((p) => !starters.some((s) => s.id === p.id));

  // ── 1. Starter Quality ──────────────────────────────────────────────────────
  const avgStarterRank = starters.length
    ? starters.reduce((s, p) => s + p.adjustedRank, 0) / starters.length
    : 999;
  const starterScore = Math.max(20, Math.round(100 - (avgStarterRank - 5) * 0.82));
  const starterDetails: string[] = starters.slice(0, 6).map((p) =>
    `${p.position} ${p.name} — Rank #${p.adjustedRank} (${p.tierLabel})`
  );
  if (starters.length < Object.values(slots).reduce((a, b) => a + b, 0) - (slots.FLEX ?? 0)) {
    starterDetails.push("⚠ Some roster slots appear unfilled.");
  }

  // ── 2. Bench Depth ──────────────────────────────────────────────────────────
  const avgBenchRank = bench.length
    ? bench.reduce((s, p) => s + p.adjustedRank, 0) / bench.length
    : 150;
  const depthScore = Math.max(20, Math.round(100 - (avgBenchRank - 30) * 0.58));
  const depthDetails = bench.length
    ? [`${bench.length} bench players — avg rank #${Math.round(avgBenchRank)}`]
    : ["No bench players drafted yet."];
  if (bench.some((p) => p.adjustedRank <= 40)) {
    depthDetails.push("Strong bench stash — you have late-round value picks.");
  }

  // ── 3. Positional Balance ───────────────────────────────────────────────────
  const posCounts: Record<string, number> = {};
  for (const p of players) posCounts[p.position] = (posCounts[p.position] ?? 0) + 1;
  const posDetails: string[] = [];
  let missingSlots = 0;
  for (const [pos, needed] of Object.entries(slots)) {
    if (pos === "FLEX") continue;
    const have = posCounts[pos] ?? 0;
    if (have < needed) {
      missingSlots += (needed - have);
      posDetails.push(`⚠ Need ${needed - have} more ${pos}`);
    } else {
      posDetails.push(`✓ ${pos}: ${have} (need ${needed})`);
    }
  }
  const positionalScore = Math.max(15, 100 - missingSlots * 18);

  // ── 4. Bye Week Risk ────────────────────────────────────────────────────────
  const starterByes: Record<number, number> = {};
  for (const p of starters) {
    if (p.position !== "K" && p.position !== "DST") {
      starterByes[p.bye] = (starterByes[p.bye] ?? 0) + 1;
    }
  }
  const maxByeConflict = Math.max(0, ...Object.values(starterByes));
  const byeScore = maxByeConflict <= 1 ? 100 : maxByeConflict === 2 ? 82 : maxByeConflict === 3 ? 63 : maxByeConflict === 4 ? 44 : 25;
  const byeDetails = Object.entries(starterByes)
    .sort(([,a],[,b]) => b - a)
    .map(([week, count]) => `Week ${week}: ${count} starter${count > 1 ? "s" : ""} off`);
  if (maxByeConflict >= 3) byeDetails.push("⚠ Consider waiver replacements for that week.");

  // ── 5. Draft Value ──────────────────────────────────────────────────────────
  const valuePerPick = players.map((p) => Math.round(p.adp) - p.adjustedRank);
  const avgValue = valuePerPick.reduce((a, b) => a + b, 0) / players.length;
  const valueScore = Math.min(100, Math.max(15, Math.round(65 + avgValue * 1.6)));
  const topValue = players
    .filter((p) => Math.round(p.adp) - p.adjustedRank >= 10)
    .slice(0, 3)
    .map((p) => `${p.name} (+${Math.round(p.adp) - p.adjustedRank} vs ADP)`);
  const valueDetails: string[] = avgValue >= 0
    ? [`Avg +${Math.round(avgValue)} spots vs consensus ADP — great value`, ...topValue]
    : [`Avg ${Math.round(avgValue)} spots vs consensus ADP — slightly above market`, ...topValue];

  // ── 6. Upside / Ceiling ─────────────────────────────────────────────────────
  const eliteUp = players.filter((p) => p.upside === "elite").length;
  const highUp  = players.filter((p) => p.upside === "high").length;
  const upsideScore = Math.min(100, Math.round(35 + eliteUp * 14 + highUp * 7));
  const upsideDetails = [
    `${eliteUp} elite-upside player${eliteUp !== 1 ? "s" : ""}`,
    `${highUp} high-upside player${highUp !== 1 ? "s" : ""}`,
    ...players.filter((p) => p.upside === "elite").slice(0, 3).map((p) => `★ ${p.name} (${p.position})`),
  ];

  // ── 7. Risk Management ──────────────────────────────────────────────────────
  const highRiskCount = starters.filter((p) => p.risk === "high").length;
  const riskScore = highRiskCount === 0 ? 100 : highRiskCount === 1 ? 84 : highRiskCount === 2 ? 68 : highRiskCount === 3 ? 52 : highRiskCount === 4 ? 38 : 22;
  const riskDetails = highRiskCount === 0
    ? ["No high-risk starters — safe floor."]
    : [
        `${highRiskCount} high-risk starter${highRiskCount > 1 ? "s" : ""}`,
        ...starters.filter((p) => p.risk === "high").map((p) => `⚠ ${p.name} — ${p.concerns[0] ?? "injury history"}`),
      ];

  // ── 8. Handcuff Coverage ────────────────────────────────────────────────────
  const myTeams = new Set(players.map((p) => p.team));
  const bellcows = starters.filter((p) => p.position === "RB" && (p.tags.includes("bellcow") || p.tags.includes("workhorse")));
  const coveredBellcows = bellcows.filter((bc) =>
    players.some((p) => p.team === bc.team && p.tags.includes("handcuff"))
  );
  const handcuffScore = bellcows.length === 0 ? 82
    : Math.round(50 + (coveredBellcows.length / bellcows.length) * 50);
  const handcuffDetails: string[] = bellcows.length === 0
    ? ["No bellcow RBs identified — add one."]
    : [
        `${coveredBellcows.length}/${bellcows.length} workhorse RBs have handcuffs`,
        ...bellcows.map((bc) =>
          coveredBellcows.includes(bc)
            ? `✓ ${bc.name} handcuffed`
            : `✗ ${bc.name} — no handcuff owned`
        ),
      ];

  // ── Weighted overall ────────────────────────────────────────────────────────
  const WEIGHTS = [
    { score: starterScore,    w: 28 },
    { score: depthScore,      w: 14 },
    { score: positionalScore, w: 20 },
    { score: byeScore,        w: 10 },
    { score: valueScore,      w: 10 },
    { score: upsideScore,     w: 10 },
    { score: riskScore,       w: 5  },
    { score: handcuffScore,   w: 3  },
  ];
  const totalW = WEIGHTS.reduce((a, b) => a + b.w, 0);
  const overallScore = Math.round(WEIGHTS.reduce((a, b) => a + b.score * b.w, 0) / totalW);
  const overallGrade = scoreToGrade(overallScore);

  // ── Key insights ────────────────────────────────────────────────────────────
  const insights: string[] = [];
  if (starterScore >= 85) insights.push("💪 Your starters are elite — core is championship caliber.");
  else if (starterScore < 60) insights.push("⚠ Starter quality is thin. Target upgrades on the waiver wire.");
  if (maxByeConflict >= 3) insights.push(`🗓 ${maxByeConflict} starters share the same bye — plan for that week now.`);
  if (avgValue >= 8) insights.push(`💰 Excellent value drafting — you're ${Math.round(avgValue)} spots ahead of consensus on average.`);
  if (upsideScore >= 80) insights.push("🚀 High ceiling roster — strong playoff upside if healthy.");
  if (highRiskCount >= 3) insights.push("🩺 Injury risk is elevated on your starters. Add depth at key spots.");
  if (coveredBellcows.length < bellcows.length) insights.push(`🔒 Missing handcuffs for ${bellcows.length - coveredBellcows.length} RB(s) — grab them early on waivers.`);
  if (missingSlots > 0) insights.push(`📋 You still need to fill ${missingSlots} roster spot(s).`);
  if (depthScore >= 80) insights.push("📦 Excellent bench depth — good trade assets heading into the season.");
  if (insights.length === 0) insights.push("✅ Solid all-around team. Monitor news closely heading into the season.");

  const categories: CategoryScore[] = [
    { key:"starters",   name:"Starter Quality",     icon:"⭐", grade:scoreToGrade(starterScore),    score:starterScore,    headline:avgStarterRank < 30 ? "Elite starters" : avgStarterRank < 50 ? "Solid lineup" : "Needs improvement",              details:starterDetails   },
    { key:"depth",      name:"Bench Depth",          icon:"📦", grade:scoreToGrade(depthScore),      score:depthScore,      headline:avgBenchRank < 70 ? "Deep bench" : avgBenchRank < 100 ? "Adequate depth" : "Thin bench",                        details:depthDetails     },
    { key:"balance",    name:"Positional Balance",   icon:"⚖️", grade:scoreToGrade(positionalScore), score:positionalScore, headline:missingSlots === 0 ? "Fully balanced" : `${missingSlots} slot${missingSlots > 1 ? "s" : ""} missing`,           details:posDetails       },
    { key:"bye",        name:"Bye Week Risk",        icon:"🗓", grade:scoreToGrade(byeScore),        score:byeScore,        headline:maxByeConflict <= 1 ? "No conflicts" : `${maxByeConflict} starters share a bye`,                                 details:byeDetails       },
    { key:"value",      name:"Draft Value",          icon:"💰", grade:scoreToGrade(valueScore),      score:valueScore,      headline:avgValue >= 5 ? `+${Math.round(avgValue)} avg vs ADP` : avgValue >= 0 ? "At market value" : "Slightly overpaid", details:valueDetails     },
    { key:"upside",     name:"Ceiling / Upside",     icon:"🚀", grade:scoreToGrade(upsideScore),     score:upsideScore,     headline:`${eliteUp} elite, ${highUp} high upside`,                                                                       details:upsideDetails    },
    { key:"risk",       name:"Risk Management",      icon:"🩺", grade:scoreToGrade(riskScore),       score:riskScore,       headline:highRiskCount === 0 ? "Low injury risk" : `${highRiskCount} high-risk starter${highRiskCount > 1 ? "s" : ""}`,   details:riskDetails      },
    { key:"handcuffs",  name:"Handcuff Coverage",    icon:"🔒", grade:scoreToGrade(handcuffScore),   score:handcuffScore,   headline:bellcows.length === 0 ? "No bellcows drafted" : `${coveredBellcows.length}/${bellcows.length} covered`,           details:handcuffDetails  },
  ];

  return { categories, overallGrade, overallScore, insights };
}

// ── Grade Letter Display ──────────────────────────────────────────────────────

function GradeLetter({ grade, size = "lg" }: { grade: Grade; size?: "sm" | "md" | "lg" | "xl" }) {
  const gc = gradeColors(grade);
  const sz = size === "xl" ? "text-8xl w-32 h-32" : size === "lg" ? "text-5xl w-20 h-20" : size === "md" ? "text-3xl w-14 h-14" : "text-xl w-10 h-10";
  return (
    <div className={`rounded-2xl ${gc.bg} border-2 ${gc.border} flex items-center justify-center font-black ${sz} ${gc.text} shadow-lg`}>
      {grade}
    </div>
  );
}

// ── Score Bar ─────────────────────────────────────────────────────────────────

function ScoreBar({ score, grade }: { score: number; grade: Grade }) {
  const gc = gradeColors(grade);
  return (
    <div className="h-1.5 w-full rounded-full bg-slate-700/50 overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-700 ${gc.bar}`}
        style={{ width: `${score}%` }}
      />
    </div>
  );
}

// ── Draft Analyzer Component ──────────────────────────────────────────────────

interface DraftAnalysisInput {
  players: LiveDraftPlayer[];
  format: "ppr" | "half" | "standard";
  slots: LeagueSettings["rosterSlots"];
}

function DraftAnalyzer({ input, onClose }: { input: DraftAnalysisInput; onClose?: () => void }) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const { categories, overallGrade, overallScore, insights } = useMemo(
    () => analyzeDraft(input.players, input.format, input.slots),
    [input]
  );
  const gc = gradeColors(overallGrade);

  if (input.players.length === 0) {
    return (
      <div className="rounded-2xl bg-slate-800/60 border border-slate-700/40 p-10 text-center">
        <div className="text-4xl mb-3">📋</div>
        <h3 className="text-lg font-bold text-white mb-2">No Team to Analyze</h3>
        <p className="text-slate-400 text-sm">Complete your draft in the Live Draft Assistant, then come back here to grade your team.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Overall Grade Hero */}
      <div className={`rounded-2xl ${gc.bg} border ${gc.border} p-6`}>
        <div className="flex items-center gap-6">
          <GradeLetter grade={overallGrade} size="xl" />
          <div className="flex-1">
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Overall Draft Grade</div>
            <div className="text-2xl font-black text-white mb-1">
              {overallScore >= 90 ? "Championship Contender" :
               overallScore >= 80 ? "Playoff-Caliber Team" :
               overallScore >= 70 ? "Competitive Roster" :
               overallScore >= 60 ? "Average Draft" :
               overallScore >= 50 ? "Below Average" : "Needs Work"}
            </div>
            <div className="text-sm text-slate-400 mb-3">
              {input.players.length} players drafted · {input.format.toUpperCase()} scoring
            </div>
            <ScoreBar score={overallScore} grade={overallGrade} />
            <div className="text-xs text-slate-500 mt-1">{overallScore}/100 composite score</div>
          </div>
        </div>
      </div>

      {/* Key Insights */}
      <div className="rounded-2xl bg-slate-800/60 border border-slate-700/40 p-5">
        <div className="text-sm font-bold text-white mb-3">🔍 Key Insights</div>
        <ul className="space-y-2">
          {insights.map((insight, i) => (
            <li key={i} className="text-sm text-slate-300 flex gap-2 items-start">
              <span className="shrink-0 text-slate-500 mt-0.5">→</span>
              {insight}
            </li>
          ))}
        </ul>
      </div>

      {/* Category Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {categories.map((cat) => {
          const cg = gradeColors(cat.grade);
          const expanded = expandedKey === cat.key;
          return (
            <div
              key={cat.key}
              onClick={() => setExpandedKey(expanded ? null : cat.key)}
              className={`rounded-xl border cursor-pointer transition-all duration-200 ${cg.bg} ${cg.border} hover:brightness-110`}
            >
              <div className="p-4">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-xl">{cat.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-slate-400">{cat.name}</div>
                    <div className={`text-sm font-bold truncate ${cg.text}`}>{cat.headline}</div>
                  </div>
                  <GradeLetter grade={cat.grade} size="sm" />
                </div>
                <ScoreBar score={cat.score} grade={cat.grade} />
                {expanded && (
                  <ul className="mt-3 space-y-1 border-t border-white/10 pt-3">
                    {cat.details.map((d, i) => (
                      <li key={i} className="text-xs text-slate-400 flex gap-1.5 items-start">
                        <span className="text-slate-600 shrink-0 mt-0.5">•</span>{d}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Roster Breakdown */}
      <div className="rounded-2xl bg-slate-800/60 border border-slate-700/40 p-5">
        <div className="text-sm font-bold text-white mb-3">📋 Full Roster</div>
        <div className="space-y-1">
          {input.players.map((p, i) => {
            const value = Math.round(p.adp) - p.adjustedRank;
            const gc2 = gradeColors(scoreToGrade(Math.min(100, Math.max(20, 65 + value * 1.6))));
            return (
              <div key={p.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-700/30 transition-colors">
                <span className="text-xs text-slate-500 w-5 text-right shrink-0">{i + 1}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded font-bold ${posClass(p.position)}`}>{p.position}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-white truncate">{p.name}</div>
                  <div className="text-xs text-slate-500">{p.team} · Bye {p.bye} · {p.tierLabel}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs font-bold text-slate-300">#{p.adjustedRank}</div>
                  {value !== 0 && (
                    <div className={`text-xs font-semibold ${value > 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {value > 0 ? `+${value}` : value} ADP
                    </div>
                  )}
                </div>
                <span className={`text-xs font-bold ${UPSIDE_COLORS[p.upside]?.split(" ")[1] ?? "text-slate-400"}`}>
                  {p.upside[0].toUpperCase()}
                </span>
                <span className={`text-xs font-bold ${RISK_COLORS[p.risk]}`}>
                  {p.risk[0].toUpperCase()}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {onClose && (
        <button
          onClick={onClose}
          className="w-full py-2.5 rounded-xl bg-slate-700/50 hover:bg-slate-700 text-slate-300 text-sm font-semibold border border-slate-600/30 transition-colors"
        >
          ← Back to Draft
        </button>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

type Tab = "rankings" | "draft" | "analyzer" | "bye-weeks" | "handcuffs";

export default function NFLDraft() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>("rankings");
  const [teamAnalysis, setTeamAnalysis] = useState<DraftAnalysisInput | null>(null);

  const tier = (user as any)?.subscriptionTier ?? "free";
  const isAdmin = tier === "admin";
  const isStarOrAbove = isAdmin || tier === "pro" || tier === "star";
  const isChampion = isAdmin || tier === "pro"; // "pro" maps to Champion
  // Live Draft + Draft Analyzer unlock for admin, Champion, or one-time Draft Hub purchasers ("draft only")
  const hasDraftAccess = isChampion || (user as any)?.draftAccess === true;

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

  const tabs: { id: Tab; label: string; icon: string; requiresPaid?: boolean; badge?: string }[] = [
    { id: "rankings",  label: "Rankings",           icon: "📊" },
    { id: "draft",     label: "Live Draft",          icon: "🏈", requiresPaid: true },
    { id: "analyzer",  label: "Draft Analyzer",      icon: "📈", requiresPaid: true,
      badge: teamAnalysis && teamAnalysis.players.length > 0 ? "Ready" : undefined },
    { id: "bye-weeks", label: "Bye Weeks",           icon: "📅" },
    { id: "handcuffs", label: "Handcuffs",           icon: "🤝" },
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
            const locked = tab.requiresPaid && !hasDraftAccess;
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
                {!locked && tab.badge && (
                  <span className="px-1.5 py-0.5 rounded-full text-[10px] font-black bg-emerald-500 text-white">
                    {tab.badge}
                  </span>
                )}
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

            {activeTab === "draft" && hasDraftAccess && (
              <DraftAssistant
                allPlayers={players}
                onTeamUpdate={(drafted, fmt, slots) => {
                  setTeamAnalysis({ players: drafted, format: fmt, slots });
                }}
              />
            )}

            {activeTab === "draft" && !hasDraftAccess && (
              <div className="space-y-6">
                <div className="rounded-2xl bg-gradient-to-r from-purple-900/40 to-blue-900/40 border border-purple-500/20 p-8 text-center">
                  <div className="text-4xl mb-3">🏈</div>
                  <h3 className="text-xl font-bold text-white mb-2">Live Draft Assistant</h3>
                  <p className="text-slate-400 text-sm mb-6 max-w-md mx-auto">
                    Configure your league, monitor every pick live, and get an AI-powered recommendation for every one of your picks — with full reasoning.
                  </p>
                  <Link href="/pricing">
                    <button className="px-8 py-3 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white font-bold rounded-xl transition-all">
                      Upgrade to Champion — 7-Day Free Trial
                    </button>
                  </Link>
                </div>
              </div>
            )}

            {activeTab === "analyzer" && hasDraftAccess && (
              <DraftAnalyzer
                input={teamAnalysis ?? { players: [], format: "ppr", slots: DEFAULT_SETTINGS.rosterSlots }}
              />
            )}

            {activeTab === "analyzer" && !hasDraftAccess && (
              <div className="rounded-2xl bg-gradient-to-r from-purple-900/40 to-blue-900/40 border border-purple-500/20 p-8 text-center">
                <div className="text-4xl mb-3">📈</div>
                <h3 className="text-xl font-bold text-white mb-2">Draft Analyzer</h3>
                <p className="text-slate-400 text-sm mb-4 max-w-md mx-auto">
                  Grade your team A–F across 8 categories: starter quality, depth, bye week risk, value picks, upside, risk management, and handcuff coverage.
                </p>
                <Link href="/pricing">
                  <button className="px-8 py-3 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white font-bold rounded-xl transition-all">
                    Upgrade to Champion — 7-Day Free Trial
                  </button>
                </Link>
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

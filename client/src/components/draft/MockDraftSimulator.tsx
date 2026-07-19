// Mock Draft Simulator — practice full drafts against AI opponents that pick
// realistically: ADP-driven with controlled randomness, roster-need awareness,
// position-run behavior, and late-round K/DST discipline. Ends with a graded
// team so users learn where their strategy leaks value.

import { useMemo, useState } from "react";
import {
  POSITION_COLORS,
  type Position,
} from "../../data/nfl-draft-rankings-2026";
import type { LiveDraftPlayer } from "../../../../server/nfl-draft";

type Format = "ppr" | "half" | "standard";

interface Pick {
  overall: number;
  round: number;
  teamIdx: number;
  player: LiveDraftPlayer;
}

interface SimSettings {
  numTeams: number;
  userSlot: number; // 1-based
  rounds: number;
  format: Format;
}

const STARTER_SLOTS: { pos: Position | "FLEX"; count: number }[] = [
  { pos: "QB", count: 1 },
  { pos: "RB", count: 2 },
  { pos: "WR", count: 2 },
  { pos: "TE", count: 1 },
  { pos: "FLEX", count: 1 },
  { pos: "K", count: 1 },
  { pos: "DST", count: 1 },
];

function getProj(p: LiveDraftPlayer, fmt: Format): number {
  return fmt === "half" ? p.projHalf : fmt === "standard" ? p.projStd : p.projPPR;
}

function posClass(pos: string): string {
  return POSITION_COLORS[pos] ?? "bg-slate-600/30 text-slate-400";
}

/** Snake order: team index (0-based) on the clock for a given overall pick (1-based). */
function teamOnClock(overall: number, numTeams: number): number {
  const round = Math.floor((overall - 1) / numTeams);
  const idx = (overall - 1) % numTeams;
  return round % 2 === 0 ? idx : numTeams - 1 - idx;
}

function countPos(roster: LiveDraftPlayer[], pos: Position): number {
  return roster.filter((p) => p.position === pos).length;
}

/** How badly a team needs a position (higher = more urgent). */
function needMultiplier(roster: LiveDraftPlayer[], pos: Position, round: number, totalRounds: number): number {
  const have = countPos(roster, pos);
  const lateRounds = round >= totalRounds - 1;
  switch (pos) {
    case "QB": return have === 0 ? (round >= 4 ? 1.6 : 1.0) : have === 1 ? 0.25 : 0.05;
    case "TE": return have === 0 ? (round >= 5 ? 1.5 : 1.0) : have === 1 ? 0.3 : 0.05;
    case "RB": return have < 2 ? 1.35 : have < 4 ? 1.0 : 0.5;
    case "WR": return have < 2 ? 1.35 : have < 5 ? 1.0 : 0.5;
    case "K": return lateRounds && have === 0 ? 3.0 : 0.001;
    case "DST": return lateRounds && have === 0 ? 3.0 : 0.001;
    default: return 1;
  }
}

/** Position-run bonus: if a position is flying off the board, AI teams chase it. */
function runBonus(recent: Pick[], pos: Position): number {
  const last5 = recent.slice(-5);
  const n = last5.filter((p) => p.player.position === pos).length;
  return n >= 3 ? 1.3 : n === 2 ? 1.15 : 1.0;
}

/** AI pick: softmax over ADP-ordered candidates weighted by need + runs. */
function aiPick(
  available: LiveDraftPlayer[],
  roster: LiveDraftPlayer[],
  round: number,
  totalRounds: number,
  recent: Pick[],
): LiveDraftPlayer {
  const lateRounds = round >= totalRounds - 1;
  // K/DST: never before the final two rounds.
  const pool = available
    .filter((p) => (lateRounds ? true : p.position !== "K" && p.position !== "DST"))
    .slice()
    .sort((a, b) => a.adp - b.adp)
    .slice(0, 14);
  if (pool.length === 0) return available[0]!;

  const weights = pool.map((p, i) => {
    const adpWeight = 1 / Math.pow(i + 1.4, 1.15); // steep preference for board-top
    return adpWeight * needMultiplier(roster, p.position, round, totalRounds) * runBonus(recent, p.position);
  });
  const total = weights.reduce((s, w) => s + w, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < pool.length; i++) {
    roll -= weights[i]!;
    if (roll <= 0) return pool[i]!;
  }
  return pool[0]!;
}

/** Our recommendation for the user: best adjustedRank that fills a need. */
function recommend(
  available: LiveDraftPlayer[],
  roster: LiveDraftPlayer[],
  round: number,
  totalRounds: number,
): LiveDraftPlayer | null {
  const lateRounds = round >= totalRounds - 1;
  const pool = available.filter((p) => (lateRounds ? true : p.position !== "K" && p.position !== "DST"));
  if (pool.length === 0) return available[0] ?? null;
  let best: LiveDraftPlayer | null = null;
  let bestScore = -Infinity;
  for (const p of pool.slice(0, 30)) {
    const score = (300 - p.adjustedRank) * needMultiplier(roster, p.position, round, totalRounds);
    if (score > bestScore) { bestScore = score; best = p; }
  }
  return best;
}

/** Sum of the best legal starting lineup's projections. */
function starterPoints(roster: LiveDraftPlayer[], fmt: Format): number {
  const byPos: Record<string, LiveDraftPlayer[]> = {};
  for (const p of roster) (byPos[p.position] = byPos[p.position] ?? []).push(p);
  for (const pos of Object.keys(byPos)) byPos[pos]!.sort((a, b) => getProj(b, fmt) - getProj(a, fmt));
  let total = 0;
  const used = new Set<number>();
  for (const slot of STARTER_SLOTS) {
    if (slot.pos === "FLEX") continue;
    const list = byPos[slot.pos] ?? [];
    let taken = 0;
    for (const p of list) {
      if (taken >= slot.count) break;
      if (used.has(p.rank)) continue;
      used.add(p.rank); total += getProj(p, fmt); taken++;
    }
  }
  // FLEX: best remaining RB/WR/TE
  const flexPool = roster
    .filter((p) => ["RB", "WR", "TE"].includes(p.position) && !used.has(p.rank))
    .sort((a, b) => getProj(b, fmt) - getProj(a, fmt));
  if (flexPool[0]) total += getProj(flexPool[0], fmt);
  return total;
}

function letterGrade(userPts: number, avgPts: number): { letter: string; color: string } {
  const diff = avgPts > 0 ? (userPts - avgPts) / avgPts : 0;
  if (diff >= 0.08) return { letter: "A+", color: "text-emerald-400" };
  if (diff >= 0.04) return { letter: "A", color: "text-emerald-400" };
  if (diff >= 0.015) return { letter: "A-", color: "text-emerald-300" };
  if (diff >= -0.01) return { letter: "B+", color: "text-blue-300" };
  if (diff >= -0.03) return { letter: "B", color: "text-blue-300" };
  if (diff >= -0.06) return { letter: "C+", color: "text-amber-300" };
  return { letter: "C", color: "text-amber-400" };
}

// ─────────────────────────────────────────────────────────────────────────────

export function MockDraftSimulator({ allPlayers }: { allPlayers: LiveDraftPlayer[] }) {
  const [phase, setPhase] = useState<"setup" | "drafting" | "done">("setup");
  const [settings, setSettings] = useState<SimSettings>({ numTeams: 12, userSlot: 5, rounds: 14, format: "ppr" });
  const [picks, setPicks] = useState<Pick[]>([]);
  const [rosters, setRosters] = useState<LiveDraftPlayer[][]>([]);
  const [posFilter, setPosFilter] = useState<Position | "ALL">("ALL");
  const [search, setSearch] = useState("");

  const totalPicks = settings.numTeams * settings.rounds;
  const userIdx = settings.userSlot - 1;

  const availableSet = useMemo(() => {
    const taken = new Set(picks.map((p) => p.player.rank));
    return allPlayers.filter((p) => !taken.has(p.rank));
  }, [allPlayers, picks]);

  const overall = picks.length + 1;
  const round = Math.floor(picks.length / settings.numTeams) + 1;
  const onClockIdx = overall <= totalPicks ? teamOnClock(overall, settings.numTeams) : -1;

  function startDraft(randomSlot: boolean) {
    const slot = randomSlot ? Math.floor(Math.random() * settings.numTeams) + 1 : settings.userSlot;
    const s = { ...settings, userSlot: slot };
    setSettings(s);
    setPicks([]);
    setRosters(Array.from({ length: s.numTeams }, () => []));
    setPhase("drafting");
    // Run AI picks until the user is on the clock.
    advanceAI([], Array.from({ length: s.numTeams }, () => [] as LiveDraftPlayer[]), s);
  }

  /** Runs AI picks (mutating local copies) until the user's turn or draft end, then commits. */
  function advanceAI(currentPicks: Pick[], currentRosters: LiveDraftPlayer[][], s: SimSettings) {
    const total = s.numTeams * s.rounds;
    const taken = new Set(currentPicks.map((p) => p.player.rank));
    let avail = allPlayers.filter((p) => !taken.has(p.rank));

    while (currentPicks.length < total) {
      const ov = currentPicks.length + 1;
      const idx = teamOnClock(ov, s.numTeams);
      if (idx === s.userSlot - 1) break; // user's turn
      const rd = Math.floor(currentPicks.length / s.numTeams) + 1;
      const player = aiPick(avail, currentRosters[idx]!, rd, s.rounds, currentPicks);
      currentPicks.push({ overall: ov, round: rd, teamIdx: idx, player });
      currentRosters[idx] = [...currentRosters[idx]!, player];
      avail = avail.filter((p) => p.rank !== player.rank);
    }

    setPicks([...currentPicks]);
    setRosters(currentRosters.map((r) => [...r]));
    if (currentPicks.length >= total) setPhase("done");
  }

  function draftPlayer(player: LiveDraftPlayer) {
    if (onClockIdx !== userIdx) return;
    const newPicks = [...picks, { overall, round, teamIdx: userIdx, player }];
    const newRosters = rosters.map((r, i) => (i === userIdx ? [...r, player] : [...r]));
    advanceAI(newPicks, newRosters, settings);
  }

  const rec = phase === "drafting" && onClockIdx === userIdx
    ? recommend(availableSet, rosters[userIdx] ?? [], round, settings.rounds)
    : null;

  const bestAvailable = useMemo(() => {
    let list = availableSet.slice().sort((a, b) => a.adjustedRank - b.adjustedRank);
    if (posFilter !== "ALL") list = list.filter((p) => p.position === posFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q));
    }
    return list.slice(0, 20);
  }, [availableSet, posFilter, search]);

  const myPicks = picks.filter((p) => p.teamIdx === userIdx);
  const valuePicks = myPicks.filter((p) => p.player.adp - p.overall >= 8);

  // ── Setup ──────────────────────────────────────────────────────────────────
  if (phase === "setup") {
    return (
      <div className="rounded-2xl bg-slate-900/60 border border-slate-800 p-6 max-w-2xl">
        <h3 className="text-xl font-black text-white mb-1">🎯 Mock Draft Simulator</h3>
        <p className="text-slate-400 text-sm mb-6">
          Practice against AI drafters that follow ADP, chase position runs, and fill needs —
          then get your team graded. Run it until your strategy is automatic.
        </p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1.5">Teams</label>
            <select
              value={settings.numTeams}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                setSettings((s) => ({ ...s, numTeams: n, userSlot: Math.min(s.userSlot, n) }));
              }}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
              data-testid="mock-teams"
            >
              {[8, 10, 12, 14].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1.5">Your pick</label>
            <select
              value={settings.userSlot}
              onChange={(e) => setSettings((s) => ({ ...s, userSlot: parseInt(e.target.value, 10) }))}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
              data-testid="mock-slot"
            >
              {Array.from({ length: settings.numTeams }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>#{n}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1.5">Rounds</label>
            <select
              value={settings.rounds}
              onChange={(e) => setSettings((s) => ({ ...s, rounds: parseInt(e.target.value, 10) }))}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
              data-testid="mock-rounds"
            >
              {[10, 12, 14, 15, 16].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1.5">Scoring</label>
            <select
              value={settings.format}
              onChange={(e) => setSettings((s) => ({ ...s, format: e.target.value as Format }))}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
              data-testid="mock-format"
            >
              <option value="ppr">PPR</option>
              <option value="half">Half PPR</option>
              <option value="standard">Standard</option>
            </select>
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => startDraft(false)}
            className="px-6 py-3 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white font-bold rounded-xl transition-all"
            data-testid="mock-start"
          >
            Start Mock Draft
          </button>
          <button
            onClick={() => startDraft(true)}
            className="px-6 py-3 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold rounded-xl border border-slate-700 transition-colors"
            data-testid="mock-start-random"
          >
            🎲 Random slot
          </button>
        </div>
      </div>
    );
  }

  // ── Done ───────────────────────────────────────────────────────────────────
  if (phase === "done") {
    const fmt = settings.format;
    const allPts = rosters.map((r) => starterPoints(r, fmt));
    const userPts = allPts[userIdx] ?? 0;
    const avgPts = allPts.reduce((s, v) => s + v, 0) / Math.max(1, allPts.length);
    const grade = letterGrade(userPts, avgPts);
    const leagueRank = allPts.filter((v) => v > userPts).length + 1;

    return (
      <div className="space-y-6">
        <div className="rounded-2xl bg-slate-900/60 border border-slate-800 p-6 flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-5">
            <div className={`text-6xl font-black ${grade.color}`}>{grade.letter}</div>
            <div>
              <h3 className="text-xl font-black text-white">Draft complete</h3>
              <p className="text-slate-400 text-sm">
                Projected starters: <span className="text-white font-bold">{userPts.toFixed(0)} pts</span>
                {" "}· league avg {avgPts.toFixed(0)} · #{leagueRank} of {settings.numTeams} teams
                {" "}· {valuePicks.length} value pick{valuePicks.length === 1 ? "" : "s"}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => startDraft(false)} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold rounded-lg" data-testid="mock-redraft">
              Draft again
            </button>
            <button onClick={() => setPhase("setup")} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-bold rounded-lg border border-slate-700">
              Change settings
            </button>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <div className="rounded-2xl bg-slate-900/60 border border-slate-800 p-5">
            <h4 className="font-black text-white mb-3">Your team</h4>
            <div className="space-y-1.5">
              {myPicks.map((p) => (
                <div key={p.overall} className="flex items-center gap-2 text-sm">
                  <span className="text-slate-500 w-14 shrink-0 text-xs">R{p.round} · {p.overall}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${posClass(p.player.position)}`}>{p.player.position}</span>
                  <span className="text-white font-medium">{p.player.name}</span>
                  <span className="text-slate-500 text-xs">{p.player.team}</span>
                  {p.player.adp - p.overall >= 8 && (
                    <span className="ml-auto text-[10px] font-black text-emerald-400">VALUE +{Math.round(p.player.adp - p.overall)}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-2xl bg-slate-900/60 border border-slate-800 p-5">
            <h4 className="font-black text-white mb-3">League standings (projected)</h4>
            <div className="space-y-1.5">
              {allPts
                .map((pts, i) => ({ pts, i }))
                .sort((a, b) => b.pts - a.pts)
                .map(({ pts, i }, rankIdx) => (
                  <div key={i} className={`flex items-center gap-2 text-sm rounded px-2 py-1 ${i === userIdx ? "bg-emerald-500/10 border border-emerald-500/30" : ""}`}>
                    <span className="text-slate-500 w-6">{rankIdx + 1}.</span>
                    <span className={i === userIdx ? "text-emerald-300 font-bold" : "text-slate-300"}>
                      {i === userIdx ? "You" : `Team ${i + 1}`}
                    </span>
                    <span className="ml-auto text-slate-400 text-xs font-bold">{pts.toFixed(0)} pts</span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Drafting ───────────────────────────────────────────────────────────────
  const isMyTurn = onClockIdx === userIdx;
  const recentPicks = picks.slice(-6).reverse();

  return (
    <div className="space-y-4">
      {/* Clock bar */}
      <div className={`rounded-xl border p-4 flex items-center justify-between flex-wrap gap-3 ${
        isMyTurn ? "bg-emerald-500/10 border-emerald-500/40" : "bg-slate-900/60 border-slate-800"
      }`}>
        <div className="flex items-center gap-3">
          <div className="text-2xl">{isMyTurn ? "🟢" : "⏳"}</div>
          <div>
            <div className="font-black text-white">
              Round {round} · Pick {overall} of {totalPicks}
              {isMyTurn ? " — you're on the clock" : ` — Team ${onClockIdx + 1} picking`}
            </div>
            <div className="text-xs text-slate-400">
              You're team #{settings.userSlot} in a {settings.numTeams}-team {settings.format.toUpperCase()} snake
            </div>
          </div>
        </div>
        {rec && (
          <div className="text-sm">
            <span className="text-slate-400">AI recommends: </span>
            <span className="font-bold text-emerald-300">{rec.name}</span>
            <span className={`ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold ${posClass(rec.position)}`}>{rec.position}</span>
          </div>
        )}
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Best available */}
        <div className="lg:col-span-2 rounded-2xl bg-slate-900/60 border border-slate-800 p-5">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <h4 className="font-black text-white mr-2">Best available</h4>
            {["ALL", "QB", "RB", "WR", "TE", "K", "DST"].map((pos) => (
              <button
                key={pos}
                onClick={() => setPosFilter(pos as Position | "ALL")}
                className={`text-[11px] font-bold px-2 py-1 rounded ${
                  posFilter === pos ? "bg-slate-700 text-white" : "text-slate-500 hover:text-white"
                }`}
              >
                {pos}
              </button>
            ))}
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="ml-auto bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white w-32"
            />
          </div>
          <div className="space-y-1 max-h-[420px] overflow-y-auto pr-1">
            {bestAvailable.map((p) => (
              <div
                key={p.rank}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm ${
                  rec?.rank === p.rank ? "bg-emerald-500/10 border border-emerald-500/30" : "bg-slate-950/50"
                }`}
              >
                <span className="text-slate-500 text-xs w-8 shrink-0">#{p.adjustedRank}</span>
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${posClass(p.position)}`}>{p.position}</span>
                <span className="text-white font-medium truncate">{p.name}</span>
                <span className="text-slate-500 text-xs">{p.team}</span>
                <span className="text-slate-500 text-[11px] ml-auto shrink-0">ADP {p.adp.toFixed(0)}</span>
                <span className="text-slate-400 text-[11px] shrink-0">{getProj(p, settings.format).toFixed(0)} pts</span>
                <button
                  onClick={() => draftPlayer(p)}
                  disabled={!isMyTurn}
                  className="shrink-0 px-3 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-30 text-white text-xs font-bold transition-colors"
                  data-testid={`mock-draft-${p.rank}`}
                >
                  Draft
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Side panel */}
        <div className="space-y-4">
          <div className="rounded-2xl bg-slate-900/60 border border-slate-800 p-5">
            <h4 className="font-black text-white mb-2">Your roster ({myPicks.length}/{settings.rounds})</h4>
            <div className="space-y-1">
              {myPicks.length === 0 && <p className="text-slate-500 text-xs">No picks yet.</p>}
              {myPicks.map((p) => (
                <div key={p.overall} className="flex items-center gap-2 text-xs">
                  <span className="text-slate-500 w-8">R{p.round}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${posClass(p.player.position)}`}>{p.player.position}</span>
                  <span className="text-slate-200 truncate">{p.player.name}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-2xl bg-slate-900/60 border border-slate-800 p-5">
            <h4 className="font-black text-white mb-2">Last picks</h4>
            <div className="space-y-1">
              {recentPicks.map((p) => (
                <div key={p.overall} className="flex items-center gap-2 text-xs">
                  <span className="text-slate-500 w-8">{p.overall}.</span>
                  <span className={p.teamIdx === userIdx ? "text-emerald-300 font-bold" : "text-slate-400"}>
                    {p.teamIdx === userIdx ? "You" : `T${p.teamIdx + 1}`}
                  </span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${posClass(p.player.position)}`}>{p.player.position}</span>
                  <span className="text-slate-300 truncate">{p.player.name}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

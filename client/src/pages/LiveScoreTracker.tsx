import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Loader2, Activity, TrendingUp, Clock, Trophy,
  RefreshCw, ChevronDown, ChevronUp, Circle,
  Shield, Zap, BarChart3, Calendar,
} from "lucide-react";
import { ACTIVE_SPORTS } from "@shared/platform-config";
import type { Lineup, LineupScore } from "@shared/schema";
import { usePageMeta } from "@/hooks/use-page-meta";
import { apiRequest, queryClient } from "@/lib/queryClient";

// ─── Types from espn-scores (mirrored here for the client) ────────────────────

interface GameScore {
  id: string;
  sport: string;
  status: "pre" | "in" | "post";
  statusDetail: string;
  shortDetail: string;
  startTime: string;
  homeTeam: { name: string; abbreviation: string; score: string; logo?: string };
  awayTeam: { name: string; abbreviation: string; score: string; logo?: string };
  period?: number;
  clock?: string;
  venue?: string;
}

interface GolfLeader {
  playerName: string;
  position: string;
  score: string;
  round: number;
  thru: string;
}

interface GolfScore {
  id: string;
  sport: "GOLF";
  status: "pre" | "in" | "post";
  statusDetail: string;
  shortDetail: string;
  tournamentName: string;
  venue?: string;
  leaderboard: GolfLeader[];
}

type ScoreData = GameScore | GolfScore;

function isGolf(s: ScoreData): s is GolfScore {
  return s.sport === "GOLF";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toNum(v: string | number | null | undefined): number {
  if (v == null || v === "") return 0;
  return typeof v === "number" ? v : parseFloat(v);
}

function fmtTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZoneName: "short" });
}

const SPORT_META: Record<string, { label: string; emoji: string }> = {
  SOCCER: { label: "World Cup", emoji: "⚽" },
  MLB:    { label: "MLB",        emoji: "⚾" },
  GOLF:   { label: "Golf",       emoji: "⛳" },
  NFL:    { label: "NFL",        emoji: "🏈" },
  NBA:    { label: "NBA",        emoji: "🏀" },
  NHL:    { label: "NHL",        emoji: "🏒" },
};

// ─── Score status badge ───────────────────────────────────────────────────────

function StatusBadge({ game }: { game: GameScore }) {
  if (game.status === "in") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 text-[11px] font-black uppercase tracking-wider">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        LIVE
      </span>
    );
  }
  if (game.status === "post") {
    return (
      <span className="px-2 py-0.5 rounded-full bg-slate-700/60 border border-slate-600/50 text-slate-400 text-[11px] font-bold uppercase tracking-wider">
        Final
      </span>
    );
  }
  return (
    <span className="px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-400 text-[11px] font-semibold">
      {fmtTime(game.startTime)}
    </span>
  );
}

// ─── Single game card ─────────────────────────────────────────────────────────

function GameCard({ game }: { game: GameScore }) {
  const isLive = game.status === "in";
  const isFinal = game.status === "post";
  const awayWinning = isFinal
    ? Number(game.awayTeam.score) > Number(game.homeTeam.score)
    : Number(game.awayTeam.score) > Number(game.homeTeam.score);

  return (
    <div
      className={`relative bg-[#1E293B] rounded-xl border transition-all ${
        isLive
          ? "border-emerald-500/30 shadow-md shadow-emerald-500/5"
          : "border-slate-700/50"
      }`}
    >
      {/* Live stripe */}
      {isLive && (
        <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-xl bg-gradient-to-r from-emerald-500/0 via-emerald-500 to-emerald-500/0" />
      )}

      <div className="p-4">
        {/* Status row */}
        <div className="flex items-center justify-between mb-3">
          <StatusBadge game={game} />
          {isLive && game.clock && (
            <span className="text-xs text-slate-400 font-mono">
              {game.clock}{game.period ? ` · Q${game.period}` : ""}
            </span>
          )}
          {!isLive && game.venue && (
            <span className="text-[11px] text-slate-600 truncate max-w-[140px]">{game.venue}</span>
          )}
        </div>

        {/* Teams */}
        <div className="space-y-2">
          {/* Away team */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {game.awayTeam.logo ? (
                <img src={game.awayTeam.logo} alt="" className="w-7 h-7 object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
              ) : (
                <div className="w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center text-[10px] font-bold text-slate-400">
                  {game.awayTeam.abbreviation.slice(0, 2)}
                </div>
              )}
              <div>
                <p className={`text-sm font-bold ${isFinal && awayWinning ? "text-white" : "text-slate-300"}`}>
                  {game.awayTeam.abbreviation}
                </p>
                <p className="text-[10px] text-slate-500 leading-tight hidden sm:block">{game.awayTeam.name}</p>
              </div>
            </div>
            <span className={`text-2xl font-black tabular-nums ${
              isLive ? "text-white" : isFinal && awayWinning ? "text-white" : "text-slate-400"
            }`}>
              {game.status === "pre" ? "–" : game.awayTeam.score}
            </span>
          </div>

          <div className="flex items-center gap-2 px-1">
            <div className="flex-1 h-px bg-slate-700/50" />
            <span className="text-[10px] text-slate-600 font-semibold">@</span>
            <div className="flex-1 h-px bg-slate-700/50" />
          </div>

          {/* Home team */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {game.homeTeam.logo ? (
                <img src={game.homeTeam.logo} alt="" className="w-7 h-7 object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
              ) : (
                <div className="w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center text-[10px] font-bold text-slate-400">
                  {game.homeTeam.abbreviation.slice(0, 2)}
                </div>
              )}
              <div>
                <p className={`text-sm font-bold ${isFinal && !awayWinning ? "text-white" : "text-slate-300"}`}>
                  {game.homeTeam.abbreviation}
                </p>
                <p className="text-[10px] text-slate-500 leading-tight hidden sm:block">{game.homeTeam.name}</p>
              </div>
            </div>
            <span className={`text-2xl font-black tabular-nums ${
              isLive ? "text-white" : isFinal && !awayWinning ? "text-white" : "text-slate-400"
            }`}>
              {game.status === "pre" ? "–" : game.homeTeam.score}
            </span>
          </div>
        </div>

        {/* Status detail (period info, etc.) */}
        {(isLive || isFinal) && game.statusDetail && (
          <p className="text-[11px] text-slate-500 mt-2 text-center">{game.statusDetail}</p>
        )}
      </div>
    </div>
  );
}

// ─── Golf leaderboard ─────────────────────────────────────────────────────────

function GolfLeaderboard({ golf }: { golf: GolfScore }) {
  const isLive = golf.status === "in";
  const isFinal = golf.status === "post";

  return (
    <div className={`bg-[#1E293B] rounded-xl border overflow-hidden ${
      isLive ? "border-emerald-500/30 shadow-md shadow-emerald-500/5" : "border-slate-700/50"
    }`}>
      {isLive && (
        <div className="h-0.5 bg-gradient-to-r from-emerald-500/0 via-emerald-500 to-emerald-500/0" />
      )}
      <div className="p-4 border-b border-slate-700/40">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-bold text-white text-sm">{golf.tournamentName}</h3>
            {golf.venue && <p className="text-[11px] text-slate-500 mt-0.5">{golf.venue}</p>}
          </div>
          <div>
            {isLive ? (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 text-[11px] font-black uppercase tracking-wider">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                LIVE
              </span>
            ) : isFinal ? (
              <span className="px-2 py-0.5 rounded-full bg-slate-700/60 border border-slate-600/50 text-slate-400 text-[11px] font-bold uppercase">
                Final
              </span>
            ) : (
              <span className="text-[11px] text-blue-400 font-semibold">{golf.shortDetail}</span>
            )}
          </div>
        </div>
      </div>
      {golf.leaderboard.length > 0 ? (
        <div>
          <div className="grid grid-cols-4 px-4 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider border-b border-slate-800/60">
            <span>Pos</span>
            <span className="col-span-2">Player</span>
            <span className="text-right">Score · Thru</span>
          </div>
          {golf.leaderboard.slice(0, 10).map((p, i) => (
            <div
              key={i}
              className={`grid grid-cols-4 px-4 py-2.5 text-sm items-center border-b border-slate-800/40 last:border-0 ${
                i < 3 ? "bg-emerald-500/3" : ""
              }`}
            >
              <span className={`font-bold ${
                i === 0 ? "text-amber-400" : i < 3 ? "text-emerald-400" : "text-slate-400"
              }`}>
                {p.position || `T${i + 1}`}
              </span>
              <span className="col-span-2 text-white font-medium truncate">{p.playerName}</span>
              <div className="text-right">
                <span className={`font-bold ${
                  p.score.startsWith("-") ? "text-red-400" : p.score === "E" ? "text-white" : "text-slate-300"
                }`}>
                  {p.score}
                </span>
                {p.thru && (
                  <span className="text-[10px] text-slate-500 ml-1">· {p.thru}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="p-6 text-center text-slate-500 text-sm">
          <Clock className="w-6 h-6 mx-auto mb-2 text-slate-600" />
          Tournament hasn't started yet
        </div>
      )}
    </div>
  );
}

// ─── Lineup score card (user's saved lineups) ─────────────────────────────────

function LineupScoreCard({ lineup, score }: { lineup: Lineup; score?: LineupScore }) {
  const [expanded, setExpanded] = useState(false);
  const liveTotal = toNum(score?.totalLivePoints);
  const projTotal = toNum(score?.totalProjectedPoints) || toNum(lineup.totalProjection as any);
  const pctComplete = score?.percentComplete || 0;
  const playerScores = (score?.playerScores || []) as any[];

  return (
    <Card className="bg-slate-900 border-slate-700 overflow-hidden">
      <div
        className="p-4 cursor-pointer hover:bg-slate-800/40 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Badge variant="outline" className="border-emerald-500/30 text-emerald-400 text-xs shrink-0">
              {lineup.sport}
            </Badge>
            <span className="text-white font-bold text-sm truncate">
              {lineup.platform === "draftkings" ? "DraftKings" : "FanDuel"} · {lineup.name || `Lineup #${lineup.id}`}
            </span>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <div className="text-right">
              <div className="text-emerald-400 font-black text-lg leading-none">{liveTotal.toFixed(1)}</div>
              <div className="text-slate-500 text-xs">/ {projTotal.toFixed(1)} proj</div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <div className="w-20 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${Math.min(pctComplete, 100)}%` }} />
              </div>
              <span className="text-slate-500 text-[10px]">{pctComplete}% done</span>
            </div>
            {expanded ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
          </div>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-slate-700/50 px-4 py-3">
          {playerScores.length > 0 ? (
            <div className="space-y-1">
              <div className="grid grid-cols-6 text-[10px] font-bold text-slate-600 uppercase tracking-wider px-2 py-1">
                <span className="col-span-2">Player</span>
                <span>Pos</span>
                <span>Team</span>
                <span className="text-right">Live Pts</span>
                <span className="text-right">Status</span>
              </div>
              {playerScores.map((ps: any, i: number) => (
                <div key={i} className="grid grid-cols-6 text-xs px-2 py-1.5 rounded hover:bg-slate-800/40 items-center">
                  <span className="col-span-2 text-white font-medium truncate">{ps.playerName}</span>
                  <span className="text-slate-400">{ps.position}</span>
                  <span className="text-slate-400">{ps.team}</span>
                  <span className="text-emerald-400 font-bold text-right">{(ps.livePoints ?? 0).toFixed(1)}</span>
                  <span className="text-right">
                    <Badge variant="outline" className={`text-[9px] ${
                      ps.gameStatus === "Final" ? "border-slate-600 text-slate-500" :
                      ps.gameStatus === "In Progress" ? "border-emerald-500/30 text-emerald-400" :
                      "border-blue-500/30 text-blue-400"
                    }`}>
                      {ps.gameStatus === "In Progress" ? "LIVE" : ps.gameStatus || "Pre"}
                    </Badge>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-4 text-slate-500 text-sm">
              <Clock className="w-6 h-6 mx-auto mb-2 text-slate-600" />
              Live scoring data will appear once games begin.
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function LiveScoreTracker() {
  usePageMeta({
    title: "Live Scores – Today's Games",
    description: "Live scores for today's games across all active sports. Track your DFS lineup performance in real-time.",
    path: "/live-scores",
  });

  const { user } = useAuth();

  // Default to SOCCER (World Cup) if active, else first active sport
  const defaultSport = ACTIVE_SPORTS.includes("SOCCER") ? "SOCCER" : ACTIVE_SPORTS[0] ?? "MLB";
  const [selectedSport, setSelectedSport] = useState<string>(defaultSport);

  // ── Scoreboard query (public, no auth needed, refetch every 30s)
  const { data: scoreboardData, isLoading: boardLoading, dataUpdatedAt, refetch: refetchScoreboard } = useQuery<ScoreData[]>({
    queryKey: [`/api/scores/${selectedSport}`],
    queryFn: async () => {
      const res = await fetch(`/api/scores/${selectedSport}`);
      if (!res.ok) throw new Error("Failed to fetch scores");
      return res.json();
    },
    refetchInterval: 30_000,
  });

  // ── User lineup tracking (auth required)
  const { data: subData } = useQuery<{ tier: string }>({
    queryKey: ["/api/subscription"],
    enabled: !!user,
  });

  const { data: lineups } = useQuery<Lineup[]>({
    queryKey: ["/api/lineups"],
    enabled: !!user,
  });

  const { data: lineupScores } = useQuery<LineupScore[]>({
    queryKey: ["/api/lineup-scores"],
    enabled: !!user,
    refetchInterval: 60_000,
  });

  const refreshMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/lineup-scores/refresh"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/lineup-scores"] });
      refetchScoreboard();
    },
  });

  const tier = subData?.tier || "free";
  const isPaid = tier === "star" || tier === "pro" || (user as any)?.isAdmin;

  // Sort scores: live first, then pre (by start time), then final
  const sortedScores = [...(scoreboardData ?? [])].sort((a, b) => {
    const order = { in: 0, pre: 1, post: 2 };
    const oa = order[a.status] ?? 3;
    const ob = order[b.status] ?? 3;
    if (oa !== ob) return oa - ob;
    // within "pre", sort by start time
    if (a.status === "pre" && b.status === "pre") {
      const ta = isGolf(a) ? 0 : new Date((a as GameScore).startTime).getTime();
      const tb = isGolf(b) ? 0 : new Date((b as GameScore).startTime).getTime();
      return ta - tb;
    }
    return 0;
  });

  const liveCount = sortedScores.filter((s) => s.status === "in").length;
  const hasLive = liveCount > 0;

  // Lineup tracking for selected sport
  const scoreMap = new Map<number, LineupScore>();
  for (const s of lineupScores ?? []) scoreMap.set(s.lineupId, s);
  const sportLineups = (lineups ?? [])
    .filter((l) => l.status === "active" || l.status === "review")
    .filter((l) => l.sport === selectedSport)
    .sort((a, b) => {
      const as_ = toNum(scoreMap.get(a.id)?.totalLivePoints);
      const bs_ = toNum(scoreMap.get(b.id)?.totalLivePoints);
      return bs_ - as_;
    });

  const meta = SPORT_META[selectedSport] ?? { label: selectedSport, emoji: "🏆" };
  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : null;

  return (
    <div className="min-h-screen bg-[#0F172A]">

      {/* ── Header ── */}
      <div className="border-b border-slate-800/60 bg-[#0F172A]/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Activity className={`w-6 h-6 ${hasLive ? "text-emerald-400" : "text-slate-400"}`} />
              <div>
                <h1 className="text-xl font-black text-white flex items-center gap-2">
                  Live Scores
                  {hasLive && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[11px] font-black uppercase tracking-wider">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      {liveCount} Live
                    </span>
                  )}
                </h1>
                {lastUpdated && (
                  <p className="text-[11px] text-slate-600">Updated {lastUpdated} · auto-refreshes every 30s</p>
                )}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => { refetchScoreboard(); refreshMutation.mutate(); }}
              disabled={refreshMutation.isPending || boardLoading}
              className="border-slate-700 text-slate-400 hover:bg-slate-800 h-8"
            >
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${(refreshMutation.isPending || boardLoading) ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>

          {/* Sport tabs */}
          <div className="flex gap-1 mt-3 overflow-x-auto pb-1 scrollbar-thin">
            {ACTIVE_SPORTS.map((sport) => {
              const m = SPORT_META[sport] ?? { label: sport, emoji: "🏆" };
              const isSelected = selectedSport === sport;
              const sportScores = sport === selectedSport ? scoreboardData ?? [] : [];
              const liveCnt = sportScores.filter((s) => s.status === "in").length;
              return (
                <button
                  key={sport}
                  onClick={() => setSelectedSport(sport)}
                  className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-bold whitespace-nowrap transition-all shrink-0 ${
                    isSelected
                      ? "bg-emerald-600 text-white shadow"
                      : "bg-slate-800/60 text-slate-400 hover:text-white hover:bg-slate-700/60"
                  }`}
                >
                  <span>{m.emoji}</span>
                  <span>{m.label}</span>
                  {isSelected && liveCnt > 0 && (
                    <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-8">

        {/* ── TODAY'S SCOREBOARD ── */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <span className="text-lg">{meta.emoji}</span>
              {meta.label} · Today's Games
              <Badge variant="outline" className="border-slate-600 text-slate-400 text-xs font-normal">
                {new Date().toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
              </Badge>
            </h2>
          </div>

          {boardLoading ? (
            <div className="flex items-center justify-center py-16 gap-2 text-slate-500">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-sm">Loading scores…</span>
            </div>
          ) : sortedScores.length === 0 ? (
            <div className="bg-[#1E293B] border border-slate-700/50 rounded-xl p-10 text-center">
              <Calendar className="w-10 h-10 text-slate-600 mx-auto mb-3" />
              <h3 className="text-white font-bold mb-1">No games today</h3>
              <p className="text-slate-500 text-sm">
                Check back on game days — scores update automatically.
              </p>
            </div>
          ) : selectedSport === "GOLF" ? (
            // Golf: leaderboard layout
            <div className="space-y-4">
              {sortedScores.filter(isGolf).map((golf) => (
                <GolfLeaderboard key={golf.id} golf={golf} />
              ))}
            </div>
          ) : (
            // Team sports: grid of game cards
            <div>
              {/* Live games first — highlighted */}
              {liveCount > 0 && (
                <div className="mb-5">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-xs font-bold text-emerald-400 uppercase tracking-widest">In Progress</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                    {sortedScores
                      .filter((s): s is GameScore => !isGolf(s) && s.status === "in")
                      .map((game) => (
                        <GameCard key={game.id} game={game} />
                      ))}
                  </div>
                </div>
              )}

              {/* Upcoming */}
              {sortedScores.some((s) => s.status === "pre") && (
                <div className="mb-5">
                  <div className="flex items-center gap-2 mb-3">
                    <Clock className="w-3.5 h-3.5 text-blue-400" />
                    <span className="text-xs font-bold text-blue-400 uppercase tracking-widest">Upcoming</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                    {sortedScores
                      .filter((s): s is GameScore => !isGolf(s) && s.status === "pre")
                      .map((game) => (
                        <GameCard key={game.id} game={game} />
                      ))}
                  </div>
                </div>
              )}

              {/* Final */}
              {sortedScores.some((s) => s.status === "post") && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Trophy className="w-3.5 h-3.5 text-slate-500" />
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Final</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                    {sortedScores
                      .filter((s): s is GameScore => !isGolf(s) && s.status === "post")
                      .map((game) => (
                        <GameCard key={game.id} game={game} />
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        {/* ── YOUR LINEUP PERFORMANCE ── */}
        {user && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-emerald-400" />
                Your {meta.label} Lineups
              </h2>
              {sportLineups.length > 0 && (
                <span className="text-xs text-slate-500">{sportLineups.length} active lineup{sportLineups.length !== 1 ? "s" : ""}</span>
              )}
            </div>

            {!isPaid ? (
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-5 flex items-center gap-3">
                <Zap className="w-5 h-5 text-amber-400 shrink-0" />
                <div>
                  <p className="text-sm font-bold text-amber-300">Live lineup tracking requires a paid plan</p>
                  <p className="text-xs text-amber-400/70 mt-0.5">
                    <a href="/pricing" className="underline hover:text-amber-300">Upgrade to Star or Champion →</a>
                  </p>
                </div>
              </div>
            ) : sportLineups.length === 0 ? (
              <div className="bg-[#1E293B] border border-slate-700/50 rounded-xl p-8 text-center">
                <Trophy className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                <h3 className="text-white font-bold mb-1">No {meta.label} lineups saved</h3>
                <p className="text-slate-500 text-sm">
                  Generate and save lineups from the optimizer to see live scoring here.
                </p>
              </div>
            ) : (
              <>
                {/* Summary bar */}
                {lineupScores && lineupScores.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                    {[
                      { label: "Lineups", value: sportLineups.length, color: "text-white" },
                      {
                        label: "Total Pts",
                        value: sportLineups.reduce((s, l) => s + toNum(scoreMap.get(l.id)?.totalLivePoints), 0).toFixed(1),
                        color: "text-emerald-400",
                      },
                      {
                        label: "Avg Done",
                        value: `${Math.round(sportLineups.reduce((s, l) => s + (scoreMap.get(l.id)?.percentComplete ?? 0), 0) / sportLineups.length)}%`,
                        color: "text-amber-400",
                      },
                      {
                        label: "Best Score",
                        value: Math.max(...sportLineups.map((l) => toNum(scoreMap.get(l.id)?.totalLivePoints))).toFixed(1),
                        color: "text-cyan-400",
                      },
                    ].map(({ label, value, color }) => (
                      <div key={label} className="bg-[#1E293B] border border-slate-700/50 rounded-xl p-3 text-center">
                        <div className={`text-xl font-black ${color}`}>{value}</div>
                        <div className="text-[11px] text-slate-500">{label}</div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="space-y-3">
                  {sportLineups.map((lineup) => (
                    <LineupScoreCard key={lineup.id} lineup={lineup} score={scoreMap.get(lineup.id)} />
                  ))}
                </div>
              </>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

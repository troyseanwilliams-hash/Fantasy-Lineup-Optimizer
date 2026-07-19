// "My Teams" tab — drafted teams saved from the Mock Draft Simulator (and
// future Live Draft saves), listed with their grade, projected points, and
// full roster.

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { POSITION_COLORS } from "../../data/nfl-draft-rankings-2026";

export interface SavedTeamPlayer {
  round: number;
  overall: number;
  name: string;
  team: string;
  position: string;
  adp?: number;
}

interface SavedTeam {
  id: number;
  name: string;
  source: string;
  format: string;
  numTeams: number;
  userSlot: number;
  rounds: number;
  grade: string;
  projectedPoints: string;
  leagueRank: number | null;
  valuePicks: number;
  players: SavedTeamPlayer[];
  createdAt: string | null;
}

const GRADE_COLORS: Record<string, string> = {
  "A+": "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  A: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  "A-": "bg-emerald-500/10 text-emerald-400 border-emerald-500/25",
  "B+": "bg-blue-500/15 text-blue-300 border-blue-500/30",
  B: "bg-blue-500/10 text-blue-400 border-blue-500/25",
  "C+": "bg-amber-500/15 text-amber-300 border-amber-500/30",
  C: "bg-amber-500/10 text-amber-400 border-amber-500/25",
};

function posClass(pos: string): string {
  return POSITION_COLORS[pos] ?? "bg-slate-600/30 text-slate-400";
}

function fmtDate(d: string | null): string {
  return d ? new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
}

export function SavedDraftTeams() {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<{ teams: SavedTeam[] }>({
    queryKey: ["/api/draft-teams"],
    queryFn: async () => {
      const r = await fetch("/api/draft-teams", { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load teams");
      return r.json();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/draft-teams/${id}`, { method: "DELETE", credentials: "include" });
      if (!r.ok) throw new Error("Delete failed");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/draft-teams"] }),
  });

  const teams = data?.teams ?? [];

  if (isLoading) {
    return <div className="text-slate-500 text-sm py-10 text-center">Loading your teams…</div>;
  }

  if (teams.length === 0) {
    return (
      <div className="rounded-2xl bg-slate-800/40 border border-slate-700/40 p-10 text-center">
        <div className="text-4xl mb-3">📋</div>
        <h3 className="text-lg font-bold text-white mb-1">No saved teams yet</h3>
        <p className="text-slate-400 text-sm max-w-md mx-auto">
          Finish a run in the Mock Draft Simulator and hit <span className="text-emerald-400 font-semibold">Save team</span> —
          your roster and grade will land here so you can compare drafts side by side.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="saved-teams-list">
      {teams.map((t) => {
        const expanded = expandedId === t.id;
        const gradeCls = GRADE_COLORS[t.grade] ?? "bg-slate-700/40 text-slate-300 border-slate-600/40";
        return (
          <div key={t.id} className="rounded-2xl bg-slate-800/50 border border-slate-700/40 overflow-hidden">
            <button
              onClick={() => setExpandedId(expanded ? null : t.id)}
              className="w-full flex items-center gap-3 px-5 py-4 text-left"
              data-testid={`saved-team-${t.id}`}
            >
              <span className={`w-11 h-11 rounded-xl border flex items-center justify-center text-lg font-black shrink-0 ${gradeCls}`}>
                {t.grade}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-white font-bold text-sm truncate">{t.name}</div>
                <div className="text-xs text-slate-400 mt-0.5">
                  {t.numTeams}-team {t.format.toUpperCase()} · slot #{t.userSlot} · {Number(t.projectedPoints).toFixed(0)} proj pts
                  {t.leagueRank ? ` · #${t.leagueRank} of ${t.numTeams}` : ""}
                  {t.valuePicks > 0 ? ` · ${t.valuePicks} value pick${t.valuePicks === 1 ? "" : "s"}` : ""}
                </div>
              </div>
              <span className="text-[10px] font-bold text-slate-500 uppercase shrink-0 hidden sm:inline">{t.source === "mock" ? "Mock" : "Live"}</span>
              <span className="text-xs text-slate-500 shrink-0 hidden md:inline">{fmtDate(t.createdAt)}</span>
              <span className="text-slate-500 shrink-0">{expanded ? "▴" : "▾"}</span>
            </button>

            {expanded && (
              <div className="px-5 pb-4 border-t border-slate-700/40 pt-3">
                <div className="grid sm:grid-cols-2 gap-x-8 gap-y-1 mb-3">
                  {t.players.map((p) => (
                    <div key={p.overall} className="flex items-center gap-2 text-sm">
                      <span className="text-slate-500 text-xs w-14 shrink-0">R{p.round} · {p.overall}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${posClass(p.position)}`}>{p.position}</span>
                      <span className="text-white font-medium truncate">{p.name}</span>
                      <span className="text-slate-500 text-xs">{p.team}</span>
                      {p.adp != null && p.adp - p.overall >= 8 && (
                        <span className="ml-auto text-[10px] font-black text-emerald-400 shrink-0">VALUE +{Math.round(p.adp - p.overall)}</span>
                      )}
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => deleteMutation.mutate(t.id)}
                  disabled={deleteMutation.isPending}
                  className="text-xs font-bold text-red-400/80 hover:text-red-300 transition-colors"
                  data-testid={`delete-team-${t.id}`}
                >
                  Delete team
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

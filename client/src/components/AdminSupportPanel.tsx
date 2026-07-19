// Admin "Support Tickets" panel — triage user tickets: filter by status,
// expand to read, set status, keep internal notes.

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, LifeBuoy, ChevronDown, ChevronUp } from "lucide-react";

interface Ticket {
  id: number;
  userId: string | null;
  email: string;
  subject: string;
  message: string;
  category: string;
  status: "open" | "in_progress" | "resolved";
  adminNotes: string | null;
  createdAt: string | null;
}

const STATUS_STYLES: Record<string, string> = {
  open: "bg-red-500/15 text-red-300 border-red-500/30",
  in_progress: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  resolved: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
};

const CATEGORY_LABELS: Record<string, string> = {
  general: "General",
  billing: "Billing",
  bug: "Bug",
  data: "Data",
  feature: "Feature",
};

function fmtDate(d: string | null): string {
  return d ? new Date(d).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";
}

export function AdminSupportPanel() {
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "in_progress" | "resolved">("open");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [notesDraft, setNotesDraft] = useState<Record<number, string>>({});
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<{ tickets: Ticket[] }>({
    queryKey: ["/api/admin/support", statusFilter],
    queryFn: async () => {
      const r = await fetch(`/api/admin/support?status=${statusFilter}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load tickets");
      return r.json();
    },
    refetchInterval: 60_000,
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, patch }: { id: number; patch: { status?: string; adminNotes?: string } }) => {
      const r = await fetch(`/api/admin/support/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!r.ok) throw new Error("Update failed");
      return r.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/support"] }),
  });

  const tickets = data?.tickets ?? [];
  const openCount = tickets.filter((t) => t.status === "open").length;

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6" data-testid="admin-support-panel">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
            <LifeBuoy className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-xl font-black text-white">Support Tickets</h2>
            <p className="text-slate-400 text-sm">
              {statusFilter === "open" && openCount > 0 ? `${openCount} awaiting a reply` : "User-submitted tickets"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {(["open", "in_progress", "resolved", "all"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition-colors capitalize ${
                statusFilter === s ? "bg-slate-800 border-slate-600 text-white" : "border-slate-800 text-slate-400 hover:text-white"
              }`}
            >
              {s.replace("_", " ")}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="w-6 h-6 animate-spin text-emerald-400" />
        </div>
      ) : tickets.length === 0 ? (
        <p className="text-slate-500 text-sm py-6">No {statusFilter === "all" ? "" : statusFilter.replace("_", " ") + " "}tickets. 🎉</p>
      ) : (
        <div className="space-y-2">
          {tickets.map((t) => {
            const expanded = expandedId === t.id;
            return (
              <div key={t.id} className="rounded-xl border border-slate-800 bg-slate-950/50">
                <button
                  onClick={() => setExpandedId(expanded ? null : t.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left"
                  data-testid={`ticket-row-${t.id}`}
                >
                  <span className="text-slate-500 text-xs font-mono shrink-0">#{t.id}</span>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-black border shrink-0 ${STATUS_STYLES[t.status]}`}>
                    {t.status.replace("_", " ").toUpperCase()}
                  </span>
                  <span className="text-[10px] font-bold text-slate-500 uppercase shrink-0">{CATEGORY_LABELS[t.category] ?? t.category}</span>
                  <span className="text-white font-semibold text-sm truncate">{t.subject}</span>
                  <span className="text-slate-500 text-xs truncate hidden md:inline">{t.email}</span>
                  <span className="ml-auto text-slate-500 text-xs shrink-0">{fmtDate(t.createdAt)}</span>
                  {expanded ? <ChevronUp className="w-4 h-4 text-slate-500 shrink-0" /> : <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />}
                </button>

                {expanded && (
                  <div className="px-4 pb-4 space-y-3 border-t border-slate-800 pt-3">
                    <div className="text-sm text-slate-300 whitespace-pre-wrap">{t.message}</div>
                    <div className="text-xs text-slate-500">
                      From <a href={`mailto:${t.email}?subject=Re: ${encodeURIComponent(t.subject)} [Ticket #${t.id}]`} className="text-emerald-400 hover:underline">{t.email}</a>
                      {t.userId ? " · registered user" : " · not signed in"}
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      {(["open", "in_progress", "resolved"] as const).map((s) => (
                        <button
                          key={s}
                          disabled={updateMutation.isPending || t.status === s}
                          onClick={() => updateMutation.mutate({ id: t.id, patch: { status: s } })}
                          className={`text-xs font-bold px-3 py-1.5 rounded-lg border capitalize transition-colors ${
                            t.status === s
                              ? STATUS_STYLES[s]
                              : "border-slate-700 text-slate-400 hover:text-white"
                          }`}
                          data-testid={`ticket-${t.id}-status-${s}`}
                        >
                          {s.replace("_", " ")}
                        </button>
                      ))}
                    </div>

                    <div className="flex gap-2">
                      <input
                        value={notesDraft[t.id] ?? t.adminNotes ?? ""}
                        onChange={(e) => setNotesDraft((d) => ({ ...d, [t.id]: e.target.value }))}
                        placeholder="Internal notes…"
                        className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white"
                        data-testid={`ticket-${t.id}-notes`}
                      />
                      <button
                        disabled={updateMutation.isPending}
                        onClick={() => updateMutation.mutate({ id: t.id, patch: { adminNotes: notesDraft[t.id] ?? t.adminNotes ?? "" } })}
                        className="text-xs font-bold px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:text-white"
                      >
                        Save note
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

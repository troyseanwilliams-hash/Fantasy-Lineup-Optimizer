// Admin "User Funnel" panel — who tried to sign up and failed, who signed up
// but never subscribed, and who started checkout without finishing.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Users, UserX, CreditCard, AlertTriangle } from "lucide-react";

interface FunnelData {
  days: number;
  summary: Record<string, number>;
  failedSignups: { email: string; attempts: number; lastReason: string | null; lastSeen: string | null }[];
  abandonedCheckouts: { email: string; startedAt: string | null; detail: string | null }[];
  unconvertedUsers: { email: string; firstName: string | null; lastName: string | null; createdAt: string | null; tier: string | null; status: string | null }[];
  recentEvents: { id: number; email: string | null; eventType: string; errorReason: string | null; createdAt: string | null }[];
}

const EVENT_COLORS: Record<string, string> = {
  signup_success: "text-emerald-400",
  signup_attempt: "text-slate-300",
  signup_error: "text-red-400",
  signup_duplicate: "text-amber-400",
  login_error: "text-orange-400",
  checkout_started: "text-blue-400",
  checkout_completed: "text-emerald-400",
};

function fmtDate(d: string | null): string {
  return d ? new Date(d).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";
}

export function AdminFunnelPanel() {
  const [days, setDays] = useState(30);
  const [tab, setTab] = useState<"failed" | "unconverted" | "checkout" | "events">("failed");

  const { data, isLoading } = useQuery<FunnelData>({
    queryKey: ["/api/admin/funnel", days],
    queryFn: async () => {
      const r = await fetch(`/api/admin/funnel?days=${days}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load funnel");
      return r.json();
    },
    refetchInterval: 60_000,
  });

  const s = data?.summary ?? {};
  const conversionPct =
    (s.signup_attempt ?? 0) > 0
      ? Math.round(((s.signup_success ?? 0) / (s.signup_attempt ?? 1)) * 100)
      : null;

  const tabs = [
    { id: "failed" as const, label: `Tried & didn't sign up (${data?.failedSignups.length ?? 0})`, icon: UserX },
    { id: "unconverted" as const, label: `Signed up, not paying (${data?.unconvertedUsers.length ?? 0})`, icon: Users },
    { id: "checkout" as const, label: `Abandoned checkout (${data?.abandonedCheckouts.length ?? 0})`, icon: CreditCard },
    { id: "events" as const, label: "Recent events", icon: AlertTriangle },
  ];

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6" data-testid="admin-funnel-panel">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div>
          <h2 className="text-xl font-black text-white">User Funnel</h2>
          <p className="text-slate-400 text-sm">Signup and checkout drop-offs, last {data?.days ?? days} days</p>
        </div>
        <div className="flex items-center gap-2">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition-colors ${
                days === d ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300" : "border-slate-700 text-slate-400 hover:text-white"
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
        {[
          { label: "Signup attempts", value: s.signup_attempt ?? 0 },
          { label: "Signups", value: s.signup_success ?? 0 },
          { label: "Conversion", value: conversionPct != null ? `${conversionPct}%` : "—" },
          { label: "Signup errors", value: (s.signup_error ?? 0) + (s.signup_duplicate ?? 0) },
          { label: "Checkouts done", value: `${s.checkout_completed ?? 0}/${s.checkout_started ?? 0}` },
        ].map((stat) => (
          <div key={stat.label} className="rounded-xl bg-slate-950/60 border border-slate-800 px-4 py-3">
            <div className="text-2xl font-black text-white">{stat.value}</div>
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 flex-wrap mb-4">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg border transition-colors ${
              tab === t.id ? "bg-slate-800 border-slate-600 text-white" : "border-slate-800 text-slate-400 hover:text-white"
            }`}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="w-6 h-6 animate-spin text-emerald-400" />
        </div>
      ) : !data ? (
        <p className="text-slate-500 text-sm py-6">Could not load funnel data.</p>
      ) : (
        <div className="overflow-x-auto">
          {tab === "failed" && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-800">
                  <th className="py-2 pr-4">Email</th>
                  <th className="py-2 pr-4">Attempts</th>
                  <th className="py-2 pr-4">Last issue</th>
                  <th className="py-2">Last seen</th>
                </tr>
              </thead>
              <tbody>
                {data.failedSignups.length === 0 && (
                  <tr><td colSpan={4} className="py-6 text-slate-500">No failed signups in this window. 🎉</td></tr>
                )}
                {data.failedSignups.map((f) => (
                  <tr key={f.email} className="border-b border-slate-800/50">
                    <td className="py-2 pr-4 text-white font-medium">{f.email}</td>
                    <td className="py-2 pr-4 text-slate-300">{f.attempts}</td>
                    <td className="py-2 pr-4 text-red-300">{f.lastReason ?? "—"}</td>
                    <td className="py-2 text-slate-400">{fmtDate(f.lastSeen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {tab === "unconverted" && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-800">
                  <th className="py-2 pr-4">Email</th>
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Tier</th>
                  <th className="py-2">Joined</th>
                </tr>
              </thead>
              <tbody>
                {data.unconvertedUsers.length === 0 && (
                  <tr><td colSpan={4} className="py-6 text-slate-500">Everyone who signed up in this window is paying. 🎉</td></tr>
                )}
                {data.unconvertedUsers.map((u) => (
                  <tr key={u.email} className="border-b border-slate-800/50">
                    <td className="py-2 pr-4 text-white font-medium">{u.email}</td>
                    <td className="py-2 pr-4 text-slate-300">{[u.firstName, u.lastName].filter(Boolean).join(" ") || "—"}</td>
                    <td className="py-2 pr-4 text-slate-400">{u.tier ?? "free"}{u.status && u.status !== "active" ? ` (${u.status})` : ""}</td>
                    <td className="py-2 text-slate-400">{fmtDate(u.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {tab === "checkout" && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-800">
                  <th className="py-2 pr-4">Email</th>
                  <th className="py-2 pr-4">What they started</th>
                  <th className="py-2">When</th>
                </tr>
              </thead>
              <tbody>
                {data.abandonedCheckouts.length === 0 && (
                  <tr><td colSpan={3} className="py-6 text-slate-500">No abandoned checkouts in this window.</td></tr>
                )}
                {data.abandonedCheckouts.map((c) => (
                  <tr key={c.email} className="border-b border-slate-800/50">
                    <td className="py-2 pr-4 text-white font-medium">{c.email}</td>
                    <td className="py-2 pr-4 text-blue-300">{c.detail ?? "—"}</td>
                    <td className="py-2 text-slate-400">{fmtDate(c.startedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {tab === "events" && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-800">
                  <th className="py-2 pr-4">Event</th>
                  <th className="py-2 pr-4">Email</th>
                  <th className="py-2 pr-4">Detail</th>
                  <th className="py-2">When</th>
                </tr>
              </thead>
              <tbody>
                {data.recentEvents.map((e) => (
                  <tr key={e.id} className="border-b border-slate-800/50">
                    <td className={`py-2 pr-4 font-bold ${EVENT_COLORS[e.eventType] ?? "text-slate-300"}`}>{e.eventType.replace(/_/g, " ")}</td>
                    <td className="py-2 pr-4 text-slate-300">{e.email ?? "—"}</td>
                    <td className="py-2 pr-4 text-slate-400">{e.errorReason ?? "—"}</td>
                    <td className="py-2 text-slate-400">{fmtDate(e.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

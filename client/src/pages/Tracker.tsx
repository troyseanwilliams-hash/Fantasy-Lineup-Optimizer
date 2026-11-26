import { useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { usePageMeta } from "@/hooks/use-page-meta";
import { Crown, Loader2, Upload, Wallet, Trash2, Plus, TrendingUp, TrendingDown } from "lucide-react";

interface TrackerRow {
  id: number;
  sport: string;
  gameType: string | null;
  contestName: string | null;
  contestDate: string | null;
  entryFee: number;
  winnings: number;
  place: number | null;
  points: number | null;
  contestEntries: number | null;
  source: string;
}

interface ImportRow {
  entryKey: string;
  sport: string;
  gameType: string | null;
  contestName: string | null;
  contestDate: string | null;
  entryFee: number;
  winnings: number;
  place: number | null;
  points: number | null;
  contestEntries: number | null;
}

// ---- CSV helpers -----------------------------------------------------------

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some(c => c.trim() !== "")) rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.some(c => c.trim() !== "")) rows.push(row);
  return rows;
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

function toMoney(v: string | undefined): number {
  if (!v) return 0;
  const n = parseFloat(v.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function toInt(v: string | undefined): number | null {
  if (!v) return null;
  const n = parseInt(v.replace(/[,\s]/g, ""), 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function toIsoDate(v: string | undefined): string | null {
  if (!v) return null;
  const d = new Date(v.replace(" ", "T"));
  if (Number.isFinite(d.getTime())) return d.toISOString();
  const d2 = new Date(v);
  return Number.isFinite(d2.getTime()) ? d2.toISOString() : null;
}

/** Turns a DraftKings "Contest History" CSV into rows the server accepts. */
function rowsFromDraftKingsCsv(text: string): ImportRow[] {
  const table = parseCsv(text);
  if (table.length < 2) return [];
  const headers = table[0].map(norm);
  const col = (...names: string[]) => {
    for (const n of names) {
      const i = headers.indexOf(n);
      if (i >= 0) return i;
    }
    return -1;
  };
  const iKey = col("entrykey", "entryid");
  const iSport = col("sport");
  const iType = col("gametype");
  const iEntry = col("entry", "contestname");
  const iDate = col("contestdateest", "contestdate", "date");
  const iPlace = col("place");
  const iPoints = col("points");
  const iCash = col("winningsnonticket", "winnings");
  const iTicket = col("winningsticket");
  const iEntries = col("contestentries");
  const iFee = col("entryfee", "entryfeeusd");
  if (iKey < 0) return [];

  const out: ImportRow[] = [];
  for (const r of table.slice(1)) {
    const key = (r[iKey] || "").trim();
    if (!key) continue;
    const name = iEntry >= 0 ? (r[iEntry] || "").trim() : "";
    let fee = iFee >= 0 ? toMoney(r[iFee]) : 0;
    if (fee === 0) {
      const m = name.match(/\$([\d,]+(?:\.\d+)?)/);
      if (m) fee = toMoney(m[1]);
    }
    const winnings = (iCash >= 0 ? toMoney(r[iCash]) : 0) + (iTicket >= 0 ? toMoney(r[iTicket]) : 0);
    const points = iPoints >= 0 ? parseFloat(r[iPoints]) : NaN;
    out.push({
      entryKey: key,
      sport: ((iSport >= 0 ? r[iSport] : "") || "OTHER").trim().toUpperCase().slice(0, 20),
      gameType: iType >= 0 ? (r[iType] || "").trim().slice(0, 60) || null : null,
      contestName: name ? name.slice(0, 300) : null,
      contestDate: iDate >= 0 ? toIsoDate(r[iDate]) : null,
      entryFee: fee,
      winnings,
      place: iPlace >= 0 ? toInt(r[iPlace]) : null,
      points: Number.isFinite(points) ? points : null,
      contestEntries: iEntries >= 0 ? toInt(r[iEntries]) : null,
    });
  }
  return out;
}

// ---- Stats -----------------------------------------------------------------

const usd = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;

interface Bucket {
  label: string;
  entries: number;
  fees: number;
  winnings: number;
}

function bucketBy(rows: TrackerRow[], key: (r: TrackerRow) => string): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const r of rows) {
    const label = key(r) || "Other";
    const b = map.get(label) || { label, entries: 0, fees: 0, winnings: 0 };
    b.entries += 1;
    b.fees += r.entryFee;
    b.winnings += r.winnings;
    map.set(label, b);
  }
  return Array.from(map.values()).sort((a, b) => b.fees - a.fees);
}

function ProfitLine({ rows }: { rows: TrackerRow[] }) {
  const points = useMemo(() => {
    const dated = rows
      .filter(r => r.contestDate)
      .sort((a, b) => new Date(a.contestDate!).getTime() - new Date(b.contestDate!).getTime());
    let running = 0;
    return dated.map(r => (running += r.winnings - r.entryFee));
  }, [rows]);
  if (points.length < 2) return null;
  const w = 640;
  const h = 140;
  const min = Math.min(0, ...points);
  const max = Math.max(0, ...points);
  const span = max - min || 1;
  const x = (i: number) => (i / (points.length - 1)) * w;
  const y = (v: number) => h - ((v - min) / span) * (h - 12) - 6;
  const path = points.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const up = points[points.length - 1] >= 0;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-36" role="img" aria-label="Cumulative profit over time" data-testid="tracker-profit-line">
      <line x1="0" x2={w} y1={y(0)} y2={y(0)} stroke="#334155" strokeDasharray="4 4" />
      <path d={path} fill="none" stroke={up ? "#C4F82E" : "#f87171"} strokeWidth="2.5" strokeLinejoin="round" />
    </svg>
  );
}

function BucketTable({ title, buckets }: { title: string; buckets: Bucket[] }) {
  if (buckets.length === 0) return null;
  return (
    <Card className="bg-slate-900/60 border-border p-5">
      <h3 className="text-sm font-black text-white uppercase tracking-wider mb-3">{title}</h3>
      <div className="space-y-2">
        {buckets.slice(0, 8).map(b => {
          const profit = b.winnings - b.fees;
          const roi = b.fees > 0 ? (profit / b.fees) * 100 : 0;
          return (
            <div key={b.label} className="flex items-center justify-between text-sm">
              <div>
                <span className="font-bold text-slate-200">{b.label}</span>
                <span className="text-slate-500 ml-2 text-xs">{b.entries} entries</span>
              </div>
              <div className="text-right">
                <span className={`font-black ${profit >= 0 ? "text-volt-400" : "text-red-400"}`}>{usd(profit)}</span>
                <span className="text-slate-500 text-xs ml-2">{pct(roi)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ---- Page ------------------------------------------------------------------

export default function Tracker() {
  const { user } = useAuth();
  const { toast } = useToast();
  usePageMeta({
    title: "Bankroll Tracker - DFS ROI by Sport and Contest",
    description: "Upload your DraftKings contest history and see profit, ROI and results by sport and contest type.",
    path: "/tracker",
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const [manual, setManual] = useState({ sport: "NBA", name: "", fee: "", won: "" });

  const { data: sub } = useQuery<{ tier: string }>({ queryKey: ["/api/subscription"], enabled: !!user });
  const isChampion = sub?.tier === "pro";

  const { data, isLoading } = useQuery<{ rows: TrackerRow[] }>({
    queryKey: ["/api/tracker"],
    enabled: !!user && isChampion,
  });
  const rows = data?.rows ?? [];

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/tracker"] });

  const importMutation = useMutation({
    mutationFn: async (parsed: ImportRow[]) => {
      let inserted = 0;
      let duplicates = 0;
      for (let i = 0; i < parsed.length; i += 2000) {
        const res = await apiRequest("POST", "/api/tracker/import", { rows: parsed.slice(i, i + 2000) });
        const body = await res.json();
        inserted += body.inserted;
        duplicates += body.duplicates;
      }
      return { inserted, duplicates };
    },
    onSuccess: ({ inserted, duplicates }) => {
      refresh();
      toast({ title: "Import complete", description: `${inserted} new entries added${duplicates ? `, ${duplicates} already on file` : ""}.` });
    },
    onError: (e: Error) => toast({ title: "Import failed", description: e.message, variant: "destructive" }),
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/tracker/entry", {
        sport: manual.sport,
        contestName: manual.name || "Manual entry",
        entryFee: Number(manual.fee) || 0,
        winnings: Number(manual.won) || 0,
      });
    },
    onSuccess: () => {
      setManual({ ...manual, name: "", fee: "", won: "" });
      refresh();
    },
    onError: (e: Error) => toast({ title: "Could not add entry", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/tracker/${id}`);
    },
    onSuccess: refresh,
  });

  const clearMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", "/api/tracker");
    },
    onSuccess: refresh,
  });

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const parsed = rowsFromDraftKingsCsv(await file.text());
    if (parsed.length === 0) {
      toast({
        title: "No entries found",
        description: "Upload the contest history CSV from DraftKings (Account > Contest History > Export).",
        variant: "destructive",
      });
      return;
    }
    importMutation.mutate(parsed);
    if (fileRef.current) fileRef.current.value = "";
  };

  const totals = useMemo(() => {
    const fees = rows.reduce((s, r) => s + r.entryFee, 0);
    const winnings = rows.reduce((s, r) => s + r.winnings, 0);
    const profit = winnings - fees;
    const cashed = rows.filter(r => r.winnings > 0).length;
    return { fees, winnings, profit, roi: fees > 0 ? (profit / fees) * 100 : 0, cashRate: rows.length ? (cashed / rows.length) * 100 : 0 };
  }, [rows]);

  if (!user) {
    return (
      <div className="container mx-auto px-4 py-16 max-w-xl text-center">
        <p className="text-slate-300 mb-4">Sign in to use the Bankroll Tracker.</p>
        <Link href="/login"><Button className="bg-volt-500 text-black font-black">Sign in</Button></Link>
      </div>
    );
  }

  if (sub && !isChampion) {
    return (
      <div className="container mx-auto px-4 py-16 max-w-2xl text-center" data-testid="tracker-upsell">
        <img src="/images/art/tracker.svg" alt="" className="mx-auto w-full max-w-md mb-8" />
        <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/20 font-bold mb-4"><Crown className="w-3.5 h-3.5 mr-1" />Champion</Badge>
        <h1 className="text-4xl font-black text-white mb-3">Bankroll Tracker</h1>
        <p className="text-slate-400 mb-6">Upload your DraftKings contest history and see exactly where you make and lose money, by sport and by contest type.</p>
        <Link href="/pricing"><Button className="bg-amber-500 hover:bg-amber-600 text-black font-black h-12 px-8">See Champion</Button></Link>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl" data-testid="tracker-page">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-volt-500/10 flex items-center justify-center"><Wallet className="w-6 h-6 text-volt-400" /></div>
          <div>
            <h1 className="text-3xl font-black text-white tracking-tight">Bankroll Tracker</h1>
            <p className="text-sm text-slate-400">Your real results, in one place.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={e => onFile(e.target.files?.[0])} data-testid="tracker-file" />
          <Button className="bg-volt-500 hover:bg-volt-400 text-black font-black" onClick={() => fileRef.current?.click()} disabled={importMutation.isPending} data-testid="tracker-upload">
            {importMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
            Upload DraftKings CSV
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="py-20 flex justify-center"><Loader2 className="w-8 h-8 text-volt-400 animate-spin" /></div>
      ) : rows.length === 0 ? (
        <Card className="bg-slate-900/60 border-border p-8 text-center">
          <img src="/images/art/tracker.svg" alt="" className="mx-auto w-full max-w-sm mb-6" />
          <h2 className="text-xl font-black text-white mb-2">Add your first results</h2>
          <p className="text-slate-400 text-sm max-w-md mx-auto">
            On DraftKings, open your account, go to Contest History and export the CSV. Upload it here. Re-uploading later only adds new entries.
          </p>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4" data-testid="tracker-summary">
            <Card className="bg-slate-900/60 border-border p-4">
              <p className="text-[11px] font-black text-slate-500 uppercase tracking-wider">Profit</p>
              <p className={`text-2xl font-black flex items-center gap-1 ${totals.profit >= 0 ? "text-volt-400" : "text-red-400"}`}>
                {totals.profit >= 0 ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}{usd(totals.profit)}
              </p>
            </Card>
            <Card className="bg-slate-900/60 border-border p-4">
              <p className="text-[11px] font-black text-slate-500 uppercase tracking-wider">ROI</p>
              <p className={`text-2xl font-black ${totals.roi >= 0 ? "text-volt-400" : "text-red-400"}`}>{pct(totals.roi)}</p>
            </Card>
            <Card className="bg-slate-900/60 border-border p-4">
              <p className="text-[11px] font-black text-slate-500 uppercase tracking-wider">Entry fees</p>
              <p className="text-2xl font-black text-white">{usd(totals.fees)}</p>
              <p className="text-xs text-slate-500">{rows.length} entries</p>
            </Card>
            <Card className="bg-slate-900/60 border-border p-4">
              <p className="text-[11px] font-black text-slate-500 uppercase tracking-wider">Cash rate</p>
              <p className="text-2xl font-black text-white">{totals.cashRate.toFixed(0)}%</p>
              <p className="text-xs text-slate-500">{usd(totals.winnings)} won</p>
            </Card>
          </div>

          {rows.filter(r => r.contestDate).length >= 2 && (
            <Card className="bg-slate-900/60 border-border p-5 mb-4">
              <h3 className="text-sm font-black text-white uppercase tracking-wider mb-2">Cumulative profit</h3>
              <ProfitLine rows={rows} />
            </Card>
          )}

          <div className="grid md:grid-cols-2 gap-4 mb-6">
            <BucketTable title="By sport" buckets={bucketBy(rows, r => r.sport)} />
            <BucketTable title="By contest type" buckets={bucketBy(rows, r => r.gameType || "Other")} />
          </div>
        </>
      )}

      <Card className="bg-slate-900/60 border-border p-5 mb-6" data-testid="tracker-manual">
        <h3 className="text-sm font-black text-white uppercase tracking-wider mb-3">Add an entry by hand</h3>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <select
            value={manual.sport}
            onChange={e => setManual({ ...manual, sport: e.target.value })}
            className="h-10 rounded-md bg-slate-950 border border-border px-3 text-sm text-white"
            aria-label="Sport"
          >
            {["NBA", "NFL", "GOLF", "MLB", "NHL", "OTHER"].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <Input placeholder="Contest" value={manual.name} onChange={e => setManual({ ...manual, name: e.target.value })} className="md:col-span-2" />
          <Input placeholder="Entry fee" inputMode="decimal" value={manual.fee} onChange={e => setManual({ ...manual, fee: e.target.value })} />
          <Input placeholder="Won" inputMode="decimal" value={manual.won} onChange={e => setManual({ ...manual, won: e.target.value })} />
        </div>
        <Button className="mt-3 bg-slate-800 hover:bg-slate-700 text-white font-bold" onClick={() => addMutation.mutate()} disabled={addMutation.isPending || !manual.fee}>
          <Plus className="w-4 h-4 mr-2" />Add entry
        </Button>
      </Card>

      {rows.length > 0 && (
        <Card className="bg-slate-900/60 border-border p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-black text-white uppercase tracking-wider">Recent entries</h3>
            <Button
              variant="ghost"
              className="text-red-400 hover:text-red-300 text-xs"
              onClick={() => { if (window.confirm("Delete all tracker entries? This cannot be undone.")) clearMutation.mutate(); }}
            >
              Clear all
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500">
                  <th className="py-2 pr-3">Date</th><th className="pr-3">Sport</th><th className="pr-3">Contest</th>
                  <th className="pr-3 text-right">Fee</th><th className="pr-3 text-right">Won</th><th className="text-right">Net</th><th />
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 50).map(r => {
                  const net = r.winnings - r.entryFee;
                  return (
                    <tr key={r.id} className="border-t border-slate-800">
                      <td className="py-2 pr-3 text-slate-400 whitespace-nowrap">{r.contestDate ? new Date(r.contestDate).toLocaleDateString() : "-"}</td>
                      <td className="pr-3 font-bold text-slate-200">{r.sport}</td>
                      <td className="pr-3 text-slate-300 max-w-[260px] truncate">{r.contestName || "-"}</td>
                      <td className="pr-3 text-right text-slate-300">{usd(r.entryFee)}</td>
                      <td className="pr-3 text-right text-slate-300">{usd(r.winnings)}</td>
                      <td className={`text-right font-black ${net >= 0 ? "text-volt-400" : "text-red-400"}`}>{usd(net)}</td>
                      <td className="pl-2 text-right">
                        <button aria-label="Delete entry" className="text-slate-600 hover:text-red-400" onClick={() => deleteMutation.mutate(r.id)}>
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {rows.length > 50 && <p className="text-xs text-slate-500 mt-3">Showing the 50 most recent of {rows.length} entries. Totals include all of them.</p>}
        </Card>
      )}
    </div>
  );
}

import { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Target,
  DollarSign,
  Activity,
  BarChart3,
  Loader2,
} from "lucide-react";

interface HistoryEntry {
  id: number;
  playerName: string;
  sport: string;
  salary: number;
  projectedPoints: string;
  actualPoints: string | null;
  slateDate: string;
  ownership?: string | null;
}

interface PlayerTrendsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  playerName: string;
  sport: string;
  currentProjection?: number;
  currentSalary?: number;
  position?: string;
  team?: string;
  boostScore?: string;
}

interface ChartDataPoint {
  date: string;
  dateLabel: string;
  projected: number;
  actual: number | null;
  salary: number;
  salaryK: number;
  delta: number | null;
  ownership: number | null;
  value: number;
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-800 border border-slate-600/60 rounded-lg px-3 py-2 shadow-xl text-xs">
      <p className="text-slate-300 font-medium mb-1">{label}</p>
      {payload.map((entry: any, i: number) => (
        <div key={i} className="flex items-center gap-2">
          <div
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-slate-400">{entry.name}:</span>
          <span className="text-white font-bold">
            {entry.name.includes("Salary")
              ? `$${entry.value.toFixed(1)}K`
              : entry.name.includes("Own")
                ? `${entry.value.toFixed(1)}%`
                : `${entry.value.toFixed(1)}`}
          </span>
        </div>
      ))}
    </div>
  );
}

function StatCard({
  label,
  value,
  subValue,
  icon: Icon,
  color,
}: {
  label: string;
  value: string;
  subValue?: string;
  icon: any;
  color: string;
}) {
  return (
    <div className="bg-slate-800/50 border border-slate-700/40 rounded-lg p-3">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className={`w-3.5 h-3.5 ${color}`} />
        <span className="text-[10px] text-slate-400 uppercase tracking-wide">
          {label}
        </span>
      </div>
      <div className="text-lg font-black text-white leading-tight">{value}</div>
      {subValue && (
        <div className="text-[10px] text-slate-500 mt-0.5">{subValue}</div>
      )}
    </div>
  );
}

export function PlayerTrendsDialog({
  open,
  onOpenChange,
  playerName,
  sport,
  currentProjection,
  currentSalary,
  position,
  team,
  boostScore,
}: PlayerTrendsDialogProps) {
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setHistory(null);
    fetch(
      `/api/players/${encodeURIComponent(playerName)}/history?sport=${sport}&limit=20`
    )
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setHistory(data))
      .catch(() => setHistory([]))
      .finally(() => setLoading(false));
  }, [open, playerName, sport]);

  const chartData = useMemo<ChartDataPoint[]>(() => {
    if (!history?.length) return [];
    return history
      .slice()
      .reverse()
      .map((h) => {
        const proj = Number(h.projectedPoints);
        const actual =
          h.actualPoints != null && Number(h.actualPoints) > 0
            ? Number(h.actualPoints)
            : null;
        const salK = h.salary / 1000;
        return {
          date: h.slateDate,
          dateLabel: new Date(h.slateDate + "T12:00:00").toLocaleDateString(
            "en-US",
            { month: "short", day: "numeric" }
          ),
          projected: proj,
          actual,
          salary: h.salary,
          salaryK: salK,
          delta: actual !== null ? actual - proj : null,
          ownership: h.ownership ? Number(h.ownership) : null,
          value: proj / Math.max(1, salK),
        };
      });
  }, [history]);

  const stats = useMemo(() => {
    if (!chartData.length)
      return {
        avgProj: 0,
        avgActual: 0,
        hitRate: 0,
        trend: 0,
        avgSalary: 0,
        salaryRange: [0, 0],
        avgValue: 0,
        consistency: 0,
        gamesWithActuals: 0,
        totalGames: 0,
        ceiling: 0,
        floor: 0,
      };
    const projs = chartData.map((d) => d.projected);
    const actuals = chartData
      .filter((d) => d.actual !== null)
      .map((d) => d.actual!);
    const avgProj = projs.reduce((a, b) => a + b, 0) / projs.length;
    const avgActual =
      actuals.length > 0 ? actuals.reduce((a, b) => a + b, 0) / actuals.length : 0;
    const hitRate =
      actuals.length > 0
        ? chartData.filter(
            (d) => d.actual !== null && d.actual >= d.projected
          ).length / actuals.length
        : 0;
    const recent3 = projs.slice(-3);
    const prior3 = projs.slice(-6, -3);
    const trend =
      prior3.length > 0
        ? recent3.reduce((a, b) => a + b, 0) / recent3.length -
          prior3.reduce((a, b) => a + b, 0) / prior3.length
        : 0;
    const salaries = chartData.map((d) => d.salaryK);
    const avgSalary = salaries.reduce((a, b) => a + b, 0) / salaries.length;
    const allPts = [...projs, ...actuals];
    const mean = allPts.reduce((a, b) => a + b, 0) / allPts.length;
    const variance =
      allPts.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / allPts.length;
    const cv = mean > 0 ? (Math.sqrt(variance) / mean) * 100 : 0;
    return {
      avgProj,
      avgActual,
      hitRate,
      trend,
      avgSalary,
      salaryRange: [Math.min(...salaries), Math.max(...salaries)],
      avgValue: avgProj / Math.max(1, avgSalary),
      consistency: cv,
      gamesWithActuals: actuals.length,
      totalGames: chartData.length,
      ceiling: actuals.length > 0 ? Math.max(...actuals) : Math.max(...projs),
      floor: actuals.length > 0 ? Math.min(...actuals) : Math.min(...projs),
    };
  }, [chartData]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto bg-slate-900 border-slate-700/60">
        <DialogHeader>
          <DialogTitle
            className="flex items-center gap-2 text-white"
            data-testid="trends-dialog-title"
          >
            <Activity className="w-5 h-5 text-amber-400" />
            <span>{playerName}</span>
            {position && (
              <span className="text-sm text-slate-400 font-normal">
                {position}
              </span>
            )}
            {team && (
              <span className="text-sm text-amber-400/80 font-normal">
                {team}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {loading && (
          <div
            className="flex items-center justify-center py-16"
            data-testid="trends-loading"
          >
            <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
          </div>
        )}

        {!loading && chartData.length === 0 && (
          <div
            className="text-center py-12"
            data-testid="trends-empty"
          >
            <BarChart3 className="w-10 h-10 text-slate-600 mx-auto mb-3" />
            <p className="text-slate-400 text-sm">
              No performance history available for {playerName}
            </p>
          </div>
        )}

        {!loading && chartData.length > 0 && (
          <div className="space-y-4">
            <div
              className="grid grid-cols-2 sm:grid-cols-4 gap-2"
              data-testid="trends-stats-grid"
            >
              <StatCard
                label="Avg Projection"
                value={stats.avgProj.toFixed(1)}
                subValue={`${stats.totalGames} games tracked`}
                icon={Target}
                color="text-amber-400"
              />
              <StatCard
                label="Avg Actual"
                value={
                  stats.gamesWithActuals > 0
                    ? stats.avgActual.toFixed(1)
                    : "N/A"
                }
                subValue={
                  stats.gamesWithActuals > 0
                    ? `${(stats.hitRate * 100).toFixed(0)}% hit rate`
                    : "No actual data"
                }
                icon={Activity}
                color="text-emerald-400"
              />
              <StatCard
                label="Trend"
                value={`${stats.trend > 0 ? "+" : ""}${stats.trend.toFixed(1)}`}
                subValue={
                  stats.trend > 0.5
                    ? "Trending up"
                    : stats.trend < -0.5
                      ? "Trending down"
                      : "Stable"
                }
                icon={
                  stats.trend > 0.5
                    ? TrendingUp
                    : stats.trend < -0.5
                      ? TrendingDown
                      : Minus
                }
                color={
                  stats.trend > 0.5
                    ? "text-emerald-400"
                    : stats.trend < -0.5
                      ? "text-red-400"
                      : "text-slate-400"
                }
              />
              <StatCard
                label="Avg Salary"
                value={`$${stats.avgSalary.toFixed(1)}K`}
                subValue={`$${stats.salaryRange[0].toFixed(1)}K - $${stats.salaryRange[1].toFixed(1)}K`}
                icon={DollarSign}
                color="text-blue-400"
              />
            </div>

            <Tabs defaultValue="points" className="w-full">
              <TabsList className="grid w-full grid-cols-3 bg-slate-800/60">
                <TabsTrigger
                  value="points"
                  className="text-xs data-[state=active]:bg-amber-500/20 data-[state=active]:text-amber-400"
                  data-testid="tab-points"
                >
                  Points
                </TabsTrigger>
                <TabsTrigger
                  value="salary"
                  className="text-xs data-[state=active]:bg-blue-500/20 data-[state=active]:text-blue-400"
                  data-testid="tab-salary"
                >
                  Salary & Value
                </TabsTrigger>
                <TabsTrigger
                  value="accuracy"
                  className="text-xs data-[state=active]:bg-emerald-500/20 data-[state=active]:text-emerald-400"
                  data-testid="tab-accuracy"
                >
                  Accuracy
                </TabsTrigger>
              </TabsList>

              <TabsContent value="points" className="mt-3">
                <div
                  className="bg-slate-800/30 rounded-lg p-3 border border-slate-700/30"
                  data-testid="chart-points"
                >
                  <div className="text-[10px] text-slate-400 mb-2 font-medium uppercase tracking-wide">
                    Projected vs Actual Points
                  </div>
                  <ResponsiveContainer width="100%" height={240}>
                    <AreaChart
                      data={chartData}
                      margin={{ top: 5, right: 10, left: -10, bottom: 5 }}
                    >
                      <defs>
                        <linearGradient
                          id="projGrad"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="5%"
                            stopColor="#f59e0b"
                            stopOpacity={0.3}
                          />
                          <stop
                            offset="95%"
                            stopColor="#f59e0b"
                            stopOpacity={0}
                          />
                        </linearGradient>
                        <linearGradient
                          id="actualGrad"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="5%"
                            stopColor="#10b981"
                            stopOpacity={0.3}
                          />
                          <stop
                            offset="95%"
                            stopColor="#10b981"
                            stopOpacity={0}
                          />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="#334155"
                        strokeOpacity={0.5}
                      />
                      <XAxis
                        dataKey="dateLabel"
                        tick={{ fontSize: 10, fill: "#94a3b8" }}
                        tickLine={false}
                        axisLine={{ stroke: "#475569" }}
                      />
                      <YAxis
                        tick={{ fontSize: 10, fill: "#94a3b8" }}
                        tickLine={false}
                        axisLine={false}
                        domain={["auto", "auto"]}
                      />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend
                        wrapperStyle={{ fontSize: "11px" }}
                        iconType="circle"
                        iconSize={8}
                      />
                      {stats.avgProj > 0 && (
                        <ReferenceLine
                          y={stats.avgProj}
                          stroke="#f59e0b"
                          strokeDasharray="4 4"
                          strokeOpacity={0.4}
                        />
                      )}
                      <Area
                        type="monotone"
                        dataKey="projected"
                        name="Projected"
                        stroke="#f59e0b"
                        fill="url(#projGrad)"
                        strokeWidth={2}
                        dot={{ r: 3, fill: "#f59e0b" }}
                        activeDot={{ r: 5, stroke: "#f59e0b", strokeWidth: 2 }}
                      />
                      <Area
                        type="monotone"
                        dataKey="actual"
                        name="Actual"
                        stroke="#10b981"
                        fill="url(#actualGrad)"
                        strokeWidth={2}
                        dot={{ r: 3, fill: "#10b981" }}
                        activeDot={{
                          r: 5,
                          stroke: "#10b981",
                          strokeWidth: 2,
                        }}
                        connectNulls={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>

                <div className="grid grid-cols-3 gap-2 mt-3">
                  <div className="bg-slate-800/40 rounded-lg p-2 border border-slate-700/30 text-center">
                    <div className="text-[9px] text-slate-500 uppercase">
                      Ceiling
                    </div>
                    <div className="text-sm font-black text-white">
                      {stats.ceiling.toFixed(1)}
                    </div>
                  </div>
                  <div className="bg-slate-800/40 rounded-lg p-2 border border-slate-700/30 text-center">
                    <div className="text-[9px] text-slate-500 uppercase">
                      Floor
                    </div>
                    <div className="text-sm font-black text-white">
                      {stats.floor.toFixed(1)}
                    </div>
                  </div>
                  <div className="bg-slate-800/40 rounded-lg p-2 border border-slate-700/30 text-center">
                    <div className="text-[9px] text-slate-500 uppercase">
                      Volatility
                    </div>
                    <div
                      className={`text-sm font-black ${stats.consistency > 30 ? "text-red-400" : stats.consistency > 15 ? "text-amber-400" : "text-emerald-400"}`}
                    >
                      {stats.consistency.toFixed(0)}%
                    </div>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="salary" className="mt-3">
                <div
                  className="bg-slate-800/30 rounded-lg p-3 border border-slate-700/30"
                  data-testid="chart-salary"
                >
                  <div className="text-[10px] text-slate-400 mb-2 font-medium uppercase tracking-wide">
                    Salary & Points-per-$1K Value
                  </div>
                  <ResponsiveContainer width="100%" height={240}>
                    <LineChart
                      data={chartData}
                      margin={{ top: 5, right: 10, left: -10, bottom: 5 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="#334155"
                        strokeOpacity={0.5}
                      />
                      <XAxis
                        dataKey="dateLabel"
                        tick={{ fontSize: 10, fill: "#94a3b8" }}
                        tickLine={false}
                        axisLine={{ stroke: "#475569" }}
                      />
                      <YAxis
                        yAxisId="salary"
                        tick={{ fontSize: 10, fill: "#94a3b8" }}
                        tickLine={false}
                        axisLine={false}
                        domain={["auto", "auto"]}
                        tickFormatter={(v) => `$${v}K`}
                      />
                      <YAxis
                        yAxisId="value"
                        orientation="right"
                        tick={{ fontSize: 10, fill: "#94a3b8" }}
                        tickLine={false}
                        axisLine={false}
                        domain={["auto", "auto"]}
                      />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend
                        wrapperStyle={{ fontSize: "11px" }}
                        iconType="circle"
                        iconSize={8}
                      />
                      <Line
                        yAxisId="salary"
                        type="monotone"
                        dataKey="salaryK"
                        name="Salary"
                        stroke="#3b82f6"
                        strokeWidth={2}
                        dot={{ r: 3, fill: "#3b82f6" }}
                        activeDot={{ r: 5 }}
                      />
                      <Line
                        yAxisId="value"
                        type="monotone"
                        dataKey="value"
                        name="Pts/$1K"
                        stroke="#a78bfa"
                        strokeWidth={2}
                        strokeDasharray="5 3"
                        dot={{ r: 3, fill: "#a78bfa" }}
                        activeDot={{ r: 5 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                <div className="grid grid-cols-2 gap-2 mt-3">
                  <div className="bg-slate-800/40 rounded-lg p-2 border border-slate-700/30 text-center">
                    <div className="text-[9px] text-slate-500 uppercase">
                      Avg Value
                    </div>
                    <div className="text-sm font-black text-white">
                      {stats.avgValue.toFixed(1)} pts/$1K
                    </div>
                  </div>
                  <div className="bg-slate-800/40 rounded-lg p-2 border border-slate-700/30 text-center">
                    <div className="text-[9px] text-slate-500 uppercase">
                      Salary Move
                    </div>
                    <div
                      className={`text-sm font-black ${
                        chartData.length >= 2
                          ? chartData[chartData.length - 1].salaryK >
                            chartData[0].salaryK
                            ? "text-red-400"
                            : chartData[chartData.length - 1].salaryK <
                                chartData[0].salaryK
                              ? "text-emerald-400"
                              : "text-slate-400"
                          : "text-slate-400"
                      }`}
                    >
                      {chartData.length >= 2
                        ? `${chartData[chartData.length - 1].salaryK > chartData[0].salaryK ? "+" : ""}$${(chartData[chartData.length - 1].salaryK - chartData[0].salaryK).toFixed(1)}K`
                        : "N/A"}
                    </div>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="accuracy" className="mt-3">
                <div
                  className="bg-slate-800/30 rounded-lg p-3 border border-slate-700/30"
                  data-testid="chart-accuracy"
                >
                  <div className="text-[10px] text-slate-400 mb-2 font-medium uppercase tracking-wide">
                    Projection Accuracy (Actual − Projected)
                  </div>
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart
                      data={chartData.filter((d) => d.delta !== null)}
                      margin={{ top: 5, right: 10, left: -10, bottom: 5 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="#334155"
                        strokeOpacity={0.5}
                      />
                      <XAxis
                        dataKey="dateLabel"
                        tick={{ fontSize: 10, fill: "#94a3b8" }}
                        tickLine={false}
                        axisLine={{ stroke: "#475569" }}
                      />
                      <YAxis
                        tick={{ fontSize: 10, fill: "#94a3b8" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip content={<CustomTooltip />} />
                      <ReferenceLine y={0} stroke="#475569" />
                      <Bar
                        dataKey="delta"
                        name="Actual vs Proj"
                        radius={[4, 4, 0, 0]}
                        maxBarSize={32}
                      >
                        {chartData
                          .filter((d) => d.delta !== null)
                          .map((entry, idx) => (
                            <Cell
                              key={idx}
                              fill={
                                entry.delta! >= 0 ? "#10b981" : "#ef4444"
                              }
                              fillOpacity={0.7}
                            />
                          ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {stats.gamesWithActuals > 0 && (
                  <div className="grid grid-cols-3 gap-2 mt-3">
                    <div className="bg-slate-800/40 rounded-lg p-2 border border-slate-700/30 text-center">
                      <div className="text-[9px] text-slate-500 uppercase">
                        Hit Rate
                      </div>
                      <div
                        className={`text-sm font-black ${stats.hitRate >= 0.5 ? "text-emerald-400" : "text-red-400"}`}
                      >
                        {(stats.hitRate * 100).toFixed(0)}%
                      </div>
                    </div>
                    <div className="bg-slate-800/40 rounded-lg p-2 border border-slate-700/30 text-center">
                      <div className="text-[9px] text-slate-500 uppercase">
                        Avg Delta
                      </div>
                      <div
                        className={`text-sm font-black ${stats.avgActual >= stats.avgProj ? "text-emerald-400" : "text-red-400"}`}
                      >
                        {stats.avgActual >= stats.avgProj ? "+" : ""}
                        {(stats.avgActual - stats.avgProj).toFixed(1)}
                      </div>
                    </div>
                    <div className="bg-slate-800/40 rounded-lg p-2 border border-slate-700/30 text-center">
                      <div className="text-[9px] text-slate-500 uppercase">
                        Games Tracked
                      </div>
                      <div className="text-sm font-black text-white">
                        {stats.gamesWithActuals}
                      </div>
                    </div>
                  </div>
                )}

                {stats.gamesWithActuals === 0 && (
                  <div className="text-center py-4">
                    <p className="text-xs text-slate-500">
                      No actual performance data available yet
                    </p>
                  </div>
                )}
              </TabsContent>
            </Tabs>

            {boostScore && Number(boostScore) !== 0 && (
              <div className="bg-slate-800/30 rounded-lg p-2.5 border border-slate-700/30">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-400 uppercase tracking-wide">
                    Current Boost
                  </span>
                  <span
                    className={`text-sm font-black ${Number(boostScore) > 0 ? "text-emerald-400" : "text-red-400"}`}
                  >
                    {Number(boostScore) > 0 ? "+" : ""}
                    {Number(boostScore).toFixed(1)} (
                    {Number(boostScore) > 0 ? "+" : ""}
                    {(Number(boostScore) * 0.008 * 100).toFixed(1)}% projection
                    impact)
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

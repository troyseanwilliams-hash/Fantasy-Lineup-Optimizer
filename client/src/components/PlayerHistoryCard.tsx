import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { TrendingUp, TrendingDown, Minus, BarChart3 } from "lucide-react";

interface HistoryEntry {
  id: number;
  playerName: string;
  sport: string;
  salary: number;
  projectedPoints: string;
  actualPoints: string | null;
  slateDate: string;
}

interface PlayerHistoryCardProps {
  playerName: string;
  sport: string;
  children: React.ReactNode;
}

export function PlayerHistoryCard({ playerName, sport, children }: PlayerHistoryCardProps) {
  const [show, setShow] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchHistory = useCallback(async () => {
    if (history !== null) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/players/${encodeURIComponent(playerName)}/history?sport=${sport}&limit=5`);
      if (res.ok) {
        const data = await res.json();
        setHistory(data);
      } else {
        setHistory([]);
      }
    } catch {
      setHistory([]);
    } finally {
      setLoading(false);
    }
  }, [playerName, sport, history]);

  const computePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const cardW = 300;
    const cardH = 280;
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow < cardH
      ? Math.max(8, rect.top - cardH - 4)
      : rect.bottom + 4;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - cardW - 8));
    setCoords({ top, left });
  }, []);

  const handleEnter = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setShow(true);
      fetchHistory();
      computePosition();
    }, 300);
  }, [fetchHistory, computePosition]);

  const handleLeave = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setShow(false);
    }, 200);
  }, []);

  const handleCardEnter = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const displayHistory = history?.slice().reverse() || [];
  const maxPts = displayHistory.length > 0
    ? Math.max(...displayHistory.map(h => Math.max(Number(h.projectedPoints), Number(h.actualPoints || 0))))
    : 1;

  const trend = displayHistory.length >= 2
    ? Number(displayHistory[displayHistory.length - 1].projectedPoints) - Number(displayHistory[0].projectedPoints)
    : 0;

  const avgProj = displayHistory.length > 0
    ? displayHistory.reduce((s, h) => s + Number(h.projectedPoints), 0) / displayHistory.length
    : 0;

  return (
    <span
      ref={triggerRef}
      className="inline-flex items-center"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      {children}
      {show && coords && createPortal(
        <div
          className="fixed z-[9999] w-[300px] bg-slate-900 border border-slate-700/60 rounded-xl shadow-2xl shadow-black/60 p-4"
          style={{ top: coords.top, left: coords.left }}
          onMouseEnter={handleCardEnter}
          onMouseLeave={handleLeave}
          data-testid={`player-history-card-${playerName}`}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-amber-400" />
              <span className="text-xs font-black text-white">Recent Games</span>
            </div>
            {displayHistory.length >= 2 && (
              <div className="flex items-center gap-1">
                {trend > 0.5 ? (
                  <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                ) : trend < -0.5 ? (
                  <TrendingDown className="w-3.5 h-3.5 text-red-400" />
                ) : (
                  <Minus className="w-3.5 h-3.5 text-slate-400" />
                )}
                <span className={`text-[10px] font-bold ${
                  trend > 0.5 ? "text-emerald-400" : trend < -0.5 ? "text-red-400" : "text-slate-400"
                }`}>
                  {trend > 0 ? "+" : ""}{trend.toFixed(1)}
                </span>
              </div>
            )}
          </div>

          {loading && (
            <div className="flex items-center justify-center py-6">
              <div className="w-5 h-5 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin" />
            </div>
          )}

          {!loading && displayHistory.length === 0 && (
            <div className="text-center py-4">
              <span className="text-xs text-slate-500">No recent history available</span>
            </div>
          )}

          {!loading && displayHistory.length > 0 && (
            <>
              <div className="flex items-end gap-1.5 h-24 mb-2">
                {displayHistory.map((h, i) => {
                  const proj = Number(h.projectedPoints);
                  const actual = Number(h.actualPoints || 0);
                  const projH = Math.max(4, (proj / maxPts) * 100);
                  const actualH = actual > 0 ? Math.max(4, (actual / maxPts) * 100) : 0;
                  const dateLabel = new Date(h.slateDate + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });

                  return (
                    <div key={h.id || i} className="flex-1 flex flex-col items-center gap-0.5" data-testid={`history-bar-${i}`}>
                      <div className="flex items-end gap-0.5 h-20 w-full justify-center">
                        <div
                          className="w-3 bg-amber-500/60 rounded-t-sm transition-all"
                          style={{ height: `${projH}%` }}
                          title={`Proj: ${proj.toFixed(1)}`}
                        />
                        {actual > 0 && (
                          <div
                            className={`w-3 rounded-t-sm transition-all ${
                              actual >= proj ? "bg-emerald-500/70" : "bg-red-500/50"
                            }`}
                            style={{ height: `${actualH}%` }}
                            title={`Actual: ${actual.toFixed(1)}`}
                          />
                        )}
                      </div>
                      <span className="text-[9px] text-slate-500 font-medium">{dateLabel}</span>
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center gap-3 mb-2">
                <div className="flex items-center gap-1">
                  <div className="w-2.5 h-2.5 bg-amber-500/60 rounded-sm" />
                  <span className="text-[9px] text-slate-400">Projected</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-2.5 h-2.5 bg-emerald-500/70 rounded-sm" />
                  <span className="text-[9px] text-slate-400">Actual</span>
                </div>
              </div>

              <div className="border-t border-slate-700/50 pt-2 space-y-1">
                <div className="flex justify-between text-[10px]">
                  <span className="text-slate-400">Avg Projection</span>
                  <span className="text-white font-bold">{avgProj.toFixed(1)} pts</span>
                </div>
                {displayHistory.some(h => h.actualPoints && Number(h.actualPoints) > 0) && (
                  <div className="flex justify-between text-[10px]">
                    <span className="text-slate-400">Avg Actual</span>
                    <span className="text-white font-bold">
                      {(displayHistory.filter(h => Number(h.actualPoints || 0) > 0)
                        .reduce((s, h) => s + Number(h.actualPoints), 0) /
                        displayHistory.filter(h => Number(h.actualPoints || 0) > 0).length
                      ).toFixed(1)} pts
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-[10px]">
                  <span className="text-slate-400">Salary Range</span>
                  <span className="text-white font-bold">
                    ${(Math.min(...displayHistory.map(h => h.salary)) / 1000).toFixed(1)}K - ${(Math.max(...displayHistory.map(h => h.salary)) / 1000).toFixed(1)}K
                  </span>
                </div>
              </div>
            </>
          )}
        </div>,
        document.body
      )}
    </span>
  );
}

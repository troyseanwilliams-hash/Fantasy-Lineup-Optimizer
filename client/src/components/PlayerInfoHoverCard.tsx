import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card";
import { Badge } from "@/components/ui/badge";
import {
  DollarSign, Target, TrendingUp, TrendingDown, Activity,
  Flame, Snowflake, Shield, AlertTriangle, Zap
} from "lucide-react";

interface PlayerInfo {
  name: string;
  team: string;
  position: string;
  salary: number;
  projectedPoints: string | number;
  fppg?: string | number | null;
  opponent?: string | null;
  gameInfo?: string | null;
  injuryStatus?: string | null;
  injuryDetail?: string | null;
  boostScore?: string | number | null;
  boostReason?: string | null;
  isConfirmedStarter?: boolean;
}

const INJURY_BADGE: Record<string, string> = {
  OUT: "bg-red-500/20 text-red-400 border-red-500/30",
  Doubtful: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  Questionable: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  Probable: "bg-green-500/20 text-green-400 border-green-500/30",
  "Day-to-Day": "bg-blue-500/20 text-blue-400 border-blue-500/30",
};

export function PlayerInfoHoverCard({
  player,
  children,
  platform = "draftkings",
}: {
  player: PlayerInfo;
  children: React.ReactNode;
  platform?: string;
}) {
  const proj = Number(player.projectedPoints) || 0;
  const fppg = Number(player.fppg || player.projectedPoints) || 0;
  const valuePer1K = player.salary > 0 ? (proj * 1000) / player.salary : 0;
  const boost = Number(player.boostScore) || 0;
  const accentColor = platform === "fanduel" ? "blue" : "emerald";

  const boostReasons = player.boostReason
    ? player.boostReason.split("; ").slice(0, 4)
    : [];

  const isHot = player.boostReason?.includes("Hot actual form");
  const isCold = player.boostReason?.includes("Cold actual form");
  const isOutperformer = player.boostReason?.includes("outperformer");
  const isUnderperformer = player.boostReason?.includes("underperformer");

  return (
    <HoverCard openDelay={200} closeDelay={100}>
      <HoverCardTrigger asChild>
        {children}
      </HoverCardTrigger>
      <HoverCardContent
        className="w-80 bg-slate-900 border-slate-700 p-0 shadow-xl"
        side="top"
        sideOffset={8}
        align="start"
      >
        <div className="p-3 border-b border-slate-800">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-bold text-white">{player.name}</div>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-[11px] font-bold text-slate-400 uppercase">{player.team}</span>
                <span className="text-slate-600">·</span>
                <span className={`text-[11px] font-bold uppercase text-${accentColor}-400/70`}>{player.position}</span>
                {player.opponent && (
                  <>
                    <span className="text-slate-600">·</span>
                    <span className="text-[11px] text-slate-400">vs {player.opponent}</span>
                  </>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {player.isConfirmedStarter && (
                <Badge variant="outline" className="text-[9px] px-1.5 py-0 bg-green-500/10 text-green-400 border-green-500/30">
                  STARTER
                </Badge>
              )}
              {player.injuryStatus && (
                <Badge variant="outline" className={`text-[9px] px-1.5 py-0 ${INJURY_BADGE[player.injuryStatus] || "text-slate-400"}`}>
                  {player.injuryStatus.toUpperCase()}
                </Badge>
              )}
            </div>
          </div>
          {player.gameInfo && (
            <div className="text-[10px] text-slate-500 mt-1">{player.gameInfo}</div>
          )}
        </div>

        <div className="grid grid-cols-4 gap-0 border-b border-slate-800">
          <div className="p-2.5 text-center border-r border-slate-800/50">
            <div className="text-[10px] font-bold text-slate-500 uppercase mb-0.5">Salary</div>
            <div className="text-sm font-bold text-white">${(player.salary / 1000).toFixed(1)}K</div>
          </div>
          <div className="p-2.5 text-center border-r border-slate-800/50">
            <div className="text-[10px] font-bold text-slate-500 uppercase mb-0.5">Proj</div>
            <div className={`text-sm font-bold text-${accentColor}-400`}>{proj.toFixed(1)}</div>
          </div>
          <div className="p-2.5 text-center border-r border-slate-800/50">
            <div className="text-[10px] font-bold text-slate-500 uppercase mb-0.5">FPPG</div>
            <div className="text-sm font-bold text-white">{fppg.toFixed(1)}</div>
          </div>
          <div className="p-2.5 text-center">
            <div className="text-[10px] font-bold text-slate-500 uppercase mb-0.5">Value</div>
            <div className={`text-sm font-bold ${valuePer1K >= 5.0 ? "text-amber-400" : valuePer1K >= 3.5 ? "text-white" : "text-slate-400"}`}>
              {valuePer1K.toFixed(1)}x
            </div>
          </div>
        </div>

        {boost !== 0 && (
          <div className="px-3 py-2 border-b border-slate-800 flex items-center gap-2">
            <Zap className={`w-3.5 h-3.5 ${boost > 0 ? "text-amber-400" : "text-red-400"}`} />
            <span className="text-[11px] font-bold text-slate-400">Boost Score:</span>
            <span className={`text-sm font-black ${boost > 3 ? "text-amber-400" : boost > 0 ? "text-emerald-400" : boost > -3 ? "text-orange-400" : "text-red-400"}`}>
              {boost > 0 ? "+" : ""}{boost.toFixed(1)}
            </span>
            <div className="flex-1" />
            {isHot && <Flame className="w-3.5 h-3.5 text-orange-400" />}
            {isCold && <Snowflake className="w-3.5 h-3.5 text-blue-400" />}
            {isOutperformer && !isHot && <TrendingUp className="w-3.5 h-3.5 text-green-400" />}
            {isUnderperformer && !isCold && <TrendingDown className="w-3.5 h-3.5 text-red-400" />}
          </div>
        )}

        {boostReasons.length > 0 && (
          <div className="px-3 py-2 space-y-1">
            {boostReasons.map((reason, i) => (
              <div key={i} className="flex items-start gap-1.5">
                <span className="text-slate-600 mt-0.5 text-[10px]">•</span>
                <span className="text-[11px] text-slate-400 leading-tight">{reason}</span>
              </div>
            ))}
            {player.boostReason && player.boostReason.split("; ").length > 4 && (
              <div className="text-[10px] text-slate-500 italic pl-3">
                +{player.boostReason.split("; ").length - 4} more insights
              </div>
            )}
          </div>
        )}

        {boostReasons.length === 0 && boost === 0 && (
          <div className="px-3 py-2">
            <span className="text-[11px] text-slate-500 italic">No boost data available</span>
          </div>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}
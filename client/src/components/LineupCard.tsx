import { type Player, type OptimizeResponse } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Zap } from "lucide-react";
import { PlayerInfoHoverCard } from "@/components/PlayerInfoHoverCard";

interface LineupCardProps {
  lineup: OptimizeResponse | any;
  playersMap?: Map<number, Player>;
  onDelete?: (id: number) => void;
  index?: number;
}

export function LineupCard({ lineup, playersMap, onDelete, index }: LineupCardProps) {
  const players = lineup.lineup || lineup.playerIds?.map((id: number) => playersMap?.get(id)).filter(Boolean) || [];
  const totalSalary = lineup.totalSalary;
  const totalPoints = lineup.totalProjectedPoints;

  return (
    <Card className="card border-slate-800 bg-slate-800/30 overflow-hidden hover:border-emerald-500/30 transition-all">
      <div className="p-6 border-b border-slate-800 flex items-center justify-between bg-slate-900/20">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
            <Zap className="w-4 h-4 text-emerald-400 fill-current" />
          </div>
          <div>
            <h4 className="font-bold text-white text-sm">Lineup #{index !== undefined ? index + 1 : '1'}</h4>
            <p className="text-[11px] text-slate-400 font-bold uppercase tracking-widest">Optimized Proj</p>
          </div>
        </div>
        <div className="text-right">
          <div className="text-lg font-black text-emerald-400">{Number(totalPoints).toFixed(2)}</div>
          <div className="text-[11px] font-bold text-slate-400">${totalSalary?.toLocaleString()}</div>
        </div>
      </div>
      <CardContent className="p-0">
        <div className="divide-y divide-slate-800/50">
          {players.map((player: Player) => (
            <div key={player.id} className="px-6 py-3 flex items-center justify-between hover:bg-slate-800/20 transition-colors">
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 rounded bg-slate-800 flex items-center justify-center text-[11px] font-black text-slate-400 border border-slate-700">
                  {player.position}
                </div>
                <PlayerInfoHoverCard player={player}>
                  <div className="cursor-pointer">
                    <div className="text-xs font-bold text-slate-200 hover:underline decoration-dotted underline-offset-2">{player.name}</div>
                    <div className="text-[11px] text-slate-400 font-bold uppercase">{player.team}</div>
                  </div>
                </PlayerInfoHoverCard>
              </div>
              <div className="text-right">
                <div className="text-[11px] font-bold text-slate-300">{player.projectedPoints}</div>
                <div className="text-[11px] text-slate-400 font-mono">${player.salary?.toLocaleString()}</div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

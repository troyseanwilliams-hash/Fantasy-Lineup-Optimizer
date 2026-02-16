import { type Player } from "@shared/schema";
import { Lock, Unlock, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

interface PlayerTableProps {
  players: Player[];
  lockedPlayerIds: number[];
  excludedPlayerIds: number[];
  onLock: (id: number) => void;
  onExclude: (id: number) => void;
  onProjectionChange: (id: number, value: string) => void;
  customProjections: Record<string, number>;
}

export function PlayerTable({
  players,
  lockedPlayerIds,
  excludedPlayerIds,
  onLock,
  onExclude,
  onProjectionChange,
  customProjections,
}: PlayerTableProps) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/20 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-900/50 border-b border-slate-800">
              <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">Player</th>
              <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest text-center">Pos</th>
              <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest text-center">Team</th>
              <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest text-right">Salary</th>
              <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest text-right">Proj</th>
              <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest text-center">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {players.map((player) => (
              <tr 
                key={player.id} 
                className={`group transition-colors hover:bg-slate-800/40 ${
                  lockedPlayerIds.includes(player.id) ? "bg-emerald-500/5" : ""
                } ${excludedPlayerIds.includes(player.id) ? "opacity-40 grayscale" : ""}`}
              >
                <td className="px-6 py-4">
                  <div className="font-bold text-white group-hover:text-[#10B981] transition-colors">{player.name}</div>
                  <div className="text-[10px] text-slate-500 font-bold uppercase">{player.gameInfo}</div>
                </td>
                <td className="px-6 py-4 text-center">
                  <Badge variant="outline" className="border-slate-700 text-slate-400 font-bold bg-slate-900/50">
                    {player.position}
                  </Badge>
                </td>
                <td className="px-6 py-4 text-center font-bold text-slate-400 text-xs">{player.team}</td>
                <td className="px-6 py-4 text-right font-mono font-bold text-slate-200">
                  ${player.salary.toLocaleString()}
                </td>
                <td className="px-6 py-4 text-right">
                  <Input 
                    type="number" 
                    step="0.1"
                    className="w-20 h-8 ml-auto bg-slate-950 border-slate-800 text-right font-bold text-[#10B981] text-xs focus:ring-[#10B981]"
                    defaultValue={customProjections[player.id] ?? player.projectedPoints}
                    onChange={(e) => onProjectionChange(player.id, e.target.value)}
                  />
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center justify-center gap-2 opacity-60 group-hover:opacity-100 transition-opacity">
                    <button 
                      onClick={() => onLock(player.id)}
                      disabled={excludedPlayerIds.includes(player.id)}
                      className={`p-2 rounded-lg transition-all ${
                        lockedPlayerIds.includes(player.id) 
                          ? "bg-emerald-500 text-white shadow-lg shadow-emerald-500/20" 
                          : "bg-slate-800 text-slate-500 hover:text-white"
                      }`}
                    >
                      {lockedPlayerIds.includes(player.id) ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                    </button>
                    <button 
                      onClick={() => onExclude(player.id)}
                      disabled={lockedPlayerIds.includes(player.id)}
                      className={`p-2 rounded-lg transition-all ${
                        excludedPlayerIds.includes(player.id)
                          ? "bg-red-500 text-white"
                          : "bg-slate-800 text-slate-500 hover:bg-red-500/20 hover:text-red-400"
                      }`}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

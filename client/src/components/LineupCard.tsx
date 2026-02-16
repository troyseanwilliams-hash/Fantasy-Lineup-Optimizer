import { type Player, type Lineup } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";

interface LineupCardProps {
  lineup: Lineup | { playerIds: number[], totalSalary: number, totalProjectedPoints: any, lineup?: Player[] };
  playersMap: Map<number, Player>;
  onDelete?: (id: number) => void;
  index?: number;
}

export function LineupCard({ lineup, playersMap, onDelete, index }: LineupCardProps) {
  // If we have direct player objects (from optimizer), use them. Otherwise lookup from map.
  // The 'lineup' property on the first type argument comes from the OptimizeResponse schema
  const playersList = 'lineup' in lineup && Array.isArray(lineup.lineup) 
    ? lineup.lineup 
    : lineup.playerIds.map(id => playersMap.get(id)).filter(Boolean) as Player[];

  // Sort by position order is nice to have but we'll stick to array order for now
  
  return (
    <div className="bg-card rounded-xl border border-border shadow-lg overflow-hidden flex flex-col h-full hover:border-primary/50 transition-colors group">
      <div className="p-4 border-b border-border bg-black/20 flex justify-between items-center">
        <div>
           <h3 className="font-display text-lg text-white">
            Lineup {index !== undefined ? `#${index + 1}` : ''}
            {'name' in lineup && lineup.name && <span className="text-muted-foreground ml-2 text-sm font-sans normal-case">({lineup.name})</span>}
           </h3>
           <div className="flex gap-4 mt-1">
             <span className="text-xs font-mono text-emerald-400">
               SAL: ${(lineup.totalSalary).toLocaleString()}
             </span>
             <span className="text-xs font-mono text-primary">
               PROJ: {Number(lineup.totalProjectedPoints).toFixed(2)}
             </span>
           </div>
        </div>
        {'id' in lineup && onDelete && (
          <Button 
            variant="ghost" 
            size="icon" 
            className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            onClick={() => onDelete(lineup.id)}
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        )}
      </div>
      
      <div className="divide-y divide-border/50">
        {playersList.map((player) => (
          <div key={player.id} className="p-3 flex items-center justify-between hover:bg-white/5 transition-colors">
            <div className="flex items-center gap-3">
              <span className="w-8 font-mono text-xs font-bold text-muted-foreground bg-secondary/50 rounded px-1.5 py-0.5 text-center">
                {player.position}
              </span>
              <div>
                <p className="text-sm font-medium text-white">{player.name}</p>
                <p className="text-[10px] text-muted-foreground uppercase">{player.team} vs {player.opponent}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="font-mono text-xs text-emerald-400/80">${player.salary}</p>
              <p className="font-mono text-xs text-primary/80">{player.projectedPoints}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

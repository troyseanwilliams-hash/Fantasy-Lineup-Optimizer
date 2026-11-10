import type { Player } from "@shared/schema";
import { classicLogicSchema, classicPlayerEvidenceSchema, type ClassicLogic } from "@shared/nfl-classic-logic";

export const APP_CLASSIC_WARNINGS = [
  "Sources: current slate projections, app ownership estimates and recorded injury statuses. Ownership is estimated, not DFS Army-certified.",
  "Not verified from app data: injury-review freshness, weather, recent workload/role, road-underdog spreads, top-defense matchup and defensive turnover/implied-total screens.",
  "Role-based exposure floors and automatic weekly anchors are not applied without evidence. Selected anchors are manual exposure targets, not verified roles. Naked QBs are disabled.",
  "Defenses are ranked by app projections; the best-two matchup exposure floors and elite-turnover exception are not certified. Defenses below $2,500 remain excluded.",
];

// Rebuild on every request from server data; never trust client-supplied app projections.
export function buildAppClassicInputs(pool: Player[], slateId: number, ownership: Map<number, number>, previous?: ClassicLogic): ClassicLogic {
  const players: ClassicLogic["players"] = {};
  for (const p of pool) {
    const projection = Number(p.projectedPoints), own = ownership.get(p.id);
    if (p.projectedPoints == null || String(p.projectedPoints).trim() === "" || !Number.isFinite(projection) || own === undefined || !Number.isFinite(own) || own < 0 || own > 100) {
      throw new Error(`${p.name}: current projection or ownership estimate is unavailable. Refresh slate data before generating.`);
    }
    const status = classicPlayerEvidenceSchema.shape.status.safeParse((p.injuryStatus || "UNKNOWN").toUpperCase());
    players[String(p.id)] = classicPlayerEvidenceSchema.parse({
      projection, ownership: own, status: status.success ? status.data : "UNKNOWN",
      chalk: own >= 20,
    });
  }
  return classicLogicSchema.parse({
    ...previous, projectionSource: "App data", slateId, players,
    anchors: previous?.anchors ?? {}, nakedPct: 0,
  });
}

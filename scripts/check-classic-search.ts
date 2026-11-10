// Read-only diagnostic: never saves generated lineups.
import { storage } from "../server/storage";
import { calculateOwnership } from "../server/ownership-engine";
import { buildAppClassicInputs } from "../server/nfl-classic-app-data";
import { generateClassicPortfolio } from "../server/nfl-classic-engine";
import { nflPortfolioSettingsSchema } from "../shared/nfl-portfolio";
import { solveLineup } from "../server/routes";

async function main() {
  const slateId = Number(process.argv[2]);
  const count = Number(process.argv[3] || 5);
  const slates = await storage.getSlates();
  const slate = slates.find(s => s.id === slateId);
  if (!slate || slate.sport !== "NFL") throw new Error("Supply an existing NFL Classic slate ID.");
  const pool = await storage.getPlayersBySlate(slateId);
  const ownership = await calculateOwnership(pool, "NFL", "gpp_large");
  const own = new Map(ownership.map(p => [p.playerId, p.projectedOwnership]));
  const settings = nflPortfolioSettingsSchema.parse({ enabled: true, classic: buildAppClassicInputs(pool, slateId, own) });
  const deadline = Date.now() + 28000;
  const result = await generateClassicPortfolio({
    pool, settings, count, allowReducedCount: process.argv.includes("--sim"), deadline, baseConstraints: {},
    solve: (players, constraints) => solveLineup(players, constraints, "NFL", slate.platform, constraints.ownershipMap, { deadline, timeoutMs: 250 }),
  });
  console.log(JSON.stringify({ requested: count, generated: result.lineups.length, partial: result.report.partial, candidates: result.report.candidateCount }));
}
main().then(() => process.exit(0)).catch(error => { console.error(error.message); process.exit(1); });

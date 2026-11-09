import { classicLogicSchema, classicPlayerEvidenceSchema, type ClassicLogic } from "./nfl-classic-logic";
import { readCsv, csvText, nameKey } from "./nfl-gpp-csv";
export const CLASSIC_INPUT_HEADERS = [
  "Name", "Team", "Projection", "Ownership", "Status", "StatusCheckedAt", "DepthChartNotes",
  "WeatherNotes", "WeatherCheckedAt", "Recent", "Opportunity", "Punt", "ValueTier", "Chalk",
  "RushingQB", "RoadUnderdogSpread", "OpponentImpliedTotal", "OpponentSackRate",
  "OpponentFumbleRate", "OpponentIntRate", "EliteTurnoverMatchup", "TopDefense", "Ceiling",
];
export const classicInputHeaderCsv = () => csvText([CLASSIC_INPUT_HEADERS]);
/** Import only formula inputs; exact name/team matching, never fuzzy player assignment. */
export function parseClassicInputs(text: string, pool: Array<{ id: number; name: string; team?: string }>, slateId: number): ClassicLogic {
  if (text.length > 3_000_000) throw new Error("Classic inputs exceed the 3 MB limit.");
  if (text.trim().startsWith("{")) {
    const parsed = classicLogicSchema.parse(JSON.parse(text));
    if (parsed.slateId !== slateId) throw new Error("Inputs belong to a different slate.");
    if (Object.keys(parsed.players).some(id => !pool.some(p => String(p.id) === id))) throw new Error("Inputs contain unknown slate player IDs.");
    return parsed;
  }
  const rows = readCsv(text), header = rows.shift();
  if (!header) throw new Error("CSV is empty.");
  const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const data: ClassicLogic["players"] = {};
  for (const row of rows) {
    const cell = (...names: string[]) => row[header.findIndex(h => names.includes(key(h)))]?.trim() || "";
    const name = cell("name", "player"), team = cell("team", "teamabbrev");
    const matches = pool.filter(p => nameKey(p.name) === nameKey(name) && p.team?.toUpperCase() === team.toUpperCase());
    if (matches.length !== 1) throw new Error(`No unique exact slate match for ${name} / ${team}.`);
    const id = String(matches[0].id);
    if (data[id]) throw new Error(`Duplicate input row for ${name}.`);
    const num = (...names: string[]) => {
      const value = cell(...names);
      return value ? Number(value.replace(/[%,$]/g, "")) : undefined;
    };
    const bool = (name: string) => {
      const v = cell(name).toLowerCase();
      if (!["", "false", "true", "0", "1", "yes", "no"].includes(v)) throw new Error(`${name} must be yes/no for ${matches[0].name}.`);
      return ["true", "1", "yes"].includes(v);
    };
    try {
      data[id] = classicPlayerEvidenceSchema.parse({
        projection: num("projection", "dkproj"), ownership: num("ownership", "main", "mainown"),
        status: cell("status").toUpperCase(), statusCheckedAt: cell("statuscheckedat"),
        depthChartNotes: cell("depthchartnotes"), weatherNotes: cell("weathernotes"),
        weatherCheckedAt: cell("weathercheckedat"),
        recent: cell("recent") ? JSON.parse(cell("recent")) : [],
        opportunity: cell("opportunity").toLowerCase() || "none",
        punt: bool("punt"), valueTier: bool("valuetier"), chalk: bool("chalk"), rushingQb: bool("rushingqb"),
        roadUnderdogSpread: num("roadunderdogspread") ?? 0,
        opponentImpliedTotal: num("opponentimpliedtotal"), opponentSackRate: num("opponentsackrate"),
        opponentFumbleRate: num("opponentfumblerate"), opponentIntRate: num("opponentintrate"),
        eliteTurnoverMatchup: bool("eliteturnovermatchup"), topDefense: bool("topdefense"), ceiling: num("ceiling"),
      });
    } catch (err) { throw new Error(`${name}: ${err instanceof Error ? err.message : "Invalid formula inputs."}`); }
  }
  if (!Object.keys(data).length) throw new Error("No player inputs found.");
  return classicLogicSchema.parse({ projectionSource: "DFS Army", slateId, players: data });
}

export type GppPosition = "QB" | "RB" | "WR" | "TE" | "K" | "DST";
export interface GppPlayer {
  id: string;
  name: string;
  pos: GppPosition;
  team: string;
  flexSalary: number;
  cptSalary: number;
  projection: number;
  cptOwn: number;
  flexOwn: number;
}
export interface ShowdownStrategyConfig {
  seed: string;
  count: number;
  captainPlan: Record<string, number>;
  flexMinimums: Record<string, number>;
  flexTargets: Record<string, number>;
  excludedIds: string[];
  favoriteTeam: string;
  splitTargets: { favorite42: number; underdog42: number; balanced33: number; fiveOne: number };
  kickerTarget: number;
}
export interface StrategyLineup {
  captain: string;
  flex: string[];
  salary: number;
  projection: number;
  ownership: number;
}
export interface StrategyResult {
  lineups: StrategyLineup[];
  seed: string;
  summary: string;
}
export interface OfficialPlayer {
  gameInfo?: string;
  name: string;
  team: string;
  pos: string;
  flexId: string;
  cptId?: string;
  flexSalary: number;
  cptSalary?: number;
}
export interface ClassicEntry { entryId: string; cells: string[]; playerIds: string[] }
export interface ClassicUpload { header: string[]; slotIndices: number[]; entries: ClassicEntry[] }
export interface ClassicViolation { id: string; name: string; count: number; cap: number; percent: number; excluded: boolean }
export interface ClassicSwap { entry: number; slot: number; fromId: string; toId: string; fromName: string; toName: string }
export interface ClassicAudit {
  violations: ClassicViolation[];
  proposals: ClassicSwap[];
  unresolved: ClassicViolation[];
  warnings: string[];
  revised: ClassicUpload;
}

import { useMemo, useState, useSyncExternalStore } from "react";
import type { GppPlayer, ShowdownStrategyConfig } from "@shared/nfl-gpp-types";

export const normalizeWorkbenchName = (name: string) => name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const eventName = "elitelineup-workbench-exclusions";
function read(key: string) {
  try { return key ? localStorage.getItem(key) || "[]" : "[]"; } catch { return "[]"; }
}
function parse(raw: string): string[] {
  try { const value: unknown = JSON.parse(raw); return Array.isArray(value) ? Array.from(new Set(value.filter((n): n is string => typeof n === "string").map(normalizeWorkbenchName).filter(Boolean))) : []; } catch { return []; }
}
function subscribe(callback: () => void) {
  window.addEventListener(eventName, callback); window.addEventListener("storage", callback);
  return () => { window.removeEventListener(eventName, callback); window.removeEventListener("storage", callback); };
}
export function useWorkbenchExclusions(userId: string | number | undefined) {
  const key = userId === undefined ? "" : `elitelineup:nfl-workbench:exclusions:${userId}`;
  const raw = useSyncExternalStore(subscribe, () => read(key), () => "[]");
  const names = useMemo(() => parse(raw), [raw]);
  const [storageError, setStorageError] = useState("");
  function setName(name: string, excluded: boolean) {
    if (!key) return;
    const normalized = normalizeWorkbenchName(name);
    const next = new Set(parse(read(key)));
    if (excluded) next.add(normalized); else next.delete(normalized);
    try { localStorage.setItem(key, JSON.stringify(Array.from(next))); setStorageError(""); window.dispatchEvent(new Event(eventName)); }
    catch { setStorageError("Standing exclusions could not be saved. Enable local storage and retry before building or auditing."); }
  }
  return { names, setName, storageError };
}
export interface WorkbenchExclusionProps {
  standingNames: string[];
  onStandingChange: (name: string, excluded: boolean) => void;
}
export function applyStandingExclusions(config: ShowdownStrategyConfig, players: GppPlayer[], names: string[]): ShowdownStrategyConfig {
  const excludedIds = players.filter(p => names.includes(normalizeWorkbenchName(p.name))).map(p => p.id);
  const next = { ...config, excludedIds, captainPlan: { ...config.captainPlan }, flexMinimums: { ...config.flexMinimums }, flexTargets: { ...config.flexTargets } };
  for (const id of excludedIds) { next.captainPlan[id] = 0; next.flexMinimums[id] = 0; next.flexTargets[id] = 0; }
  return next;
}

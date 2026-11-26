import type { Player, Slate } from "@shared/schema";

/**
 * Real GPP ownership projections from SportsDataIO (NFL + NBA, DraftKings classic slates).
 * Flow: DfsSlatesByDate/{date} -> find the DraftKings slate whose OperatorSlateID equals our
 * draftGroupId -> DfsSlateOwnershipProjectionsBySlateID/{SlateID}. Anything that fails or
 * is empty returns an empty map so the caller falls back to the modeled estimate.
 */
export const SPORTSDATA_OWNERSHIP_LABEL = "SportsDataIO projected GPP ownership";
const SLUGS: Record<string, string> = { NFL: "nfl", NBA: "nba" };
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const TTL_MS = 10 * 60_000;
const FAIL_TTL_MS = 2 * 60_000;

type SlateKey = Pick<Slate, "id" | "sport" | "platform" | "startTime" | "draftGroupId" | "gameType">;
// Keyed by DraftKings player id (as a string).
const cache = new Map<number, { expires: number; byDkId: Map<string, number> }>();

export function sportsDataOwnershipSupported(slate: SlateKey | undefined): slate is SlateKey {
  if (!slate || !process.env.SPORTSDATA_API_KEY) return false;
  return !!SLUGS[slate.sport.toUpperCase()] && slate.platform === "draftkings" && !!slate.draftGroupId &&
    (slate.gameType || "Classic").trim().toLowerCase() === "classic";
}

async function getJson(url: string, apiKey: string): Promise<any> {
  const res = await fetch(url, { headers: { "Ocp-Apim-Subscription-Key": apiKey } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function easternDate(d: Date): string {
  const [y, m, day] = d.toLocaleDateString("en-CA", { timeZone: "America/New_York" }).split("-");
  return `${y}-${MONTHS[Number(m) - 1]}-${day}`;
}

async function load(slate: SlateKey): Promise<Map<string, number>> {
  const apiKey = process.env.SPORTSDATA_API_KEY!;
  const slug = SLUGS[slate.sport.toUpperCase()];
  const base = `https://api.sportsdata.io/v3/${slug}/projections/json`;
  const date = easternDate(new Date(slate.startTime));

  const slates: any[] = await getJson(`${base}/DfsSlatesByDate/${date}`, apiKey);
  const dk = (Array.isArray(slates) ? slates : []).filter(s => s.Operator === "DraftKings" && !s.RemovedByOperator);
  const match = dk.find(s => Number(s.OperatorSlateID) === slate.draftGroupId);
  if (!match) return new Map();

  const projections: any = await getJson(`${base}/DfsSlateOwnershipProjectionsBySlateID/${match.SlateID}`, apiKey);
  const rows: any[] = projections?.SlateOwnershipProjections ?? [];
  if (!rows.length) return new Map();

  // Ownership rows carry SportsDataIO ids; the slate's player list maps them to DraftKings ids.
  const dkIdBySlatePlayer = new Map<number, string>();
  const dkIdByPlayer = new Map<number, string>();
  for (const sp of match.DfsSlatePlayers ?? []) {
    const id = sp.OperatorPlayerID != null ? String(sp.OperatorPlayerID) : "";
    if (!id) continue;
    if (sp.SlatePlayerID != null) dkIdBySlatePlayer.set(Number(sp.SlatePlayerID), id);
    if (sp.PlayerID != null) dkIdByPlayer.set(Number(sp.PlayerID), id);
  }

  const out = new Map<string, number>();
  for (const r of rows) {
    const pct = Number(r.ProjectedOwnershipPercentage);
    if (!Number.isFinite(pct) || pct < 0) continue;
    const dkId =
      (r.SlatePlayerID != null ? dkIdBySlatePlayer.get(Number(r.SlatePlayerID)) : undefined) ??
      (r.PlayerID != null ? dkIdByPlayer.get(Number(r.PlayerID)) : undefined);
    if (dkId) out.set(dkId, Math.round(pct * 10) / 10);
  }
  return out;
}

async function forSlate(slate: SlateKey): Promise<Map<string, number>> {
  const hit = cache.get(slate.id);
  if (hit && hit.expires > Date.now()) return hit.byDkId;
  let byDkId = new Map<string, number>();
  let ttl = TTL_MS;
  try {
    byDkId = await load(slate);
    if (byDkId.size === 0) ttl = FAIL_TTL_MS;
  } catch (err: any) {
    console.warn(`[Ownership] SportsDataIO ${slate.sport} slate ${slate.id}: ${err?.message ?? err}`);
    ttl = FAIL_TTL_MS;
  }
  if (cache.size >= 200) cache.clear();
  cache.set(slate.id, { expires: Date.now() + ttl, byDkId });
  return byDkId;
}

/** playerId -> projected ownership for every pool player SportsDataIO covers. */
export async function sportsDataOwnershipForPool(
  players: Player[],
  scopes: ReadonlyMap<number, SlateKey | undefined>,
): Promise<Map<number, number>> {
  const result = new Map<number, number>();
  const slateIds = Array.from(new Set(players.map(p => p.slateId)));
  await Promise.all(slateIds.map(async slateId => {
    const slate = scopes.get(slateId);
    if (!sportsDataOwnershipSupported(slate)) return;
    const byDkId = await forSlate(slate);
    if (!byDkId.size) return;
    for (const p of players) {
      if (p.slateId !== slateId || p.draftKingsPlayerId == null) continue;
      const pct = byDkId.get(String(p.draftKingsPlayerId));
      if (pct != null) result.set(p.id, pct);
    }
  }));
  return result;
}

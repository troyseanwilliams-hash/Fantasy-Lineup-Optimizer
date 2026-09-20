const NFL_TEAM_ALIASES: Record<string, string> = {
  LA: "LAR",
  LAR: "LAR",
  STL: "LAR",
  WSH: "WAS",
  WAS: "WAS",
  JAC: "JAX",
  JAX: "JAX",
  OAK: "LV",
  LV: "LV",
  SD: "LAC",
  LAC: "LAC",
};

export function normalizeNFLTeam(team: string | null | undefined): string {
  const value = String(team || "").trim().toUpperCase();
  return NFL_TEAM_ALIASES[value] || value;
}

export function nflGameKey(away: string | null | undefined, home: string | null | undefined): string {
  const teams = [normalizeNFLTeam(away), normalizeNFLTeam(home)];
  return teams.every(Boolean) ? teams.sort().join("-") : "";
}
import type { Player, Slate } from "@shared/schema";

/**
 * The DraftKings draftables feed has two IDs:
 * - playerId is the stable athlete ID
 * - draftableId is the contest/upload row ID (and is what goes in a CSV)
 *
 * Keep this type deliberately permissive.  DraftKings has returned both
 * rosterSlotId and position for the slot in different feed versions, and
 * actualPosition for the underlying athlete position.
 */
export interface ExportDraftable {
  draftableId?: number | string | null;
  playerId?: number | string | null;
  displayName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  teamAbbreviation?: string | null;
  team?: string | null;
  position?: string | null;
  actualPosition?: string | null;
  playerPosition?: string | null;
  athletePosition?: string | null;
  rosterSlotId?: number | string | null;
  rosterSlot?: number | string | null;
  slot?: number | string | null;
  salary?: number | string | null;
  isCaptain?: boolean | null;
  draftGroupId?: number | string | null;
  [key: string]: unknown;
}

export class ExportResolutionError extends Error {
  readonly status: 400 | 503;

  constructor(message: string, status: 400 | 503 = 400) {
    super(message);
    this.name = "ExportResolutionError";
    this.status = status;
  }
}

export interface ResolvePlayersForExportOptions {
  slate: Slate;
  players: Player[];
  playerIds: number[];
  captainId?: number;
  draftables?: ExportDraftable[];
}

function positiveInteger(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function normalized(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function normalizedPosition(value: unknown): string {
  return normalized(value).replace(/\s*\/\s*/g, "/");
}

function positionAliases(sport: string, value: unknown): Set<string> {
  const position = normalizedPosition(value);
  const aliases = new Set([position]);
  switch (sport.toUpperCase()) {
    case "NBA":
      if (position === "g" || position === "pg/sg") aliases.add("pg/sg");
      if (position === "f" || position === "sf/pf") aliases.add("sf/pf");
      break;
    case "SOCCER":
      if (["f", "fwd", "forward"].includes(position)) aliases.add("f");
      if (["m", "mf", "mid", "midfielder"].includes(position)) aliases.add("m");
      if (["d", "def", "defender"].includes(position)) aliases.add("d");
      if (["gk", "goalkeeper"].includes(position)) aliases.add("gk");
      break;
  }
  return aliases;
}

function draftableName(draftable: ExportDraftable): string {
  return String(
    draftable.displayName ||
    [draftable.firstName, draftable.lastName].filter(Boolean).join(" "),
  ).trim();
}

function draftableTeam(draftable: ExportDraftable): string {
  return String(draftable.teamAbbreviation || draftable.team || "").trim();
}

function draftablePosition(draftable: ExportDraftable): string {
  // `position` is the athlete position in the usual DK response.  Some feed
  // versions put the roster role there instead, so only use a role-looking
  // value after checking the explicit athlete-position fields.
  const explicitPosition =
    draftable.actualPosition ||
    draftable.playerPosition ||
    draftable.athletePosition;
  if (explicitPosition) return String(explicitPosition).trim();
  const position = String(draftable.position || "").trim();
  if (!["cpt", "captain", "mvp", "flex"].includes(normalized(position))) {
    return position;
  }
  const alternate = String(draftable.rosterSlotId || draftable.rosterSlot || "").trim();
  return alternate;
}

function slotValues(draftable: ExportDraftable): string[] {
  return [
    draftable.rosterSlotId,
    draftable.rosterSlot,
    draftable.slot,
    draftable.position,
  ]
    .filter(value => value != null)
    .map(value => normalized(value));
}

function roleSlotKey(draftable: ExportDraftable): string | null {
  const rawSlot = draftable.rosterSlotId ?? draftable.rosterSlot ?? draftable.slot;
  if (rawSlot == null) return null;
  const numericSlot = Number(rawSlot);
  if (Number.isSafeInteger(numericSlot) && numericSlot > 0) {
    return `numeric:${numericSlot}`;
  }
  const textSlot = normalized(rawSlot);
  return textSlot ? `text:${textSlot}` : null;
}

function isCaptainDraftable(draftable: ExportDraftable): boolean {
  if (draftable.isCaptain === true) return true;
  return slotValues(draftable).some(value =>
    value === "cpt" ||
    value === "captain" ||
    value === "mvp",
  );
}

function draftableSalary(draftable: ExportDraftable): number {
  const salary = Number(draftable.salary);
  return Number.isFinite(salary) ? salary : Number.POSITIVE_INFINITY;
}

function samePlayerIdentity(
  sport: string,
  player: Player,
  draftable: ExportDraftable,
): boolean {
  const playerPositions = positionAliases(sport, player.position);
  const draftablePositions = positionAliases(sport, draftablePosition(draftable));
  return normalized(player.name) === normalized(draftableName(draftable)) &&
    normalized(player.team) === normalized(draftableTeam(draftable)) &&
    Array.from(playerPositions).some(position => draftablePositions.has(position));
}

function resolveDraftableForPlayer(
  sport: string,
  player: Player,
  draftables: ExportDraftable[],
  role: "captain" | "flex",
  allowNumericShowdownRoles: boolean,
): ExportDraftable {
  const canonicalId = positiveInteger(player.draftKingsPlayerId);
  if (!canonicalId) {
    throw new ExportResolutionError(
      `DraftKings player ${player.name} is missing its canonical player ID.`,
    );
  }

  // A canonical DB ID may be the contest draftableId (the current ingest
  // format) or the stable athlete playerId (older imported rows).  In either
  // case, the live row must also have the stable athlete ID and exact
  // identity.  Never search by name alone or use internalID.
  const canonicalMatches = draftables.filter(draftable => {
    const draftableId = positiveInteger(draftable.draftableId);
    const athleteId = positiveInteger(draftable.playerId);
    const idMatches = draftableId === canonicalId || athleteId === canonicalId;
    return idMatches && athleteId != null && samePlayerIdentity(sport, player, draftable);
  });

  if (canonicalMatches.length === 0) {
    throw new ExportResolutionError(
      `DraftKings ${player.name} is missing from the current contest.`,
    );
  }

  const athleteIds = new Set(
    canonicalMatches
      .map(draftable => positiveInteger(draftable.playerId))
      .filter((id): id is number => id != null),
  );
  if (athleteIds.size !== 1) {
    throw new ExportResolutionError(
      `DraftKings player ${player.name} is ambiguous in the current contest.`,
    );
  }
  const athleteId = Array.from(athleteIds)[0];

  // The canonical row stored on a Showdown slate is normally the cheaper
  // FLEX draftable.  Once it proves the athlete identity, use that stable
  // underlying athlete ID to select the separate CPT row.
  const identityMatches = draftables.filter(draftable =>
    positiveInteger(draftable.playerId) === athleteId &&
    samePlayerIdentity(sport, player, draftable),
  );

  const explicitRoleMatches = identityMatches.filter(draftable =>
    role === "captain" ? isCaptainDraftable(draftable) : !isCaptainDraftable(draftable),
  );
  const hasExplicitRole = identityMatches.some(isCaptainDraftable);
  let roleMatches = explicitRoleMatches;

  if (
    allowNumericShowdownRoles &&
    !hasExplicitRole &&
    identityMatches.length === 2
  ) {
    const [first, second] = identityMatches;
    const firstSalary = draftableSalary(first);
    const secondSalary = draftableSalary(second);
    const high = Math.max(firstSalary, secondSalary);
    const low = Math.min(firstSalary, secondSalary);
    const firstSlot = roleSlotKey(first);
    const secondSlot = roleSlotKey(second);
    const firstDraftableId = positiveInteger(first.draftableId);
    const secondDraftableId = positiveInteger(second.draftableId);
    const hasDistinctSlots =
      firstSlot !== null &&
      secondSlot !== null &&
      firstSlot !== secondSlot &&
      firstDraftableId !== null &&
      secondDraftableId !== null &&
      firstDraftableId !== secondDraftableId;
    const hasCaptainMultiplier =
      Number.isFinite(high) &&
      Number.isFinite(low) &&
      low > 0 &&
      Math.abs(high / low - 1.5) < 0.001;

    if (hasDistinctSlots && hasCaptainMultiplier) {
      const inferredCaptain = firstSalary > secondSalary ? first : second;
      const inferredFlex = inferredCaptain === first ? second : first;
      roleMatches = [role === "captain" ? inferredCaptain : inferredFlex];
    } else {
      roleMatches = [];
    }
  }

  if (roleMatches.length === 0) {
    const roleLabel = role === "captain" ? "captain" : "flex";
    throw new ExportResolutionError(
      `DraftKings ${roleLabel} row for ${player.name} is missing from the current contest.`,
    );
  }

  if (role === "captain") {
    if (roleMatches.length !== 1) {
      throw new ExportResolutionError(
        `DraftKings captain row for ${player.name} is ambiguous in the current contest.`,
      );
    }
    return roleMatches[0];
  }

  // Classic contest rows are contest-specific, so a saved canonical
  // draftable ID is enough to break an equal-salary duplicate tie once the
  // row has already passed group, stable-athlete, and player-identity checks.
  // Do not use this shortcut for Showdown: CPT/FLEX rows intentionally share
  // an athlete and must still be resolved by their role.
  if (!allowNumericShowdownRoles) {
    const exactCanonicalRows = roleMatches.filter(
      row => positiveInteger(row.draftableId) === canonicalId,
    );
    if (exactCanonicalRows.length === 1) {
      return exactCanonicalRows[0];
    }
  }

  // A player can have more than one non-captain row in some DK feeds.  The
  // lower-priced live row is the flex row; equal-priced alternatives are
  // ambiguous and must not be guessed.
  if (roleMatches.some(row => !Number.isFinite(draftableSalary(row)))) {
    throw new ExportResolutionError(
      `DraftKings flex row for ${player.name} is ambiguous in the current contest.`,
    );
  }
  const lowestSalary = Math.min(...roleMatches.map(draftableSalary));
  const lowestPriced = roleMatches.filter(row => draftableSalary(row) === lowestSalary);
  if (!Number.isFinite(lowestSalary) || lowestPriced.length !== 1) {
    throw new ExportResolutionError(
      `DraftKings flex row for ${player.name} is ambiguous in the current contest.`,
    );
  }
  return lowestPriced[0];
}

function resolveDraftKingsPlayers(
  slate: Slate,
  selectedPlayers: Player[],
  captainId: number | undefined,
  draftables: ExportDraftable[],
): Player[] {
  if (!Number.isSafeInteger(slate.draftGroupId) || slate.draftGroupId == null || slate.draftGroupId <= 0) {
    throw new ExportResolutionError(
      "The selected DraftKings slate has no current contest group.",
    );
  }
  if (!draftables || draftables.length === 0) {
    throw new ExportResolutionError(
      "The current DraftKings contest player pool is unavailable.",
      503,
    );
  }

  // This filter is useful to callers/tests that combine feed rows from more
  // than one group.  The production fetch is already scoped to this group.
  const targetDraftGroupId = slate.draftGroupId;
  const scopedDraftables = draftables.filter(draftable => {
    if (draftable.draftGroupId == null) return true;
    return positiveInteger(draftable.draftGroupId) === targetDraftGroupId;
  });
  const allowNumericShowdownRoles =
    normalized(slate.gameType).includes("showdown");

  const resolved = new Map<number, number>();
  for (const player of selectedPlayers) {
    const row = resolveDraftableForPlayer(
      slate.sport,
      player,
      scopedDraftables,
      player.id === captainId ? "captain" : "flex",
      allowNumericShowdownRoles,
    );
    const draftableId = positiveInteger(row.draftableId);
    if (!draftableId) {
      throw new ExportResolutionError(
        `DraftKings contest row for ${player.name} has no valid draftable ID.`,
      );
    }
    if (Array.from(resolved.values()).includes(draftableId)) {
      throw new ExportResolutionError(
        `DraftKings contest row ${draftableId} resolves more than one selected player.`,
      );
    }
    resolved.set(player.id, draftableId);
  }

  return selectedPlayers.map(player => ({
    ...player,
    draftKingsPlayerId: resolved.get(player.id)!,
  }));
}

function validateSelectedPlayers(
  slate: Slate,
  players: Player[],
  playerIds: number[],
  captainId: number | undefined,
): Player[] {
  if (playerIds.length === 0) {
    throw new ExportResolutionError("At least one player is required for export.");
  }
  if (new Set(playerIds).size !== playerIds.length) {
    throw new ExportResolutionError("Export player IDs must be unique.");
  }
  if (captainId != null && !playerIds.includes(captainId)) {
    throw new ExportResolutionError("Captain must be one of the selected players.");
  }

  const byId = new Map(players.map(player => [player.id, player]));
  const selectedPlayers = playerIds.map(playerId => byId.get(playerId));
  if (selectedPlayers.some(player => !player)) {
    const missing = playerIds.find(playerId => !byId.has(playerId));
    throw new ExportResolutionError(
      `Player ${missing} does not belong to the selected slate.`,
    );
  }

  const selected = selectedPlayers as Player[];
  if (selected.some(player => player.slateId !== slate.id)) {
    throw new ExportResolutionError(
      "Every selected player must belong to the selected slate.",
    );
  }
  return selected;
}

/**
 * Resolve the provider IDs used by a fresh export without changing the
 * database rows or any saved lineup snapshot.
 */
export function resolvePlayersForExport(options: ResolvePlayersForExportOptions): Player[] {
  const platform = normalized(options.slate.platform);
  const selectedPlayers = validateSelectedPlayers(
    options.slate,
    options.players,
    options.playerIds,
    options.captainId,
  );

  if (platform === "draftkings") {
    return resolveDraftKingsPlayers(
      options.slate,
      selectedPlayers,
      options.captainId,
      options.draftables || [],
    );
  }

  if (platform === "fanduel") {
    const missing = selectedPlayers.find(player =>
      positiveInteger(player.fanDuelPlayerId) == null,
    );
    if (missing) {
      throw new ExportResolutionError(
        `FanDuel player ID is missing for ${missing.name}.`,
      );
    }
  }

  // Yahoo exports use the names already stored on the selected slate.  Do
  // not force a provider lookup or mutate either provider ID on non-DK rows.
  return selectedPlayers.map(player => ({ ...player }));
}

export const resolveExportPlayers = resolvePlayersForExport;
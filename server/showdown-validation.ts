export interface ShowdownRosterValidation {
  valid: boolean;
  message?: string;
  captainId?: number;
  flexPlayerIds?: number[];
}

export function validateShowdownRoster(
  captainIdInput: unknown,
  flexIdsInput: unknown,
  rosterSize: number,
  availablePlayerIds: Iterable<number>,
): ShowdownRosterValidation {
  const availableIds = new Set(availablePlayerIds);
  const captainId = Number(captainIdInput);
  const flexPlayerIds = Array.isArray(flexIdsInput) ? flexIdsInput.map(Number) : [];
  const hasInvalidId = !Number.isInteger(captainId) ||
    flexPlayerIds.some(id => !Number.isInteger(id));

  if (
    hasInvalidId ||
    !availableIds.has(captainId) ||
    flexPlayerIds.length !== rosterSize - 1 ||
    new Set(flexPlayerIds).size !== flexPlayerIds.length
  ) {
    return {
      valid: false,
      message: "Invalid Showdown roster. Select one captain and the required flex players.",
    };
  }

  if (flexPlayerIds.some(id => id === captainId || !availableIds.has(id))) {
    return {
      valid: false,
      message: "Every saved Showdown player must belong to the selected slate.",
    };
  }

  return { valid: true, captainId, flexPlayerIds };
}
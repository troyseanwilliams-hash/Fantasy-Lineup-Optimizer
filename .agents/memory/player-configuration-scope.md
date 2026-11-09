---
name: Player configuration scope
description: Persistence and precedence decisions for personal player settings shared by Optimizer and Resim.
---

Personal player configuration belongs to an exact user and slate. Do not inherit another slate's settings just because the target has no saved overrides.

**Why:** Users save caps to control concentration for a particular slate until it expires. The earlier source-to-target fallback could silently apply those settings to a different contest during Resim.

**How to apply:** Resolve configuration from the effective target slate. Remapping stable provider player IDs during a refresh of the same slate is appropriate; copying settings across distinct slates is not. Expiry follows the existing latest-game-start lifecycle, not first kickoff. Preserve historical data as read-only rather than deleting it solely for expiry.

Saved player caps are authoritative across generation modes, and must combine with request/global caps using the stricter maximum.

**Why:** A stale optimizer tab or a different Resim screen must not undo a cap the user just saved. Saved-lineup exposure is historical reporting; changing a cap does not itself rewrite those lineups.

**How to apply:** Apply saved attributes server-side and enforce caps on the actual generated batch. Make reset explicit, distinguish historical exposure from new-batch limits, and preserve unsaved edits to other players when saving one row.

Exclusion wins over a lock or positive minimum exposure, including partial updates. Clearing exclusion must not restore those old conflicting settings.

**Why:** Excluding a player must be one action rather than requiring the user to find and clear hidden conflicts first.

**How to apply:** Normalize both interactive edits and merged server updates while retaining unrelated caps, projections and notes.
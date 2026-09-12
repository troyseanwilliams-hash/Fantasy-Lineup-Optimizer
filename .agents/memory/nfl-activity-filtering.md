---
name: NFL activity filtering
description: Why recent-game participation data must not determine NFL optimizer eligibility.
---

Do not use ESPN recently-played coverage to exclude players from NFL classic optimizer pools. Continue using explicit injury status, zero-point history, user exclusions, and contest player-pool membership.

**Why:** Early-week NFL history may contain only one or two completed games, and ESPN activity data may omit required DraftKings positions such as DST. Treating every unmatched player as inactive can reduce a valid Sunday slate to an impossible roster pool.

**How to apply:** Keep NFL recent-activity data informational rather than exclusionary. For other sports, apply it only when the current slate has high coverage in the retrieved history.

Preserve the full eligible NFL DraftKings pool during ingestion; do not take the highest-salary players globally.

**Why:** A global salary cap on player count removed every low-priced defense from an otherwise populated Sunday slate. Player count alone did not reveal that no valid roster could be formed.

**How to apply:** Verify required-position coverage and solve actual nine-slot rosters when changing ingestion or pool filtering. Apply performance trimming at solve time with position coverage, not by discarding contest members during import.
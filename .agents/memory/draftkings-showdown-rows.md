---
name: DraftKings Showdown rows
description: How DraftKings represents players in single-game contest draft groups.
---

DraftKings Showdown draft groups contain two rows per player: a captain-priced row and a flex-priced row. The stored player pool must use the lower flex-priced row because the optimizer applies the captain salary and projection multipliers separately.

**Why:** Keeping the first API row doubles the captain pricing when the optimizer applies its multiplier, producing inflated salaries. Players without a published FPPG must not receive a salary-based projection in Showdown because that makes cheap backups look artificially strong.

**How to apply:** Deduplicate Showdown draftables by underlying player ID using the lowest-salary row, and use zero rather than salary-derived FPPG when DraftKings has no actual FPPG value.
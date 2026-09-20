---
name: NFL GPP portfolio strategy
description: How to apply the user's 2022–2025 large-field NFL top-100 lineup research.
---

Use the historical data as portfolio-level targets rather than universal hard constraints. The core mix is about 10% naked QB, 49% QB+1, 38% QB+2, and 3% QB+3; roughly half should include a skill-position bring-back.

Prioritize at least two sub-10%-owned WRs, five to six games represented, and a secondary two-player correlation in roughly two-thirds of GPP lineups. The preferred secondary pairing is RB plus an opposing WR.

Avoid sub-$4,500 RB punts when alternatives exist. Prefer home TEs, allow TE at FLEX on DraftKings, and prefer home-favorite defenses. Use contest-size total-ownership figures as targets only when reliable ownership and field-size inputs exist.

Do not enforce the observed 4x salary return as a projection floor. It describes winning outcomes and is too strict for pregame median projections; use it as upside/value ranking evidence instead.

**Why:** The source summarizes 34,856 top-100 lineups from 376 large-field contests from 2022–2025. Turning every tendency into a hard per-lineup rule would overfit the sample and make valid portfolios unnecessarily infeasible.

**How to apply:** Allocate discrete lineup counts across the requested portfolio, round percentages to whole lineups, preserve user locks/exclusions/exposure limits, and fail clearly rather than returning invalid or incomplete lineups.

Do not normalize every table in the source into mutually exclusive portfolio quotas. RB/WR venue and implied-total percentages can overlap because a lineup contains multiple players at those positions.

**Why:** Those percentages can legitimately add to more than 100%; treating them like the exclusive QB stack or FLEX distribution changes their meaning.

**How to apply:** Use overlapping observations as preferences or separately measured incidence rates. Historical performance comparisons require dated pre-lock inputs and post-lock actuals; current feeds and synthetic fixtures cannot establish historical profitability.

Exposure feasibility depends on candidate generation as well as final portfolio selection.

**Why:** A realistic full-slate check produced a valid unrestricted batch but failed with an 80% exposure cap: projection jitter alone can keep selecting the same high-value players. The selector cannot choose alternatives that were never generated.

**How to apply:** Generate deliberate alternatives for overrepresented players and minimum-exposure targets, while preserving locks. Distinguish an exhausted search budget from proven infeasibility; never relax hard exposures silently.

Exposure maxima are final-batch invariants, not candidate-ranking preferences.

**Why:** Legacy fill-to-count and minimum-exposure replacement passes could undo an earlier valid selection, producing more than the configured maximum. Source-preserving Resim clones can also make all-saved exposure differ from the newly generated batch.

**How to apply:** Validate the final returned/saved set against its actual count after every selection stage; neither player overrides nor locks may silently loosen a global maximum. Distinguish batch exposure from historical saved-lineup exposure in reports.
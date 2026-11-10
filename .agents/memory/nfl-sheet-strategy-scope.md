---
name: NFL sheet strategy scope
description: Scope and safety decisions for the uploaded Showdown build specification and separate Classic audit.
---
The user chose “Both, kept separate.” The later CLASSIC_LOGIC document supersedes the original Classic audit-only scope and its 25%/20% caps: apply the new Classic formulas to live NFL DraftKings Classic GPP generation and refresh, while keeping Showdown separate.

**Why:** The user subsequently supplied a dedicated Classic specification and said “Implement and use only the data needed for these formulas. Then clean up the rest to simplify.” They explicitly clarified “Keep Legacy Sim controls on top of this logic.”

**How to apply:** Preserve Ceiling, Leverage, Outperformer, simulation count and sort controls; layer ranking over the hard Classic eligibility, exposure, ownership and structure rules. Do not let a legacy preset bypass current rules. Retain explicit approval for final-upload changes and all saved history.

Keep the Showdown minimum two-roster-spot difference strict.

NFL Classic uses existing app data by default; a separate DFS Army evidence import is optional.

**Why:** The mandatory per-slate import blocked generation. The user explicitly chose “Use existing app data” instead of strict DFS Army-only inputs.

**How to apply:** Keep legacy Sim controls and implementable Classic caps/structure rules. Report unavailable weather, freshness, role and matchup checks as unverified; never invent evidence to satisfy them. Imported strict evidence remains an optional mode.

Keep exposure caps strict even for small batches; do not round them up.

**Why:** After a five-lineup search failed, the user explicitly chose “Keep strict caps” instead of rounded small-batch caps.

**How to apply:** Improve candidate diversity and explain proven capacity conflicts separately from search exhaustion. Never silently weaken exposure or quality rules to fill a batch.

Sim may return fewer than the requested maximum, but only as a newly validated complete portfolio at the actual returned size. Normal mode remains exact-count.

**Why:** The user approved fewer Sim lineups when 500 cannot be built, while explicitly pointing out that five-lineup Normal generation also needs fixing.

**How to apply:** Recalculate all exposure and architecture counts for the returned Sim batch, preserve the original quality floor, and disclose the shortfall. Never truncate a portfolio or treat a passing synthetic fixture as evidence that the current slate is fixed.

**Why:** The document calls it a hard constraint but later suggests relaxing it; silently relaxing would misrepresent the final audit. The user was told the stricter interpretation would be used.

**How to apply:** Report bounded search exhaustion rather than returning a weaker or partial set. Use supplied CPT/FLEX ownership, not invented substitutes.

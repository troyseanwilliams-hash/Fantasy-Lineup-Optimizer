---
name: NFL sheet strategy scope
description: Scope and safety decisions for the uploaded Showdown build specification and separate Classic audit.
---
The user chose “Both, kept separate.” The later CLASSIC_LOGIC document supersedes the original Classic audit-only scope and its 25%/20% caps: apply the new Classic formulas to live NFL DraftKings Classic GPP generation and refresh, while keeping Showdown separate.

**Why:** The user subsequently supplied a dedicated Classic specification and said “Implement and use only the data needed for these formulas. Then clean up the rest to simplify.” They explicitly clarified “Keep Legacy Sim controls on top of this logic.”

**How to apply:** Preserve Ceiling, Leverage, Outperformer, simulation count and sort controls; layer ranking over the hard Classic eligibility, exposure, ownership and structure rules. Do not let a legacy preset bypass current rules. Retain explicit approval for final-upload changes and all saved history.

Keep the Showdown minimum two-roster-spot difference strict.

**Why:** The document calls it a hard constraint but later suggests relaxing it; silently relaxing would misrepresent the final audit. The user was told the stricter interpretation would be used.

**How to apply:** Report bounded search exhaustion rather than returning a weaker or partial set. Use supplied CPT/FLEX ownership, not invented substitutes.

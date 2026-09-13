---
name: DraftKings Classic roster rows
description: Live Classic feeds can contain separate equal-priced positional and FLEX entries for one athlete.
---

Do not assume multiple equal-priced draftables imply ambiguous athlete identity in Classic feeds. NFL live feeds have separate positional and FLEX draftable IDs for the same stable athlete at the same salary.

**Why:** A live export investigation verified WR and FLEX entries for one athlete with distinct contest IDs. Rejecting every salary tie blocks valid Classic exports.

**How to apply:** Preserve an exact saved contest ID when it is verified against the selected draft group's live identity. Do not extend that preference to Showdown captain/FLEX resolution, or guess between distinct IDs when only a legacy athlete ID is known.
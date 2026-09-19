---
name: DraftKings Classic roster rows
description: Live Classic feeds can contain separate equal-priced positional and FLEX entries for one athlete.
---

Do not assume multiple equal-priced draftables imply ambiguous athlete identity in Classic feeds. NFL live feeds have separate positional and FLEX draftable IDs for the same stable athlete at the same salary.

**Why:** A live export investigation verified WR and FLEX entries for one athlete with distinct contest IDs. Rejecting every salary tie blocks valid Classic exports.

**How to apply:** Verify Classic export IDs against the official DraftKings downloadable salary CSV, not merely the live draftables feed. Do not extend Classic ID selection to Showdown captain/FLEX resolution.

The live draftables feed is not sufficient proof of CSV-upload eligibility: it includes separate FLEX IDs absent from the official salary CSV, whose positional ID supports both the position and FLEX.

**Why:** A direct comparison of an NFL Classic group's public draftables and official salary CSV found 555 additional API IDs absent from the 670-player CSV. Preserving an exact saved API ID can therefore pass identity validation without matching the upload template.

**How to apply:** Use the official group-specific CSV as the upload-ID reference. A rejected file is still needed to establish whether this discrepancy caused a particular rejection.
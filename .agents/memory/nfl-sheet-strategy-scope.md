---
name: NFL sheet strategy scope
description: Scope and safety decisions for the uploaded Showdown build specification and separate Classic audit.
---
The user chose “Both, kept separate”: apply the sheet-driven Showdown strategy and provide the separate Classic final-upload exposure audit, without applying captain rules to Classic or replacing its existing generation strategy.

**Why:** The supplied specification primarily describes captain-mode construction; its Classic section instead calls for 25% player caps, 20% QB/DST caps, and user approval of proposed changes.

**How to apply:** Preserve that distinction and clearly identify sheet-based results versus live generation/simulation. Do not imply the workbench automatically changes the existing optimizer or saved entries.

Keep the Showdown minimum two-roster-spot difference strict.

**Why:** The document calls it a hard constraint but later suggests relaxing it; silently relaxing would misrepresent the final audit. The user was told the stricter interpretation would be used.

**How to apply:** Report bounded search exhaustion rather than returning a weaker or partial set. Use supplied CPT/FLEX ownership, not invented substitutes.

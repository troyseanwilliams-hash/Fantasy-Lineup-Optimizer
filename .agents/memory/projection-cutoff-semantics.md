---
name: Projection cutoff semantics
description: Keep user-controlled player eligibility separate from optimizer score adjustments.
---

Treat Min Projection as a player-eligibility rule, not a total-lineup points floor or exposure requirement. Determine eligibility from the input projection, including explicit projection edits and manual point boosts, before server-only scoring adjustments and simulated variation.

**Why:** Applying the cutoff to differently adjusted or randomized scores makes the same input player eligible in one generation mode but excluded in another. A lock must report a cutoff conflict rather than override the user's exclusion.

**How to apply:** When adding scoring transforms or optimizer modes, preserve the input eligibility decision through sampling and solving. Keep Max Exposure independent, and distinguish manual point boosts from automatic scoring adjustments.
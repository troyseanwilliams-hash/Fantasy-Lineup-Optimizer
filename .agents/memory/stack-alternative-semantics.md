---
name: Stack alternative semantics
description: Mixed game and exact-player favorites must behave as alternatives, not combined requirements.
---

Selected game stacks and exact-player favorites are alternatives: choose one stack requirement per lineup. This does not prohibit the completed lineup from incidentally satisfying another favorite.

**Why:** Forcing all favorites together defeats the user's ability to nominate several candidate stacks. Even an unselected game's dependent constraints can accidentally make a valid exact-player alternative infeasible.

**How to apply:** Gate every alternative-specific dependent constraint on that alternative's selection, while keeping global roster rules independent. Test adding an infeasible, unselected alternative does not invalidate an otherwise feasible selected stack.